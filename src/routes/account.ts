import { Router, type Request, type Response } from "express";
import { getCurrentSession, type CurrentSession } from "../auth/sessions.ts";
import { findUserByEmail, updateUserEmail } from "../auth/users.ts";
import { renderPage } from "../html.ts";
import {
  deleteReview,
  findReviewById,
  listReviewsForUser,
  updateReview,
  type Review,
} from "../reviews/index.ts";
import {
  createUploadedFile,
  listUploadedFilesForUser,
  type UploadedFile,
} from "../uploads/index.ts";
import { uploadTaxDocument } from "../uploads/middleware.ts";
import { logEvent } from "../logger.ts";

export const router = Router();

router.get("/account", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  res.type("html").send(renderAccountPage(current));
});

router.post("/account/email", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const email = String(req.body.email ?? "").trim();
  if (!email) {
    res.status(400).type("html").send(renderAccountPage(current, "Email is required."));
    return;
  }

  const existing = findUserByEmail(email);
  if (existing && existing.id !== current.user.id) {
    res.status(409).type("html").send(renderAccountPage(current, "Email is already in use."));
    return;
  }

  updateUserEmail(current.user.id, email);
  res.redirect("/account");
});

function renderAccountPage(current: CurrentSession, error: string = ""): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";
  const supportCard =
    current.user.role === "support" || current.user.role === "admin"
      ? `<article class="card">
          <h2>Support</h2>
          <p>Review customer orders and internal notes.</p>
          <a href="/support">Open support dashboard</a>
        </article>`
      : "";
  const adminCard =
    current.user.role === "admin"
      ? `<article class="card">
          <h2>Admin</h2>
          <p>Review product pricing, inventory, and internal costs.</p>
          <a href="/admin">Open admin dashboard</a>
        </article>`
      : "";

  return renderPage(
    "Your Account",
    `
      <nav><a href="/">Back to store</a></nav>
      <p class="eyebrow">Account</p>
      <h1>Your Profile</h1>
      ${errorMessage}
      <section class="card-grid">
        <article class="card">
          <h2>Profile</h2>
          <dl>
            <dt>Name</dt>
            <dd>${current.user.display_name}</dd>
            <dt>Email</dt>
            <dd>${current.user.email}</dd>
            <dt>Role</dt>
            <dd>${current.user.role}</dd>
          </dl>
          <form method="post" action="/account/email" class="account-form">
            <label>
              Email
              <input name="email" type="email" value="${current.user.email}" required>
            </label>
            <button type="submit">Change email</button>
          </form>
        </article>
        <article class="card">
          <h2>Orders</h2>
          <p>Review your plushie order history.</p>
          <a href="/account/orders">View orders</a>
        </article>
        <article class="card">
          <h2>Your Reviews</h2>
          <p>Review the plushie opinions you’ve posted.</p>
          <a href="/account/reviews">View reviews</a>
        </article>
        <article class="card">
          <h2>Tax Exemption</h2>
          <p>Upload tax exemption certificates for support review.</p>
          <a href="/account/tax-exemption">Manage documents</a>
        </article>
        <article class="card">
          <h2>Session</h2>
          <dl>
            <dt>Created</dt>
            <dd>${current.session.created_at}</dd>
            <dt>Expires</dt>
            <dd>${current.session.expires_at}</dd>
            <dt>Last authenticated</dt>
            <dd>${current.session.last_authenticated_at}</dd>
          </dl>
        </article>
        ${supportCard}
        ${adminCard}
      </section>
    `,
  );
}

router.get("/account/tax-exemption", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  res.type("html").send(renderTaxExemptionPage(listUploadedFilesForUser(current.user.id)));
});

router.post("/account/tax-exemption/files", uploadTaxDocument, (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const file = req.file;
  if (!file) {
    res
      .status(400)
      .type("html")
      .send(
        renderTaxExemptionPage(
          listUploadedFilesForUser(current.user.id),
          "Choose a PDF, JPEG, PNG, or WebP file to upload.",
        ),
      );
    return;
  }

  const uploadedFile = createUploadedFile(
    current.user.id,
    file.originalname,
    file.path,
    file.mimetype,
  );

  logEvent("tax_exemption_uploaded", {
    userId: current.user.id,
    email: current.user.email,
    uploadedFileId: uploadedFile.id,
    originalName: file.originalname,
    contentType: file.mimetype,
    storagePath: file.path,
    size: file.size,
  });

  res.redirect("/account/tax-exemption");
});

