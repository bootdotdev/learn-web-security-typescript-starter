import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import express from "express";
import { zipSync } from "fflate";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const mode = process.argv[2];

let result;
switch (mode) {
  case "global-rate-limit":
    result = await probeGlobalRateLimit();
    break;
  case "endpoint-rate-limit":
    result = await probeEndpointRateLimit();
    break;
  case "auth-rate-limit":
    result = await probeAuthRateLimit();
    break;
  case "search-throttle":
    result = await probeSearchThrottle();
    break;
  case "resource-limits":
    result = await probeResourceLimits();
    break;
  case "timeouts":
    result = await probeTimeouts();
    break;
  case "api-key-quota":
    result = await probeApiKeyQuota();
    break;
  case "load-shedding":
    result = await probeLoadShedding();
    break;
  default:
    throw new Error(
      "Usage: node scripts/availability-policy.mjs <global-rate-limit|endpoint-rate-limit|auth-rate-limit|search-throttle|resource-limits|timeouts|api-key-quota|load-shedding>",
    );
}

console.log(JSON.stringify(result));

async function probeGlobalRateLimit() {
  const { createRateLimiter } = await import("../src/security/rateLimit.ts");
  const app = express();
  let now = 1_000_000;
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(createRateLimiter({ windowSeconds: 60, max: 2, now: () => now }));
  app.get("/work", (_req, res) => res.json({ ok: true }));

  return withServer(app, async (origin) => {
    const healthStatuses = await requestStatuses(origin, "/health", 3);
    const first = await fetch(`${origin}/work`);
    const second = await fetch(`${origin}/work`);
    const blocked = await fetch(`${origin}/work`);
    now += 60_000;
    const recovered = await fetch(`${origin}/work`);

    return {
      healthStatuses,
      workStatuses: [first.status, second.status, blocked.status],
      limit: first.headers.get("ratelimit-limit"),
      remaining: second.headers.get("ratelimit-remaining"),
      reset: blocked.headers.get("ratelimit-reset"),
      retryAfter: blocked.headers.get("retry-after"),
      recoveredStatus: recovered.status,
      recoveredRemaining: recovered.headers.get("ratelimit-remaining"),
      recoveredReset: recovered.headers.get("ratelimit-reset"),
    };
  });
}

async function probeEndpointRateLimit() {
  return withTemporaryApp(
    "bearly-secure-endpoint-rate-limit-",
    async (origin) => {
      const productStatuses = [];
      let productLimit = null;
      for (let index = 0; index < 31; index += 1) {
        const response = await fetch(`${origin}/api/products`);
        productLimit ??= response.headers.get("ratelimit-limit");
        productStatuses.push(response.status);
      }
      const globalResponse = await fetch(`${origin}/`);

      return {
        allowedProductRequests: productStatuses.filter(
          (status) => status === 200,
        ).length,
        blockedProductStatus: productStatuses.at(-1),
        productLimit,
        globalStatus: globalResponse.status,
        globalLimit: globalResponse.headers.get("ratelimit-limit"),
      };
    },
  );
}

