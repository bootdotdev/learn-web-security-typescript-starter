const ACTIVE_VERSION_ENV = "DATA_ENCRYPTION_ACTIVE_VERSION";
const KEY_ENV_PREFIX = "DATA_ENCRYPTION_KEY_";
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const VERSION_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type Keyring = {
  readonly activeVersion: string;
  readonly keys: ReadonlyMap<string, Buffer>;
};

export type VersionedEncryptedPayload = {
  readonly keyVersion: string;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
  readonly ciphertext: Buffer;
};

type SerializedEncryptedPayload = {
  keyVersion: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
};

export function loadOptionalKeyring(env: NodeJS.ProcessEnv = process.env): Keyring | undefined {
  const hasActiveVersion = Boolean(env[ACTIVE_VERSION_ENV]);
  const hasConfiguredKey = Object.keys(env).some((name) => name.startsWith(KEY_ENV_PREFIX));
  return hasActiveVersion || hasConfiguredKey ? loadKeyring(env) : undefined;
}

export function loadKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  const configuredActiveVersion = env[ACTIVE_VERSION_ENV];
  if (!configuredActiveVersion) {
    throw new Error(`Missing required environment variable: ${ACTIVE_VERSION_ENV}`);
  }

  const activeVersion = normalizeVersion(configuredActiveVersion);
  const keys = new Map<string, Buffer>();

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(KEY_ENV_PREFIX)) {
      continue;
    }

    const version = normalizeVersion(name.slice(KEY_ENV_PREFIX.length));
    if (keys.has(version)) {
      throw new Error(`Duplicate encryption key version: ${version}`);
    }
    if (!value || !KEY_HEX_PATTERN.test(value)) {
      throw new Error(`${name} must contain exactly 64 hexadecimal characters`);
    }

    keys.set(version, Buffer.from(value, "hex"));
  }

  if (!keys.has(activeVersion)) {
    throw new Error(`No encryption key configured for active version: ${activeVersion}`);
  }

  return { activeVersion, keys };
}

export function requireKeyring(keyring: Keyring | undefined): Keyring {
  if (!keyring) {
    throw new Error("Data encryption requires a configured keyring");
  }

  return keyring;
}

export function serializeEncryptedPayload(payload: VersionedEncryptedPayload): Buffer {
  return Buffer.from(
    JSON.stringify({
      keyVersion: payload.keyVersion,
      nonce: payload.nonce.toString("base64"),
      authTag: payload.authTag.toString("base64"),
      ciphertext: payload.ciphertext.toString("base64"),
    } satisfies SerializedEncryptedPayload),
    "utf8",
  );
}

export function deserializeEncryptedPayload(serialized: Buffer): VersionedEncryptedPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(serialized.toString("utf8"));
  } catch {
    throw new Error("Invalid serialized encrypted payload");
  }

  if (!isSerializedEncryptedPayload(payload)) {
    throw new Error("Invalid serialized encrypted payload");
  }

  return {
    keyVersion: payload.keyVersion,
    nonce: decodeBase64(payload.nonce),
    authTag: decodeBase64(payload.authTag),
    ciphertext: decodeBase64(payload.ciphertext),
  };
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().toLowerCase();
  if (!VERSION_PATTERN.test(normalized)) {
    throw new Error(`Invalid encryption key version: ${version}`);
  }

  return normalized;
}

function isSerializedEncryptedPayload(payload: unknown): payload is SerializedEncryptedPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.keyVersion === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Invalid serialized encrypted payload");
  }

  return decoded;
}
