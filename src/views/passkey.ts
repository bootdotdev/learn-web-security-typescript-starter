import { escapeHtml, renderAccountLink, renderPage } from "./layout.ts";

export type StoredCredential = {
  id: number;
  credential_id: string;
  created_at: string;
};

export function renderPasskeyLoginPage(
  error?: string,
  returnTo: string = "/",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return renderPage(
    "Sign In with Passkey",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
      <h1 class="auth-heading">Sign In with Passkey</h1>
      <p class="subtitle">Use your device passkey to sign in – no password required.</p>
      <div id="passkey-login-message" class="form-message auth-message" aria-live="polite">${errorMessage}</div>
      <div class="page-action"><button id="passkey-login-btn" data-return-to="${escapeHtml(returnTo)}">Sign in with passkey</button></div>
      <p class="auth-link">Don't have a passkey? <a href="/login?returnTo=${encodeURIComponent(returnTo)}">Sign in with password</a>.</p>
      <script src="/vendor/simplewebauthn/index.umd.min.js"></script>
      <script src="/passkey.js"></script>`,
  );
}

export function renderPasskeyManagePage(
  credentials: StoredCredential[],
  displayName: string,
  error?: string,
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const credentialList =
    credentials.length === 0
      ? `<p class="passkey-list">No passkeys registered yet.</p>`
      : `<ul class="passkey-list">${credentials
          .map(
            (credential) => `<li>
              <span>Passkey registered ${escapeHtml(credential.created_at)}</span>
              <form method="post" action="/account/passkey/${credential.id}/delete" class="passkey-delete-form">
                <button type="submit" class="danger-link">Remove</button>
              </form>
            </li>`,
          )
          .join("")}</ul>`;
  return renderPage(
    "Passkeys",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav>
      <p class="eyebrow">Account</p>
      <h1>Passkeys</h1>
      <p class="subtitle">Passkeys let you sign in without a password using your device's biometrics or PIN.</p>
      ${credentialList}
      <div class="page-action">
        <button id="passkey-register-btn">Register new passkey</button>
        <div id="passkey-register-message" class="form-message" aria-live="polite">${errorMessage}</div>
      </div>
      <script src="/vendor/simplewebauthn/index.umd.min.js"></script>
      <script src="/passkey.js"></script>`,
  );
}