router.get("/account/reviews", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const reviews = listReviewsForUser(current.user.id);
  const reviewList =
    reviews.length === 0
      ? `<article class="card">
          <h2>No reviews yet</h2>
          <p>Your plushie opinions will show up here after you post a review.</p>
          <a href="/">Browse plushies</a>
        </article>`
      : reviews
          .map(
            (review) => `
            <article class="card review-summary">
              <h2><a href="/products/${review.product_id}">${review.product_name}</a></h2>
              <p class="rating">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
              <p>${review.body}</p>
              <p class="review-date">Posted ${review.created_at}</p>
              <a href="/account/reviews/${review.id}/edit">Edit review</a>
            </article>`,
          )
          .join("");

  res.type("html").send(
    renderPage(
      "Your Reviews",
      `
      <nav><a href="/account">Back to account</a></nav>
      <p class="eyebrow">Account</p>
      <h1>Your Reviews</h1>
      <section class="card-grid">${reviewList}</section>
    `,
    ),
  );
});

router.get("/account/reviews/:id/edit", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const review = requireReview(req, res);
  if (!review) {
    return;
  }

  res.type("html").send(renderReviewFormPage(review));
});

router.post("/account/reviews/:id", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const review = requireReview(req, res);
  if (!review) {
    return;
  }

  const rating = Number(req.body.rating);
  const body = String(req.body.body ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || body.length === 0) {
    res
      .status(400)
      .type("html")
      .send(renderReviewFormPage({ ...review, rating, body }, "Invalid review."));
    return;
  }

  updateReview(review.id, rating, body);
  res.redirect("/account/reviews");
});

router.post("/account/reviews/:id/delete", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const review = requireReview(req, res);
  if (!review) {
    return;
  }

  deleteReview(review.id);
  res.redirect("/account/reviews");
});

function requireReview(req: Request, res: Response): Review | undefined {
  const reviewId = Number(req.params.id);
  if (!Number.isInteger(reviewId)) {
    res.status(404).send("Review not found");
    return undefined;
  }

  const review = findReviewById(reviewId);
  if (!review) {
    res.status(404).send("Review not found");
    return undefined;
  }

  return review;
}

function renderTaxExemptionPage(files: UploadedFile[], error: string = ""): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  const rows = files
    .map(
      (file) => `
              <tr>
                <td>${file.original_name}</td>
                <td>${file.content_type}</td>
                <td>${file.created_at}</td>
              </tr>
            `,
    )
    .join("");

  const uploadedFiles =
    files.length === 0
      ? `<article class="card">
          <h2>No documents yet</h2>
          <p>Your uploaded tax exemption certificates will show up here.</p>
        </article>`
      : `<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

  return renderPage(
    "Tax Exemption Documents",
    `
      <nav><a href="/account">Back to account</a></nav>
      <p class="eyebrow">Account</p>
      <h1>Tax Exemption</h1>
      <p class="lede">Upload a tax exemption certificate if you buy plushies for a school, hospital, charity, or other exempt organization.</p>
      ${errorMessage}
      <form method="post" action="/account/tax-exemption/files" enctype="multipart/form-data" class="upload-form">
        <label>
          Certificate file
          <input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required>
        </label>
        <button type="submit">Upload document</button>
      </form>
      <section class="card-grid">
        ${uploadedFiles}
      </section>
    `,
  );
}

function renderReviewFormPage(review: Review, error: string = ""): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  return renderPage(
    `Edit Review #${review.id}`,
    `
      <nav><a href="/account/reviews">Back to reviews</a></nav>
      <p class="eyebrow">Review for ${review.product_name}</p>
      <h1>Edit Review</h1>
      ${errorMessage}
      <form method="post" action="/account/reviews/${review.id}" class="review-form">
        <label>
          Rating
          <select name="rating" required>
            ${renderRatingOptions(review.rating)}
          </select>
        </label>
        <label>
          Review
          <textarea name="body" rows="5" required>${review.body}</textarea>
        </label>
        <button type="submit">Save review</button>
      </form>
      <form method="post" action="/account/reviews/${review.id}/delete" class="delete-form">
        <button type="submit" class="danger-link">Delete review</button>
      </form>
    `,
  );
}

function renderRatingOptions(selectedRating: number): string {
  return [5, 4, 3, 2, 1]
    .map(
      (rating) =>
        `<option value="${rating}" ${rating === selectedRating ? "selected" : ""}>${rating} stars</option>`,
    )
    .join("");
}
