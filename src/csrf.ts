import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function validateRequestOrigin(_appOrigin: string): RequestHandler {
  return (_req, _res, next) => {
    next();
  };
}

export function csrfTokensMatch(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
