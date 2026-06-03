import type { Request, RequestHandler, Response } from "express";

export type RateLimitState = {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimiterOptions = {
  windowSeconds: number;
  max: number;
  key?: (req: Request) => string;
  onLimit?: (req: Request, res: Response, state: RateLimitState) => void;
  now?: () => number;
};

type Counter = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  limited: boolean;
  state: RateLimitState;
};

export class FixedWindowRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly max: number;
  private readonly onLimit: RateLimiterOptions["onLimit"];
  private readonly readKey: (req: Request) => string;
  private readonly readNow: () => number;
  private readonly windowMs: number;
  private nextSweepAt: number;

  public constructor(options: RateLimiterOptions) {
    validateRateLimiterOptions(options);
    this.max = options.max;
    this.onLimit = options.onLimit;
    this.readKey = options.key ?? clientIpKey;
    this.readNow = options.now ?? Date.now;
    this.windowMs = options.windowSeconds * 1_000;
    this.nextSweepAt = this.readNow() + this.windowMs;
  }

  public consume(req: Request): RateLimitResult {
    const now = this.readNow();
    this.sweepExpiredCounters(now);

    const key = this.readKey(req);
    let counter = this.counters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + this.windowMs };
      this.counters.set(key, counter);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
    if (counter.count >= this.max) {
      return {
        limited: true,
        state: {
          limit: this.max,
          remaining: 0,
          resetAt: counter.resetAt,
          retryAfterSeconds,
        },
      };
    }

    counter.count += 1;
    return {
      limited: false,
      state: {
        limit: this.max,
        remaining: this.max - counter.count,
        resetAt: counter.resetAt,
        retryAfterSeconds,
      },
    };
  }

  public setHeaders(res: Response, state: RateLimitState): void {
    res.setHeader("RateLimit-Limit", String(state.limit));
    res.setHeader("RateLimit-Remaining", String(state.remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
  }

  public reject(req: Request, res: Response, state: RateLimitState): void {
    this.setHeaders(res, state);
    res.setHeader("Retry-After", String(state.retryAfterSeconds));
    if (this.onLimit) {
      this.onLimit(req, res, state);
      return;
    }

    res.status(429).json({ error: "Too many requests" });
  }

  private sweepExpiredCounters(now: number): void {
    if (now < this.nextSweepAt) {
      return;
    }

    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) {
        this.counters.delete(key);
      }
    }
    this.nextSweepAt = now + this.windowMs;
  }
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  validateRateLimiterOptions(options);
  return (_req, _res, next) => next();
}

function validateRateLimiterOptions(options: RateLimiterOptions): void {
  if (!Number.isSafeInteger(options.windowSeconds) || options.windowSeconds <= 0) {
    throw new Error("Rate-limit window must be a positive integer");
  }
  if (!Number.isSafeInteger(options.max) || options.max <= 0) {
    throw new Error("Rate-limit maximum must be a positive integer");
  }
}

export function clientIpKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function canonicalEmailKey(req: Request): string {
  return String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
}
