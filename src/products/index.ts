import { getDb } from "../db/index.ts";

export type Product = {
  id: number;
  name: string;
  description: string;
  image_path: string;
  price_cents: number;
  cost_cents: number;
  inventory_count: number;
  is_active: number;
  created_at: string;
};

export type ProductInput = {
  name: string;
  description: string;
  image_path: string;
  price_cents: number;
  cost_cents: number;
  inventory_count: number;
  is_active: number;
};

export function createProduct(input: ProductInput): Product {
  const result = getDb()
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

  const product = findAnyProductById(Number(result.lastInsertRowid));
  if (!product) {
    throw new Error("Failed to create product");
  }

  return product;
}

export function listProducts(): Product[] {
  return getDb()
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

export function listAllProducts(): Product[] {
  return getDb()
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        ORDER BY name
      `,
    )
    .all() as Product[];
}

export function findAnyProductById(productId: number): Product | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE id = ?
      `,
    )
    .get(productId) as Product | undefined;
}

export function findProductById(productId: number): Product | undefined {
  return getDb()
    .prepare(
      `
        SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
        FROM products
        WHERE id = ? AND is_active = 1
      `,
    )
    .get(productId) as Product | undefined;
}

export function updateProduct(productId: number, input: ProductInput): Product | undefined {
  const result = getDb()
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

  return findAnyProductById(productId);
}

export function searchProducts(query: string): Product[] {
  const sql = `
    SELECT id, name, description, image_path, price_cents, cost_cents, inventory_count, is_active, created_at
    FROM products
    WHERE is_active = 1
      AND (name LIKE '%${query}%' OR description LIKE '%${query}%')
    ORDER BY name
  `;

  return getDb().prepare(sql).all() as Product[];
}
