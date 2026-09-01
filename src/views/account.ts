import { MAX_PASSWORD_LENGTH } from "../auth/passwords.ts";
import type { CurrentSession } from "../auth/sessions.ts";
import { MAX_REVIEW_BODY_LENGTH, type Review } from "../reviews.ts";
import type { UploadedFile } from "../uploads/index.ts";
import { escapeHtml, renderAccountLink, renderPage } from "./layout.ts";

export function renderTotpSetupPage(
  displayName: string,
  secret: string,
  qrDataUrl: string,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return renderPage(
    "Set Up Two-Step Verification",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav>
      <p class="eyebrow">Account</p><h1>Set Up Two-Step Verification</h1>
      <p class="subtitle">Scan this code with an authenticator app like Google Authenticator or Authy.</p>
      <div class="totp-setup-code"><img src="${escapeHtml(qrDataUrl)}" alt="QR code for two-step verification setup" width="200" height="200"><p>Or enter this key manually: <code>${escapeHtml(secret)}</code></p></div>
      <p class="totp-setup-instruction">Then enter the 6-digit code from your authenticator app to finish setup.</p>${errorMessage}
      <form method="post" action="/account/totp/confirm" class="account-form"><label>Authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required autofocus></label><button type="submit">Enable two-step verification</button></form>`,
  );
}

export function renderTotpEnabledPage(
  displayName: string,
  csrfToken: string,
): string {
  return renderPage(
    "Two-Step Verification Enabled",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav>
      <p class="eyebrow">Account</p><h1>Two-Step Verification Enabled</h1>
      <p class="subtitle">Your account requires an authenticator code when you log in.</p>
      <form method="post" action="/account/totp/disable" class="account-form"><input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}"><p>Turning off two-step verification also invalidates your remaining backup codes.</p><button type="submit" class="danger-link">Turn off two-step verification</button></form>`,
  );
}

export function renderTotpBackupCodesPage(
  displayName: string,
  backupCodes: string[],
): string {
  const codeList = backupCodes
    .map((code) => `<li><code>${escapeHtml(code)}</code></li>`)
    .join("");
  return renderPage(
    "Two-Step Verification Enabled",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav><p class="eyebrow">Account</p><h1>Two-Step Verification Enabled</h1><p class="subtitle">Save these backup codes somewhere safe. Each one only works once, and we won't show them again.</p><ul class="backup-codes">${codeList}</ul>`,
  );
}

export function renderAccountPage(
  current: CurrentSession,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const isSupport =
    current.user.role === "support" || current.user.role === "admin";
  const isAdmin = current.user.role === "admin";
  const supportNav = isSupport ? `<a href="/support">Support</a>` : "";
  const adminNav = isAdmin ? `<a href="/admin">Admin</a>` : "";
  const supportCard = isSupport
    ? `<article class="card"><h2>Support</h2><p>Review customer orders and internal notes.</p><a href="/support">Open support dashboard</a></article>`
    : "";
  const adminCard = isAdmin
    ? `<article class="card"><h2>Admin</h2><p>Review product pricing, inventory, and internal costs.</p><a href="/admin">Open admin dashboard</a></article>`
    : "";
  return renderPage(
    "Your Account",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${supportNav}${adminNav}<form method="post" action="/logout" class="logout-form"><button type="submit">Log out</button></form></nav>
      <p class="eyebrow">Account</p><h1 class="profile-heading">Your Profile</h1><div class="form-message profile-message" aria-live="polite">${errorMessage}</div>
      <section class="card-grid">
        <article class="card"><h2>Profile</h2><dl><dt>Name</dt><dd>${escapeHtml(current.user.display_name)}</dd><dt>Email</dt><dd>${escapeHtml(current.user.email)}</dd><dt>Role</dt><dd>${escapeHtml(current.user.role)}</dd></dl>
          <form method="post" action="/account/email" class="account-form"><input name="csrfToken" type="hidden" value="${escapeHtml(current.session.csrf_token)}"><label>Email<input name="email" type="email" autocomplete="email" value="${escapeHtml(current.user.email)}" required></label><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD_LENGTH}" required></label><button type="submit">Change email</button></form></article>
        <article class="card"><h2>Orders</h2><p>Review your plushie order history.</p><a href="/account/orders">View orders</a></article>
        <article class="card"><h2>Your Reviews</h2><p>Review the plushie opinions you’ve posted.</p><a href="/account/reviews">View reviews</a></article>
        <article class="card"><h2>Two-Step Verification</h2><p>${current.user.has_totp ? "Two-step verification is enabled. Your account requires an authenticator code when you log in." : "Set up an authenticator app to enable two-step verification."}</p><a href="/account/totp">Manage two-step verification</a></article>
        <article class="card"><h2>Passkeys</h2><p>Register a device passkey to sign in without a password.</p><a href="/account/passkey">Manage passkeys</a></article>
        <article class="card"><h2>Tax Exemption</h2><p>Upload tax exemption certificates for support review.</p><a href="/account/tax-exemption">Manage documents</a></article>
        <article class="card"><h2>Session</h2><dl><dt>Created</dt><dd>${escapeHtml(current.session.created_at)}</dd><dt>Expires</dt><dd>${escapeHtml(current.session.expires_at)}</dd><dt>Last authenticated</dt><dd>${escapeHtml(current.session.last_authenticated_at)}</dd></dl></article>${supportCard}${adminCard}
      </section>`,
  );
}

export function renderReviewsPage(
  reviews: Review[],
  displayName: string,
): string {
  const reviewList = reviews.length
    ? reviews
        .map(
          (review) => `
            <article class="card">
              <h2><a href="/products/${review.product_id}">${escapeHtml(review.product_name)}</a></h2>
              <p class="rating" aria-label="${review.rating} out of 5 stars">
                ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}
              </p>
              <p>${escapeHtml(review.body)}</p>
              <p class="review-date">Posted ${escapeHtml(review.created_at)}</p>
              <a href="/account/reviews/${review.id}/edit">Edit review</a>
            </article>`,
        )
        .join("")
    : `<article class="card"><h2>No reviews yet</h2><p>Your plushie opinions will show up here after you post a review.</p><a href="/">Browse plushies</a></article>`;
  return renderPage(
    "Your Reviews",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav><p class="eyebrow">Account</p><h1>Your Reviews</h1><section class="card-grid">${reviewList}</section>`,
  );
}

