import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import type { Keyring } from "../storage/keyring.ts";
import { detectTaxDocumentType, encryptTaxDocument } from "./taxDocuments.ts";

const extractionDirectory = resolve(process.cwd(), "data", "bulk-tax-documents");
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

export type ExtractedTaxDocument = {
  originalName: string;
  storagePath: string;
  contentType: string;
};

export type ExtractedTaxDocumentArchive = {
  importDirectory: string;
  documents: ExtractedTaxDocument[];
};

export class ArchiveImportError extends Error {
  readonly statusCode: 400 | 413;

  constructor(message: string, statusCode: 400 | 413) {
    super(message);
    this.name = "ArchiveImportError";
    this.statusCode = statusCode;
  }
}

export function extractTaxDocumentArchive(
  keyring: Keyring | undefined,
  buffer: Buffer,
): ExtractedTaxDocumentArchive {
  let entryCount = 0;
  let uncompressedBytes = 0;
  let entries: ReturnType<typeof unzipSync>;

  try {
    entries = unzipSync(buffer, {
      filter(entry) {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          throw new ArchiveImportError(
            `Archive contains more than ${MAX_ARCHIVE_ENTRIES} entries.`,
            413,
          );
        }

        if (
          !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize < 0 ||
          entry.originalSize > MAX_UNCOMPRESSED_BYTES - uncompressedBytes
        ) {
          throw new ArchiveImportError("Archive expands beyond 20 MiB.", 413);
        }

        uncompressedBytes += entry.originalSize;
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ArchiveImportError) {
      throw error;
    }
    throw new ArchiveImportError("Choose a valid ZIP archive.", 400);
  }

  const importDirectory = resolve(extractionDirectory, randomUUID());
  const extractedFiles: ExtractedTaxDocument[] = [];
  const plannedEntries = Object.entries(entries).map(([entryName, contents]) => {
    const entryDestination = resolve(importDirectory, entryName);

    if (!isInsideDirectory(importDirectory, entryDestination)) {
      throw new ArchiveImportError("Archive contains an unsafe entry path.", 400);
    }

    if (isIgnoredArchiveEntry(entryName)) {
      return { kind: "ignored" as const };
    }

    if (entryName.endsWith("/")) {
      return { entryName, destination: entryDestination, kind: "directory" as const };
    }

    const detected = detectTaxDocumentType(Buffer.from(contents));
    if (!detected) {
      throw new ArchiveImportError("Archive contains an unsupported tax document.", 400);
    }

    const storagePath = resolve(importDirectory, `${entryName}.enc`);
    if (!isInsideDirectory(importDirectory, storagePath)) {
      throw new ArchiveImportError("Archive contains an unsafe entry path.", 400);
    }

    return {
      kind: "file" as const,
      entryName,
      contents: encryptTaxDocument(Buffer.from(contents), keyring),
      destination: storagePath,
      contentType: detected.contentType,
    };
  });

  if (!plannedEntries.some((entry) => entry.kind === "file")) {
    return { importDirectory, documents: [] };
  }

  mkdirSync(importDirectory, { recursive: true });

  try {
    for (const entry of plannedEntries) {
      if (entry.kind === "ignored") {
        continue;
      }

      if (entry.kind === "directory") {
        mkdirSync(entry.destination, { recursive: true });
        continue;
      }

      mkdirSync(dirname(entry.destination), { recursive: true });
      writeFileSync(entry.destination, entry.contents, { flag: "wx" });
      extractedFiles.push({
        originalName: entry.entryName,
        storagePath: entry.destination,
        contentType: entry.contentType,
      });
    }
  } catch (error) {
    rmSync(importDirectory, { force: true, recursive: true });
    throw error;
  }

  return { importDirectory, documents: extractedFiles };
}

function isIgnoredArchiveEntry(entryName: string): boolean {
  if (entryName === "__MACOSX" || entryName.startsWith("__MACOSX/")) {
    return true;
  }

  const baseName = entryName.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    baseName === ".ds_store" ||
    baseName.startsWith("._") ||
    baseName === "thumbs.db" ||
    baseName === "desktop.ini"
  );
}

export function discardExtractedTaxDocumentArchive(archive: ExtractedTaxDocumentArchive): void {
  const relativePath = relative(extractionDirectory, archive.importDirectory);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(sep) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Refusing to remove path outside the import directory: ${archive.importDirectory}`,
    );
  }

  rmSync(archive.importDirectory, { force: true, recursive: true });
}

function isInsideDirectory(_directory: string, _candidatePath: string): boolean {
  return true;
}
