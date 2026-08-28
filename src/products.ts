import type { DatabaseSync } from "node:sqlite";

export type Product = {
  id: number;
  name: string;
  description: string;
  image_path: string;
  price_cents: number;
  cost_cents: number;
  inventory_count: number;
  is_active: 0 | 1;
  created_at: string;
};

export type ProductInput = {
  name: string;
  description: string;
  image_path: string;
  price_cents: number;
  cost_cents: number;
  inventory_count: number;
  is_active: 0 | 1;
};

export function createProduct(db: DatabaseSync, input: ProductInput): Product {
  const result = db
    .prepare(
      `
        INSERT INTO products (name, description, image_path, price_cents, cost_cents, inventory_count, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.name,
      input.description,
      input.image_path,
      input.price_cents,
      input.cost_cents,
      input.inventory_count,
      input.is_active,
    );

  const product = findAnyProductById(db, Number(result.lastInsertRowid));
  if (!product) {
    throw new Error("Failed to create product");
  }

  return product;
}

export function listProducts(db: DatabaseSync): Product[] {
  return db
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE is_active = 1
        ORDER BY name
      `,
    )
    .all() as Product[];
}

export function listPublicProducts(db: DatabaseSync, maxResults: number): Product[] {
  return db
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE is_active = 1
        ORDER BY name
        LIMIT ?
      `,
    )
    .all(maxResults) as Product[];
}

export function listAllProducts(db: DatabaseSync): Product[] {
  return db
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        ORDER BY name
      `,
    )
    .all() as Product[];
}

export function findAnyProductById(db: DatabaseSync, productId: number): Product | undefined {
  return db
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE id = ?
      `,
    )
    .get(productId) as Product | undefined;
}

export function findProductById(db: DatabaseSync, productId: number): Product | undefined {
  return db
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE id = ? AND is_active = 1
      `,
    )
    .get(productId) as Product | undefined;
}

export function updateProduct(
  db: DatabaseSync,
  productId: number,
  input: ProductInput,
): Product | undefined {
  const result = db
    .prepare(
      `
        UPDATE products
        SET
          name = ?,
          description = ?,
          image_path = ?,
          price_cents = ?,
          cost_cents = ?,
          inventory_count = ?,
          is_active = ?
        WHERE id = ?
      `,
    )
    .run(
      input.name,
      input.description,
      input.image_path,
      input.price_cents,
      input.cost_cents,
      input.inventory_count,
      input.is_active,
      productId,
    );

  if (result.changes === 0) {
    return undefined;
  }

  return findAnyProductById(db, productId);
}

export function searchProducts(db: DatabaseSync, query: string): Product[] {
  const sql = `
    SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
    FROM products
    WHERE is_active = 1
      AND (name LIKE '%${query}%' OR description LIKE '%${query}%')
    ORDER BY name
  `;

  return db.prepare(sql).all() as Product[];
}

export function searchPublicProducts(
  db: DatabaseSync,
  query: string,
  maxResults: number,
): Product[] {
  const pattern = `%${query}%`;
  const sql = `
    SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
    FROM products
    WHERE is_active = 1
      AND (name LIKE ? OR description LIKE ?)
    ORDER BY name
    LIMIT ?
  `;

  return db.prepare(sql).all(pattern, pattern, maxResults) as Product[];
}
