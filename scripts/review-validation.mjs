import { existsSync } from "node:fs";
import { initDependencies } from "../src/dependencies.ts";
import { getCurrentSession } from "../src/auth/sessions.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const sessionCookie = process.argv[2];
const baseURL = process.argv[3] ?? "http://localhost:3000";

if (!sessionCookie) {
  console.error("Usage: node scripts/review-validation.mjs <session-cookie> [base-url]");
  process.exit(1);
}

const deps = initDependencies();
const db = deps.db;
const current = getCurrentSession(db, sessionCookie);
if (!current) {
  throw new Error("The review probe requires a valid session cookie");
}
const seededReview = db
  .prepare("SELECT rating, body, updated_at FROM reviews WHERE id = 1 AND user_id = ?")
  .get(current.user.id);
if (!seededReview) {
  throw new Error("The review probe requires seeded review 1");
}

try {
  const trimmedBody = "Whitespace belongs around this review, not inside it.";
  const trimmedResponse = await fetch(new URL("/account/reviews/1", baseURL), {
    method: "POST",
    headers: {
      Cookie: sessionCookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(baseURL).origin,
    },
    body: new URLSearchParams({
      csrfToken: current.session.csrf_token,
      rating: "5",
      body: `  ${trimmedBody}  `,
    }),
    redirect: "manual",
  });
  const storedReview = db.prepare("SELECT body FROM reviews WHERE id = 1").get();

  console.log(
    JSON.stringify({
      trimmedAccepted: trimmedResponse.status === 302 && storedReview?.body === trimmedBody,
    }),
  );
} finally {
  try {
    db.prepare("UPDATE reviews SET rating = ?, body = ?, updated_at = ? WHERE id = 1").run(
      seededReview.rating,
      seededReview.body,
      seededReview.updated_at,
    );
  } finally {
    db.close();
  }
}
