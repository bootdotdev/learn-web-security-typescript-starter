import { getDb } from "../db/index.ts";
import { hashPassword } from "./passwords.ts";

type UserRole = "customer" | "support" | "admin";

export type User = {
  id: number;
  email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export function createUser(email: string, displayName: string, password: string): User {
  const result = getDb()
    .prepare(
      `
        INSERT INTO users (email, display_name, role, password_hash)
        VALUES (?, ?, 'customer', ?)
      `,
    )
    .run(email, displayName, hashPassword(password));

  const user = findUserById(Number(result.lastInsertRowid));
  if (!user) {
    throw new Error("Failed to create user");
  }

  return user;
}

export function findUserByEmail(email: string): User | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, email, display_name, role, password_hash, created_at, updated_at
        FROM users
        WHERE email = ?
      `,
    )
    .get(email) as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, email, display_name, role, password_hash, created_at, updated_at
        FROM users
        WHERE id = ?
      `,
    )
    .get(id) as User | undefined;
}

export function updateUserPassword(userId: number, password: string): void {
  getDb()
    .prepare(
      `
        UPDATE users
        SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .run(hashPassword(password), userId);
}

export function updateUserEmail(userId: number, email: string): void {
  getDb()
    .prepare(
      `
        UPDATE users
        SET email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .run(email, userId);
}