async function probeAuthRateLimit() {
  const probeAppOrigin = "http://bearly-secure.test";
  const neutralResetMessage =
    "If an account exists for that email, Bear Mail will send a reset link shortly.";
  return withTemporaryApp(
    "bearly-secure-auth-rate-limit-",
    async (origin, deps) => {
      deps.db
        .prepare(
          `
            INSERT INTO users (email, display_name, role, password_hash)
            VALUES ('mabel@example.com', 'Mabel Pines', 'customer', ?)
          `,
        )
        .run("0".repeat(64));

      async function attemptSeries(path, emails, readIp, extraFields = {}) {
        const attempts = [];
        for (let index = 0; index < emails.length; index += 1) {
          const response = await postFormResponse(
            origin,
            path,
            { email: emails[index], ...extraFields },
            {
              Origin: probeAppOrigin,
              "X-Forwarded-For": readIp(index),
            },
          );
          attempts.push({
            status: response.status,
            body: await response.text(),
            retryAfter: response.headers.get("retry-after"),
          });
        }
        return attempts;
      }

      const loginEmailVariants = [
        " MABEL@EXAMPLE.COM ",
        "mabel@example.com",
        "Mabel@Example.Com",
        "mabel@example.com ",
        " Mabel@example.com",
        "MABEL@example.com",
      ];
      const unknownLoginVariants = loginEmailVariants.map((email) =>
        email.replace(/mabel/i, "nobody"),
      );
      const knownLogin = await attemptSeries(
        "/login",
        loginEmailVariants,
        (index) => `192.0.2.${index + 1}`,
        { password: "incorrect-password" },
      );
      const unknownLogin = await attemptSeries(
        "/login",
        unknownLoginVariants,
        (index) => `192.0.2.${index + 21}`,
        { password: "incorrect-password" },
      );
      const loginByIp = await attemptSeries(
        "/login",
        Array.from(
          { length: 21 },
          (_, index) => `login-ip-${index}@example.com`,
        ),
        () => "192.0.2.100",
        { password: "incorrect-password" },
      );
      const totpByIp = await attemptSeries(
        "/login/totp",
        Array.from({ length: 21 }, () => ""),
        () => "192.0.2.101",
      );

      const resetEmailVariants = loginEmailVariants.slice(0, 4);
      const unknownResetVariants = unknownLoginVariants.slice(0, 4);
      const knownReset = await attemptSeries(
        "/password-reset",
        resetEmailVariants,
        (index) => `198.51.100.${index + 1}`,
      );
      const unknownReset = await attemptSeries(
        "/password-reset",
        unknownResetVariants,
        (index) => `198.51.100.${index + 21}`,
      );
      const resetByIp = await attemptSeries(
        "/password-reset",
        Array.from(
          { length: 11 },
          (_, index) => `reset-ip-${index}@example.com`,
        ),
        () => "198.51.100.100",
      );

      const blockedAttempts = [
        knownLogin.at(-1),
        unknownLogin.at(-1),
        loginByIp.at(-1),
        totpByIp.at(-1),
        knownReset.at(-1),
        unknownReset.at(-1),
        resetByIp.at(-1),
      ];

      return {
        knownLoginStatuses: knownLogin.map(({ status }) => status),
        unknownLoginStatuses: unknownLogin.map(({ status }) => status),
        loginIpStatuses: loginByIp.map(({ status }) => status),
        totpIpStatuses: totpByIp.map(({ status }) => status),
        knownResetStatuses: knownReset.map(({ status }) => status),
        unknownResetStatuses: unknownReset.map(({ status }) => status),
        resetIpStatuses: resetByIp.map(({ status }) => status),
        loginLimitBodiesMatch:
          knownLogin.at(-1)?.body === unknownLogin.at(-1)?.body,
        resetLimitBodiesMatch:
          knownReset.at(-1)?.body === unknownReset.at(-1)?.body,
        resetNeutralBodiesMatch:
          knownReset[0]?.body.includes(neutralResetMessage) === true &&
          unknownReset[0]?.body.includes(neutralResetMessage) === true,
        blockedAttemptsHaveRetryAfter: blockedAttempts.every(
          (attempt) => Number(attempt?.retryAfter) > 0,
        ),
      };
    },
    (deps) => {
      deps.appOrigin = probeAppOrigin;
      deps.trustedProxyHops = 1;
    },
  );
}

async function probeSearchThrottle() {
  return withTemporaryApp(
    "bearly-secure-search-throttle-",
    async (origin) => {
      const statuses = [];
      for (let index = 0; index < 6; index += 1) {
        const response = await fetch(`${origin}/search?q=sloth`, {
          headers: { "X-Forwarded-For": `198.51.100.${index + 1}` },
        });
        statuses.push(response.status);
      }
      return { statuses };
    },
    (deps) => {
      deps.trustedProxyHops = 1;
    },
  );
}

