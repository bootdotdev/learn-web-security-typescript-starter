import { hash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export function hashBackupCode(code: string): string {
  return hash("sha256", code, "hex");
}

export function generateBackupCodes(
  db: DatabaseSync,
  userId: number,
  count: number = 8,
): string[] {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Backup-code count must be a positive integer");
  }

  const codes = Array.from({ length: count }, () =>
    randomBytes(16).toString("hex"),
  );
  const insert = db.prepare(`
    INSERT INTO totp_backup_codes (user_id, code_hash)
    VALUES (?, ?)
  `);
  db.exec("BEGIN IMMEDIATE");

  try {
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(userId);
    for (const code of codes) {
      insert.run(userId, hashBackupCode(code));
    }
    db.exec("COMMIT");
    return codes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hasUnusedBackupCode(
  db: DatabaseSync,
  userId: number,
  code: string,
): boolean {
  const backupCode = db
    .prepare(
      `
        SELECT id
        FROM totp_backup_codes
        WHERE user_id = ?
          AND code_hash = ?
          AND used_at IS NULL
      `,
    )
    .get(userId, hashBackupCode(code));

  return backupCode !== undefined;
}

export function consumeUnusedBackupCode(
  db: DatabaseSync,
  userId: number,
  code: string,
): boolean {
  const updateResult = db
    .prepare(
      `
        UPDATE totp_backup_codes
        SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND code_hash = ?
          AND used_at IS NULL
      `,
    )
    .run(userId, hashBackupCode(code));

  return updateResult.changes === 1;
}

export function verifyAndConsumeBackupCode(
  db: DatabaseSync,
  userId: number,
  code: string,
): boolean {
  return hasUnusedBackupCode(db, userId, code);
}

export function countRecentRecoveryAttempts(
  db: DatabaseSync,
  email: string,
  minutes: number = 15,
): number {
  pruneExpiredRecoveryAttempts(db, minutes);

  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM mfa_recovery_attempts
        WHERE email = ?
          AND success = 0
          AND created_at > datetime('now', ?)
      `,
    )
    .get(email, `-${minutes} minutes`) as { count: number };

  return row.count;
}

export function pruneExpiredRecoveryAttempts(
  db: DatabaseSync,
  minutes: number = 15,
): number {
  const result = db
    .prepare(
      `
        DELETE FROM mfa_recovery_attempts
        WHERE created_at <= datetime('now', ?)
      `,
    )
    .run(`-${minutes} minutes`);

  return Number(result.changes);
}

export function recordRecoveryAttempt(
  db: DatabaseSync,
  email: string,
  userId: number | null,
  success: boolean,
): void {
  db.prepare(
    `
        INSERT INTO mfa_recovery_attempts (email, user_id, success)
        VALUES (?, ?, ?)
      `,
  ).run(email, userId, success ? 1 : 0);
}
