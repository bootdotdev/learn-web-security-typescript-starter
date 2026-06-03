import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateSync } from "otplib";

const mode = process.argv[2];

setRequiredEnvironment();

let result;
switch (mode) {
  case "observability":
    result = await probeObservability();
    break;
  case "alerts":
    result = await probeAlerts();
    break;
  case "security-txt":
    result = await probeSecurityTxt();
    break;
  case "damage-control":
    result = await probeDamageControl();
    break;
  default:
    throw new Error(
      "Usage: node scripts/incident-response-policy.mjs <observability|alerts|security-txt|damage-control>",
    );
}

console.log(JSON.stringify(result));

async function probeObservability() {
  const logPath = resolve("data/bearly-secure.log");
  const logExisted = existsSync(logPath);
  const originalLog = logExisted ? readFileSync(logPath) : Buffer.alloc(0);
  const probeEmail = "observability-probe@example.com";
  const probePassword = "observability-secret";
  const demoPassword = "password123";
  const mabelEmail = "mabel@example.com";
  const wendyEmail = "wendy@example.com";
  const wendyTotpSecret = "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF";
  const invalidMfaCode = "not-a-code";
  const suppliedRequestId = "client-supplied-request-id";
  let submittedMfaCode = "";

  try {
    const { createApp } = await import("../src/app.ts");
    const { initDependencies } = await import("../src/dependencies.ts");
    const deps = initDependencies();
    let result;
    try {
      result = await withServer(createApp(deps), async (origin) => {
        const firstHealth = await fetch(`${origin}/health`, {
          headers: { "X-Request-ID": suppliedRequestId },
        });
        const secondHealth = await fetch(`${origin}/health`);
        const failedLogin = await postForm(origin, "/login", {
          email: probeEmail,
          password: probePassword,
          returnTo: "/account",
        });
        const successfulLogin = await postForm(
          origin,
          "/login",
          {
            email: mabelEmail,
            password: demoPassword,
            returnTo: "/account",
          },
          undefined,
          { redirect: "manual" },
        );
        const totpPassword = await postForm(
          origin,
          "/login",
          {
            email: wendyEmail,
            password: demoPassword,
            returnTo: "/account",
          },
          undefined,
          { redirect: "manual" },
        );
        const challengeCookie = readResponseCookie(totpPassword, "totp_login_challenge");
        const failedTotp = challengeCookie
          ? await postForm(origin, "/login/totp", { mfaCode: invalidMfaCode }, undefined, {
              cookie: challengeCookie,
              redirect: "manual",
            })
          : undefined;
        submittedMfaCode = generateSync({ secret: wendyTotpSecret });
        const successfulTotp = challengeCookie
          ? await postForm(origin, "/login/totp", { mfaCode: submittedMfaCode }, undefined, {
              cookie: challengeCookie,
              redirect: "manual",
            })
          : undefined;

        const originalConsoleLog = console.log;
        let passwordReset;
        try {
          console.log = () => {};
          passwordReset = await postForm(origin, "/password-reset", {
            email: mabelEmail,
          });
        } finally {
          console.log = originalConsoleLog;
        }

        return {
          firstHealthStatus: firstHealth.status,
          firstHealthRequestId: firstHealth.headers.get("x-request-id"),
          secondHealthStatus: secondHealth.status,
          secondHealthRequestId: secondHealth.headers.get("x-request-id"),
          loginStatus: failedLogin.status,
          loginRequestId: failedLogin.headers.get("x-request-id"),
          successfulLoginStatus: successfulLogin.status,
          successfulLoginRequestId: successfulLogin.headers.get("x-request-id"),
          totpPasswordStatus: totpPassword.status,
          failedTotpStatus: failedTotp?.status,
          failedTotpRequestId: failedTotp?.headers.get("x-request-id"),
          successfulTotpStatus: successfulTotp?.status,
          successfulTotpRequestId: successfulTotp?.headers.get("x-request-id"),
          resetStatus: passwordReset.status,
          resetRequestId: passwordReset.headers.get("x-request-id"),
        };
      });
    } finally {
      deps.db.close();
    }

    const appendedLog = readFileSync(logPath).subarray(originalLog.length).toString("utf8");
    const entries = appendedLog
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const failedLoginEntry = findEvent(entries, "login_attempt", result.loginRequestId);
    const successfulLoginEntry = findEvent(
      entries,
      "login_attempt",
      result.successfulLoginRequestId,
    );
    const failedTotpEntry = findEvent(entries, "login_attempt", result.failedTotpRequestId);
    const successfulTotpEntry = findEvent(entries, "login_attempt", result.successfulTotpRequestId);
    const resetEntry = findEvent(entries, "password_reset_request", result.resetRequestId);
    const forbiddenKeys = new Set([
      "email",
      "password",
      "mfaCode",
      "resetToken",
      "resetLink",
      "sessionId",
    ]);
    const responseRequestIds = [
      result.firstHealthRequestId,
      result.secondHealthRequestId,
      result.loginRequestId,
      result.successfulLoginRequestId,
      result.failedTotpRequestId,
      result.successfulTotpRequestId,
      result.resetRequestId,
    ];
    const authEventsCorrelated = [
      [failedLoginEntry, result.loginRequestId, "failure"],
      [successfulLoginEntry, result.successfulLoginRequestId, "success"],
      [failedTotpEntry, result.failedTotpRequestId, "failure"],
      [successfulTotpEntry, result.successfulTotpRequestId, "success"],
      [resetEntry, result.resetRequestId, "accepted"],
    ].every(
      ([entry, requestId, outcome]) =>
        validAuthEvent(entry, outcome) && entry.requestId === requestId,
    );

    return {
      ...result,
      requestIdsGlobal:
        result.firstHealthStatus === 200 &&
        result.secondHealthStatus === 200 &&
        responseRequestIds.every(validRequestId) &&
        new Set(responseRequestIds).size === responseRequestIds.length,
      requestIdsServerGenerated:
        validRequestId(result.firstHealthRequestId) &&
        result.firstHealthRequestId !== suppliedRequestId,
      authEventsCorrelated,
      authSecretsAbsent:
        [
          probeEmail,
          probePassword,
          demoPassword,
          mabelEmail,
          wendyEmail,
          invalidMfaCode,
          submittedMfaCode,
        ].every((value) => !appendedLog.includes(value)) &&
        entries.every((entry) =>
          Object.entries(entry).every(
            ([key, value]) => !forbiddenKeys.has(key) || value === "[REDACTED]",
          ),
        ),
    };
  } finally {
    if (logExisted) {
      writeFileSync(logPath, originalLog);
    } else {
      rmSync(logPath, { force: true });
    }
  }
}

