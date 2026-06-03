import { Router } from "express";
import {
  addProductToCart,
  getCartTotalCents,
  listCartItems,
  updateCartItemQuantity,
  type CartItem,
} from "../cart/index.ts";
import { getCurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import { findProductById } from "../products/index.ts";

export const router = Router();

router.get("/cart", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const items = listCartItems(current.user.id);
  const totalCents = getCartTotalCents(items);

  res.type("html").send(
    renderPage(
      "Your Cart",
      `<nav><a href="/">Back to store</a></nav>
      <p class="eyebrow">Shopping Cart</p>
      <h1>Your Cart</h1>
      ${renderCart(items, totalCents)}`,
    ),
  );
});

router.post("/cart/items", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const productId = Number(req.body.productId);
  const quantity = Number(req.body.quantity ?? 1);

  if (!Number.isInteger(productId) || !findProductById(productId)) {
    res.status(404).send("Product not found");
    return;
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    res.status(400).send("Invalid quantity");
    return;
  }

  addProductToCart(current.user.id, productId, quantity);
  res.redirect("/cart");
});

router.post("/cart/items/:productId", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const productId = Number(req.params.productId);
  const quantity = Number(req.body.quantity);

  if (!Number.isInteger(productId)) {
    res.status(404).send("Product not found");
    return;
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    res.status(400).send("Invalid quantity");
    return;
  }

  updateCartItemQuantity(current.user.id, productId, quantity);
  res.redirect("/cart");
});

function renderCart(items: CartItem[], totalCents: number): string {
  if (items.length === 0) {
    return `<article class="card empty-state"><p>Your cart is empty. The bears are trying not to take it personally.</p></article>`;
  }

  const rows = items
    .map(
      (item) => `<tr>
              <td><a href="/products/${item.product_id}">${item.name}</a></td>
              <td>${formatMoney(item.price_cents)}</td>
              <td>
                <form method="post" action="/cart/items/${item.product_id}" class="quantity-form">
                  <input name="quantity" type="number" min="0" value="${item.quantity}">
                  <button type="submit">Update</button>
                </form>
              </td>
              <td>${formatMoney(item.line_total_cents)}</td>
            </tr>
            `,
    )
    .join("")
    .trimEnd();

  return `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Price</th>
              <th>Quantity</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <article class="card cart-summary">
        <h2>Total: ${formatMoney(totalCents)}</h2>
        <p>Ready to send these plushies on their way?</p>
        <a class="button-link" href="/checkout">Proceed to checkout</a>
      </article>`;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
