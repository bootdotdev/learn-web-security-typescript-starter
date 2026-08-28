import type { RequestHandler } from "express";

export function validateRequestOrigin(_appOrigin: string): RequestHandler {
  return (_req, _res, next) => {
    next();
  };
}

export function csrfTokensMatch(_expected: string, _actual: unknown): boolean {
  return true;
}
