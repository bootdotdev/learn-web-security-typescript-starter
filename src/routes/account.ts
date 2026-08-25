import { Router, type Request, type Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import { requireAuth, requireRecentAuth } from "../auth/accessControl.ts";
import type { CurrentSession } from "../auth/sessions.ts";
import { verifyTotpCode } from "../auth/totp.ts";
import { generateBackupCodes } from "../auth/totpBackupCodes.ts";
import {
  clearTotpSecret,
  confirmTotpSecret,
  findUserByEmail,
  getPendingTotpSecret,
  normalizeEmail,
  setPendingTotpSecret,
  updateUserEmail,
} from "../auth/users.ts";
import type { Dependencies } from "../dependencies.ts";
import { sendErrorPage } from "../errors.ts";
import { logEvent } from "../logger.ts";
import {
  deleteReview,
  findReviewById,
  listReviewsForUser,
  parseReviewBody,
  updateReview,
  type Review,
} from "../reviews.ts";
import { createUploadedFile, listUploadedFilesForUser } from "../uploads/index.ts";
import { createUploadMiddleware } from "../uploads/middleware.ts";
import { storeTaxDocument } from "../uploads/taxDocuments.ts";
import {
  renderAccountPage,
  renderReviewFormPage,
  renderReviewsPage,
  renderTaxExemptionPage,
  renderTotpBackupCodesPage,
  renderTotpEnabledPage,
  renderTotpSetupPage,
} from "../views/account.ts";

export function createAccountRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();
  const uploadTaxDocument = createUploadMiddleware(5 * 1024 * 1024, "document");

  router.get("/account", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    res.type("html").send(renderAccountPage(current));
  });

  router.get("/account/totp", async (req, res) => {
    const current = requireRecentAuth(db, req, res, "/account/totp");
    if (!current) return;
    if (current.user.has_totp) {
      res
        .type("html")
        .send(renderTotpEnabledPage(current.user.display_name, current.session.csrf_token));
      return;
    }
    const secret = getPendingTotpSecret(db, current.user.id) ?? startTotpEnrollment(db, current);
    const qrDataUrl = await QRCode.toDataURL(
      generateURI({ issuer: "Bearly Secure", label: current.user.email, secret }),
    );
    res.type("html").send(renderTotpSetupPage(current.user.display_name, secret, qrDataUrl));
  });

  router.post("/account/totp/confirm", async (req, res) => {
    const current = requireRecentAuth(db, req, res, "/account/totp");
    if (!current) return;
    const pendingSecret = getPendingTotpSecret(db, current.user.id);
    if (!pendingSecret) {
      res.redirect("/account/totp");
      return;
    }
    const code = String(req.body.code ?? "").trim();
    if (!verifyTotpCode(code, pendingSecret)) {
      logEvent("totp_enrollment_failed", { userId: current.user.id, email: current.user.email });
      const qrDataUrl = await QRCode.toDataURL(
        generateURI({ issuer: "Bearly Secure", label: current.user.email, secret: pendingSecret }),
      );
      res
        .status(400)
        .type("html")
        .send(
          renderTotpSetupPage(
            current.user.display_name,
            pendingSecret,
            qrDataUrl,
            "Invalid code. Try again.",
          ),
        );
      return;
    }
    confirmTotpSecret(db, current.user.id);
    const backupCodes = generateBackupCodes(db, current.user.id);
    logEvent("totp_enrollment_confirmed", { userId: current.user.id, email: current.user.email });
    res.type("html").send(renderTotpBackupCodesPage(current.user.display_name, backupCodes));
  });

  router.post("/account/totp/disable", (req, res) => {
    const current = requireRecentAuth(db, req, res, "/account/totp");
    if (!current) return;
    if (!current.user.has_totp) {
      res.redirect("/account");
      return;
    }
    clearTotpSecret(db, current.user.id);
    logEvent("totp_disabled", { userId: current.user.id, email: current.user.email });
    res.redirect("/account");
  });

  router.post("/account/email", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    const currentPassword = String(req.body.currentPassword ?? "");
    if (!currentPassword) {
      res
        .status(403)
        .type("html")
        .send(renderAccountPage(current, "Re-enter your current password to change your email."));
      return;
    }
    const email = normalizeEmail(String(req.body.email ?? ""));
    if (!email) {
      res.status(400).type("html").send(renderAccountPage(current, "Email is required."));
      return;
    }
    const existing = findUserByEmail(db, email);
    if (existing && existing.id !== current.user.id) {
      res.status(409).type("html").send(renderAccountPage(current, "Email is already in use."));
      return;
    }
    updateUserEmail(db, current.user.id, email);
    res.redirect("/account");
  });

  router.get("/account/tax-exemption", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    res
      .type("html")
      .send(
        renderTaxExemptionPage(
          current.user.display_name,
          listUploadedFilesForUser(db, current.user.id),
        ),
      );
  });

  router.post(
    "/account/tax-exemption/files",
    (req, res, next) => {
      const current = requireAuth(db, req, res);
      if (!current) return;
      res.locals.currentSession = current;
      next();
    },
    uploadTaxDocument,
    (req, res) => {
      const current = res.locals.currentSession as CurrentSession;
      const file = req.file;
      if (!file) {
        sendTaxUploadError(db, res, current, "Choose a PDF, JPEG, PNG, or WebP file to upload.");
        return;
      }
      const storedDocument = storeTaxDocument(file.buffer, deps.keyring);
      if (!storedDocument) {
        sendTaxUploadError(db, res, current, "Choose a valid PDF, JPEG, PNG, or WebP file.");
        return;
      }
      const uploadedFile = createUploadedFile(
        db,
        current.user.id,
        file.originalname,
        storedDocument.storagePath,
        storedDocument.contentType,
      );
      logEvent("tax_exemption_uploaded", {
        userId: current.user.id,
        email: current.user.email,
        uploadedFileId: uploadedFile.id,
        originalName: file.originalname,
        contentType: storedDocument.contentType,
        storagePath: storedDocument.storagePath,
        size: file.size,
      });
      res.redirect("/account/tax-exemption");
    },
  );

  router.get("/account/reviews", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    res
      .type("html")
      .send(renderReviewsPage(listReviewsForUser(db, current.user.id), current.user.display_name));
  });

  router.get("/account/reviews/:id/edit", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    const review = requireOwnedReview(db, req, res);
    if (!review) return;
    res
      .type("html")
      .send(renderReviewFormPage(review, current.session.csrf_token, current.user.display_name));
  });

  router.post("/account/reviews/:id", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    const review = requireOwnedReview(db, req, res);
    if (!review) return;
    const rating = Number(req.body.rating);
    const body = parseReviewBody(req.body.body);
    if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5 || body === undefined) {
      res
        .status(400)
        .type("html")
        .send(
          renderReviewFormPage(
            { ...review, rating, body: body ?? "" },
            current.session.csrf_token,
            current.user.display_name,
            "Invalid review.",
          ),
        );
      return;
    }
    updateReview(db, review.id, rating, body);
    res.redirect("/account/reviews");
  });

  router.post("/account/reviews/:id/delete", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) return;
    const review = requireOwnedReview(db, req, res);
    if (!review) return;
    deleteReview(db, review.id);
    res.redirect("/account/reviews");
  });

  return router;
}

function startTotpEnrollment(db: DatabaseSync, current: CurrentSession): string {
  const secret = generateSecret();
  setPendingTotpSecret(db, current.user.id, secret);
  logEvent("totp_enrollment_started", { userId: current.user.id, email: current.user.email });
  return secret;
}

function sendTaxUploadError(
  db: DatabaseSync,
  res: Response,
  current: CurrentSession,
  message: string,
): void {
  res
    .status(400)
    .type("html")
    .send(
      renderTaxExemptionPage(
        current.user.display_name,
        listUploadedFilesForUser(db, current.user.id),
        message,
      ),
    );
}

function requireOwnedReview(
  db: DatabaseSync,
  req: Request,
  res: Response,
  userId?: number,
): Review | undefined {
  const reviewId = Number(req.params.id);
  if (!Number.isSafeInteger(reviewId)) {
    sendErrorPage(res, 404, "Review Not Found", "We couldn't find that review.");
    return undefined;
  }
  const review = findReviewById(db, reviewId);
  if (!review || (userId !== undefined && review.user_id !== userId)) {
    sendErrorPage(res, 404, "Review Not Found", "We couldn't find that review.");
    return undefined;
  }
  return review;
}
