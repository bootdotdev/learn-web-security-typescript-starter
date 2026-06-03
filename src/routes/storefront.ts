import { Router } from "express";
import { getCurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import { listProducts, searchProducts, type Product } from "../products/index.ts";

export const router = Router();

router.get("/", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  const products = listProducts();

  const items = renderProductList(products);
  const supportLink =
    current && (current.user.role === "support" || current.user.role === "admin")
      ? `<a href="/support">Support</a>`
      : "";
  const adminLink = current?.user.role === "admin" ? `<a href="/admin">Admin</a>` : "";

  const accountNav = current
    ? `<form method="post" action="/logout" class="nav-links logout-form">${adminLink}${supportLink}<a href="/cart">Cart</a><a href="/account">${current.user.display_name}</a><button type="submit">Log out</button></form>`
    : `<div class="nav-links"><a href="/cart">Cart</a><a href="/login">Log in</a><a href="/signup">Create account</a></div>`;

  res.type("html").send(
    renderPage(
      "Bearly Secure",
      `
      <nav>${accountNav}</nav>
      <p class="eyebrow">Tiny plushies. Big attack surface.</p>
      <h1>Bearly Secure</h1>
      <p class="subtitle">A deliberately vulnerable plushie shop for web security lessons.</p>
      ${renderSearchForm()}
      <ul class="products">${items}</ul>
    `,
    ),
  );
});

router.get("/search", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const products = query.length > 0 ? searchProducts(query) : [];
  const resultSummary =
    query.length === 0
      ? "Enter a search term to find plushies."
      : `${products.length} result${products.length === 1 ? "" : "s"} for “${query}”`;
  const items =
    products.length > 0
      ? renderProductList(products)
      : `<li>No plushies found. Maybe the bears are hiding.</li>`;

  res.type("html").send(
    renderPage(
      "Search",
      `
      <nav class="nav-links"><a href="/">Back to store</a><a href="/cart">Cart</a></nav>
      <p class="eyebrow">Search</p>
      <h1>Find a Friend</h1>
      ${renderSearchForm(query)}
      <p class="search-summary">${resultSummary}</p>
      <ul class="products search-results">${items}</ul>
    `,
    ),
  );
});

function renderProductList(products: Product[]): string {
  return products
    .map((product) => {
      const price = `$${(Number(product.price_cents) / 100).toFixed(2)}`;
      return `<li class="product-card">
        <img
          class="product-card-image"
          src="${product.image_path}"
          alt="${product.name} product photo"
          width="640"
          height="640"
          loading="lazy"
        >
        <div class="product-card-body">
          <a class="product-link" href="/products/${product.id}">${product.name}</a> – ${price}
          <p>${product.description}</p>
          <form method="post" action="/cart/items" class="inline-cart-form">
            <input name="productId" type="hidden" value="${product.id}">
            <input name="quantity" type="hidden" value="1">
            <button type="submit">Add to cart</button>
          </form>
        </div>
      </li>`;
    })
    .join("");
}

function renderSearchForm(query: string = ""): string {
  return `<form method="get" action="/search" class="search-form">
    <label>
      Search plushies
      <input name="q" type="search" value="${query}" placeholder="teddy, sloth, fox">
    </label>
    <button type="submit">Search</button>
  </form>`;
}
