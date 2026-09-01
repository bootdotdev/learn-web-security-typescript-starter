import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { readTaxDocument } from "../uploads/taxDocuments.ts";
import { requireAuth, requireRole } from "../auth/accessControl.ts";
import { sendErrorPage } from "../errors.ts";
import { findUploadedFileById } from "../uploads/index.ts";
import { findImportedTaxDocumentById } from "../uploads/importedTaxDocuments.ts";
import {
  createSignedDownloadPath,
  verifySignedDownload,
} from "../uploads/signedDownloads.ts";

export function createFilesRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/files/:id/download", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const fileId = Number(req.params.id);
    if (!Number.isSafeInteger(fileId)) {
      sendErrorPage(res, 404, "File Not Found", "We couldn't find that file.");
      return;
    }

    const file = findUploadedFileById(db, fileId);
    if (!file) {
      sendErrorPage(res, 404, "File Not Found", "We couldn't find that file.");
      return;
    }

    res.redirect(createSignedDownloadPath(deps.downloadSigningKey, file.id));
  });

  router.get("/files/:id/signed-download", (req, res) => {
    const fileId = Number(req.params.id);
    const expires =
      typeof req.query.expires === "string" ? req.query.expires : "";
    const signature =
      typeof req.query.signature === "string" ? req.query.signature : "";

    if (
      !Number.isSafeInteger(fileId) ||
      !verifySignedDownload(deps.downloadSigningKey, fileId, expires, signature)
    ) {
      sendErrorPage(
        res,
        403,
        "Download Link Unavailable",
        "This download link is invalid or has expired.",
      );
      return;
    }

    const file = findUploadedFileById(db, fileId);
    if (!file) {
      sendErrorPage(res, 404, "File Not Found", "We couldn't find that file.");
      return;
    }

    const plaintext = readTaxDocument(file.storage_path, deps.keyring);
    res.attachment(file.original_name);
    res.type(file.content_type).send(plaintext);
  });

  router.get("/support/files/imports/:id/download", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) {
      return;
    }

    const importedDocumentId = Number(req.params.id);
    if (!Number.isSafeInteger(importedDocumentId)) {
      sendErrorPage(res, 404, "File Not Found", "We couldn't find that file.");
      return;
    }

    const importedDocument = findImportedTaxDocumentById(
      db,
      importedDocumentId,
    );
    if (!importedDocument) {
      sendErrorPage(res, 404, "File Not Found", "We couldn't find that file.");
      return;
    }

    const plaintext = readTaxDocument(
      importedDocument.storage_path,
      deps.keyring,
    );
    res.attachment(importedDocument.original_name);
    res.type(importedDocument.content_type).send(plaintext);
  });

  return router;
}
