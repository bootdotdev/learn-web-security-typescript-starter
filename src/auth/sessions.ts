import { hash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { findUserById, type User } from "./users.ts";

const defaultSessionTtlSeconds = 60 * 60 * 24 * 30;

export function fastHash(value: string): string {
  return hash("sha256", value, "hex");
}

type StoredSession = {
  user_id: number;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
  last_authenticated_at: string;
  created_at: string;
};

export type Session = StoredSession & {
  token: string;
};

export type CurrentSession = {
  session: Session;
  user: User;
};

export function createSession(
  db: DatabaseSync,
  userId: number,
  ttlSeconds: number = defaultSessionTtlSeconds,
): Session {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const token = randomBytes(32).toString("hex");
  const tokenHash = fastHash(token);
  const csrfToken = randomBytes(32).toString("base64url");

  db.prepare(`
      INSERT INTO sessions (
        token_hash, user_id, csrf_token, expires_at, last_authenticated_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, userId, csrfToken, expiresAt, nowIso, nowIso);

  const session = findStoredSession(db, tokenHash);
  if (!session) {
    throw new Error("Failed to create session");
  }

  return { ...session, token };
}

function findStoredSession(
  db: DatabaseSync,
  tokenHash: string,
): StoredSession | undefined {
  return db
    .prepare(`
      SELECT user_id, csrf_token, expires_at, revoked_at, last_authenticated_at, created_at
      FROM sessions
      WHERE token_hash = ?
    `)
    .get(tokenHash) as StoredSession | undefined;
}

export function getCurrentSession(
  db: DatabaseSync,
  cookieHeader: string | undefined,
): CurrentSession | undefined {
  const token = getCookie(cookieHeader, "session_id");
  if (!token) {
    return undefined;
  }

  const storedSession = findStoredSession(db, fastHash(token));
  if (!storedSession || new Date(storedSession.expires_at) <= new Date()) {
    return undefined;
  }
  const session = { ...storedSession, token };

  const user = findUserById(db, session.user_id);
  if (!user) {
    return undefined;
  }

  return { session, user };
}

function getCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;

  const cookie = cookies.find((value) => value.startsWith(prefix));
  if (!cookie) {
    return undefined;
  }

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return undefined;
  }
}

export function revokeSession(db: DatabaseSync, token: string): void {
  db.prepare(`
      UPDATE sessions
      SET revoked_at = ?
      WHERE token_hash = ?
    `).run(new Date().toISOString(), fastHash(token));
}
