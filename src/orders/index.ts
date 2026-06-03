import { getDb } from "../db/index.ts";
import { getCartTotalCents, type CartItem } from "../cart/index.ts";

export type Order = {
  id: number;
  user_id: number;
  customer_name: string;
  customer_email: string;
  status: string;
  total_cents: number;
  admin_notes: string;
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

export function createOrderFromCart(userId: number, items: CartItem[], adminNotes: string): Order {
  const db = getDb();
  const totalCents = getCartTotalCents(items);

  db.exec("BEGIN");

  try {
    const result = db
      .prepare(
        `
          INSERT INTO orders (user_id, status, total_cents, admin_notes)
          VALUES (?, 'paid', ?, ?)
        `,
      )
      .run(userId, totalCents, adminNotes);
    const orderId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(
      `
        INSERT INTO order_items (order_id, product_id, quantity, price_cents)
        VALUES (?, ?, ?, ?)
      `,
    );

    for (const item of items) {
      insertItem.run(orderId, item.product_id, item.quantity, item.price_cents);
    }

    db.prepare(
      `
        DELETE FROM cart_items
        WHERE user_id = ?
      `,
    ).run(userId);

    const order = findOrderById(orderId);
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

export function listOrdersForUser(userId: number): Order[] {
  return getDb()
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
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        WHERE orders.user_id = ?
        ORDER BY orders.created_at DESC, orders.id DESC
      `,
    )
    .all(userId) as Order[];
}

export function listAllOrders(): Order[] {
  return getDb()
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
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        ORDER BY orders.created_at DESC, orders.id DESC
      `,
    )
    .all() as Order[];
}

export function findOrderById(orderId: number): Order | undefined {
  return getDb()
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
          orders.created_at
        FROM orders
        JOIN users ON users.id = orders.user_id
        WHERE orders.id = ?
      `,
    )
    .get(orderId) as Order | undefined;
}

export function listOrderItems(orderId: number): OrderItem[] {
  return getDb()
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
