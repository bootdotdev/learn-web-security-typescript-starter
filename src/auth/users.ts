import type { DatabaseSync } from "node:sqlite";
import {
  decryptStringWithKeyring,
  encryptStringWithKeyring,
  type Keyring,
} from "../storage/keyring.ts";
import { hashPassword } from "./passwords.ts";

type UserRole = "customer" | "support" | "admin";

export type User = {
  id: number;
  email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  has_totp: boolean;
  has_pending_totp: boolean;
  created_at: string;
  updated_at: string;
};

export function normalizeEmail(email: string): string {
  return email;
}

export async function createUser(
  db: DatabaseSync,
  email: string,
  displayName: string,
  password: string,
): Promise<User> {
  const passwordHash = await hashPassword(password);
  const result = db
    .prepare(
      `
        INSERT INTO users (email, display_name, role, password_hash)
        VALUES (?, ?, 'customer', ?)
      `,
    )
    .run(email, displayName, passwordHash);

  const user = findUserById(db, Number(result.lastInsertRowid));
  if (!user) {
    throw new Error("Failed to create user");
  }

  return user;
}

export function findUserByEmail(
  db: DatabaseSync,
  email: string,
): User | undefined {
  const row = db
    .prepare(
      `
        SELECT id, email, display_name, role, password_hash,
               totp_secret IS NOT NULL AS has_totp,
               pending_totp_secret IS NOT NULL AS has_pending_totp,
               created_at, updated_at
        FROM users
        WHERE email = ?
      `,
    )
    .get(email) as
    | (Omit<User, "has_totp" | "has_pending_totp"> & {
        has_totp: number;
        has_pending_totp: number;
      })
    | undefined;
  return mapUser(row);
}

export function findUserById(db: DatabaseSync, id: number): User | undefined {
  const row = db
    .prepare(
      `
        SELECT id, email, display_name, role, password_hash,
               totp_secret IS NOT NULL AS has_totp,
               pending_totp_secret IS NOT NULL AS has_pending_totp,
               created_at, updated_at
        FROM users
        WHERE id = ?
      `,
    )
    .get(id) as
    | (Omit<User, "has_totp" | "has_pending_totp"> & {
        has_totp: number;
        has_pending_totp: number;
      })
    | undefined;
  return mapUser(row);
}

export async function updateUserPassword(
  db: DatabaseSync,
  userId: number,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  db.prepare(
    `
        UPDATE users
        SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
  ).run(passwordHash, userId);
}

export function getTotpSecret(
  db: DatabaseSync,
  userId: number,
  keyring: Keyring | undefined,
): string | undefined {
  return getDecryptedTotpSecret(db, userId, "totp_secret", keyring);
}

export function getPendingTotpSecret(
  db: DatabaseSync,
  userId: number,
  keyring: Keyring | undefined,
): string | undefined {
  return getDecryptedTotpSecret(db, userId, "pending_totp_secret", keyring);
}

export function setPendingTotpSecret(
  db: DatabaseSync,
  userId: number,
  secret: string,
  keyring: Keyring | undefined,
): void {
  db.prepare(
    `
        UPDATE users
        SET pending_totp_secret = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
  ).run(encryptStringWithKeyring(secret, keyring), userId);
}

export function confirmTotpSecret(db: DatabaseSync, userId: number): void {
  db.prepare(
    `
        UPDATE users
        SET totp_secret = pending_totp_secret,
            pending_totp_secret = NULL,
            last_totp_step = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
  ).run(userId);
}

export function clearTotpSecret(db: DatabaseSync, userId: number): void {
  db.exec("BEGIN IMMEDIATE");

  try {
    db.prepare(
      `
        UPDATE users
        SET totp_secret = NULL,
            pending_totp_secret = NULL,
            last_totp_step = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    ).run(userId);
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM totp_login_challenges WHERE user_id = ?").run(
      userId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateUserEmail(
  db: DatabaseSync,
  userId: number,
  email: string,
): void {
  db.prepare(
    `
        UPDATE users
        SET email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
  ).run(email, userId);
}

function getDecryptedTotpSecret(
  db: DatabaseSync,
  userId: number,
  column: "totp_secret" | "pending_totp_secret",
  keyring: Keyring | undefined,
): string | undefined {
  const row = db
    .prepare(`SELECT ${column} AS secret FROM users WHERE id = ?`)
    .get(userId) as { secret: string | null } | undefined;
  return row?.secret
    ? decryptStringWithKeyring(row.secret, keyring)
    : undefined;
}

function mapUser(
  row:
    | (Omit<User, "has_totp" | "has_pending_totp"> & {
        has_totp: number;
        has_pending_totp: number;
      })
    | undefined,
): User | undefined {
  return row
    ? {
        ...row,
        has_totp: Boolean(row.has_totp),
        has_pending_totp: Boolean(row.has_pending_totp),
      }
    : undefined;
}