export function renderTaxExemptionPage(
  displayName: string,
  files: UploadedFile[],
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const rows = files
    .map(
      (file) =>
        `<tr><td>${escapeHtml(file.original_name)}</td><td>${escapeHtml(file.content_type)}</td><td>${escapeHtml(file.created_at)}</td><td><a href="/files/${file.id}/download">Download</a></td></tr>`,
    )
    .join("");
  const uploadedFiles = files.length
    ? `<div class="table-wrap"><table><thead><tr><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Uploaded</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<article class="card"><h2>No documents yet</h2><p>Your uploaded tax exemption certificates will show up here.</p></article>`;
  return renderPage(
    "Tax Exemption Documents",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav><p class="eyebrow">Account</p><h1>Tax Exemption</h1><p class="lede">Upload a tax exemption certificate if you buy plushies for a school, hospital, charity, or other exempt organization.</p>${errorMessage}<form method="post" action="/account/tax-exemption/files" enctype="multipart/form-data" class="upload-form"><label>Certificate file<input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label><button type="submit">Upload document</button></form><section class="card-grid">${uploadedFiles}</section>`,
  );
}

export function renderReviewFormPage(
  review: Review,
  csrfToken: string,
  displayName: string,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const ratingOptions = [5, 4, 3, 2, 1]
    .map(
      (rating) =>
        `<option value="${rating}" ${rating === review.rating ? "selected" : ""}>${rating} stars</option>`,
    )
    .join("");
  return renderPage(
    `Edit Review #${review.id}`,
    `<nav class="page-nav" aria-label="Primary">
        <a class="brand-link" href="/">Bearly Secure</a>
        ${renderAccountLink(displayName)}
        <a href="/account/reviews">Reviews</a>
      </nav>
      <p class="eyebrow">Review for ${escapeHtml(review.product_name)}</p>
      <h1>Edit Review</h1>
      ${errorMessage}
      <form method="post" action="/account/reviews/${review.id}" class="review-form">
        <input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}">
        <label>Rating<select name="rating" required>${ratingOptions}</select></label>
        <label>Review<textarea name="body" rows="5" maxlength="${MAX_REVIEW_BODY_LENGTH}" required>${escapeHtml(review.body)}</textarea></label>
        <button type="submit">Save review</button>
      </form>
      <form method="post" action="/account/reviews/${review.id}/delete" class="delete-form">
        <input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}">
        <button type="submit" class="danger-link">Delete review</button>
      </form>`,
  );
}
