import { escapeHtml, renderPage } from "./layout.ts";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function errorMarkup(error?: string): string {
  return error ? `<p class="error">${escapeHtml(error)}</p>` : "";
}

export function renderPasswordResetCompletePage(email: string): string {
  return renderPage(
    "Password Reset Complete",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1>Password Reset Complete</h1>
      <p class="subtitle">The password for <strong>${escapeHtml(email)}</strong> has been changed.</p>
      <p class="auth-link"><a href="/login">Log in with the new password</a></p>`,
  );
}

export function renderLoginPage(error?: string, returnTo: string = "/"): string {
  return renderPage(
    "Log In",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Log In</h1>
      <div class="form-message auth-message" aria-live="polite">${errorMarkup(error)}</div>
      <form method="post" action="/login" class="auth-form">
        <input name="returnTo" type="hidden" value="${escapeHtml(returnTo)}">
        <label>Email<input name="email" type="email" autocomplete="username" required autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD_LENGTH}" required></label>
        <button type="submit">Log in</button>
      </form>
      <p class="auth-link">New here? <a href="/signup">Create an account</a>.</p>
      <p class="auth-link"><a href="/password-reset">Forgot your password?</a></p>
      <p class="auth-link"><a href="/recover-mfa">Lost access to your authenticator app?</a></p>
      <p class="auth-link"><a href="/auth/passkey?returnTo=${encodeURIComponent(returnTo)}">Sign in with passkey instead</a>.</p>`,
  );
}

export function renderTotpLoginPage(returnTo: string, error?: string): string {
  return renderPage(
    "Two-Step Verification",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Two-Step Verification</h1>
      <p class="subtitle">Enter the 6-digit code from your authenticator app.</p>
      <div class="form-message auth-message" aria-live="polite">${errorMarkup(error)}</div>
      <form method="post" action="/login/totp" class="auth-form">
        <input name="returnTo" type="hidden" value="${escapeHtml(returnTo)}">
        <label>Authenticator code<input name="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" required autofocus></label>
        <button type="submit">Verify code</button>
      </form>
      <form method="post" action="/login/totp/cancel" class="auth-link"><button type="submit" class="auth-link-button">Back to login</button></form>
      <p class="auth-link"><a href="/recover-mfa">Use a backup code</a></p>`,
  );
}

export function renderMfaRecoveryPage(error?: string): string {
  return renderPage(
    "Use a Backup Code",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Use a Backup Code</h1>
      <p class="subtitle">Using a backup code turns off two-step verification and invalidates any remaining codes.</p>
      <div class="form-message auth-message" aria-live="polite">${errorMarkup(error)}</div>
      <form method="post" action="/recover-mfa" class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="username" required autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD_LENGTH}" required></label>
        <label>Backup code<input name="backupCode" type="text" autocomplete="one-time-code" required></label>
        <button type="submit">Recover account</button>
      </form>
      <p class="auth-link"><a href="/login">Back to login</a></p>`,
  );
}

export function renderSignupPage(error?: string): string {
  return renderPage(
    "Create Account",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Create Account</h1>
      <div class="form-message auth-message" aria-live="polite">${errorMarkup(error)}</div>
      <form method="post" action="/signup" class="auth-form">
        <label>Name<input name="displayName" type="text" autocomplete="name" required autofocus></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required></label>
        <button type="submit">Create account</button>
      </form>
      <p class="auth-link">Already have an account? <a href="/login">Log in</a>.</p>`,
  );
}

export function renderPasswordResetRequestPage(message?: string, resetLink?: string): string {
  const messageMarkup = message ? `<p>${escapeHtml(message)}</p>` : "";
  const resetLinkMarkup = resetLink
    ? `<article class="card"><h2>Reset Link</h2><p>Bear Mail is offline, so here’s the reset link:</p><p><a href="${escapeHtml(resetLink)}">${escapeHtml(resetLink)}</a></p></article>`
    : "";
  return renderPage(
    "Reset Password",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Reset Password</h1>
      <p class="subtitle">Enter your email address and Bear Mail will send a reset link.</p>
      <div class="form-message auth-message" aria-live="polite">${messageMarkup}</div>
      <form method="post" action="/password-reset" class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="email" required autofocus></label>
        <button type="submit">Send reset link</button>
      </form>
      ${resetLinkMarkup}
      <p class="auth-link"><a href="/login">Back to login</a></p>`,
  );
}

export function renderPasswordResetRequestConfirmationPage(resetLink?: string): string {
  return renderPasswordResetRequestPage(
    "An account exists for that email, Bear Mail will send a reset link shortly.",
    resetLink,
  );
}

export function renderPasswordResetEmailNotFoundPage(): string {
  return renderPasswordResetRequestPage("No account found for that email.");
}

export function renderPasswordResetForm(token: string, error?: string): string {
  return renderPage(
    "Choose New Password",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Choose New Password</h1>
      <div class="form-message auth-message" aria-live="polite">${errorMarkup(error)}</div>
      <form method="post" action="/password-reset/${encodeURIComponent(token)}" class="auth-form">
        <label>New password<input name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required autofocus></label>
        <button type="submit">Reset password</button>
      </form>
      <p class="auth-link"><a href="/login">Back to login</a></p>`,
  );
}
