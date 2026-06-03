import { Router, type Request, type Response } from "express";
import { getCurrentSession, type CurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import { findOrderById, listAllOrders, listOrderItems, type Order } from "../orders/index.ts";
import { listAllUploadedFiles, type UploadedFile } from "../uploads/index.ts";

export const router = Router();

router.get("/support", (req, res) => {
  const current = requireSupportSession(req, res);
  if (!current) {
    return;
  }

  res.type("html").send(
    renderPage(
      "Support Dashboard",
      `
      <nav class="nav-links"><a href="/">Store</a><a href="/account">Account</a></nav>
      <p class="eyebrow">Support</p>
      <h1>Support Dashboard</h1>
      <section class="card-grid">
        <article class="card">
          <h2>Orders</h2>
          <p>Look up customer plushie orders and internal notes.</p>
          <a href="/support/orders">View all orders</a>
        </article>
        <article class="card">
          <h2>Tax Exemptions</h2>
          <p>Review customer tax exemption certificates.</p>
          <a href="/support/tax-exemptions">View documents</a>
        </article>
      </section>
    `,
    ),
  );
});

router.get("/support/orders", (req, res) => {
  const current = requireSupportSession(req, res);
  if (!current) {
    return;
  }

  const rows = listAllOrders().map(renderOrderRow).join("").trimEnd();

  res.type("html").send(
    renderPage(
      "Support Orders",
      `<nav class="nav-links">
        <a href="/support">Support</a>
        <a href="/account">Account</a>
      </nav>
      <p class="eyebrow">Support</p>
      <h1>All Orders</h1>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`,
    ),
  );
});

router.get("/support/tax-exemptions", (req, res) => {
  const current = requireSupportSession(req, res);
  if (!current) {
    return;
  }

  const files = listAllUploadedFiles();
  const fileList =
    files.length === 0
      ? `<article class="card">
          <h2>No documents yet</h2>
          <p>Customer tax exemption certificates will show up here.</p>
        </article>`
      : `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${files.map(renderUploadedFileRow).join("").trimEnd()}
          </tbody>
        </table>
      </div>`;

  res.type("html").send(
    renderPage(
      "Tax Exemption Documents",
      `<nav class="nav-links">
        <a href="/support">Support</a>
        <a href="/account">Account</a>
      </nav>
      <p class="eyebrow">Support</p>
      <h1>Tax Exemptions</h1>
      ${fileList}`,
    ),
  );
});

router.get("/support/orders/:id", (req, res) => {
  const current = requireSupportSession(req, res);
  if (!current) {
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
      `Support Order #${order.id}`,
      `<nav class="nav-links">
        <a href="/support/orders">All orders</a>
        <a href="/account">Account</a>
      </nav>
      <p class="eyebrow">Support Order #${order.id}</p>
      <h1>${formatMoney(order.total_cents)}</h1>
      <section class="card-grid">
        <article class="card">
          <h2>Customer</h2>
          <dl>
            <dt>Name</dt>
            <dd>${order.customer_name}</dd>
            <dt>Email</dt>
            <dd>${order.customer_email}</dd>
            <dt>User ID</dt>
            <dd>${order.user_id}</dd>
          </dl>
        </article>
        <article class="card">
          <h2>Internal Notes</h2>
          <p>${order.admin_notes || "No internal notes."}</p>
        </article>
        <article class="card">
          <h2>Status</h2>
          <dl>
            <dt>Status</dt>
            <dd>${order.status}</dd>
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

function requireSupportSession(req: Request, res: Response): CurrentSession | undefined {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return undefined;
  }

  if (current.user.role !== "support" && current.user.role !== "admin") {
    res.status(403).send("Forbidden");
    return undefined;
  }

  return current;
}

function renderOrderRow(order: Order): string {
  return `<tr>
              <td><a href="/support/orders/${order.id}">#${order.id}</a></td>
              <td>${order.customer_name}<br>${order.customer_email}</td>
              <td>${order.status}</td>
              <td>${formatMoney(order.total_cents)}</td>
              <td>${order.created_at}</td>
            </tr>
            `;
}

function renderUploadedFileRow(file: UploadedFile): string {
  return `<tr>
              <td>${file.original_name}</td>
              <td>${file.customer_name}<br>${file.customer_email}</td>
              <td>${file.content_type}</td>
              <td>${file.created_at}</td>
              <td><a href="/files/${file.id}/download">Download</a></td>
            </tr>
            `;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
