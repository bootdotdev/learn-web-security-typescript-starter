import { getCartTotalCents, type CartItem } from "../cart.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Keyring } from "../storage/keyring.ts";
import { encryptShippingDetails, type ShippingDetails } from "./shipping.ts";

type OrderStatus = "pending" | "paid" | "shipped" | "refunded";

export class InsufficientInventoryError extends Error {
  constructor() {
    super("One or more cart items are no longer available in the requested quantity.");
    this.name = "InsufficientInventoryError";
  }
}

export type Order = {
  id: number;
  user_id: number;
  customer_name: string;
  customer_email: string;
  status: OrderStatus;
  total_cents: number;
  admin_notes: string;
  shipping_details_encrypted: string | null;
  created_at: string;
};

export type OrderItem = {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  price_cents: number;
};

export function createOrderFromCart(
  db: DatabaseSync,
  userId: number,
  items: CartItem[],
  discountCents: number,
  shippingDetails: ShippingDetails,
  adminNotes: string,
  keyring: Keyring | undefined,
): Order {
  const totalCents = getCartTotalCents(items) - discountCents;
  const encryptedShippingDetails = encryptShippingDetails(shippingDetails, keyring);

  db.exec("BEGIN");

  try {
    const result = db
      .prepare(
        `
          INSERT INTO orders (
            user_id,
            status,
            total_cents,
            admin_notes,
            shipping_details_encrypted
          )
          VALUES (?, 'pending', ?, ?, ?)
        `,
      )
      .run(userId, totalCents, adminNotes, encryptedShippingDetails);
    const orderId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(
      `
        INSERT INTO order_items (order_id, product_id, quantity, price_cents)
        VALUES (?, ?, ?, ?)
      `,
    );
    const decrementInventory = db.prepare(
      `
        UPDATE products
        SET inventory_count = inventory_count - ?
        WHERE id = ?
          AND is_active = 1
          AND inventory_count >= ?
      `,
    );

    for (const item of items) {
      const inventoryResult = decrementInventory.run(item.quantity, item.product_id, item.quantity);
      if (inventoryResult.changes !== 1) {
        throw new InsufficientInventoryError();
      }
      insertItem.run(orderId, item.product_id, item.quantity, item.price_cents);
    }

    db.prepare(
      `
        DELETE FROM cart_items
        WHERE user_id = ?
      `,
    ).run(userId);

    const order = findOrderById(db, orderId);
    if (!order) {
      throw new Error("Failed to create order");
    }

    db.exec("COMMIT");
    return order;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function approvePawPalOrder(db: DatabaseSync, orderId: number): boolean {
  const result = db
    .prepare(
      `
        UPDATE orders
        SET status = 'paid'
        WHERE id = ? AND status = 'pending'
      `,
    )
    .run(orderId);

  return result.changes === 1;
}

export function listOrdersForUser(db: DatabaseSync, userId: number): Order[] {
  return db
    .prepare(
      `
        SELECT
          orders.id,
          orders.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          orders.status,
          orders.total_cents,
          orders.admin_notes,
          orders.shipping_details_encrypted,
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        WHERE orders.user_id = ?
        ORDER BY orders.created_at DESC, orders.id DESC
      `,
    )
    .all(userId) as Order[];
}

export function listAllOrders(db: DatabaseSync): Order[] {
  return db
    .prepare(
      `
        SELECT
          orders.id,
          orders.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          orders.status,
          orders.total_cents,
          orders.admin_notes,
          orders.shipping_details_encrypted,
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        ORDER BY orders.created_at DESC, orders.id DESC
      `,
    )
    .all() as Order[];
}

export function findOrderById(db: DatabaseSync, orderId: number): Order | undefined {
  return db
    .prepare(
      `
        SELECT
          orders.id,
          orders.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          orders.status,
          orders.total_cents,
          orders.admin_notes,
          orders.shipping_details_encrypted,
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        WHERE orders.id = ?
      `,
    )
    .get(orderId) as Order | undefined;
}

export function listOrderItems(db: DatabaseSync, orderId: number): OrderItem[] {
  return db
    .prepare(
      `
        SELECT
          order_items.id,
          order_items.order_id,
          order_items.product_id,
          products.name AS product_name,
          order_items.quantity,
          order_items.price_cents
        FROM order_items
        JOIN products ON products.id = order_items.product_id
        WHERE order_items.order_id = ?
        ORDER BY order_items.id
      `,
    )
    .all(orderId) as OrderItem[];
}
