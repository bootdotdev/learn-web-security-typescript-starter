import type { DatabaseSync } from "node:sqlite";

const WAREHOUSE_DAILY_QUOTA = 5;

export type ApiKeyQuota = {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  retryAfterSeconds: number;
};

export function consumeApiKeyQuota(
  db: DatabaseSync,
  apiKeyId: number,
  limit: number = WAREHOUSE_DAILY_QUOTA,
  now: Date = new Date(),
): ApiKeyQuota {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("API-key quota must be a positive integer");
  }

  const periodStart = now.toISOString().slice(0, 10);
  const reset = new Date(`${periodStart}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);

  const consumed = db
    .prepare(
      `
        INSERT INTO api_key_usage (api_key_id, period_start, request_count)
        VALUES (?, ?, 1)
        ON CONFLICT (api_key_id, period_start) DO UPDATE
        SET request_count = request_count + 1
        WHERE request_count < ?
        RETURNING request_count
      `,
    )
    .get(apiKeyId, periodStart, limit) as { request_count: number } | undefined;

  const used =
    consumed?.request_count ??
    (
      db
        .prepare(
          `
            SELECT request_count
            FROM api_key_usage
            WHERE api_key_id = ? AND period_start = ?
          `,
        )
        .get(apiKeyId, periodStart) as { request_count: number }
    ).request_count;

  return {
    allowed: consumed !== undefined,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt: reset.toISOString(),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((reset.getTime() - now.getTime()) / 1000),
    ),
  };
}