async function probeResourceLimits() {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "bearly-secure-resource-limits-"),
  );
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousWorkingDirectory = process.cwd();
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  process.chdir(temporaryDirectory);
  let database;
  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const { createSession } = await import("../src/auth/sessions.ts");
    const { createApp } = await import("../src/app.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    const app = createApp(deps);
    const userId = Number(
      database
        .prepare(
          `
            INSERT INTO users (email, display_name, role, password_hash)
            VALUES ('resource-limits@example.com', 'Resource Limits', 'support', 'unused')
          `,
        )
        .run().lastInsertRowid,
    );
    const session = createSession(database, userId);
    const insert = database.prepare(`
      INSERT INTO products (
        name, description, image_path, price_cents, cost_cents, inventory_count, is_active
      ) VALUES (?, 'probe', '/probe.png', 100, 50, 1, 1)
    `);
    for (let index = 0; index < deps.maxPublicProductResults + 5; index += 1) {
      insert.run(`Probe ${String(index).padStart(3, "0")}`);
    }

    const reportError = console.error;
    let results;
    try {
      console.error = () => {};
      results = await withServer(app, async (origin) => {
        const requestHeaders = {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        };
        const smallBody = await fetch(`${origin}/login`, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            email: "nobody@example.com",
            password: "incorrect",
          }),
        });
        const largeBody = await fetch(`${origin}/login`, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({ value: "x".repeat(deps.maxRequestBodyBytes) }),
        });
        const formHeaders = {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
        };
        const smallFormBody = await fetch(`${origin}/login`, {
          method: "POST",
          headers: formHeaders,
          body: new URLSearchParams({
            email: "nobody@example.com",
            password: "incorrect",
          }),
        });
        const largeFormBody = await fetch(`${origin}/login`, {
          method: "POST",
          headers: formHeaders,
          body: new URLSearchParams({
            value: "x".repeat(deps.maxRequestBodyBytes),
          }),
        });
        const validPdf = Buffer.from("%PDF-resource-limit-probe");
        const smallTaxForm = new FormData();
        smallTaxForm.set(
          "document",
          new Blob([validPdf], { type: "application/pdf" }),
          "small.pdf",
        );
        const smallUpload = await fetch(
          `${origin}/account/tax-exemption/files`,
          {
            method: "POST",
            headers: {
              Cookie: `session_id=${session.token}`,
              Origin: "http://localhost:3000",
            },
            body: smallTaxForm,
            redirect: "manual",
          },
        );
        const smallArchiveForm = new FormData();
        smallArchiveForm.set(
          "archive",
          new Blob([Buffer.from(zipSync({ "small.pdf": validPdf }))], {
            type: "application/zip",
          }),
          "small.zip",
        );
        const smallArchiveUpload = await fetch(
          `${origin}/support/tax-exemptions/import`,
          {
            method: "POST",
            headers: {
              Cookie: `session_id=${session.token}`,
              Origin: "http://localhost:3000",
            },
            body: smallArchiveForm,
            redirect: "manual",
          },
        );
        const taxForm = new FormData();
        taxForm.set(
          "document",
          new Blob([Buffer.alloc(deps.maxUploadBytes + 1)]),
          "large.pdf",
        );
        const largeUpload = await fetch(
          `${origin}/account/tax-exemption/files`,
          {
            method: "POST",
            headers: {
              Cookie: `session_id=${session.token}`,
              Origin: "http://localhost:3000",
            },
            body: taxForm,
            redirect: "manual",
          },
        );
        const archiveForm = new FormData();
        archiveForm.set(
          "archive",
          new Blob([Buffer.alloc(deps.maxUploadBytes + 1)]),
          "large.zip",
        );
        const largeArchiveUpload = await fetch(
          `${origin}/support/tax-exemptions/import`,
          {
            method: "POST",
            headers: {
              Cookie: `session_id=${session.token}`,
              Origin: "http://localhost:3000",
            },
            body: archiveForm,
            redirect: "manual",
          },
        );
        const products = await (await fetch(`${origin}/api/products`)).json();
        const storefront = await (await fetch(`${origin}/`)).text();
        const search = await (await fetch(`${origin}/search?q=Probe`)).text();

        return {
          smallBody: smallBody.status,
          largeBody: largeBody.status,
          smallFormBody: smallFormBody.status,
          largeFormBody: largeFormBody.status,
          smallUpload: smallUpload.status,
          smallArchiveUpload: smallArchiveUpload.status,
          largeUpload: largeUpload.status,
          largeArchiveUpload: largeArchiveUpload.status,
          uploadedDocumentCount: database
            .prepare(
              "SELECT COUNT(*) AS count FROM uploaded_files WHERE user_id = ?",
            )
            .get(userId).count,
          importedDocumentCount: database
            .prepare(
              "SELECT COUNT(*) AS count FROM imported_tax_documents WHERE imported_by_user_id = ?",
            )
            .get(userId).count,
          productCount: products.products.length,
          storefrontProductCount: countOccurrences(
            storefront,
            'class="product-card"',
          ),
          searchProductCount: countOccurrences(search, 'class="product-card"'),
        };
      });
    } finally {
      console.error = reportError;
    }

    return {
      ...results,
      productLimit: deps.maxPublicProductResults,
    };
  } finally {
    database?.close();
    process.chdir(previousWorkingDirectory);
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function probeTimeouts() {
  const { reserveAcornFulfillmentWithTimeout } =
    await import("../src/integrations/acornFulfillment.ts");
  const request = {
    name: "Mabel Pines",
    address: "618 Gopher Road",
    city: "Gravity Falls",
    region: "OR",
    postalCode: "97001",
  };
  const quick = await reserveAcornFulfillmentWithTimeout(request, {
    delayMs: 0,
    timeoutMs: 50,
  });
  let timeoutName = null;
  try {
    await reserveAcornFulfillmentWithTimeout(request, {
      delayMs: 50,
      timeoutMs: 5,
    });
  } catch (error) {
    timeoutName = error instanceof Error ? error.name : String(error);
  }
  const defaultTimeout = await probeDefaultFulfillmentTimeout(
    reserveAcornFulfillmentWithTimeout,
    request,
  );

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "bearly-secure-timeouts-"),
  );
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousFulfillmentDelay = process.env.ACORN_FULFILLMENT_DELAY_MS;
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  process.env.ACORN_FULFILLMENT_DELAY_MS = "750";
  let database;
  let checkoutResult;
  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const { createSession } = await import("../src/auth/sessions.ts");
    const { createApp } = await import("../src/app.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    const app = createApp(deps);
    database
      .prepare(
        `
          INSERT INTO users (email, display_name, role, password_hash)
          VALUES ('timeout@example.com', 'Timeout Bear', 'customer', 'unused')
        `,
      )
      .run();
    database
      .prepare(
        `
          INSERT INTO products (
            name, description, image_path, price_cents, cost_cents, inventory_count
          ) VALUES ('Timeout Bear', 'probe', '/probe.png', 100, 50, 1)
        `,
      )
      .run();
    database
      .prepare(
        "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (1, 1, 1)",
      )
      .run();
    const session = createSession(database, 1);
    const orderCountBefore = database
      .prepare("SELECT COUNT(*) AS count FROM orders")
      .get().count;

    checkoutResult = await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `session_id=${session.token}`,
          Origin: "http://localhost:3000",
        },
        body: new URLSearchParams({
          csrfToken: session.csrf_token,
          shippingName: "Timeout Bear",
          shippingAddress: "42 Acorn Plaza",
          shippingCity: "Gravity Falls",
          shippingRegion: "OR",
          shippingPostalCode: "97001",
        }),
      });
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        checkoutSkipped: response.status === 503,
      };
    });

    checkoutResult.orderCountBefore = orderCountBefore;
    checkoutResult.orderCountAfter = database
      .prepare("SELECT COUNT(*) AS count FROM orders")
      .get().count;
  } finally {
    database?.close();
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    restoreEnvironment("ACORN_FULFILLMENT_DELAY_MS", previousFulfillmentDelay);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  const serverSource = readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  return {
    quickReservation: quick.reservationId,
    timeoutName,
    defaultTimeout,
    checkout: checkoutResult,
    headersTimeoutMs: readNumericAssignment(serverSource, "headersTimeout"),
    requestTimeoutMs: readNumericAssignment(serverSource, "requestTimeout"),
  };
}