async function probeDamageControl() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "bearly-secure-incident-response-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  let database;

  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const { getCurrentSession, fastHash, revokeAllActiveSessions } =
      await import("../src/auth/sessions.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    database
      .prepare(
        `
          INSERT INTO users (email, display_name, role, password_hash)
          VALUES ('incident@example.com', 'Incident Bear', 'customer', 'unused')
        `,
      )
      .run();

    const sessionColumns = new Set(
      database
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .map((column) => column.name),
    );
    const sessionsRequireCsrfToken = sessionColumns.has("csrf_token");
    const insertSession = sessionsRequireCsrfToken
      ? database.prepare(`
          INSERT INTO sessions (
            token_hash, user_id, csrf_token, expires_at, last_authenticated_at, created_at,
            revoked_at
          ) VALUES (?, 1, ?, '2040-01-01T00:00:00.000Z', ?, ?, ?)
        `)
      : database.prepare(`
          INSERT INTO sessions (
            token_hash, user_id, expires_at, last_authenticated_at, created_at, revoked_at
          ) VALUES (?, 1, '2040-01-01T00:00:00.000Z', ?, ?, ?)
        `);
    const insertProbeSession = (token, createdAt, revokedAt = null) => {
      const values = [fastHash(token)];
      if (sessionsRequireCsrfToken) {
        values.push(`${token}-csrf`);
      }
      insertSession.run(...values, createdAt, createdAt, revokedAt);
    };
    const originalRevokedAt = "2030-01-01T12:00:00.000Z";
    insertProbeSession("old-session", "2030-01-02T00:00:00.100Z");
    insertProbeSession("boundary-session", "2030-01-02T00:00:00.500Z");
    insertProbeSession("new-session", "2030-01-02T00:00:00.900Z");
    insertProbeSession("already-revoked-session", "2030-01-01T00:00:00.000Z", originalRevokedAt);

    const revoked = revokeAllActiveSessions(database);
    const repeatRevocationNoChanges = revokeAllActiveSessions(database) === 0;
    const storedRevokedAt = database
      .prepare("SELECT revoked_at FROM sessions WHERE token_hash = ?")
      .get(fastHash("already-revoked-session")).revoked_at;

    return {
      revoked,
      oldSessionActive: Boolean(getCurrentSession(database, "session_id=old-session")),
      boundarySessionActive: Boolean(getCurrentSession(database, "session_id=boundary-session")),
      newSessionActive: Boolean(getCurrentSession(database, "session_id=new-session")),
      alreadyRevokedSessionUnchanged: storedRevokedAt === originalRevokedAt,
      repeatRevocationNoChanges,
    };
  } finally {
    database?.close();
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

async function probeAlerts() {
  const logPath = resolve("data/bearly-secure.log");
  const logExisted = existsSync(logPath);
  const originalLog = logExisted ? readFileSync(logPath) : Buffer.alloc(0);

  try {
    const { createApp } = await import("../src/app.ts");
    const { initDependencies } = await import("../src/dependencies.ts");
    const deps = initDependencies();
    let loginProbe;
    let resetProbe;
    let successfulLoginProbe;
    let failedTotpProbe;
    let knownResetProbe;
    try {
      loginProbe = await probeAlertWindow({
        createApp: () => createApp(deps),
        fields: (index) => ({
          email: `failed-login-${index}@example.com`,
          password: "incorrect",
        }),
        logOffset: originalLog.length,
        logPath,
        path: "/login",
        signal: "failed_logins",
        windowMs: 5 * 60_000,
      });
      resetProbe = await probeAlertWindow({
        createApp: () => createApp(deps),
        fields: (index) => ({
          email: `reset-request-${index}@example.com`,
        }),
        logOffset: originalLog.length,
        logPath,
        path: "/password-reset",
        signal: "password_reset_requests",
        windowMs: 10 * 60_000,
      });
      successfulLoginProbe = await probeSuccessfulLoginIsIgnored({
        createApp: () => createApp(deps),
        logPath,
      });
      failedTotpProbe = await probeFailedTotpCounts({
        createApp: () => createApp(deps),
        logPath,
      });
      knownResetProbe = await probeKnownResetCounts({
        createApp: () => createApp(deps),
        logPath,
      });
    } finally {
      deps.db.close();
    }

    const appendedLog = readFileSync(logPath).subarray(originalLog.length).toString("utf8");
    const alerts = appendedLog
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "security_alert");
    const loginAlerts = alerts.filter((entry) => entry.signal === "failed_logins");
    const resetAlerts = alerts.filter((entry) => entry.signal === "password_reset_requests");

    return {
      login: loginProbe.statuses,
      passwordReset: resetProbe.statuses,
      loginWindowReset: loginProbe.windowReset,
      resetWindowReset: resetProbe.windowReset,
      loginAlertAtThreshold: loginProbe.alertAtThreshold,
      resetAlertAtThreshold: resetProbe.alertAtThreshold,
      loginAlertNotDuplicated: loginProbe.alertNotDuplicated,
      resetAlertNotDuplicated: resetProbe.alertNotDuplicated,
      successfulLoginIgnored: successfulLoginProbe.successfulLoginIgnored,
      failedTotpCounted: failedTotpProbe.failedTotpCounted,
      knownResetCounted: knownResetProbe.knownResetCounted,
      loginAlert: loginAlerts.every((entry) => validAlert(entry, 3, 300)),
      resetAlert: resetAlerts.every((entry) => validAlert(entry, 3, 600)),
      alertCountsMatchProbes: loginAlerts.length === 3 && resetAlerts.length === 2,
      emailAddressesAbsent: !appendedLog.includes("@example.com"),
    };
  } finally {
    if (logExisted) {
      writeFileSync(logPath, originalLog);
    } else {
      rmSync(logPath, { force: true });
    }
  }
}

