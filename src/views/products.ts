import type { CurrentSession } from "../auth/sessions.ts";
import { MAX_CART_QUANTITY } from "../cart.ts";
import type { Product } from "../products.ts";
import { MAX_REVIEW_BODY_LENGTH, type Review } from "../reviews.ts";
import {
  escapeHtml,
  formatMoney,
  renderAccountLink,
  renderPage,
} from "./layout.ts";

export function renderProductPage(
  current: CurrentSession | undefined,
  product: Product,
  reviews: Review[],
  remainingInventory: number,
): string {
  const sessionLink = current
    ? renderAccountLink(current.user.display_name)
    : `<a href="/login">Log in</a>`;
  const cartLink = current ? `<a href="/cart">Cart</a>` : "";
  const reviewItems =
    reviews.length > 0
      ? reviews
          .map(
            (review) => `
              <article class="review">
                <h3>${escapeHtml(review.reviewer_name)}</h3>
                <p class="rating" aria-label="${review.rating} out of 5 stars">
                  ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}
                </p>
                <p>${review.body}</p>
                ${current?.user.id === review.user_id ? `<a href="/account/reviews/${review.id}/edit">Edit your review</a>` : ""}
              </article>`,
          )
          .join("")
      : `<p>No reviews yet. This bear is waiting for judgment.</p>`;
  const reviewForm = current
    ? `<form method="post" action="/products/${product.id}/reviews" class="review-form">
        <input name="csrfToken" type="hidden" value="${escapeHtml(current.session.csrf_token)}">
        <h2>Write a Review</h2>
        <label>Rating
          <select name="rating" required>
            <option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option>
          </select>
        </label>
        <label>Review
          <textarea name="body" rows="5" maxlength="${MAX_REVIEW_BODY_LENGTH}" required></textarea>
        </label>
        <button type="submit">Post review</button>
      </form>`
    : `<p class="review-login"><a href="/login">Log in</a> to write a review.</p>`;
  const adminAction =
    current?.user.role === "admin"
      ? `<p class="page-action"><a class="button-link" href="/admin/products/${product.id}/edit">Edit product</a></p>`
      : "";
  const roleNav =
    current?.user.role === "admin"
      ? `<a href="/support">Support</a><a href="/admin">Admin</a>`
      : "";
  const inventoryStatus =
    product.inventory_count === 0
      ? `<span class="out-of-stock">Out of stock</span>`
      : `${product.inventory_count} in stock`;
  const cartForm =
    product.inventory_count === 0
      ? `<p class="out-of-stock">This plushie is currently out of stock.</p>`
      : current && remainingInventory === 0
        ? `<p class="inventory-note">All available inventory is already in your cart.</p>`
        : `<form method="post" action="/cart/items" class="cart-form">
          ${current ? `<input name="csrfToken" type="hidden" value="${escapeHtml(current.session.csrf_token)}">` : ""}
          <input name="productId" type="hidden" value="${product.id}">
          <label>Quantity
            <input name="quantity" type="number" min="1" max="${Math.min(MAX_CART_QUANTITY, remainingInventory)}" value="1" required>
          </label>
          <button type="submit">Add to cart</button>
        </form>`;
  const stockOverlay =
    product.inventory_count === 0
      ? `<span class="stock-overlay" aria-hidden="true">Out of stock</span>`
      : "";

  return renderPage(
    product.name,
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${cartLink}${sessionLink}${roleNav}</nav>
      <p class="eyebrow">${formatMoney(product.price_cents)}</p>
      <h1>${escapeHtml(product.name)}</h1>
      ${adminAction}
      <section class="product-detail-hero">
        <div class="product-image-frame product-detail-image-frame">
          <img class="product-detail-image" src="${escapeHtml(product.image_path)}" alt="${escapeHtml(product.name)} product photo" width="640" height="640">
          ${stockOverlay}
        </div>
        <div><p class="lede">${escapeHtml(product.description)}</p>${cartForm}</div>
      </section>
      <section class="card-grid">
        <article class="card"><h2>Details</h2><dl><dt>Inventory</dt><dd>${inventoryStatus}</dd><dt>Product ID</dt><dd>${product.id}</dd></dl></article>
        <article class="card"><h2>Reviews</h2><div>${reviewItems}</div></article>
        <article class="card">${reviewForm}</article>
      </section>`,
  );
}
