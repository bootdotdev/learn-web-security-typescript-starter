import { createHmac, hash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const LEGACY_DEMO_PASSWORD = "password123";
const LEGACY_DEMO_HASH = hash("sha256", LEGACY_DEMO_PASSWORD, "hex");
const mode = process.argv[2];

let result;
switch (mode) {
  case "encryption":
    result = await probeEncryption();
    break;
  case "keyring":
    result = await probeKeyring();
    break;
  case "password-kdf":
    result = await probePasswordKdf();
    break;
  case "argon2-parameters":
    result = await probeArgon2Parameters();
    break;
  case "encrypted-files":
    result = await probeEncryptedFiles();
    break;
  case "field-encryption":
    result = await probeFieldEncryption(process.argv[3]);
    break;
  default:
    throw new Error(
      "Usage: node scripts/storage-policy.mjs <encryption|keyring|password-kdf|argon2-parameters|encrypted-files|field-encryption>",
    );
}

console.log(JSON.stringify(result));

async function probeEncryption() {
  const { decrypt, encrypt } = await import("../src/storage/encryption.ts");
  const key = Buffer.alloc(32, 17);
  const plaintext = Buffer.from([0, 1, 127, 128, 254, 255]);
  const first = encrypt(plaintext, key);
  const second = encrypt(plaintext, key);
  const tampered = {
    ...first,
    ciphertext: Buffer.from(first.ciphertext),
  };
  tampered.ciphertext[0] ^= 1;

  return {
    roundTrip: decrypt(first, key).equals(plaintext),
    bufferFields:
      Buffer.isBuffer(first.nonce) &&
      Buffer.isBuffer(first.authTag) &&
      Buffer.isBuffer(first.ciphertext),
    nonceLength: first.nonce.length,
    authTagLength: first.authTag.length,
    freshNonce: !first.nonce.equals(second.nonce),
    differentCiphertext: !first.ciphertext.equals(second.ciphertext),
    tamperRejected: rejects(() => decrypt(tampered, key)),
    wrongKeyRejected: rejects(() => decrypt(first, Buffer.alloc(32, 34))),
    shortKeyRejected: rejects(() => encrypt(plaintext, Buffer.alloc(31))),
    malformedPayloadRejected: rejects(() =>
      decrypt({ ...first, nonce: Buffer.alloc(11) }, key),
    ),
    malformedAuthTagRejected: rejects(() =>
      decrypt({ ...first, authTag: first.authTag.subarray(0, 12) }, key),
    ),
  };
}

async function probeKeyring() {
  const { decryptWithKeyring, encryptWithKeyring, loadKeyring } =
    await import("../src/storage/keyring.ts");
  const v1 = "33".repeat(32);
  const v2 = "44".repeat(32);
  const originalKeyring = loadKeyring({
    DATA_ENCRYPTION_ACTIVE_VERSION: "v1",
    DATA_ENCRYPTION_KEY_V1: v1,
  });
  const oldPayload = encryptWithKeyring(
    Buffer.from("old document"),
    originalKeyring,
  );
  const rotatedKeyring = loadKeyring({
    DATA_ENCRYPTION_ACTIVE_VERSION: "v2",
    DATA_ENCRYPTION_KEY_V1: v1,
    DATA_ENCRYPTION_KEY_V2: v2,
  });
  const binaryPlaintext = Buffer.from([0, 1, 127, 128, 254, 255]);
  const newPayload = encryptWithKeyring(binaryPlaintext, rotatedKeyring);
  const startupEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("DATA_ENCRYPTION_"),
    ),
  );
  startupEnvironment.PAWPAL_API_KEY = "local-keyring-probe-key";
  startupEnvironment.DOWNLOAD_SIGNING_KEY = "20".repeat(32);
  startupEnvironment.APP_ORIGIN = "http://localhost:3000";
  const totpEncryption = await probeTotpEncryption(v2);

  return {
    activeVersion: rotatedKeyring.activeVersion,
    keyVersion: newPayload.keyVersion,
    keyLengthsValid: [...rotatedKeyring.keys.values()].every(
      (key) => Buffer.isBuffer(key) && key.length === 32,
    ),
    roundTrip: decryptWithKeyring(newPayload, rotatedKeyring).equals(
      binaryPlaintext,
    ),
    oldVersion: oldPayload.keyVersion,
    oldReadable:
      decryptWithKeyring(oldPayload, rotatedKeyring).toString("utf8") ===
      "old document",
    unknownVersionRejected: rejects(() =>
      decryptWithKeyring({ ...oldPayload, keyVersion: "v3" }, rotatedKeyring),
    ),
    validStartupAccepted:
      appImportStatus({
        ...startupEnvironment,
        DATA_ENCRYPTION_ACTIVE_VERSION: "v2",
        DATA_ENCRYPTION_KEY_V1: v1,
        DATA_ENCRYPTION_KEY_V2: v2,
      }) === 0,
    missingStartupRejected: appImportStatus(startupEnvironment) !== 0,
    malformedStartupRejected:
      appImportStatus({
        ...startupEnvironment,
        DATA_ENCRYPTION_ACTIVE_VERSION: "v2",
        DATA_ENCRYPTION_KEY_V1: "zz".repeat(32),
        DATA_ENCRYPTION_KEY_V2: v2,
      }) !== 0,
    ...totpEncryption,
  };
}

