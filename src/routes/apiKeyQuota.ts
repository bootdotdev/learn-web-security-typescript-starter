import type { Response } from "express";
import type { ApiKeyQuota } from "../auth/apiKeyUsage.ts";

export function toApiKeyQuotaResponse(quota: ApiKeyQuota): {
  used: number;
  limit: number;
  remaining: number;
  resets_at: string;
} {
  return {
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining,
    resets_at: quota.resetsAt,
  };
}

export function setApiKeyQuotaHeaders(response: Response, quota: ApiKeyQuota): void {
  response.setHeader("X-Quota-Limit", String(quota.limit));
  response.setHeader("X-Quota-Remaining", String(quota.remaining));
  response.setHeader("X-Quota-Reset", quota.resetsAt);
}

export function sendApiKeyQuotaExhausted(response: Response, quota: ApiKeyQuota): void {
  setApiKeyQuotaHeaders(response, quota);
  response.setHeader("Retry-After", String(quota.retryAfterSeconds));
  response.status(429).json({
    error: "Daily API-key quota exhausted",
    used: quota.used,
    limit: quota.limit,
    resets_at: quota.resetsAt,
  });
}
