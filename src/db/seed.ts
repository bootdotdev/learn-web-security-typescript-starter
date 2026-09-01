import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../auth/passwords.ts";
import { hashBackupCode } from "../auth/totpBackupCodes.ts";
import { initDependencies } from "../dependencies.ts";
import { resetDb } from "./reset.ts";

const warehouseApiKeyHash =
  "08efe1ae20064a3db693bba1a5003a76ad23fe600085f5457099875176a0eede";

type SeedUser = {
  email: string;
  displayName: string;
  role: "customer" | "support" | "admin";
  passwordHash: string;
};

const demoPassword = "password123";
const seedUserDefinitions = [
  { email: "mabel@example.com", displayName: "Mabel Pines", role: "customer" },
  { email: "sancho@example.com", displayName: "Sancho Panza", role: "support" },
  { email: "wendy@example.com", displayName: "Wendy Corduroy", role: "admin" },
  {
    email: "scarrasco@example.com",
    displayName: "Samson Carrasco",
    role: "customer",
  },
  {
    email: "consumptive@example.com",
    displayName: "Clavdia Chauchat",
    role: "customer",
  },
  {
    email: "pacifica@example.com",
    displayName: "Pacifica Northwest",
    role: "customer",
  },
  {
    email: "vico@example.com",
    displayName: "Ludovico Settembrini",
    role: "customer",
  },
  {
    email: "grenda@example.com",
    displayName: "Grenda Grendinator",
    role: "customer",
  },
  {
    email: "eastwest@example.com",
    displayName: "J’Dinkalage Morgoone",
    role: "support",
  },
  { email: "theo@example.com", displayName: "Theo Beers", role: "admin" },
] as const satisfies readonly Omit<SeedUser, "passwordHash">[];
const seededUsers: SeedUser[] = [];
for (const user of seedUserDefinitions) {
  seededUsers.push({
    ...user,
    passwordHash: await hashPassword(demoPassword),
  });
}

