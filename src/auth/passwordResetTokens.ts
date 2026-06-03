import { getDb } from "../db/index.ts";

export type PasswordResetToken = {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  used_at: string | null;
};

export function createPasswordResetToken(userId: number): PasswordResetToken {
  const token = `${userId}-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const result = getDb()
    .prepare(
      `
        INSERT INTO password_reset_tokens (user_id, token, expires_at)
        VALUES (?, ?, ?)
      `,
    )
    .run(userId, token, expiresAt);

  return (
    findPasswordResetToken(token) ?? {
      id: Number(result.lastInsertRowid),
      user_id: userId,
      token,
      expires_at: expiresAt,
      used_at: null,
    }
  );
}

export function findPasswordResetToken(token: string): PasswordResetToken | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, user_id, token, expires_at, used_at
        FROM password_reset_tokens
        WHERE token = ?
      `,
    )
    .get(token) as PasswordResetToken | undefined;
}