async function probeAlertWindow({ createApp, fields, logOffset, logPath, path, signal, windowMs }) {
  const originalDateNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;

  try {
    return await withServer(createApp(), async (origin) => {
      const statuses = [];
      for (let index = 0; index < 2; index += 1) {
        statuses.push((await postForm(origin, path, fields(index))).status);
      }

      now += windowMs + 1;
      statuses.push((await postForm(origin, path, fields(2))).status);
      const windowReset = countSecurityAlerts(logPath, logOffset, signal) === 0;

      for (let index = 3; index < 5; index += 1) {
        statuses.push((await postForm(origin, path, fields(index))).status);
      }
      const alertAtThreshold = countSecurityAlerts(logPath, logOffset, signal) === 1;

      statuses.push((await postForm(origin, path, fields(5))).status);
      const alertNotDuplicated = countSecurityAlerts(logPath, logOffset, signal) === 1;

      return { alertAtThreshold, alertNotDuplicated, statuses, windowReset };
    });
  } finally {
    Date.now = originalDateNow;
  }
}

async function probeSuccessfulLoginIsIgnored({ createApp, logPath }) {
  const logOffset = readFileSync(logPath).length;

  return withServer(createApp(), async (origin) => {
    const firstFailedLogin = await postForm(origin, "/login", {
      email: "ignored-success-first@example.com",
      password: "incorrect",
    });
    const secondFailedLogin = await postForm(origin, "/login", {
      email: "ignored-success-second@example.com",
      password: "incorrect",
    });
    const successfulLogin = await postForm(
      origin,
      "/login",
      {
        email: "mabel@example.com",
        password: "password123",
        returnTo: "/account",
      },
      undefined,
      { redirect: "manual" },
    );
    const noAlertAfterSuccess = countSecurityAlerts(logPath, logOffset, "failed_logins") === 0;
    const thresholdLogin = await postForm(origin, "/login", {
      email: "ignored-success-third@example.com",
      password: "incorrect",
    });

    return {
      successfulLoginIgnored:
        firstFailedLogin.status === 401 &&
        secondFailedLogin.status === 401 &&
        successfulLogin.status === 302 &&
        noAlertAfterSuccess &&
        thresholdLogin.status === 401 &&
        countSecurityAlerts(logPath, logOffset, "failed_logins") === 1,
    };
  });
}

