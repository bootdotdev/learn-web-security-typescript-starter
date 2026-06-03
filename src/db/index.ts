import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.ts";

const databasePath =
  process.env.DATABASE_URL ?? join(process.cwd(), "data", "bearly-secure.sqlite");

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) {
    return db;
  }

  mkdirSync(dirname(databasePath), { recursive: true });

  db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);

  return db;
}
