import type { CurrentSession } from "../auth/sessions.ts";
import type { Product } from "../products.ts";
import {
  escapeHtml,
  formatMoney,
  renderAccountLink,
  renderPage,
} from "./layout.ts";

export function renderStorefrontPage(
  current: CurrentSession | undefined,
  products: Product[],
  cartQuantities: ReadonlyMap<number, number>,
): string {
  const accountNav = current
    ? `<a href="/cart">Cart</a>${renderAccountLink(current.user.display_name)}`
    : `<a href="/login">Log in</a><a href="/signup">Create account</a>`;
  return renderPage(
    "Bearly Secure",
    `
      <nav class="page-nav" aria-label="Primary">${accountNav}</nav>
      <p class="eyebrow">Tiny plushies. Big attack surface.</p>
      <h1>Bearly Secure</h1>
      <p class="subtitle">A deliberately vulnerable plushie shop for web security lessons.</p>
      ${renderSearchForm()}
      <ul class="products">${renderProductList(products, current?.session.csrf_token, cartQuantities)}</ul>
    `,
  );
}

export function renderSearchPage(
  current: CurrentSession | undefined,
  query: string,
  products: Product[],
  cartQuantities: ReadonlyMap<number, number>,
): string {
  const sessionLink = current
    ? renderAccountLink(current.user.display_name)
    : `<a href="/login">Log in</a>`;
  const cartLink = current ? `<a href="/cart">Cart</a>` : "";
  const resultSummary =
    query.length === 0
      ? "Enter a search term to find plushies."
      : `${products.length} result${products.length === 1 ? "" : "s"} for “${query}”`;
  const items =
    products.length > 0
      ? renderProductList(products, current?.session.csrf_token, cartQuantities)
      : `<li>No plushies found. Maybe the bears are hiding.</li>`;
  return renderPage(
    "Search",
    `
      <nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${cartLink}${sessionLink}</nav>
      <p class="eyebrow">Search</p>
      <h1>Find a Friend</h1>
      ${renderSearchForm(query)}
      <p class="search-summary">${resultSummary}</p>
      <ul class="products search-results">${items}</ul>
    `,
  );
}

function renderProductList(
  products: Product[],
  csrfToken?: string,
  cartQuantities: ReadonlyMap<number, number> = new Map(),
): string {
  return products
    .map((product) => {
      const quantityInCart = cartQuantities.get(product.id) ?? 0;
      const remainingInventory = Math.max(
        0,
        product.inventory_count - quantityInCart,
      );
      const availability =
        product.inventory_count === 0
          ? `<p class="out-of-stock">Out of stock</p>`
          : remainingInventory === 0
            ? `<p class="inventory-note">All available inventory is already in your cart.</p>`
            : `<form method="post" action="/cart/items" class="inline-cart-form">
              ${csrfToken ? `<input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}">` : ""}
              <input name="productId" type="hidden" value="${product.id}">
              <input name="quantity" type="hidden" value="1">
              <button type="submit">Add to cart</button>
            </form>`;
      const stockOverlay =
        product.inventory_count === 0
          ? `<span class="stock-overlay" aria-hidden="true">Out of stock</span>`
          : "";
      return `<li class="product-card">
        <div class="product-image-frame product-card-image-frame">
          <img class="product-card-image" src="${escapeHtml(product.image_path)}" alt="${escapeHtml(product.name)} product photo" width="640" height="640" loading="lazy">
          ${stockOverlay}
        </div>
        <div class="product-card-body">
          <a class="product-link" href="/products/${product.id}">${escapeHtml(product.name)}</a> – ${formatMoney(product.price_cents)}
          <p>${escapeHtml(product.description)}</p>
          ${availability}
        </div>
      </li>`;
    })
    .join("");
}

function renderSearchForm(query: string = ""): string {
  return `
    <form method="get" action="/search" class="search-form">
      <label>
        Search plushies
        <input
          name="q"
          type="search"
          value="${query}"
          placeholder="teddy, sloth, fox"
        >
      </label>
      <button type="submit">Search</button>
    </form>`;
}
