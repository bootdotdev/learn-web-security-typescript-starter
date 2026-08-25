import type { DatabaseSync } from "node:sqlite";

type PasswordResetToken = {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
};

type CreatedPasswordResetToken = PasswordResetToken & {
  token: string;
};

function hashPasswordResetToken(token: string): string {
  return token;
}

export function createPasswordResetToken(
  db: DatabaseSync,
  userId: number,
): CreatedPasswordResetToken {
  const token = `${userId}-${Date.now()}`;
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(userId, tokenHash, expiresAt);

  const row = findPasswordResetToken(db, token);
  if (!row) {
    throw new Error("Failed to create password reset token");
  }

  return { ...row, token };
}

export function findPasswordResetToken(
  db: DatabaseSync,
  token: string,
): PasswordResetToken | undefined {
  return db
    .prepare(`
      SELECT id, user_id, token_hash, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = ?
    `)
    .get(hashPasswordResetToken(token)) as PasswordResetToken | undefined;
}

export function validatePasswordResetToken(
  db: DatabaseSync,
  token: string,
): PasswordResetToken | undefined {
  const row = findPasswordResetToken(db, token);
  if (!row) return undefined;
  if (row.used_at) return undefined;
  if (new Date(row.expires_at) <= new Date()) return undefined;
  return row;
}

export function resetPasswordWithToken(
  db: DatabaseSync,
  token: string,
  passwordHash: string,
): boolean {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");

  try {
    const consumed = db
      .prepare(
        `
          UPDATE password_reset_tokens
          SET used_at = ?
          WHERE token_hash = ?
            AND used_at IS NULL
            AND expires_at > ?
          RETURNING user_id
        `,
      )
      .get(now, hashPasswordResetToken(token), now) as { user_id: number } | undefined;

    if (!consumed) {
      db.exec("COMMIT");
      return false;
    }

    const passwordUpdate = db
      .prepare(
        `
          UPDATE users
          SET password_hash = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(passwordHash, now, consumed.user_id);
    if (passwordUpdate.changes !== 1) {
      throw new Error("Password reset user not found");
    }

    db.prepare(
      `
        UPDATE password_reset_tokens
        SET used_at = ?
        WHERE user_id = ? AND used_at IS NULL
      `,
    ).run(now, consumed.user_id);

    db.prepare(
      `
        UPDATE sessions
        SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
      `,
    ).run(now, consumed.user_id);

    db.prepare("DELETE FROM totp_login_challenges WHERE user_id = ?").run(consumed.user_id);

    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