function seedData(db: DatabaseSync, users: readonly SeedUser[]): void {
  const insertUser = db.prepare(`
    INSERT INTO users (email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);

  for (const user of users) {
    insertUser.run(user.email, user.displayName, user.role, user.passwordHash);
  }

  db.prepare("UPDATE users SET totp_secret = ? WHERE email = ?").run(
    "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF",
    "wendy@example.com",
  );

  // Seed Wendy with a passkey credential so CLI checks can simulate passkey login.
  // The matching private key (PKCS8, P-256) is embedded in the passkey test helper.
  const wendyId = (
    db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("wendy@example.com") as {
      id: number;
    }
  ).id;
  db.prepare(`
    INSERT INTO totp_backup_codes (user_id, code_hash)
    VALUES (?, ?)
  `).run(wendyId, hashBackupCode("a6f31c8d94e2b7504d8a1f3c6b9e2075"));

  db.prepare(
    `INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter, transports)
       VALUES (?, ?, ?, 0, ?)`,
  ).run(
    wendyId,
    "5kcO4l1a45q4ekBss8CXgyyIcYiofd0Sm4tIo9oZqZ0",
    "pQECAyYgASFYIHeKpJoZLcCWKRxpQ2DMzjLYhe738ROMLeU7ABISzdJJIlggbYVvviIKz_zGqOiZOYQ-9HWfjWgWdTlS7iDmrB1hOzE",
    '["internal"]',
  );

  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, image_path, price_cents, cost_cents, inventory_count, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(
    "Classic Teddy",
    "A suspiciously trustworthy bear.",
    "/product-photos/teddy-bear.webp",
    2499,
    900,
    12,
    1,
  );
  insertProduct.run(
    "SQLi Sloth",
    "Moves slowly, concatenates strings quickly.",
    "/product-photos/sqli-sloth.webp",
    1999,
    650,
    8,
    1,
  );
  insertProduct.run(
    "CORS Fox",
    "Friendly from every origin. Probably too friendly.",
    "/product-photos/cors-fox.webp",
    2799,
    1100,
    5,
    1,
  );
  insertProduct.run(
    "CSRF Ferret",
    "Small, fast, and always doing things you didn’t ask for.",
    "/product-photos/csrf-ferret.webp",
    3210,
    1200,
    17,
    1,
  );
  insertProduct.run(
    "OAuth Otter",
    "Trusts everyone at the river. Heedless of outboard motors.",
    "/product-photos/oauth-otter.webp",
    3499,
    1425,
    6,
    1,
  );
  insertProduct.run(
    "XSS Axolotl",
    "Glows if rendered too literally.",
    "/product-photos/xss-axolotl.webp",
    4299,
    1800,
    3,
    1,
  );
  insertProduct.run(
    "Rate Limit Raccoon",
    "Five hugs per minute, max!",
    "/product-photos/rate-limit-raccoon.webp",
    1599,
    500,
    24,
    1,
  );
  insertProduct.run(
    "Debug Duck",
    "Retired after a quack overflow.",
    "/product-photos/placeholder.png",
    999,
    250,
    0,
    0,
  );

  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, status, total_cents, admin_notes)
    VALUES (?, ?, ?, ?)
  `);

  insertOrder.run(
    1,
    "shipped",
    4498,
    "Gift wrap requested. Do not expose in customer API.",
  );
  insertOrder.run(
    1,
    "paid",
    2799,
    "Payment processor retry succeeded on second attempt.",
  );
  insertOrder.run(2, "paid", 7497, "Employee discount applied manually.");
  insertOrder.run(
    3,
    "pending",
    4798,
    "High-value customer; verify address before shipping.",
  );
  insertOrder.run(
    4,
    "shipped",
    5209,
    "Customer expressed interest in donkey plushies.",
  );
  insertOrder.run(4, "paid", 3210, "");
  insertOrder.run(
    4,
    "pending",
    7197,
    "Shipping address updated to Isle of Barataria.",
  );
  insertOrder.run(
    5,
    "shipped",
    7798,
    "Deliver to sanatorium front desk; do not leave outside.",
  );
  insertOrder.run(7, "paid", 2499, "Customer may call to discuss metaphysics.");
  insertOrder.run(
    8,
    "pending",
    6597,
    "Large plush order; confirm inventory before packing.",
  );
  insertOrder.run(
    8,
    "refunded",
    5997,
    "Refunded after duplicate checkout. Keep for audit trail.",
  );
  insertOrder.run(
    9,
    "shipped",
    5098,
    "Support staff personal order; no staff discount requested.",
  );
  insertOrder.run(9, "paid", 2799, "");

  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, quantity, price_cents)
    VALUES (?, ?, ?, ?)
  `);

  insertOrderItem.run(1, 1, 1, 2499);
  insertOrderItem.run(1, 2, 1, 1999);
  insertOrderItem.run(2, 3, 1, 2799);
  insertOrderItem.run(3, 1, 3, 2499);
  insertOrderItem.run(4, 2, 1, 1999);
  insertOrderItem.run(4, 3, 1, 2799);
  insertOrderItem.run(5, 2, 1, 1999);
  insertOrderItem.run(5, 4, 1, 3210);
  insertOrderItem.run(6, 4, 1, 3210);
  insertOrderItem.run(7, 3, 2, 2799);
  insertOrderItem.run(7, 7, 1, 1599);
  insertOrderItem.run(8, 5, 1, 3499);
  insertOrderItem.run(8, 6, 1, 4299);
  insertOrderItem.run(9, 1, 1, 2499);
  insertOrderItem.run(10, 1, 2, 2499);
  insertOrderItem.run(10, 7, 1, 1599);
  insertOrderItem.run(11, 2, 3, 1999);
  insertOrderItem.run(12, 5, 1, 3499);
  insertOrderItem.run(12, 7, 1, 1599);
  insertOrderItem.run(13, 3, 1, 2799);

  const insertReview = db.prepare(`
    INSERT INTO reviews (user_id, product_id, rating, body)
    VALUES (?, ?, ?, ?)
  `);

  insertReview.run(1, 1, 5, "Soft, reliable, and only a little judgmental.");
  insertReview.run(2, 1, 4, "Great bear. Could use more pockets for snacks.");
  insertReview.run(1, 2, 5, "Slow to arrive, but emotionally available.");
  insertReview.run(3, 3, 3, "Too friendly; needs stricter boundaries.");
  insertReview.run(
    4,
    4,
    5,
    "Small, fast, and excellent company on long roads.",
  );
  insertReview.run(
    4,
    7,
    2,
    "The raccoon was fine, but my inn had terrible soup.",
  );
  insertReview.run(
    5,
    6,
    4,
    "Bright enough for gloomy rooms, albeit slightly smug.",
  );
  insertReview.run(
    7,
    5,
    5,
    "An enthusiastic but insufficiently dialectical critter.",
  );
  insertReview.run(
    8,
    3,
    1,
    "What is this, a fox for ants?! I need a bigger one.",
  );
  insertReview.run(
    9,
    7,
    4,
    "Cuddle rate limit documentation could be clearer.",
  );

  const insertUploadedFile = db.prepare(`
    INSERT INTO uploaded_files (user_id, original_name, storage_path, content_type)
    VALUES (?, ?, ?, ?)
  `);

  insertUploadedFile.run(
    1,
    "mystery-shack-tax-exemption.pdf",
    "data/uploads/mystery-shack-tax-exemption.pdf",
    "application/pdf",
  );

  const apiKeysTableExists =
    db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'api_keys'",
      )
      .get() !== undefined;
  if (apiKeysTableExists) {
    db.prepare(`
      INSERT INTO api_keys (name, key_hash, scope)
      VALUES (?, ?, ?)
    `).run(
      "Warehouse Fulfillment Integration",
      warehouseApiKeyHash,
      "orders:read",
    );
  }
}

const deps = initDependencies();
try {
  resetDb(deps.db, (db) => seedData(db, seededUsers));
  console.log(`Seeded ${deps.databasePath}`);
} finally {
  deps.db.close();
}
