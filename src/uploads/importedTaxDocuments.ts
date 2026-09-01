import type { DatabaseSync } from "node:sqlite";
import {
  discardExtractedTaxDocumentArchive,
  type ExtractedTaxDocumentArchive,
} from "./archive.ts";

export type ImportedTaxDocument = {
  id: number;
  imported_by_user_id: number;
  imported_by_name: string;
  original_name: string;
  storage_path: string;
  content_type: string;
  created_at: string;
};

export function createImportedTaxDocuments(
  db: DatabaseSync,
  importedByUserId: number,
  archive: ExtractedTaxDocumentArchive,
): ImportedTaxDocument[] {
  let transactionStarted = false;
  try {
    const insertDocument = db.prepare(
      `
        INSERT INTO imported_tax_documents (
          imported_by_user_id,
          original_name,
          storage_path,
          content_type
        )
        VALUES (?, ?, ?, ?)
      `,
    );

    db.exec("BEGIN");
    transactionStarted = true;
    const importedDocuments = archive.documents.map((document) => {
      const result = insertDocument.run(
        importedByUserId,
        document.originalName,
        document.storagePath,
        document.contentType,
      );
      const importedDocument = findImportedTaxDocumentById(
        db,
        Number(result.lastInsertRowid),
      );
      if (!importedDocument) {
        throw new Error("Failed to create imported tax document");
      }
      return importedDocument;
    });
    db.exec("COMMIT");
    transactionStarted = false;
    return importedDocuments;
  } catch (error) {
    const failures: unknown[] = [error];
    if (transactionStarted && db.isTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    try {
      discardExtractedTaxDocumentArchive(archive);
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Tax document import failed with additional cleanup errors",
      );
    }
    throw error;
  }
}

export function findImportedTaxDocumentById(
  db: DatabaseSync,
  importedDocumentId: number,
): ImportedTaxDocument | undefined {
  return db
    .prepare(
      `
        SELECT
          imported_tax_documents.id,
          imported_tax_documents.imported_by_user_id,
          users.display_name AS imported_by_name,
          imported_tax_documents.original_name,
          imported_tax_documents.storage_path,
          imported_tax_documents.content_type,
          imported_tax_documents.created_at
        FROM imported_tax_documents
        JOIN users ON users.id = imported_tax_documents.imported_by_user_id
        WHERE imported_tax_documents.id = ?
      `,
    )
    .get(importedDocumentId) as ImportedTaxDocument | undefined;
}

export function listImportedTaxDocuments(
  db: DatabaseSync,
): ImportedTaxDocument[] {
  return db
    .prepare(
      `
        SELECT
          imported_tax_documents.id,
          imported_tax_documents.imported_by_user_id,
          users.display_name AS imported_by_name,
          imported_tax_documents.original_name,
          imported_tax_documents.storage_path,
          imported_tax_documents.content_type,
          imported_tax_documents.created_at
        FROM imported_tax_documents
        JOIN users ON users.id = imported_tax_documents.imported_by_user_id
        ORDER BY imported_tax_documents.created_at DESC, imported_tax_documents.id DESC
      `,
    )
    .all() as ImportedTaxDocument[];
}
