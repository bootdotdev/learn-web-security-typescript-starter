import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const commands = ["inspect", "expire", "create-challenge", "challenge-status"];
const [command, token] = process.argv.slice(2);
if (!commands.includes(command) || (command !== "challenge-status" && !token)) {
  throw new Error(
    "Usage: node scripts/password-reset-token.mjs <inspect|expire|create-challenge> <token> | challenge-status",
  );
}

const databasePath =
  process.env.DATABASE_URL ??
  join(process.cwd(), "data", "bearly-secure.sqlite");
const database = new DatabaseSync(databasePath, {
  readOnly: command === "inspect" || command === "challenge-status",
});
const tokenHash = token ? createHash("sha256").update(token).digest("hex") : "";
const testChallengeHash = createHash("sha256")
  .update("bs_test_password_reset_challenge")
  .digest("hex");

function pendingChallengeExists() {
  return (
    database
      .prepare("SELECT 1 FROM totp_login_challenges WHERE token_hash = ?")
      .get(testChallengeHash) !== undefined
  );
}

try {
  if (command === "inspect") {
    const row = database
      .prepare(
        `
          SELECT token_hash, expires_at
          FROM password_reset_tokens
          WHERE token_hash IN (?, ?)
        `,
      )
      .get(tokenHash, token);
    const remainingLifetimeMs = Date.parse(row?.expires_at ?? "") - Date.now();

    console.log(
      JSON.stringify({
        hashMatches: row?.token_hash === tokenHash,
        rawTokenStored: row?.token_hash === token,
        expiresAboutFifteenMinutes:
          remainingLifetimeMs > 14 * 60 * 1000 &&
          remainingLifetimeMs <= 15 * 60 * 1000,
      }),
    );
  } else if (command === "expire") {
    const result = database
      .prepare(
        `
          UPDATE password_reset_tokens
          SET expires_at = ?
          WHERE token_hash = ?
        `,
      )
      .run(new Date(0).toISOString(), tokenHash);

    console.log(JSON.stringify({ expired: result.changes === 1 }));
  } else if (command === "create-challenge") {
    const resetToken = database
      .prepare("SELECT user_id FROM password_reset_tokens WHERE token_hash = ?")
      .get(tokenHash);
    if (!resetToken) {
      throw new Error("Password reset token not found");
    }

    database
      .prepare(
        `
          INSERT INTO totp_login_challenges (
            token_hash,
            user_id,
            return_to,
            attempts_remaining,
            expires_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(token_hash) DO UPDATE SET
            user_id = excluded.user_id,
            return_to = excluded.return_to,
            attempts_remaining = excluded.attempts_remaining,
            expires_at = excluded.expires_at
        `,
      )
      .run(
        testChallengeHash,
        resetToken.user_id,
        "/account",
        5,
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );

    console.log(
      JSON.stringify({ pendingChallengeExists: pendingChallengeExists() }),
    );
  } else {
    console.log(
      JSON.stringify({ pendingChallengeExists: pendingChallengeExists() }),
    );
  }
} finally {
  database.close();
}
