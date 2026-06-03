import { existsSync, readFileSync, rmSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { storeTaxDocument } from "../uploads/taxDocuments.ts";
import { deserializeEncryptedPayload, type Keyring } from "./keyring.ts";

type PlaintextTaxDocumentRow = {
  id: number;
  original_name: string;
  storage_path: string;
};

type TaxDocumentTable = "uploaded_files" | "imported_tax_documents";

const seededFixtureName = "mystery-shack-tax-exemption.pdf";
const runtimeDocumentDirectories = [
  resolve("data", "uploads"),
  resolve("data", "bulk-tax-documents"),
];

export function migrateSensitiveDataAtRest(
  database: DatabaseSync,
  keyring: Keyring | undefined,
): void {
  if (!keyring) {
    return;
  }

  migrateTaxDocumentTable(database, keyring, "uploaded_files");
  migrateTaxDocumentTable(database, keyring, "imported_tax_documents");
}

function migrateTaxDocumentTable(
  database: DatabaseSync,
  keyring: Keyring,
  table: TaxDocumentTable,
): void {
  const rows = database
    .prepare(
      `
        SELECT id, original_name, storage_path
        FROM ${table}
      `,
    )
    .all() as unknown as PlaintextTaxDocumentRow[];

  const update = database.prepare(
    `
      UPDATE ${table}
      SET storage_path = ?, content_type = ?
      WHERE id = ?
    `,
  );

  for (const row of rows) {
    const configuredPath = resolve(row.storage_path);
    if (existsSync(configuredPath) && !isRuntimeDocumentPath(configuredPath)) {
      throw new Error(`Unsafe plaintext tax document path: ${row.storage_path}`);
    }
    if (existsSync(configuredPath) && isSerializedEncryptedPayload(configuredPath)) {
      continue;
    }

    const fixturePath = resolve("data", "fixtures", seededFixtureName);
    const sourcePath = existsSync(configuredPath)
      ? configuredPath
      : row.original_name === seededFixtureName && existsSync(fixturePath)
        ? fixturePath
        : undefined;
    if (!sourcePath) {
      throw new Error(`Missing plaintext tax document: ${row.storage_path}`);
    }

    const stored = storeTaxDocument(readFileSync(sourcePath), keyring);
    if (!stored) {
      throw new Error(`Invalid plaintext tax document: ${row.storage_path}`);
    }
    if (!isSerializedEncryptedPayload(stored.storagePath)) {
      rmSync(stored.storagePath, { force: true });
      continue;
    }

    try {
      update.run(stored.storagePath, stored.contentType, row.id);
    } catch (error) {
      rmSync(stored.storagePath, { force: true });
      throw error;
    }

    if (sourcePath === configuredPath) {
      rmSync(configuredPath, { force: true });
    }
  }
}

function isSerializedEncryptedPayload(storagePath: string): boolean {
  try {
    deserializeEncryptedPayload(readFileSync(storagePath));
    return true;
  } catch {
    return false;
  }
}

function isRuntimeDocumentPath(path: string): boolean {
  return runtimeDocumentDirectories.some((directory) => {
    const relativePath = relative(directory, path);
    return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
  });
}
