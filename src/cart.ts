import type { DatabaseSync } from "node:sqlite";

export const MAX_CART_QUANTITY = 99;

export type CartItem = {
  id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
  name: string;
  image_path: string;
  price_cents: number;
  inventory_count: number;
  is_active: number;
  line_total_cents: number;
};

export type CartItemAvailability =
  | "available"
  | "inactive"
  | "out-of-stock"
  | "insufficient-inventory";

export function addProductToCart(
  db: DatabaseSync,
  userId: number,
  productId: number,
  quantity: number,
): boolean {
  if (!isValidCartQuantity(quantity, 1)) {
    return false;
  }

  const result = db
    .prepare(
      `
        INSERT INTO cart_items (user_id, product_id, quantity)
        SELECT ?, products.id, ?
        FROM products
        WHERE products.id = ?
          AND products.is_active = 1
          AND products.inventory_count >= ?
        ON CONFLICT (user_id, product_id) DO UPDATE SET
          quantity = cart_items.quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
        WHERE cart_items.quantity + excluded.quantity <= ?
          AND cart_items.quantity + excluded.quantity <= (
            SELECT inventory_count
            FROM products
            WHERE products.id = excluded.product_id
              AND products.is_active = 1
          )
      `,
    )
    .run(userId, quantity, productId, quantity, MAX_CART_QUANTITY);

  return result.changes === 1;
}

export function listCartItems(db: DatabaseSync, userId: number): CartItem[] {
  return db
    .prepare(
      `
        SELECT
          cart_items.id,
          cart_items.user_id,
          cart_items.product_id,
          cart_items.quantity,
          cart_items.created_at,
          cart_items.updated_at,
          products.name,
          products.image_path,
          products.price_cents,
          products.inventory_count,
          products.is_active,
          products.price_cents * cart_items.quantity AS line_total_cents
        FROM cart_items
        JOIN products ON products.id = cart_items.product_id
        WHERE cart_items.user_id = ?
        ORDER BY cart_items.created_at
      `,
    )
    .all(userId) as CartItem[];
}

export function updateCartItemQuantity(
  db: DatabaseSync,
  userId: number,
  productId: number,
  quantity: number,
): boolean {
  if (!isValidCartQuantity(quantity, 0)) {
    return false;
  }

  if (quantity <= 0) {
    removeCartItem(db, userId, productId);
    return true;
  }

  const result = db
    .prepare(
      `
        UPDATE cart_items
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND product_id = ?
          AND ? <= (
            SELECT inventory_count
            FROM products
            WHERE products.id = cart_items.product_id
              AND products.is_active = 1
          )
      `,
    )
    .run(quantity, userId, productId, quantity);

  return result.changes === 1;
}

function removeCartItem(db: DatabaseSync, userId: number, productId: number): void {
  db.prepare(
    `
        DELETE FROM cart_items
        WHERE user_id = ? AND product_id = ?
      `,
  ).run(userId, productId);
}

export function getCartTotalCents(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.line_total_cents, 0);
}

export function getCartItemAvailability(item: CartItem): CartItemAvailability {
  if (item.is_active !== 1) {
    return "inactive";
  }
  if (item.inventory_count === 0) {
    return "out-of-stock";
  }
  if (item.quantity > item.inventory_count) {
    return "insufficient-inventory";
  }
  return "available";
}

function isValidCartQuantity(quantity: number, minimum: 0 | 1): boolean {
  return Number.isSafeInteger(quantity) && quantity >= minimum && quantity <= MAX_CART_QUANTITY;
}
