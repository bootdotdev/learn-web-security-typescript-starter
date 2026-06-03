import { getDb } from "../db/index.ts";

export type CartItem = {
  id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
  name: string;
  price_cents: number;
  inventory_count: number;
  line_total_cents: number;
};

export function addProductToCart(userId: number, productId: number, quantity: number): void {
  getDb()
    .prepare(
      `
        INSERT INTO cart_items (user_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT (user_id, product_id) DO UPDATE SET
          quantity = cart_items.quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run(userId, productId, quantity);
}

export function listCartItems(userId: number): CartItem[] {
  return getDb()
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
          products.price_cents,
          products.inventory_count,
          products.price_cents * cart_items.quantity AS line_total_cents
        FROM cart_items
        JOIN products ON products.id = cart_items.product_id
        WHERE cart_items.user_id = ?
        ORDER BY cart_items.created_at
      `,
    )
    .all(userId) as CartItem[];
}

export function updateCartItemQuantity(userId: number, productId: number, quantity: number): void {
  if (quantity <= 0) {
    removeCartItem(userId, productId);
    return;
  }

  getDb()
    .prepare(
      `
        UPDATE cart_items
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND product_id = ?
      `,
    )
    .run(quantity, userId, productId);
}

function removeCartItem(userId: number, productId: number): void {
  getDb()
    .prepare(
      `
        DELETE FROM cart_items
        WHERE user_id = ? AND product_id = ?
      `,
    )
    .run(userId, productId);
}

export function getCartTotalCents(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.line_total_cents, 0);
}
