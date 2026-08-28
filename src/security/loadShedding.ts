import type { Response } from "express";

export type LoadSheddingOptions = {
  maxConcurrent: number;
  retryAfterSeconds: number;
};

export function validateLoadSheddingOptions(options: LoadSheddingOptions): void {
  if (!Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent <= 0) {
    throw new Error("In-flight limit must be a positive integer");
  }
  if (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds <= 0) {
    throw new Error("Retry delay must be a positive integer");
  }
}

export function rejectLoadShedding(response: Response, options: LoadSheddingOptions): void {
  response.setHeader("X-In-Flight-Limit", String(options.maxConcurrent));
  response.setHeader("Retry-After", String(options.retryAfterSeconds));
  response.status(503).json({ error: "Service is at capacity" });
}
