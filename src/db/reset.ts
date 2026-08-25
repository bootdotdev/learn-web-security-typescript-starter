import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.ts";

type ForeignKeyViolation = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

type StoredUpload = {
  storage_path: string;
};

const uploadDirectory = resolve(process.cwd(), "data", "uploads");
const bulkImportDirectory = resolve(process.cwd(), "data", "bulk-tax-documents");

function assertForeignKeyIntegrity(db: DatabaseSync): void {
  const violations = db.prepare("PRAGMA foreign_key_check").all() as ForeignKeyViolation[];
  if (violations.length === 0) {
    return;
  }

  const details = violations
    .map(({ table, rowid, parent }) => `${table}[rowid=${rowid ?? "unknown"}] -> ${parent}`)
    .join(", ");
  throw new Error(`Seed data violates foreign key constraints: ${details}`);
}

function getReferencedUploads(db: DatabaseSync): Set<string> {
  const hasUploadsTable = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'uploaded_files'")
    .get();
  if (!hasUploadsTable) {
    return new Set();
  }

  const uploads = db.prepare("SELECT storage_path FROM uploaded_files").all() as StoredUpload[];
  return new Set(uploads.map(({ storage_path }) => resolve(storage_path)));
}

function isInsideUploadDirectory(filePath: string): boolean {
  const relativePath = relative(uploadDirectory, filePath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function cleanupOrphanedUploads(db: DatabaseSync): void {
  mkdirSync(uploadDirectory, { recursive: true });
  if (lstatSync(uploadDirectory).isSymbolicLink()) {
    throw new Error(`Refusing to clean symbolic-link upload directory: ${uploadDirectory}`);
  }

  const referencedUploads = getReferencedUploads(db);
  for (const entry of readdirSync(uploadDirectory, { withFileTypes: true })) {
    const filePath = join(uploadDirectory, entry.name);
    if (!entry.isFile() || !isInsideUploadDirectory(filePath) || referencedUploads.has(filePath)) {
      continue;
    }
    unlinkSync(filePath);
  }
}

function emptyBulkImportDirectory(): void {
  mkdirSync(bulkImportDirectory, { recursive: true });
  if (lstatSync(bulkImportDirectory).isSymbolicLink()) {
    throw new Error(`Refusing to clean symbolic-link import directory: ${bulkImportDirectory}`);
  }

  emptyDirectory(bulkImportDirectory);
}

function emptyDirectory(directoryPath: string): void {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    const relativePath = relative(bulkImportDirectory, entryPath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`Refusing to clean path outside import directory: ${entryPath}`);
    }

    if (entry.isSymbolicLink() || entry.isFile()) {
      unlinkSync(entryPath);
      continue;
    }

    if (!entry.isDirectory()) {
      throw new Error(`Refusing to clean unsupported import entry: ${entryPath}`);
    }

    emptyDirectory(entryPath);
    rmdirSync(entryPath);
  }
}

export function resetDb(db: DatabaseSync, seedData: (db: DatabaseSync) => void): void {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = OFF");

  let transactionStarted = false;
  try {
    db.exec("BEGIN EXCLUSIVE");
    transactionStarted = true;

    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    for (const { name } of tables) {
      db.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
    }

    applySchema(db);
    seedData(db);
    assertForeignKeyIntegrity(db);
    db.exec("COMMIT");
    transactionStarted = false;

    cleanupOrphanedUploads(db);
    emptyBulkImportDirectory();
  } catch (error) {
    const failures: unknown[] = [error];
    let rollbackComplete = !db.isTransaction;
    if (db.isTransaction) {
      try {
        db.exec("ROLLBACK");
        rollbackComplete = true;
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (transactionStarted && rollbackComplete) {
      try {
        cleanupOrphanedUploads(db);
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Database reset failed with additional cleanup errors");
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
