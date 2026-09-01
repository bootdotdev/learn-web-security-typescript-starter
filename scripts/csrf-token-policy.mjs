import { existsSync } from "node:fs";
import { initDependencies } from "../src/dependencies.ts";
import { getCurrentSession } from "../src/auth/sessions.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const sessionCookie = process.argv[2];
const crossSessionToken = process.argv[3];
const baseURL = process.argv[4] ?? "http://localhost:3000";

if (!sessionCookie || !crossSessionToken) {
  console.error(
    "Usage: node scripts/csrf-token-policy.mjs <session-cookie> <cross-session-token> [base-url]",
  );
  process.exit(1);
}

const deps = initDependencies();
const db = deps.db;
const current = getCurrentSession(db, sessionCookie);
if (!current) {
  throw new Error("The CSRF probe requires a valid session cookie");
}

const original = db
  .prepare("SELECT email, totp_secret FROM users WHERE id = ?")
  .get(current.user.id);
if (!original) {
  throw new Error("The CSRF probe requires a valid user");
}

const enabledTotpSecret = "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF";

try {
  db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(
    enabledTotpSecret,
    current.user.id,
  );

  const malformedToken = new URLSearchParams([
    ["csrfToken", "first"],
    ["csrfToken", "second"],
    ["email", "mabel+csrf@example.com"],
    ["currentPassword", "password123"],
  ]);
  const malformedStatus = await post("/account/email", malformedToken);
  const crossSessionTotpStatus = await post(
    "/account/totp/disable",
    new URLSearchParams({ csrfToken: crossSessionToken }),
  );
  const afterRejected = db
    .prepare("SELECT email, totp_secret FROM users WHERE id = ?")
    .get(current.user.id);

  console.log(
    JSON.stringify({
      malformedTokenRejected: malformedStatus === 403,
      crossSessionTotpRejected: crossSessionTotpStatus === 403,
      rejectedStateUnchanged:
        afterRejected?.email === original.email &&
        afterRejected?.totp_secret === enabledTotpSecret,
    }),
  );
} finally {
  try {
    db.prepare("UPDATE users SET email = ?, totp_secret = ? WHERE id = ?").run(
      original.email,
      original.totp_secret,
      current.user.id,
    );
  } finally {
    db.close();
  }
}

async function post(path, body) {
  const response = await fetch(new URL(path, baseURL), {
    method: "POST",
    headers: {
      Cookie: sessionCookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(baseURL).origin,
    },
    body,
    redirect: "manual",
  });
  return response.status;
}