async function probeTotpEncryption(key) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "bearly-secure-totp-encryption-"),
  );
  const logPath = resolve("data/bearly-secure.log");
  const logExisted = existsSync(logPath);
  const originalLog = logExisted ? readFileSync(logPath) : Buffer.alloc(0);
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith("DATA_ENCRYPTION_"),
      ),
    ),
    PAWPAL_API_KEY: "local-keyring-probe-key",
    DOWNLOAD_SIGNING_KEY: "20".repeat(32),
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_URL: join(temporaryDirectory, "probe.sqlite"),
    DATA_ENCRYPTION_ACTIVE_VERSION: "v2",
    DATA_ENCRYPTION_KEY_V2: key,
  };
  let database;
  let server;

  try {
    const seedResult = spawnSync(
      process.execPath,
      [resolve("src/db/seed.ts")],
      {
        cwd: temporaryDirectory,
        encoding: "utf8",
        env: environment,
      },
    );
    if (seedResult.status !== 0) {
      throw new Error(
        `Could not seed the TOTP encryption probe: ${seedResult.stderr}`,
      );
    }

    const { createApp } = await import("../src/app.ts");
    const { initDependencies } = await import("../src/dependencies.ts");
    const { decryptStringWithKeyring } =
      await import("../src/storage/keyring.ts");
    const deps = initDependencies(environment, temporaryDirectory);
    database = deps.db;
    createApp(deps);
    const app = createApp(deps);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine the TOTP probe server port");
    }

    const seededRow = database
      .prepare(
        "SELECT totp_secret FROM users WHERE email = 'wendy@example.com'",
      )
      .get();
    const encryptedSeededSecret =
      seededRow && typeof seededRow.totp_secret === "string"
        ? seededRow.totp_secret
        : "";
    const seededSecret = "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF";

    const passwordResponse = await requestProbeApp(address.port, "/login", {
      form: {
        email: "wendy@example.com",
        password: "password123",
        returnTo: "/account",
      },
    });
    const challengeCookie = readResponseCookie(
      passwordResponse.headers,
      "totp_login_challenge",
    );
    const totpResponse = challengeCookie
      ? await requestProbeApp(address.port, "/login/totp", {
          cookie: challengeCookie,
          form: { mfaCode: generateTotpCode(seededSecret) },
        })
      : undefined;

    const mabelLoginResponse = await requestProbeApp(address.port, "/login", {
      form: {
        email: "mabel@example.com",
        password: "password123",
        returnTo: "/account/totp",
      },
    });
    const mabelSessionCookie = readResponseCookie(
      mabelLoginResponse.headers,
      "session_id",
    );
    const enrollmentResponse = mabelSessionCookie
      ? await requestProbeApp(address.port, "/account/totp", {
          cookie: mabelSessionCookie,
          method: "GET",
        })
      : undefined;
    const enrollmentSecret =
      enrollmentResponse?.body.match(
        /Or enter this key manually: <code>([A-Z2-7]+)<\/code>/,
      )?.[1] ?? "";
    const pendingRow = database
      .prepare(
        "SELECT pending_totp_secret FROM users WHERE email = 'mabel@example.com'",
      )
      .get();
    const encryptedPendingSecret =
      pendingRow && typeof pendingRow.pending_totp_secret === "string"
        ? pendingRow.pending_totp_secret
        : "";
    const confirmationResponse =
      mabelSessionCookie && enrollmentSecret
        ? await requestProbeApp(address.port, "/account/totp/confirm", {
            cookie: mabelSessionCookie,
            form: { code: generateTotpCode(enrollmentSecret) },
          })
        : undefined;
    const enrolledRow = database
      .prepare(
        "SELECT totp_secret, pending_totp_secret FROM users WHERE email = 'mabel@example.com'",
      )
      .get();
    const encryptedEnrolledSecret =
      enrolledRow && typeof enrolledRow.totp_secret === "string"
        ? enrolledRow.totp_secret
        : "";

    return {
      seededTotpEncrypted:
        encryptedSeededSecret.length > 0 &&
        !encryptedSeededSecret.includes(seededSecret),
      seededTotpRoundTrip:
        encryptedSeededSecret.length > 0 &&
        decryptStringWithKeyring(encryptedSeededSecret, deps.keyring) ===
          seededSecret,
      seededTotpLoginSucceeded:
        passwordResponse.statusCode === 302 &&
        passwordResponse.headers.location === "/login/totp" &&
        totpResponse?.statusCode === 302 &&
        totpResponse.headers.location === "/account" &&
        readResponseCookie(totpResponse.headers, "session_id") !== undefined,
      newTotpEnrollmentEncrypted:
        enrollmentResponse?.statusCode === 200 &&
        enrollmentSecret.length > 0 &&
        encryptedPendingSecret.length > 0 &&
        !encryptedPendingSecret.includes(enrollmentSecret) &&
        decryptStringWithKeyring(encryptedPendingSecret, deps.keyring) ===
          enrollmentSecret,
      newTotpEnrollmentSucceeded:
        confirmationResponse?.statusCode === 200 &&
        enrolledRow?.pending_totp_secret === null &&
        encryptedEnrolledSecret.length > 0 &&
        decryptStringWithKeyring(encryptedEnrolledSecret, deps.keyring) ===
          enrollmentSecret,
    };
  } finally {
    if (server) {
      server.close();
      await once(server, "close");
    }
    database?.close();

    if (logExisted) {
      writeFileSync(logPath, originalLog);
    } else {
      rmSync(logPath, { force: true });
    }

    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function requestProbeApp(port, path, options = {}) {
  const method = options.method ?? "POST";
  const body = options.form ? new URLSearchParams(options.form).toString() : "";

  return new Promise((resolvePromise, rejectPromise) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Origin: "http://localhost:3000",
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...(options.form
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () =>
          resolvePromise({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode,
          }),
        );
      },
    );

    request.once("error", rejectPromise);
    request.end(body);
  });
}

