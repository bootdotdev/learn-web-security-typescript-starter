import { randomBytes } from "node:crypto";
import { getDb } from "../db/index.ts";
import { findUserById, type User } from "./users.ts";

const defaultSessionTtlSeconds = 60 * 60 * 24 * 30;

export type Session = {
  id: string;
  user_id: number;
  expires_at: string;
  revoked_at: string | null;
  last_authenticated_at: string;
  created_at: string;
};

export type CurrentSession = {
  session: Session;
  user: User;
};

export function createSession(
  userId: number,
  ttlSeconds: number = defaultSessionTtlSeconds,
): Session {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const sessionId = randomBytes(32).toString("hex");

  getDb()
    .prepare(
      `
        INSERT INTO sessions (id, user_id, expires_at, last_authenticated_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(sessionId, userId, expiresAt, now.toISOString());

  const session = findSessionById(sessionId);
  if (!session) {
    throw new Error("Failed to create session");
  }

  return session;
}

function findSessionById(sessionId: string): Session | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, user_id, expires_at, revoked_at, last_authenticated_at, created_at
        FROM sessions
        WHERE id = ?
      `,
    )
    .get(sessionId) as Session | undefined;
}

export function getCurrentSession(cookieHeader: string | undefined): CurrentSession | undefined {
  const sessionId = getCookie(cookieHeader, "session_id");
  if (!sessionId) {
    return undefined;
  }

  const session = findSessionById(sessionId);
  if (!session || new Date(session.expires_at) <= new Date()) {
    return undefined;
  }

  const user = findUserById(session.user_id);
  if (!user) {
    return undefined;
  }

  return { session, user };
}

function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;

  const cookie = cookies.find((value) => value.startsWith(prefix));
  if (!cookie) {
    return undefined;
  }

  return decodeURIComponent(cookie.slice(prefix.length));
}
