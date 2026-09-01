import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { sendErrorPage } from "../errors.ts";
import { getCurrentSession, type CurrentSession } from "./sessions.ts";

const ALLOWED_RETURN_PATHS = [
  "/",
  "/account",
  "/account/assistant",
  "/account/passkey",
  "/account/totp",
  "/admin/image-preview",
  "/support/tax-exemptions/import",
] as const;

type AllowedReturnPath = (typeof ALLOWED_RETURN_PATHS)[number];

const allowedReturnPaths = new Set<string>(ALLOWED_RETURN_PATHS);
const recentAuthenticationWindowMs = 10 * 60 * 1000;

type UserRole = CurrentSession["user"]["role"];

type RequireAuthOptions = {
  returnTo?: AllowedReturnPath;
};

export function safeReturnTo(value: unknown): AllowedReturnPath {
  return typeof value === "string" && allowedReturnPaths.has(value)
    ? (value as AllowedReturnPath)
    : "/";
}

export function requireAuth(
  db: DatabaseSync,
  req: Request,
  res: Response,
  options: RequireAuthOptions = {},
): CurrentSession | undefined {
  const current = getCurrentSession(db, req.header("cookie"));
  if (!current) {
    const loginPath = options.returnTo
      ? `/login?${new URLSearchParams({ returnTo: safeReturnTo(options.returnTo) })}`
      : "/login";
    res.redirect(loginPath);
    return undefined;
  }

  return current;
}

export function requireRecentAuth(
  db: DatabaseSync,
  req: Request,
  res: Response,
  returnTo: AllowedReturnPath,
): CurrentSession | undefined {
  const current = requireAuth(db, req, res, { returnTo });
  if (!current) {
    return undefined;
  }

  if (!hasRecentAuthentication(current)) {
    res.redirect(`/login?${new URLSearchParams({ returnTo })}`);
    return undefined;
  }

  return current;
}

export function hasRecentAuthentication(current: CurrentSession): boolean {
  const authenticatedAt = Date.parse(current.session.last_authenticated_at);
  const now = Date.now();
  return (
    Number.isFinite(authenticatedAt) &&
    authenticatedAt <= now &&
    authenticatedAt >= now - recentAuthenticationWindowMs
  );
}

export function requireRole(
  db: DatabaseSync,
  req: Request,
  res: Response,
  ...allowedRoles: UserRole[]
): CurrentSession | undefined {
  const current = requireAuth(db, req, res);
  if (!current) {
    return undefined;
  }

  if (!hasRole(current, ...allowedRoles)) {
    sendErrorPage(
      res,
      403,
      "Forbidden",
      "You don't have permission to view this page.",
    );
    return undefined;
  }

  return current;
}

export function hasRole(
  current: CurrentSession | undefined,
  ...allowedRoles: UserRole[]
): boolean {
  return current !== undefined && allowedRoles.includes(current.user.role);
}