function readResponseCookie(headers, name) {
  return headers["set-cookie"]
    ?.map((cookie) => cookie.split(";", 1)[0])
    .find((cookie) => cookie.startsWith(`${name}=`));
}

function generateTotpCode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";

  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    if (index >= 0) {
      bits += index.toString(2).padStart(5, "0");
    }
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  const counter = Math.floor(Date.now() / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

async function probePasswordKdf() {
  return withTemporaryApp(async ({ database, port }) => {
    const { createPasswordResetToken } =
      await import("../src/auth/passwordResetTokens.ts");
    const { hashPassword, verifyPassword } =
      await import("../src/auth/passwords.ts");
    const { createSession } = await import("../src/auth/sessions.ts");
    const { generateBackupCodes } =
      await import("../src/auth/totpBackupCodes.ts");
    const { createUser, findUserByEmail, updateUserPassword } =
      await import("../src/auth/users.ts");
    const originalPassword = "correct horse battery staple";
    const changedPassword = "purple plush platypus";
    const createdUser = await createUser(
      database,
      "kdf-probe@example.com",
      "KDF Probe",
      originalPassword,
    );
    const createdHash = createdUser.password_hash;

    await updateUserPassword(database, createdUser.id, changedPassword);
    const changedHash =
      findUserByEmail(database, createdUser.email)?.password_hash ?? "";
    const directHash = await hashPassword("direct helper password");
    const createdParameters = readArgon2Parameters(createdHash);
    const changedParameters = readArgon2Parameters(changedHash);
    const directHashParameters = readArgon2Parameters(directHash);

    const routePassword = "route integration password";
    const routeEmail = "route-kdf-probe@example.com";
    const routeUser = await createUser(
      database,
      routeEmail,
      "Route KDF Probe",
      routePassword,
    );
    const wrongLoginResponse = await requestProbeApp(port, "/login", {
      form: {
        email: routeEmail,
        password: "wrong password",
        returnTo: "/account",
      },
    });
    const [backupCode] = generateBackupCodes(database, routeUser.id, 1);
    const wrongRecoveryResponse = await requestProbeApp(port, "/recover-mfa", {
      form: { email: routeEmail, password: "wrong password", backupCode },
    });
    const accountSession = createSession(database, routeUser.id);
    const rejectedEmail = "route-kdf-changed@example.com";
    const wrongEmailChangeResponse = await requestProbeApp(
      port,
      "/account/email",
      {
        cookie: `session_id=${accountSession.token}`,
        form: {
          csrfToken: accountSession.csrf_token,
          currentPassword: "wrong password",
          email: rejectedEmail,
        },
      },
    );

    const signupPassword = "signup route password";
    const signupEmail = "signup-kdf-probe@example.com";
    const signupResponse = await requestProbeApp(port, "/signup", {
      form: {
        email: signupEmail,
        displayName: "Signup KDF Probe",
        password: signupPassword,
      },
    });
    const signupHash =
      findUserByEmail(database, signupEmail)?.password_hash ?? "";

    const resetOriginalPassword = "reset route old password";
    const resetPassword = "reset route new password";
    const resetUser = await createUser(
      database,
      "reset-kdf-probe@example.com",
      "Reset KDF Probe",
      resetOriginalPassword,
    );
    const resetToken = createPasswordResetToken(database, resetUser.id).token;
    const resetResponse = await requestProbeApp(
      port,
      `/password-reset/${resetToken}`,
      {
        form: { password: resetPassword },
      },
    );
    const resetHash =
      findUserByEmail(database, resetUser.email)?.password_hash ?? "";

    return {
      createdArgon2id: createdHash.startsWith("$argon2id$"),
      createdUsesBaseline: usesPasswordHashBaseline(createdParameters),
      createdPasswordVerified: await verifyPassword(
        originalPassword,
        createdHash,
      ),
      createdWrongPasswordRejected: !(await verifyPassword(
        "wrong password",
        createdHash,
      )),
      changedArgon2id: changedHash.startsWith("$argon2id$"),
      changedUsesBaseline: usesPasswordHashBaseline(changedParameters),
      changedPasswordVerified: await verifyPassword(
        changedPassword,
        changedHash,
      ),
      previousPasswordRejected: !(await verifyPassword(
        originalPassword,
        changedHash,
      )),
      directHashArgon2id: directHash.startsWith("$argon2id$"),
      directHashUsesBaseline: usesPasswordHashBaseline(directHashParameters),
      legacyPasswordVerified: await verifyPassword(
        LEGACY_DEMO_PASSWORD,
        LEGACY_DEMO_HASH,
      ),
      legacyWrongPasswordRejected: !(await verifyPassword(
        "wrong password",
        LEGACY_DEMO_HASH,
      )),
      malformedHashRejected: !(await verifyPassword(
        LEGACY_DEMO_PASSWORD,
        "not-a-hash",
      )),
      loginRouteRejectsWrongPassword: wrongLoginResponse.statusCode === 401,
      mfaRecoveryRouteRejectsWrongPassword:
        wrongRecoveryResponse.statusCode === 401,
      emailChangeRouteRejectsWrongPassword:
        wrongEmailChangeResponse.statusCode === 403 &&
        findUserByEmail(database, routeEmail)?.id === routeUser.id &&
        findUserByEmail(database, rejectedEmail) === undefined,
      signupRouteStoresArgon2id:
        signupResponse.statusCode === 302 &&
        signupResponse.headers.location === "/account" &&
        signupHash.startsWith("$argon2id$") &&
        (await verifyPassword(signupPassword, signupHash)),
      passwordResetRouteStoresArgon2id:
        resetResponse.statusCode === 200 &&
        resetHash.startsWith("$argon2id$") &&
        (await verifyPassword(resetPassword, resetHash)) &&
        !(await verifyPassword(resetOriginalPassword, resetHash)),
    };
  });
}

async function probeArgon2Parameters() {
  const argon2 = (await import("argon2")).default;
  const password = "stale parameter password";
  const staleHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 8 * 1024,
    timeCost: 2,
    parallelism: 1,
  });

  return withTemporaryApp(async ({ database, port }) => {
    insertPasswordUser(database, "parameters@example.com", staleHash);
    insertPasswordUser(database, "parameters-failed@example.com", staleHash);
    insertPasswordUser(
      database,
      "parameters-legacy@example.com",
      LEGACY_DEMO_HASH,
    );
    const legacyRecoveryUserId = insertPasswordUser(
      database,
      "parameters-recovery@example.com",
      LEGACY_DEMO_HASH,
    );
    const { generateBackupCodes } =
      await import("../src/auth/totpBackupCodes.ts");
    const { confirmTotpSecret, setPendingTotpSecret } =
      await import("../src/auth/users.ts");
    const { loadKeyring } = await import("../src/storage/keyring.ts");
    setPendingTotpSecret(
      database,
      legacyRecoveryUserId,
      "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF",
      loadKeyring(),
    );
    confirmTotpSecret(database, legacyRecoveryUserId);
    const [legacyRecoveryCode] = generateBackupCodes(
      database,
      legacyRecoveryUserId,
      1,
    );

    const loginStatus = await postLogin(
      port,
      "parameters@example.com",
      password,
    );
    const failedLoginStatus = await postLogin(
      port,
      "parameters-failed@example.com",
      "wrong password",
    );
    const legacyLoginStatus = await postLogin(
      port,
      "parameters-legacy@example.com",
      LEGACY_DEMO_PASSWORD,
    );
    const legacyRecoveryResponse = await requestProbeApp(port, "/recover-mfa", {
      form: {
        email: "parameters-recovery@example.com",
        password: LEGACY_DEMO_PASSWORD,
        backupCode: legacyRecoveryCode,
      },
    });
    const upgradedHash = readPasswordHash(database, "parameters@example.com");
    const failedHash = readPasswordHash(
      database,
      "parameters-failed@example.com",
    );
    const legacyUpgradedHash = readPasswordHash(
      database,
      "parameters-legacy@example.com",
    );
    const legacyRecoveryHash = readPasswordHash(
      database,
      "parameters-recovery@example.com",
    );
    const { hashPassword, passwordNeedsRehash, verifyPassword } =
      await import("../src/auth/passwords.ts");
    const currentHash = await hashPassword("current policy password");
    const currentParameters = readArgon2Parameters(currentHash);
    const upgradedParameters = readArgon2Parameters(upgradedHash);
    const legacyUpgradedParameters = readArgon2Parameters(legacyUpgradedHash);
    const legacyRecoveryParameters = readArgon2Parameters(legacyRecoveryHash);

    return {
      staleHashVerified: await verifyPassword(password, staleHash),
      staleHashNeedsRehash: passwordNeedsRehash(staleHash),
      currentHashDoesNotNeedRehash: !passwordNeedsRehash(currentHash),
      legacyHashNeedsRehash: passwordNeedsRehash(LEGACY_DEMO_HASH),
      currentMemoryCost: currentParameters.memoryCost,
      currentTimeCost: currentParameters.timeCost,
      currentParallelism: currentParameters.parallelism,
      successfulLogin: loginStatus === 302,
      upgradedAfterLogin: upgradedHash !== staleHash,
      upgradedPasswordVerified: await verifyPassword(password, upgradedHash),
      upgradedMemoryCost: upgradedParameters.memoryCost,
      upgradedTimeCost: upgradedParameters.timeCost,
      upgradedParallelism: upgradedParameters.parallelism,
      failedLoginRejected: failedLoginStatus === 401,
      failedLoginPreservedHash: failedHash === staleHash,
      legacyLoginSucceeded: legacyLoginStatus === 302,
      legacyUpgradedAfterLogin:
        legacyUpgradedHash !== LEGACY_DEMO_HASH &&
        legacyUpgradedHash.startsWith("$argon2id$"),
      legacyUpgradeUsesCurrentPolicy: usesPasswordHashBaseline(
        legacyUpgradedParameters,
      ),
      legacyUpgradeVerified: await verifyPassword(
        LEGACY_DEMO_PASSWORD,
        legacyUpgradedHash,
      ),
      legacyRecoverySucceeded:
        legacyRecoveryResponse.statusCode === 302 &&
        legacyRecoveryResponse.headers.location === "/account/totp",
      legacyRecoveryUpgraded:
        legacyRecoveryHash !== LEGACY_DEMO_HASH &&
        legacyRecoveryHash.startsWith("$argon2id$"),
      legacyRecoveryUsesCurrentPolicy: usesPasswordHashBaseline(
        legacyRecoveryParameters,
      ),
      legacyRecoveryVerified: await verifyPassword(
        LEGACY_DEMO_PASSWORD,
        legacyRecoveryHash,
      ),
    };
  });
}

