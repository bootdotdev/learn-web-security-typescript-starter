import type { Order, OrderItem } from "../orders/index.ts";
import { escapeHtml, formatMoney, renderAccountLink, renderPage } from "./layout.ts";

export function renderOrdersPage(displayName: string, orders: Order[]): string {
  const orderRows = orders
    .map(
      (order) => `<tr>
              <td><a href="/orders/${order.id}">#${order.id}</a></td>
              <td>${escapeHtml(order.status)}</td>
              <td>${formatMoney(order.total_cents)}</td>
              <td>${escapeHtml(order.created_at)}</td>
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
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            ${orderRows}
          </tbody>
        </table>
      </div>`;

  return renderPage(
    "Your Orders",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a><a href="/cart">Cart</a>${renderAccountLink(displayName)}</nav>
      <p class="eyebrow">Account</p>
      <h1>Your Orders</h1>
      <p class="page-action"><a class="button-link" href="/account/assistant">Ask the order assistant</a></p>
      ${orderList}`,
  );
}

export function renderOrderPage(
  displayName: string,
  order: Order,
  orderItems: OrderItem[],
): string {
  const items = orderItems
    .map(
      (item) => `<tr>
              <td>${escapeHtml(item.product_name)}</td>
              <td>${item.quantity}</td>
              <td>${formatMoney(item.price_cents)}</td>
              <td>${formatMoney(item.quantity * item.price_cents)}</td>
            </tr>
            `,
    )
    .join("")
    .trimEnd();

  return renderPage(
    `Order #${order.id}`,
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a><a href="/cart">Cart</a>${renderAccountLink(displayName)}<a href="/account/orders">Orders</a></nav>
      <p class="eyebrow">Order #${order.id}</p>
      <h1>${formatMoney(order.total_cents)}</h1>
      <section class="card-grid">
        <article class="card">
          <h2>Details</h2>
          <dl>
            <dt>Status</dt>
            <dd>${escapeHtml(order.status)}</dd>
            <dt>Customer</dt>
            <dd>${escapeHtml(order.customer_name)}</dd>
            <dt>Created</dt>
            <dd>${escapeHtml(order.created_at)}</dd>
          </dl>
        </article>
      </section>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items}
          </tbody>
        </table>
      </div>`,
  );
}
