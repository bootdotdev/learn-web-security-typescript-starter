import type { CookieOptions, Response } from "express";

const SESSION_COOKIE_NAME = "session_id";

const sessionCookieOptions = {
  path: "/",
} satisfies CookieOptions;

type CookieSession = {
  token: string;
  expires_at: string;
};

export function setSessionCookie(response: Response, session: CookieSession): void {
  response.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);
}