async function probeEncryptedFiles() {
  const { initDependencies } = await import("../src/dependencies.ts");
  const { decryptWithKeyring, deserializeEncryptedPayload, loadKeyring } =
    await import("../src/storage/keyring.ts");
  const { zipSync } = await import("fflate");
  const keyring = loadKeyring();
  const { extractTaxDocumentArchive } =
    await import("../src/uploads/archive.ts");
  const { createImportedTaxDocuments } =
    await import("../src/uploads/importedTaxDocuments.ts");
  const { readTaxDocument } = await import("../src/uploads/taxDocuments.ts");
  const deps = initDependencies();
  const database = deps.db;
  const dockerfilePolicy = runJsonPolicy(
    "scripts/container-policy.mjs",
    "dockerfile",
  );
  const dockerignorePolicy = runJsonPolicy(
    "scripts/container-policy.mjs",
    "dockerignore",
  );
  const fixturePath = "data/fixtures/mystery-shack-tax-exemption.pdf";
  const fixtureTracked =
    spawnSync("git", ["check-ignore", "--no-index", "--quiet", fixturePath])
      .status === 1;
  let importedArchive;
  let importedArchiveDocumentId;
  try {
    const uploadedFile = database
      .prepare(
        `
        SELECT original_name, storage_path
        FROM uploaded_files
        ORDER BY id
        LIMIT 1
      `,
      )
      .get();

    if (!uploadedFile) {
      throw new Error(
        "The encrypted-file probe requires a seeded uploaded file",
      );
    }

    const stored = readFileSync(uploadedFile.storage_path);
    const serializedPayload = deserializeEncryptedPayload(stored);
    const plaintext = readTaxDocument(uploadedFile.storage_path, keyring);
    const fixture = readFileSync(
      resolve("data/fixtures", uploadedFile.original_name),
    );
    const tamperedPayload = {
      ...serializedPayload,
      ciphertext: Buffer.from(serializedPayload.ciphertext),
    };
    tamperedPayload.ciphertext[0] ^= 1;

    importedArchive = extractTaxDocumentArchive(
      keyring,
      Buffer.from(zipSync({ "new-archive-import.pdf": fixture })),
    );
    const [importedArchiveDocument] = createImportedTaxDocuments(
      database,
      1,
      importedArchive,
    );
    if (!importedArchiveDocument) {
      throw new Error(
        "The encrypted-file probe could not create an archive import",
      );
    }
    importedArchiveDocumentId = importedArchiveDocument.id;
    const importedArchiveStored = readFileSync(
      importedArchiveDocument.storage_path,
    );
    const importedArchivePayload = deserializeEncryptedPayload(
      importedArchiveStored,
    );
    const importedArchivePlaintext = readTaxDocument(
      importedArchiveDocument.storage_path,
      keyring,
    );

    return {
      encryptedExtension: uploadedFile.storage_path.endsWith(".enc"),
      storedFileHasNoPdfHeader: !stored.includes(Buffer.from("%PDF-")),
      recordsActiveKeyVersion:
        serializedPayload.keyVersion === keyring.activeVersion,
      seededFixtureRoundTrip: plaintext.equals(fixture),
      tamperRejected: rejects(() =>
        decryptWithKeyring(tamperedPayload, keyring),
      ),
      newArchiveImportEncrypted:
        importedArchiveDocument.storage_path.endsWith(".enc") &&
        !importedArchiveStored.includes(Buffer.from("%PDF-")) &&
        importedArchivePayload.keyVersion === keyring.activeVersion,
      newArchiveImportRoundTrip: importedArchivePlaintext.equals(fixture),
      fixtureTracked,
      fixtureAvailableInContainer:
        dockerfilePolicy.runtimeCopies &&
        dockerfilePolicy.writableData &&
        dockerignorePolicy.runtimeFilesIncluded,
    };
  } finally {
    if (importedArchiveDocumentId !== undefined) {
      database
        .prepare("DELETE FROM imported_tax_documents WHERE id = ?")
        .run(importedArchiveDocumentId);
    }
    if (importedArchive) {
      rmSync(importedArchive.importDirectory, { force: true, recursive: true });
    }
    database.close();
  }
}

