import type { Order, OrderItem } from "../orders/index.ts";
import type { ShippingDetails } from "../orders/shipping.ts";
import type { UploadedFile } from "../uploads/index.ts";
import type { ImportedTaxDocument } from "../uploads/importedTaxDocuments.ts";
import {
  escapeHtml,
  formatMoney,
  renderAccountLink,
  renderPage,
} from "./layout.ts";

function adminLink(isAdmin: boolean): string {
  return isAdmin ? `<a href="/admin">Admin</a>` : "";
}

export function renderSupportDashboard(
  displayName: string,
  isAdmin: boolean,
): string {
  return renderPage(
    "Support Dashboard",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}${adminLink(isAdmin)}</nav>
      <p class="eyebrow">Support</p><h1>Support Dashboard</h1>
      <section class="card-grid">
        <article class="card"><h2>Orders</h2><p>Look up customer plushie orders and internal notes.</p><a href="/support/orders">View all orders</a></article>
        <article class="card"><h2>Tax Exemptions</h2><p>Review customer tax exemption certificates.</p><a href="/support/tax-exemptions">View documents</a><a href="/support/tax-exemptions/import">Import ZIP archive</a></article>
      </section>`,
  );
}

export function renderSupportOrdersPage(
  orders: Order[],
  displayName: string,
  isAdmin: boolean,
): string {
  const rows = orders
    .map(
      (order) =>
        `<tr><td><a href="/support/orders/${order.id}">#${order.id}</a></td><td>${escapeHtml(order.customer_name)}<br>${escapeHtml(order.customer_email)}</td><td>${escapeHtml(order.status)}</td><td>${formatMoney(order.total_cents)}</td><td>${escapeHtml(order.created_at)}</td></tr>`,
    )
    .join("");
  return renderPage(
    "Support Orders",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a>${adminLink(isAdmin)}</nav>
      <p class="eyebrow">Support</p><h1>All Orders</h1>
      <div class="table-wrap"><table><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Created</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

export function renderTaxExemptionsPage(
  files: UploadedFile[],
  importedDocuments: ImportedTaxDocument[],
  displayName: string,
  isAdmin: boolean,
): string {
  const rows = files
    .map(
      (file) =>
        `<tr><td>${escapeHtml(file.original_name)}</td><td>${escapeHtml(file.customer_name)}<br>${escapeHtml(file.customer_email)}</td><td>${escapeHtml(file.content_type)}</td><td>${escapeHtml(file.created_at)}</td><td><a href="/files/${file.id}/download">Download</a></td></tr>`,
    )
    .join("");
  const fileList = files.length
    ? `<div class="table-wrap"><table><thead><tr><th scope="col">Document</th><th scope="col">Customer</th><th scope="col">Type</th><th scope="col">Uploaded</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<article class="card empty-state"><h2>No documents yet</h2><p>Customer tax exemption certificates will show up here.</p></article>`;
  const importedRows = importedDocuments
    .map(
      (document) =>
        `<tr><td>${escapeHtml(document.original_name)}</td><td>Unassigned</td><td>${escapeHtml(document.imported_by_name)}</td><td>${escapeHtml(document.created_at)}</td><td><a href="/support/files/imports/${document.id}/download">Download</a></td></tr>`,
    )
    .join("");
  const importedFileList = importedDocuments.length
    ? `<div class="table-wrap"><table><thead><tr><th scope="col">Document</th><th scope="col">Customer</th><th scope="col">Imported by</th><th scope="col">Imported</th><th scope="col">Actions</th></tr></thead><tbody>${importedRows}</tbody></table></div>`
    : `<article class="card empty-state"><h2>No bulk imports yet</h2><p>Documents imported from support ZIP archives will show up here.</p></article>`;
  return renderPage(
    "Tax Exemption Documents",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a>${adminLink(isAdmin)}</nav>
      <p class="eyebrow">Support</p><h1>Tax Exemptions</h1><h2 class="section-heading">Customer uploads</h2>${fileList}<h2 class="section-heading">Bulk imports</h2>${importedFileList}`,
  );
}

export function renderSupportOrderPage(
  order: Order,
  items: OrderItem[],
  shippingDetails: ShippingDetails | undefined,
  displayName: string,
  isAdmin: boolean,
): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.product_name)}</td><td>${item.quantity}</td><td>${formatMoney(item.price_cents)}</td><td>${formatMoney(item.quantity * item.price_cents)}</td></tr>`,
    )
    .join("");
  const shipping = shippingDetails
    ? `<address>${escapeHtml(shippingDetails.name)}<br>${escapeHtml(shippingDetails.address)}<br>${escapeHtml(shippingDetails.city)}, ${escapeHtml(shippingDetails.region)} ${escapeHtml(shippingDetails.postalCode)}</address>`
    : "<p>No shipping details.</p>";
  return renderPage(
    `Support Order #${order.id}`,
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a>${adminLink(isAdmin)}<a href="/support/orders">Orders</a></nav>
      <p class="eyebrow">Support Order #${order.id}</p><h1>${formatMoney(order.total_cents)}</h1>
      <section class="card-grid">
        <article class="card"><h2>Customer</h2><dl><dt>Name</dt><dd>${escapeHtml(order.customer_name)}</dd><dt>Email</dt><dd>${escapeHtml(order.customer_email)}</dd><dt>User ID</dt><dd>${order.user_id}</dd></dl></article>
        <article class="card"><h2>Internal Notes</h2><p>${order.admin_notes ? escapeHtml(order.admin_notes) : "No internal notes."}</p></article>
        <article class="card"><h2>Shipping</h2>${shipping}</article>
        <article class="card"><h2>Status</h2><dl><dt>Status</dt><dd>${escapeHtml(order.status)}</dd><dt>Created</dt><dd>${escapeHtml(order.created_at)}</dd></dl></article>
      </section>
      <div class="table-wrap"><table><thead><tr><th scope="col">Product</th><th scope="col">Qty</th><th scope="col">Price</th><th scope="col">Subtotal</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}