async function probeFailedTotpCounts({ createApp, logPath }) {
  const logOffset = readFileSync(logPath).length;

  return withServer(createApp(), async (origin) => {
    const totpPassword = await postForm(
      origin,
      "/login",
      {
        email: "wendy@example.com",
        password: "password123",
        returnTo: "/account",
      },
      undefined,
      { redirect: "manual" },
    );
    const challengeCookie = readResponseCookie(totpPassword, "totp_login_challenge");
    const firstFailedLogin = await postForm(origin, "/login", {
      email: "totp-first@example.com",
      password: "incorrect",
    });
    const secondFailedLogin = await postForm(origin, "/login", {
      email: "totp-second@example.com",
      password: "incorrect",
    });
    const noAlertBeforeTotpFailure = countSecurityAlerts(logPath, logOffset, "failed_logins") === 0;
    const failedTotp = challengeCookie
      ? await postForm(origin, "/login/totp", { mfaCode: "not-a-code" }, undefined, {
          cookie: challengeCookie,
          redirect: "manual",
        })
      : undefined;

    return {
      failedTotpCounted:
        totpPassword.status === 302 &&
        firstFailedLogin.status === 401 &&
        secondFailedLogin.status === 401 &&
        noAlertBeforeTotpFailure &&
        failedTotp?.status === 401 &&
        countSecurityAlerts(logPath, logOffset, "failed_logins") === 1,
    };
  });
}

