import type { Request } from "express";
import { logEvent } from "../logger.ts";
import { clientIpKey } from "../security/rateLimit.ts";

type AuthAlertOptions = {
  signal: "failed_logins" | "password_reset_requests";
  threshold: number;
  windowSeconds: number;
};

type Counter = {
  count: number;
  resetAt: number;
};

type AuthAlertRecorder = (
  req: Request,
  requestId: string,
  userId: number | null,
) => void;

export function createAuthAlertThreshold(
  options: AuthAlertOptions,
): AuthAlertRecorder {
  const counters = new Map<string, Counter>();
  const windowMs = options.windowSeconds * 1000;
  let nextSweepAt = Date.now() + windowMs;

  return (req: Request, requestId: string, userId: number | null): void => {
    const now = Date.now();
    if (now >= nextSweepAt) {
      for (const [key, counter] of counters) {
        if (counter.resetAt <= now) {
          counters.delete(key);
        }
      }
      nextSweepAt = now + windowMs;
    }

    const sourceIp = clientIpKey(req);
    let counter = counters.get(sourceIp);

    if (!counter || counter.resetAt <= now) {
      counter = {
        count: 0,
        resetAt: now + windowMs,
      };
      counters.set(sourceIp, counter);
    }

    counter.count += 1;
    if (counter.count !== options.threshold) {
      return;
    }

    logEvent("security_alert", {
      requestId,
      outcome: "threshold_crossed",
      signal: options.signal,
      severity: "warning",
      sourceIp,
      userId,
      threshold: options.threshold,
      windowSeconds: options.windowSeconds,
    });
  };
}
