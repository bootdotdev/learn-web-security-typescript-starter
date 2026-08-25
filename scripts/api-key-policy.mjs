import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const warehouseKey = "bs_whsec_8f2d1b7a4c6e9d0f3a5b";
const wrongScopeKey = "bs_catalog_scope_test";
const revokedKey = "bs_revoked_warehouse_test";

const databasePath =
  process.env.DATABASE_URL ?? join(process.cwd(), "data", "bearly-secure.sqlite");
const database = new DatabaseSync(databasePath);

function hashApiKey(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex");
}

try {
  database.exec("PRAGMA busy_timeout = 5000");

  const warehouse = database
    .prepare(`
      SELECT key_hash, scope, revoked_at
      FROM api_keys
      WHERE name = ?
    `)
    .get("Warehouse Fulfillment Integration");
  const rawKeyStored = database
    .prepare("SELECT 1 FROM api_keys WHERE key_hash = ?")
    .get(warehouseKey);

  const upsertFixture = database.prepare(`
    INSERT INTO api_keys (name, key_hash, scope, revoked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      name = excluded.name,
      scope = excluded.scope,
      revoked_at = excluded.revoked_at
  `);
  upsertFixture.run("Catalog Integration", hashApiKey(wrongScopeKey), "products:read", null);
  upsertFixture.run(
    "Revoked Warehouse Integration",
    hashApiKey(revokedKey),
    "orders:read",
    new Date().toISOString(),
  );

  console.log(
    JSON.stringify({
      hashMatches: warehouse?.key_hash === hashApiKey(warehouseKey),
      rawKeyAbsent: rawKeyStored === undefined,
      scopeMatches: warehouse?.scope === "orders:read",
      active: warehouse?.revoked_at === null,
    }),
  );
} finally {
  database.close();
}