async function probeKnownResetCounts({ createApp, logPath }) {
  const logOffset = readFileSync(logPath).length;

  return withServer(createApp(), async (origin) => {
    const firstUnknownReset = await postForm(origin, "/password-reset", {
      email: "known-reset-first@example.com",
    });
    const secondUnknownReset = await postForm(origin, "/password-reset", {
      email: "known-reset-second@example.com",
    });
    const originalConsoleLog = console.log;
    let knownReset;
    try {
      console.log = () => {};
      knownReset = await postForm(origin, "/password-reset", { email: "mabel@example.com" });
    } finally {
      console.log = originalConsoleLog;
    }

    return {
      knownResetCounted:
        firstUnknownReset.status === 200 &&
        secondUnknownReset.status === 200 &&
        knownReset?.status === 200 &&
        countSecurityAlerts(logPath, logOffset, "password_reset_requests") === 1,
    };
  });
}

function countSecurityAlerts(logPath, logOffset, signal) {
  return readFileSync(logPath)
    .subarray(logOffset)
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "security_alert" && entry.signal === signal).length;
}

async function probeSecurityTxt() {
  const { createApp } = await import("../src/app.ts");
  const { initDependencies } = await import("../src/dependencies.ts");
  const deps = initDependencies();

  try {
    return await withServer(createApp(deps), async (origin) => {
      const response = await fetch(`${origin}/.well-known/security.txt`);
      const body = await response.text();
      const lines = body.split(/\r?\n/);
      const expiresFields = lines.filter((line) => /^Expires:/i.test(line));
      const expiresValue = expiresFields[0]?.slice("Expires:".length).trim() ?? "";
      const expiresAt = parseRfc3339(expiresValue);
      const checkedAt = new Date();
      const oneYearFromNow = new Date(checkedAt);
      oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1);

      return {
        status: response.status,
        contentTypeIsPlainText: response.headers.get("content-type")?.startsWith("text/plain"),
        contactPresent: lines.includes("Contact: mailto:security@bearlysecure.example"),
        policyPresent: lines.includes("Policy: https://bearlysecure.example/security-policy"),
        oneExpiresField: expiresFields.length === 1,
        expiresIsRfc3339: Number.isFinite(expiresAt),
        expiresIsFuture: Number.isFinite(expiresAt) && expiresAt > checkedAt.getTime(),
        expiresWithinOneYear: Number.isFinite(expiresAt) && expiresAt < oneYearFromNow.getTime(),
      };
    });
  } finally {
    deps.db.close();
  }
}

function parseRfc3339(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  );
  if (!match) {
    return Number.NaN;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return Number.NaN;
  }

  return Date.parse(value);
}

function validAlert(entry, threshold, windowSeconds) {
  return Boolean(
    entry &&
    entry.outcome === "threshold_crossed" &&
    entry.severity === "warning" &&
    entry.threshold === threshold &&
    entry.windowSeconds === windowSeconds &&
    typeof entry.timestamp === "string" &&
    typeof entry.requestId === "string" &&
    typeof entry.sourceIp === "string",
  );
}

function validAuthEvent(entry, outcome) {
  return Boolean(
    entry &&
    entry.outcome === outcome &&
    typeof entry.timestamp === "string" &&
    typeof entry.requestId === "string" &&
    typeof entry.sourceIp === "string" &&
    Object.hasOwn(entry, "userId"),
  );
}

function findEvent(entries, eventName, requestId) {
  return entries.find((entry) => entry.event === eventName && entry.requestId === requestId);
}

function validRequestId(value) {
  return typeof value === "string" && value.length > 0;
}

function readResponseCookie(response, name) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .find((cookie) => cookie.startsWith(`${name}=`));
}

async function postForm(
  origin,
  path,
  fields,
  requestOrigin = process.env.APP_ORIGIN,
  options = {},
) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: requestOrigin,
  };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  return fetch(`${origin}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
    redirect: options.redirect,
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

function setRequiredEnvironment() {
  process.env.APP_ORIGIN ??= "http://localhost:3000";
  process.env.DATA_ENCRYPTION_ACTIVE_VERSION ??= "v1";
  process.env.DATA_ENCRYPTION_KEY_V1 ??=
    "1111111111111111111111111111111111111111111111111111111111111111";
  process.env.PAWPAL_API_KEY ??= "incident-response-probe";
  process.env.DOWNLOAD_SIGNING_KEY ??= "20".repeat(32);
}
