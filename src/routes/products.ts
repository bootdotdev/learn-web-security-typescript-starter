import { Router } from "express";
import { getCurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import { findProductById } from "../products/index.ts";
import { createReview, listReviewsForProduct } from "../reviews/index.ts";

export const router = Router();

router.get("/products/:id", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));

  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) {
    res.status(404).send("Product not found");
    return;
  }

  const product = findProductById(productId);
  if (!product) {
    res.status(404).send("Product not found");
    return;
  }

  const reviews = listReviewsForProduct(product.id);
  const reviewItems =
    reviews.length > 0
      ? reviews
          .map(
            (review) => `
            <article class="review">
              <h3>${review.reviewer_name}</h3>
              <p class="rating">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
              <p>${review.body}</p>
            </article>`,
          )
          .join("")
      : `<p>No reviews yet. This bear is waiting for judgment.</p>`;
  const reviewForm = current
    ? `<form method="post" action="/products/${product.id}/reviews" class="review-form">
        <h2>Write a Review</h2>
        <label>
          Rating
          <select name="rating" required>
            <option value="5">5 stars</option>
            <option value="4">4 stars</option>
            <option value="3">3 stars</option>
            <option value="2">2 stars</option>
            <option value="1">1 star</option>
          </select>
        </label>
        <label>
          Review
          <textarea name="body" rows="5" required></textarea>
        </label>
        <button type="submit">Post review</button>
      </form>`
    : `<p class="review-login"><a href="/login">Log in</a> to write a review.</p>`;

  res.type("html").send(
    renderPage(
      product.name,
      `
      <nav class="nav-links"><a href="/">Back to store</a><a href="/cart">Cart</a></nav>
      <p class="eyebrow">${formatMoney(product.price_cents)}</p>
      <h1>${product.name}</h1>
      <section class="product-detail-hero">
        <img
          class="product-detail-image"
          src="${product.image_path}"
          alt="${product.name} product photo"
          width="640"
          height="640"
        >
        <div>
          <p class="lede">${product.description}</p>
          <form method="post" action="/cart/items" class="cart-form">
            <input name="productId" type="hidden" value="${product.id}">
            <label>
              Quantity
              <input name="quantity" type="number" min="1" value="1" required>
            </label>
            <button type="submit">Add to cart</button>
          </form>
        </div>
      </section>
      <section class="card-grid">
        <article class="card">
          <h2>Details</h2>
          <dl>
            <dt>Inventory</dt>
            <dd>${product.inventory_count} in stock</dd>
            <dt>Product ID</dt>
            <dd>${product.id}</dd>
          </dl>
        </article>
        <article class="card">
          <h2>Reviews</h2>
          <div class="reviews">${reviewItems}</div>
        </article>
        <article class="card">
          ${reviewForm}
        </article>
      </section>
    `,
    ),
  );
});

router.post("/products/:id/reviews", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || !findProductById(productId)) {
    res.status(404).send("Product not found");
    return;
  }

  const rating = Number(req.body.rating);
  const body = String(req.body.body ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || body.length === 0) {
    res.status(400).send("Invalid review");
    return;
  }

  createReview(current.user.id, productId, rating, body);
  res.redirect(`/products/${productId}`);
});

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
