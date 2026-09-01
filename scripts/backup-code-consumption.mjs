import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  hashBackupCode,
  verifyAndConsumeBackupCode,
} from "../src/auth/totpBackupCodes.ts";

const databasePath =
  process.env.DATABASE_URL ??
  join(process.cwd(), "data", "bearly-secure.sqlite");
const fixtureCode = "bs_test_atomic_backup_code";
const fixtureCodeHash = hashBackupCode(fixtureCode);
const database = new DatabaseSync(databasePath);

const preparedStatements = [];
const instrumentedDatabase = {
  prepare(sql) {
    preparedStatements.push(sql.replace(/\s+/g, " ").trim());
    return {
      get() {
        return { id: 1 };
      },
      run() {
        return { changes: 1 };
      },
    };
  },
};

const instrumentedAccepted = verifyAndConsumeBackupCode(
  instrumentedDatabase,
  1,
  fixtureCode,
);
const [preparedStatement] = preparedStatements;
const singleConditionalUpdate =
  instrumentedAccepted === true &&
  preparedStatements.length === 1 &&
  /^UPDATE totp_backup_codes\b/i.test(preparedStatement ?? "") &&
  /\bSET used_at\s*=/i.test(preparedStatement ?? "") &&
  /\buser_id\s*=\s*\?/i.test(preparedStatement ?? "") &&
  /\bcode_hash\s*=\s*\?/i.test(preparedStatement ?? "") &&
  /\bused_at\s+IS\s+NULL\b/i.test(preparedStatement ?? "");

try {
  const user = database
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("wendy@example.com");
  if (!user) {
    throw new Error("Wendy's seeded account was not found");
  }

  database
    .prepare(
      `
        INSERT INTO totp_backup_codes (user_id, code_hash, used_at)
        VALUES (?, ?, NULL)
        ON CONFLICT(code_hash) DO UPDATE SET
          user_id = excluded.user_id,
          used_at = NULL
      `,
    )
    .run(user.id, fixtureCodeHash);

  const firstAccepted = verifyAndConsumeBackupCode(
    database,
    user.id,
    fixtureCode,
  );
  const secondAccepted = verifyAndConsumeBackupCode(
    database,
    user.id,
    fixtureCode,
  );
  const stored = database
    .prepare("SELECT used_at FROM totp_backup_codes WHERE code_hash = ?")
    .get(fixtureCodeHash);

  console.log(
    JSON.stringify({
      firstAccepted,
      secondAccepted,
      consumptionRecorded: typeof stored?.used_at === "string",
      singleConditionalUpdate,
    }),
  );
} finally {
  database.close();
}
