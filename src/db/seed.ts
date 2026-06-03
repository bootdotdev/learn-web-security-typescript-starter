import { rmSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "../auth/passwords.ts";
import { getDb } from "./index.ts";

const databasePath =
  process.env.DATABASE_URL ?? join(process.cwd(), "data", "bearly-secure.sqlite");

if (process.argv.includes("--reset")) {
  rmSync(databasePath, { force: true });
}

const db = getDb();

const existing = db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number };

if (existing.count === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (email, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);

  const demoPasswordHash = hashPassword("password123");

  insertUser.run("mabel@example.com", "Mabel Pines", "customer", demoPasswordHash);
  insertUser.run("sancho@example.com", "Sancho Panza", "support", demoPasswordHash);
  insertUser.run("wendy@example.com", "Wendy Corduroy", "admin", demoPasswordHash);
  insertUser.run("scarrasco@example.com", "Samson Carrasco", "customer", demoPasswordHash);
  insertUser.run("consumptive@example.com", "Clavdia Chauchat", "customer", demoPasswordHash);
  insertUser.run("pacifica@example.com", "Pacifica Northwest", "customer", demoPasswordHash);
  insertUser.run("vico@example.com", "Ludovico Settembrini", "customer", demoPasswordHash);
  insertUser.run("grenda@example.com", "Grenda Grendinator", "customer", demoPasswordHash);
  insertUser.run("eastwest@example.com", "J’Dinkalage Morgoone", "support", demoPasswordHash);
  insertUser.run("theo@example.com", "Theo Beers", "admin", demoPasswordHash);

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

  insertOrder.run(1, "shipped", 4498, "Gift wrap requested. Do not expose in customer API.");
  insertOrder.run(1, "paid", 2799, "Payment processor retry succeeded on second attempt.");
  insertOrder.run(2, "paid", 7497, "Employee discount applied manually.");
  insertOrder.run(3, "pending", 4798, "High-value customer; verify address before shipping.");
  insertOrder.run(4, "shipped", 5209, "Customer expressed interest in donkey plushies.");
  insertOrder.run(4, "paid", 3210, "");
  insertOrder.run(4, "pending", 7197, "Shipping address updated to Isle of Barataria.");
  insertOrder.run(5, "shipped", 7798, "Deliver to sanatorium front desk; do not leave outside.");
  insertOrder.run(7, "paid", 2499, "Customer may call to discuss metaphysics.");
  insertOrder.run(8, "pending", 6597, "Large plush order; confirm inventory before packing.");
  insertOrder.run(8, "refunded", 5997, "Refunded after duplicate checkout. Keep for audit trail.");
  insertOrder.run(9, "shipped", 5098, "Support staff personal order; no staff discount requested.");
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
  insertReview.run(4, 4, 5, "Small, fast, and excellent company on long roads.");
  insertReview.run(4, 7, 2, "The raccoon was fine, but my inn had terrible soup.");
  insertReview.run(5, 6, 4, "Bright enough for gloomy rooms, albeit slightly smug.");
  insertReview.run(7, 5, 5, "An enthusiastic but insufficiently dialectical critter.");
  insertReview.run(8, 3, 1, "What is this, a fox for ants?! I need a bigger one.");
  insertReview.run(9, 7, 4, "Cuddle rate limit documentation could be clearer.");

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
}

console.log(`Seeded ${databasePath}`);
