import type { DatabaseSync } from "node:sqlite";
import { fastHash } from "./sessions.ts";

type ApiKey = {
  id: number;
  name: string;
  key_hash: string;
  scope: string;
  revoked_at: string | null;
  created_at: string;
};

export function findApiKey(db: DatabaseSync, apiKey: string): ApiKey | undefined {
  if (!apiKey) return undefined;

  const keyHash = fastHash(apiKey);

  return db
    .prepare(`
      SELECT id, name, key_hash, scope, revoked_at, created_at
      FROM api_keys
      WHERE key_hash = ?
        AND revoked_at IS NULL
    `)
    .get(keyHash) as ApiKey | undefined;
}
