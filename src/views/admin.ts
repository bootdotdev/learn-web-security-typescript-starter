import type { Product, ProductInput } from "../products.ts";
import { escapeHtml, formatMoney, renderAccountLink, renderPage } from "./layout.ts";

export function renderAdminDashboard(displayName: string): string {
  return renderPage(
    "Admin Dashboard",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a></nav>
      <p class="eyebrow">Admin</p>
      <h1>Admin Dashboard</h1>
      <section class="card-grid">
        <article class="card"><h2>Products</h2><p>Create products, update catalog status, and review internal costs.</p><a href="/admin/products">View products</a></article>
        <article class="card"><h2>Remote Image Preview</h2><p>Fetch a product image URL and inspect the upstream response.</p><a href="/admin/image-preview">Preview an image</a></article>
      </section>`,
  );
}

export function renderAdminProductsPage(products: Product[], displayName: string): string {
  const rows = products
    .map(
      (product) => `<tr>
              <td><a href="/admin/products/${product.id}">${escapeHtml(product.name)}</a></td>
              <td>${product.is_active ? "Active" : "Inactive"}</td>
              <td>${formatMoney(product.price_cents)}</td>
              <td>${formatMoney(product.cost_cents)}</td>
              <td>${product.inventory_count}</td>
              <td><a href="/admin/products/${product.id}/edit">Edit</a></td>
            </tr>
            `,
    )
    .join("")
    .trimEnd();

  return renderPage(
    "Admin Products",
    `<nav class="page-nav" aria-label="Primary">
        <a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a><a href="/admin">Admin</a>
      </nav>
      <p class="eyebrow">Admin</p><h1>Products</h1>
      <p class="page-action"><a class="button-link" href="/admin/products/new">Create product</a></p>
      <div class="table-wrap"><table><thead><tr><th scope="col">Product</th><th scope="col">Status</th><th scope="col">Price</th><th scope="col">Cost</th><th scope="col">Inventory</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

export function renderAdminProductPage(product: Product, displayName: string): string {
  const marginCents = product.price_cents - product.cost_cents;
  return renderPage(
    `Admin Product #${product.id}`,
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a><a href="/admin">Admin</a><a href="/admin/products">Products</a></nav>
      <p class="eyebrow">Admin Product #${product.id}</p><h1>${escapeHtml(product.name)}</h1>
      <p class="lede">${escapeHtml(product.description)}</p>
      <p class="page-action"><a class="button-link" href="/admin/products/${product.id}/edit">Edit product</a>${product.is_active ? `<a href="/products/${product.id}">View storefront page</a>` : ""}</p>
      <section class="card-grid">
        <article class="card"><h2>Catalog</h2><dl><dt>Status</dt><dd>${product.is_active ? "Active" : "Inactive"}</dd><dt>Inventory</dt><dd>${product.inventory_count}</dd><dt>Created</dt><dd>${escapeHtml(product.created_at)}</dd></dl></article>
        <article class="card"><h2>Internal Pricing</h2><dl><dt>Price</dt><dd>${formatMoney(product.price_cents)}</dd><dt>Cost</dt><dd>${formatMoney(product.cost_cents)}</dd><dt>Margin</dt><dd>${formatMoney(marginCents)}</dd></dl></article>
      </section>`,
  );
}

export function renderProductFormPage(
  title: string,
  heading: string,
  action: string,
  product: ProductInput,
  submitLabel: string,
  displayName: string,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return renderPage(
    title,
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a><a href="/admin">Admin</a><a href="/admin/products">Products</a></nav>
      <p class="eyebrow">Admin</p><h1>${escapeHtml(heading)}</h1>${errorMessage}
      <form method="post" action="${escapeHtml(action)}" class="product-form">
        <label>Name<input name="name" value="${escapeHtml(product.name)}" required></label>
        <label>Description<textarea name="description" rows="5" required>${escapeHtml(product.description)}</textarea></label>
        <label>Image path<input name="imagePath" value="${escapeHtml(product.image_path)}" required></label>
        <label>Price cents<input name="priceCents" type="number" min="0" step="1" value="${product.price_cents}" required></label>
        <label>Cost cents<input name="costCents" type="number" min="0" step="1" value="${product.cost_cents}" required></label>
        <label>Inventory count<input name="inventoryCount" type="number" min="0" step="1" value="${product.inventory_count}" required></label>
        <label class="checkbox-label"><input name="isActive" type="checkbox" value="1" ${product.is_active ? "checked" : ""}>Active in storefront</label>
        <button type="submit">${escapeHtml(submitLabel)}</button>
      </form>`,
  );
}