function runJsonPolicy(scriptPath, mode) {
  const result = spawnSync(process.execPath, [scriptPath, mode], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Could not run ${scriptPath} ${mode}: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

async function probeFieldEncryption(orderIdValue) {
  const orderId = Number(orderIdValue);
  if (!Number.isInteger(orderId)) {
    throw new Error(
      "Usage: node scripts/storage-policy.mjs field-encryption <order-id>",
    );
  }

  const { initDependencies } = await import("../src/dependencies.ts");
  const { deserializeEncryptedPayload, loadKeyring } =
    await import("../src/storage/keyring.ts");
  const { decryptShippingDetails } = await import("../src/orders/shipping.ts");
  const keyring = loadKeyring();
  const deps = initDependencies();
  const database = deps.db;
  try {
    const order = database
      .prepare(
        `
        SELECT shipping_details_encrypted
        FROM orders
        WHERE id = ?
      `,
      )
      .get(orderId);

    if (!order || typeof order.shipping_details_encrypted !== "string") {
      throw new Error(
        `Order ${orderId} does not have encrypted shipping details`,
      );
    }

    const payload = deserializeEncryptedPayload(
      Buffer.from(order.shipping_details_encrypted, "utf8"),
    );
    const shippingDetails = decryptShippingDetails(
      order.shipping_details_encrypted,
      keyring,
    );
    const plaintextShippingDetails = Buffer.from(
      JSON.stringify(shippingDetails),
      "utf8",
    );

    return {
      recordsActiveKeyVersion: payload.keyVersion === keyring.activeVersion,
      ciphertextDiffersFromPlaintext: !payload.ciphertext.equals(
        plaintextShippingDetails,
      ),
      shippingDetails,
    };
  } finally {
    database.close();
  }
}

async function withTemporaryApp(probe) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "bearly-secure-password-login-"),
  );
  const logPath = resolve("data/bearly-secure.log");
  const logExisted = existsSync(logPath);
  const originalLog = logExisted ? readFileSync(logPath) : Buffer.alloc(0);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousAppOrigin = process.env.APP_ORIGIN;
  const previousPawPalApiKey = process.env.PAWPAL_API_KEY;
  process.env.DATABASE_URL = join(temporaryDirectory, "probe.sqlite");
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.PAWPAL_API_KEY = "local-password-policy-key";

  let server;
  let database;
  try {
    const { initDependencies } = await import("../src/dependencies.ts");
    const { applySchema } = await import("../src/db/schema.ts");
    const { createApp } = await import("../src/app.ts");
    const deps = initDependencies();
    database = deps.db;
    applySchema(database);
    const app = createApp(deps);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine the password probe server port");
    }

    return await probe({ database, port: address.port });
  } finally {
    if (server) {
      server.close();
      await once(server, "close");
    }
    database?.close();

    if (logExisted) {
      writeFileSync(logPath, originalLog);
    } else {
      rmSync(logPath, { force: true });
    }

    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    restoreEnvironment("APP_ORIGIN", previousAppOrigin);
    restoreEnvironment("PAWPAL_API_KEY", previousPawPalApiKey);
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function insertPasswordUser(database, email, passwordHash) {
  const result = database
    .prepare(
      `
        INSERT INTO users (email, display_name, role, password_hash)
        VALUES (?, 'Password Probe', 'customer', ?)
      `,
    )
    .run(email, passwordHash);
  return Number(result.lastInsertRowid);
}

function readPasswordHash(database, email) {
  const row = database
    .prepare("SELECT password_hash FROM users WHERE email = ?")
    .get(email);
  if (!row || typeof row.password_hash !== "string") {
    throw new Error(`Could not read the password hash for ${email}`);
  }

  return row.password_hash;
}

function postLogin(port, email, password) {
  const body = new URLSearchParams({
    email,
    password,
    returnTo: "/",
  }).toString();

  return new Promise((resolvePromise, rejectPromise) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/login",
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolvePromise(response.statusCode));
      },
    );

    request.once("error", rejectPromise);
    request.end(body);
  });
}

function readArgon2Parameters(passwordHash) {
  const encodedParameters = passwordHash.split("$")[3] ?? "";
  const parameters = Object.fromEntries(
    encodedParameters.split(",").map((entry) => {
      const [name, value] = entry.split("=");
      return [name, Number(value)];
    }),
  );

  return {
    memoryCost: parameters.m,
    timeCost: parameters.t,
    parallelism: parameters.p,
  };
}

function usesPasswordHashBaseline(parameters) {
  return (
    parameters.memoryCost === 19 * 1024 &&
    parameters.timeCost === 2 &&
    parameters.parallelism === 1
  );
}

function restoreEnvironment(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previousValue;
  }
}

function appImportStatus(environment) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const { initDependencies } = await import("./src/dependencies.ts"); const deps = initDependencies(); deps.db.close();',
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
    },
  ).status;
}

function rejects(operation) {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
}