async function probeDefaultFulfillmentTimeout(reserve, request) {
  const originalAbortTimeout = AbortSignal.timeout;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandle = {};
  const timeoutReason = new DOMException(
    "The operation timed out",
    "TimeoutError",
  );
  let defaultTimeoutMs = null;
  let abortListener;
  let fulfillmentTimerCleared = false;
  const signal = {
    aborted: false,
    reason: undefined,
    addEventListener(eventName, listener) {
      if (eventName === "abort") {
        abortListener = listener;
      }
    },
    removeEventListener(eventName, listener) {
      if (eventName === "abort" && abortListener === listener) {
        abortListener = undefined;
      }
    },
  };

  try {
    AbortSignal.timeout = (timeoutMs) => {
      defaultTimeoutMs = timeoutMs;
      return signal;
    };
    globalThis.setTimeout = () => timerHandle;
    globalThis.clearTimeout = (handle) => {
      if (handle === timerHandle) {
        fulfillmentTimerCleared = true;
      }
    };

    const pendingReservation = reserve(request, { delayMs: 1_000 });
    const timeoutSignalObserved = typeof abortListener === "function";
    let timeoutName = null;
    if (abortListener) {
      signal.aborted = true;
      signal.reason = timeoutReason;
      abortListener();
      try {
        await pendingReservation;
      } catch (error) {
        timeoutName = error instanceof Error ? error.name : String(error);
      }
    }

    return {
      defaultTimeoutMs,
      timeoutName,
      timeoutSignalObserved,
      fulfillmentTimerCleared,
    };
  } finally {
    AbortSignal.timeout = originalAbortTimeout;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

async function probeApiKeyQuota() {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "bearly-secure-api-quota-"),
  );
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  let database;

  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    const insertApiKey = database.prepare(
      "INSERT INTO api_keys (name, key_hash, scope) VALUES (?, ?, ?)",
    );
    const contentionKeyId = Number(
      insertApiKey.run(
        "Contention Probe",
        "contention-probe-hash",
        "orders:read",
      ).lastInsertRowid,
    );
    const validKey = "bs_quota_valid_probe";
    const wrongScopeKey = "bs_quota_wrong_scope_probe";
    insertApiKey.run("Valid Quota Probe", hashApiKey(validKey), "orders:read");
    insertApiKey.run(
      "Wrong Scope Probe",
      hashApiKey(wrongScopeKey),
      "products:write",
    );

    const now = new Date("2030-01-02T12:00:00.000Z");
    const contentionResults = await consumeQuotaConcurrently(
      deps.databasePath,
      contentionKeyId,
      2,
      now,
      8,
    );
    const finalUsed = database
      .prepare(
        `
          SELECT request_count
          FROM api_key_usage
          WHERE api_key_id = ? AND period_start = ?
        `,
      )
      .get(contentionKeyId, "2030-01-02").request_count;

    const app = (await import("../src/app.ts")).createApp(deps);
    const http = await withServer(app, async (origin) => {
      const requestWarehouse = (apiKey) =>
        fetch(`${origin}/api/integrations/warehouse/orders`, {
          headers: { "X-API-Key": apiKey },
        });
      const invalid = await requestWarehouse("invalid");
      const wrongScope = await requestWarehouse(wrongScopeKey);
      const rejectedUsageCount = database
        .prepare(
          "SELECT COUNT(*) AS count FROM api_key_usage WHERE api_key_id != ?",
        )
        .get(contentionKeyId).count;
      const validResponses = [];
      for (let index = 0; index < 6; index += 1) {
        const response = await requestWarehouse(validKey);
        validResponses.push({
          status: response.status,
          limit: response.headers.get("x-quota-limit"),
          remaining: response.headers.get("x-quota-remaining"),
          reset: response.headers.get("x-quota-reset"),
          retryAfter: response.headers.get("retry-after"),
          body: await response.json(),
        });
      }

      return {
        invalidStatus: invalid.status,
        wrongScopeStatus: wrongScope.status,
        rejectedUsageCount,
        validResponses,
      };
    });

    return {
      atomic: {
        allowedCount: contentionResults.filter((quota) => quota.allowed).length,
        blockedCount: contentionResults.filter((quota) => !quota.allowed)
          .length,
        finalUsed,
        results: contentionResults,
      },
      http,
    };
  } finally {
    database?.close();
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function consumeQuotaConcurrently(
  databasePath,
  apiKeyId,
  limit,
  now,
  workerCount,
) {
  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const workerSource = `
    import { DatabaseSync } from "node:sqlite";
    import { parentPort, workerData } from "node:worker_threads";
    import { consumeApiKeyQuota } from ${JSON.stringify(
      new URL("../src/auth/apiKeyUsage.ts", import.meta.url).href,
    )};

    const db = new DatabaseSync(workerData.databasePath);
    db.exec("PRAGMA busy_timeout = 5000");
    const barrier = new Int32Array(workerData.barrier);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(barrier, 0, 0);
    try {
      const result = consumeApiKeyQuota(
        db,
        workerData.apiKeyId,
        workerData.limit,
        new Date(workerData.now),
      );
      parentPort.postMessage({ type: "result", result });
    } finally {
      db.close();
    }
  `;
  const workers = Array.from({ length: workerCount }, () =>
    createQuotaWorker(workerSource, {
      databasePath,
      apiKeyId,
      limit,
      now: now.toISOString(),
      barrier,
    }),
  );

  await Promise.all(workers.map((worker) => worker.ready));
  Atomics.store(new Int32Array(barrier), 0, 1);
  Atomics.notify(new Int32Array(barrier), 0, workerCount);
  return Promise.all(workers.map((worker) => worker.result));
}

function createQuotaWorker(source, workerData) {
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(source)}`),
    {
      type: "module",
      workerData,
    },
  );
  let markReady;
  let resolveResult;
  let rejectReady;
  let rejectResult;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  worker.on("message", (message) => {
    if (message.type === "ready") {
      markReady();
    } else if (message.type === "result") {
      resolveResult(message.result);
    }
  });
  worker.on("error", (error) => {
    rejectReady(error);
    rejectResult(error);
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      const error = new Error(`Quota worker exited with code ${code}`);
      rejectReady(error);
      rejectResult(error);
    }
  });

  return { ready, result };
}

function hashApiKey(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function probeLoadShedding() {
  const { createLoadShedder } = await import("../src/security/loadShedding.ts");
  const appSource = readFileSync(
    new URL("../src/app.ts", import.meta.url),
    "utf8",
  );
  const healthRoutePosition = appSource.indexOf('app.get("/health"');
  const loadShedderPosition = appSource.indexOf("app.use(loadShedder)");
  const app = express();
  let releaseHeldRequest;
  let markHeldRequestStarted;
  const heldRequestStarted = new Promise((resolve) => {
    markHeldRequestStarted = resolve;
  });
  const heldRequestGate = new Promise((resolve) => {
    releaseHeldRequest = resolve;
  });
  let releaseDisconnectedRequest;
  let markDisconnectedRequestStarted;
  let markDisconnectedRequestClosed;
  const disconnectedRequestStarted = new Promise((resolve) => {
    markDisconnectedRequestStarted = resolve;
  });
  const disconnectedRequestClosed = new Promise((resolve) => {
    markDisconnectedRequestClosed = resolve;
  });
  const disconnectedRequestGate = new Promise((resolve) => {
    releaseDisconnectedRequest = resolve;
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(createLoadShedder({ maxConcurrent: 1, retryAfterSeconds: 1 }));
  app.get("/work", async (req, res) => {
    if (req.query.hold === "finish") {
      markHeldRequestStarted();
      await heldRequestGate;
    }
    if (req.query.hold === "close") {
      res.once("close", markDisconnectedRequestClosed);
      markDisconnectedRequestStarted();
      await disconnectedRequestGate;
    }
    if (!res.destroyed) {
      res.json({ ok: true });
    }
  });

  return withServer(app, async (origin) => {
    const heldRequest = fetch(`${origin}/work?hold=finish`);
    await heldRequestStarted;
    const healthWhileFull = await fetch(`${origin}/health`);
    const blocked = await fetch(`${origin}/work`);
    releaseHeldRequest();
    const held = await heldRequest;
    const recoveredAfterFinish = await fetch(`${origin}/work`);

    const controller = new AbortController();
    const disconnectedRequest = fetch(`${origin}/work?hold=close`, {
      signal: controller.signal,
    }).then(
      (response) => `status:${response.status}`,
      (error) => (error instanceof Error ? error.name : String(error)),
    );
    await disconnectedRequestStarted;
    controller.abort();
    const disconnectedResult = await disconnectedRequest;
    await disconnectedRequestClosed;
    const recoveredAfterClose = await fetch(`${origin}/work`);
    releaseDisconnectedRequest();

    return {
      held: held.status,
      healthWhileFull: healthWhileFull.status,
      blocked: blocked.status,
      retryAfter: blocked.headers.get("retry-after"),
      recoveredAfterFinish: recoveredAfterFinish.status,
      disconnectedResult,
      recoveredAfterClose: recoveredAfterClose.status,
      healthRegisteredBeforeLoadShedder:
        healthRoutePosition >= 0 &&
        loadShedderPosition >= 0 &&
        healthRoutePosition < loadShedderPosition,
    };
  });
}

async function withServer(app, probe) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine probe server port");
    }
    return await probe(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function withTemporaryApp(
  prefix,
  probe,
  configureDependencies = () => {},
) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), prefix));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  let database;

  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const { createApp } = await import("../src/app.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    configureDependencies(deps);
    return await withServer(createApp(deps), (origin) => probe(origin, deps));
  } finally {
    database?.close();
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function requestStatuses(origin, path, count) {
  const statuses = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await fetch(`${origin}${path}`)).status);
  }
  return statuses;
}

function postFormResponse(origin, path, fields, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function readNumericAssignment(source, propertyName) {
  const match = source.match(
    new RegExp(`server\\.${propertyName}\\s*=\\s*([\\d_]+)\\s*;`),
  );
  if (!match) {
    return null;
  }

  const value = Number(match[1].replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
