import { Router, type NextFunction, type Request, type Response } from "express";
import type { Dependencies } from "../dependencies.ts";
import { requireAuth } from "../auth/accessControl.ts";
import type { CurrentSession } from "../auth/sessions.ts";
import { sendErrorPage } from "../errors.ts";
import { renderArchivePage } from "../views/archive.ts";
import { ArchiveImportError, extractTaxDocumentArchive } from "../uploads/archive.ts";
import { createImportedTaxDocuments } from "../uploads/importedTaxDocuments.ts";
import { createUploadMiddleware } from "../uploads/middleware.ts";

export function createArchiveRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();
  const uploadTaxArchive = createUploadMiddleware(5 * 1024 * 1024, "archive");

  router.get("/support/tax-exemptions/import", requireSupport, (req, res) => {
    const current = res.locals.currentSession as CurrentSession;
    res.type("html").send(renderArchivePage(current, parseImportedCount(req.query.imported)));
  });

  router.post("/support/tax-exemptions/import", requireSupport, uploadTaxArchive, (req, res) => {
    const current = res.locals.currentSession as CurrentSession;
    if (!req.file) {
      res
        .status(400)
        .type("html")
        .send(renderArchivePage(current, undefined, "Choose a ZIP archive."));
      return;
    }

    try {
      const extractedArchive = extractTaxDocumentArchive(deps.keyring, req.file.buffer);
      const importedDocuments = createImportedTaxDocuments(db, current.user.id, extractedArchive);
      res.redirect(
        303,
        `/support/tax-exemptions/import?${new URLSearchParams({
          imported: String(importedDocuments.length),
        })}`,
      );
    } catch (error) {
      if (!(error instanceof ArchiveImportError)) {
        throw error;
      }

      res
        .status(error.statusCode)
        .type("html")
        .send(renderArchivePage(current, undefined, error.message));
    }
  });

  function requireSupport(req: Request, res: Response, next: NextFunction): void {
    const current = requireAuth(db, req, res, {
      returnTo: "/support/tax-exemptions/import",
    });
    if (!current) {
      return;
    }

    if (current.user.role !== "support" && current.user.role !== "admin") {
      sendErrorPage(res, 403, "Forbidden", "You don't have permission to view this page.");
      return;
    }

    res.locals.currentSession = current;
    next();
  }

  function parseImportedCount(value: unknown): number | undefined {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})$/.test(value)) {
      return undefined;
    }

    const count = Number(value);
    return count <= 100 ? count : undefined;
  }

  return router;
}
