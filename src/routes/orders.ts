import { Router } from "express";
import { getCurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import { findOrderById, listOrderItems, listOrdersForUser } from "../orders/index.ts";

export const router = Router();

router.get("/account/orders", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const orders = listOrdersForUser(current.user.id);

  const orderRows = orders
    .map(
      (order) => `<tr>
              <td><a href="/orders/${order.id}">#${order.id}</a></td>
              <td>${order.status}</td>
              <td>${formatMoney(order.total_cents)}</td>
              <td>${order.created_at}</td>
            </tr>
            `,
    )
    .join("")
    .trimEnd();

  const orderList =
    orders.length === 0
      ? `<article class="card empty-state">
          <h2>No orders yet</h2>
          <p>Your plushie order history will show up here after checkout.</p>
          <a href="/">Browse plushies</a>
        </article>`
      : `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Total</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${orderRows}
          </tbody>
        </table>
      </div>`;

  res.type("html").send(
    renderPage(
      "Your Orders",
      `<nav><a href="/account">Back to account</a></nav>
      <p class="eyebrow">Account</p>
      <h1>Your Orders</h1>
      ${orderList}`,
    ),
  );
});

router.get("/orders/:id", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    res.status(404).send("Order not found");
    return;
  }

  const order = findOrderById(orderId);
  if (!order) {
    res.status(404).send("Order not found");
    return;
  }

  const items = listOrderItems(order.id)
    .map(
      (item) => `<tr>
              <td>${item.product_name}</td>
              <td>${item.quantity}</td>
              <td>${formatMoney(item.price_cents)}</td>
              <td>${formatMoney(item.quantity * item.price_cents)}</td>
            </tr>
            `,
    )
    .join("")
    .trimEnd();

  res.type("html").send(
    renderPage(
      `Order #${order.id}`,
      `<nav><a href="/account/orders">Back to orders</a></nav>
      <p class="eyebrow">Order #${order.id}</p>
      <h1>${formatMoney(order.total_cents)}</h1>
      <section class="card-grid">
        <article class="card">
          <h2>Details</h2>
          <dl>
            <dt>Status</dt>
            <dd>${order.status}</dd>
            <dt>Customer</dt>
            <dd>${order.customer_name}</dd>
            <dt>Created</dt>
            <dd>${order.created_at}</dd>
          </dl>
        </article>
      </section>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items}
          </tbody>
        </table>
      </div>`,
    ),
  );
});

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
