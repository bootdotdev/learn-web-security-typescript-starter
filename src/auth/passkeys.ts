import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const rpName = "Bearly Secure";

export {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
};

type PasskeyCredential = {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: string;
};

export function listPasskeyCredentials(db: DatabaseSync, userId: number): PasskeyCredential[] {
  return db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports, created_at
       FROM passkey_credentials WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId) as PasskeyCredential[];
}

export function findPasskeyByCredentialId(
  db: DatabaseSync,
  credentialId: string,
): PasskeyCredential | undefined {
  return db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports, created_at
       FROM passkey_credentials WHERE credential_id = ?`,
    )
    .get(credentialId) as PasskeyCredential | undefined;
}

export function storePasskeyCredential(
  db: DatabaseSync,
  userId: number,
  credentialId: string,
  publicKey: Uint8Array,
  counter: number,
  transports?: string[],
): void {
  db.prepare(
    `INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter, transports)
       VALUES (?, ?, ?, ?, ?)`,
  ).run(
    userId,
    credentialId,
    isoBase64URL.fromBuffer(publicKey as Uint8Array<ArrayBuffer>),
    counter,
    transports ? JSON.stringify(transports) : null,
  );
}

export function updatePasskeyCounter(
  db: DatabaseSync,
  credentialId: string,
  newCounter: number,
): void {
  db.prepare(`UPDATE passkey_credentials SET counter = ? WHERE credential_id = ?`).run(
    newCounter,
    credentialId,
  );
}

export function deletePasskeyCredential(db: DatabaseSync, id: number, userId: number): void {
  db.prepare(`DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?`).run(id, userId);
}

type StoredChallenge = {
  id: string;
  challenge: string;
  user_id: number | null;
  expires_at: string;
};

export function createChallenge(db: DatabaseSync, userId?: number): StoredChallenge {
  const id = crypto.randomUUID();
  const challenge = isoBase64URL.fromBuffer(crypto.randomBytes(32));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare("DELETE FROM passkey_challenges WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare(
    `INSERT INTO passkey_challenges (id, challenge, user_id, expires_at)
       VALUES (?, ?, ?, ?)`,
  ).run(id, challenge, userId ?? null, expiresAt);

  return { id, challenge, user_id: userId ?? null, expires_at: expiresAt };
}

export function consumeChallenge(db: DatabaseSync, id: string): StoredChallenge | undefined {
  const stored = db
    .prepare(
      `DELETE FROM passkey_challenges
       WHERE id = ?
       RETURNING id, challenge, user_id, expires_at`,
    )
    .get(id) as StoredChallenge | undefined;

  const expiresAt = stored ? Date.parse(stored.expires_at) : Number.NaN;
  if (!stored || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return undefined;
  }

  return stored;
}
