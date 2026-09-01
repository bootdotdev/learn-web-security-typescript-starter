import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import type { DatabaseSync } from "node:sqlite";

const TOTP_LOGIN_CHALLENGE_COOKIE_NAME = "totp_login_challenge";
const TOTP_LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;
const TOTP_LOGIN_CHALLENGE_ATTEMPTS = 5;

const totpLoginChallengeCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} satisfies CookieOptions;

export type TotpLoginChallenge = {
  user_id: number;
  return_to: string;
  attempts_remaining: number;
  expires_at: string;
};

type CreatedTotpLoginChallenge = TotpLoginChallenge & {
  token: string;
};

function hashChallengeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  if (!cookie) {
    return undefined;
  }

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return undefined;
  }
}

export function getTotpLoginChallengeToken(
  cookieHeader: string | undefined,
): string | undefined {
  return getCookie(cookieHeader, TOTP_LOGIN_CHALLENGE_COOKIE_NAME);
}

export function createTotpLoginChallenge(
  db: DatabaseSync,
  userId: number,
  returnTo: string,
): CreatedTotpLoginChallenge {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashChallengeToken(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + TOTP_LOGIN_CHALLENGE_TTL_MS,
  ).toISOString();

  db.prepare(
    `
        DELETE FROM totp_login_challenges
        WHERE attempts_remaining <= 0
          OR expires_at <= ?
      `,
  ).run(now.toISOString());

  db.prepare(
    `
        INSERT INTO totp_login_challenges (
          token_hash,
          user_id,
          return_to,
          attempts_remaining,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
  ).run(tokenHash, userId, returnTo, TOTP_LOGIN_CHALLENGE_ATTEMPTS, expiresAt);

  return {
    token,
    user_id: userId,
    return_to: returnTo,
    attempts_remaining: TOTP_LOGIN_CHALLENGE_ATTEMPTS,
    expires_at: expiresAt,
  };
}

export function findTotpLoginChallenge(
  db: DatabaseSync,
  token: string,
): TotpLoginChallenge | undefined {
  const tokenHash = hashChallengeToken(token);
  const challenge = db
    .prepare(
      `
        SELECT user_id, return_to, attempts_remaining, expires_at
        FROM totp_login_challenges
        WHERE token_hash = ?
      `,
    )
    .get(tokenHash) as TotpLoginChallenge | undefined;

  if (!challenge) {
    return undefined;
  }
  if (
    challenge.attempts_remaining <= 0 ||
    new Date(challenge.expires_at) <= new Date()
  ) {
    deleteTotpLoginChallenge(db, token);
    return undefined;
  }

  return challenge;
}

export function recordTotpLoginChallengeFailure(
  db: DatabaseSync,
  token: string,
): boolean {
  const now = new Date().toISOString();
  const failedChallenge = db
    .prepare(
      `
        UPDATE totp_login_challenges
        SET attempts_remaining = attempts_remaining - 1
        WHERE token_hash = ?
          AND attempts_remaining > 0
          AND expires_at > ?
        RETURNING attempts_remaining
      `,
    )
    .get(hashChallengeToken(token), now) as
    | { attempts_remaining: number }
    | undefined;

  if (!failedChallenge || failedChallenge.attempts_remaining <= 0) {
    deleteTotpLoginChallenge(db, token);
    return true;
  }

  return false;
}

export function deleteTotpLoginChallenge(
  db: DatabaseSync,
  token: string,
): void {
  db.prepare("DELETE FROM totp_login_challenges WHERE token_hash = ?").run(
    hashChallengeToken(token),
  );
}

export function abandonTotpLoginChallenge(
  db: DatabaseSync,
  cookieHeader: string | undefined,
): void {
  const token = getTotpLoginChallengeToken(cookieHeader);
  if (token) {
    deleteTotpLoginChallenge(db, token);
  }
}

export function setTotpLoginChallengeCookie(
  response: Response,
  challenge: CreatedTotpLoginChallenge,
): void {
  response.cookie(TOTP_LOGIN_CHALLENGE_COOKIE_NAME, challenge.token, {
    ...totpLoginChallengeCookieOptions,
    expires: new Date(challenge.expires_at),
  });
}

export function clearTotpLoginChallengeCookie(response: Response): void {
  response.clearCookie(
    TOTP_LOGIN_CHALLENGE_COOKIE_NAME,
    totpLoginChallengeCookieOptions,
  );
}
