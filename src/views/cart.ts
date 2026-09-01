import {
  getCartItemAvailability,
  MAX_CART_QUANTITY,
  type CartItem,
  type CartItemAvailability,
} from "../cart.ts";
import {
  escapeHtml,
  formatMoney,
  renderAccountLink,
  renderPage,
} from "./layout.ts";

export function renderCartPage(
  displayName: string,
  items: CartItem[],
  totalCents: number,
  csrfToken: string,
): string {
  return renderPage(
    "Your Cart",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}</nav>
      <p class="eyebrow">Shopping Cart</p>
      <h1>Your Cart</h1>
      ${renderCart(items, totalCents, csrfToken)}`,
  );
}

function renderCart(
  items: CartItem[],
  totalCents: number,
  csrfToken: string,
): string {
  if (items.length === 0) {
    return `<article class="card empty-state">
      <p>Your cart is empty. The bears are trying not to take it personally.</p>
      <a href="/">Continue shopping</a>
    </article>`;
  }

  const checkoutBlocked = items.some(
    (item) => getCartItemAvailability(item) !== "available",
  );
  const rows = items
    .map((item) => {
      const availability = getCartItemAvailability(item);
      const productName =
        availability === "inactive"
          ? `<span>${escapeHtml(item.name)}</span>`
          : `<a href="/products/${item.product_id}">${escapeHtml(item.name)}</a>`;

      return `<tr>
              <td>
                <div class="cart-product">
                  <img src="${escapeHtml(item.image_path)}" alt="" width="56" height="56">
                  ${productName}
                </div>
              </td>
              <td>${formatMoney(item.price_cents)}</td>
              <td>${renderCartQuantity(item, availability, csrfToken)}</td>
              <td>${formatMoney(item.line_total_cents)}</td>
              <td>
                <form method="post" action="/cart/items/${item.product_id}" class="remove-item-form">
                  <input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}">
                  <input name="quantity" type="hidden" value="0">
                  <button type="submit" class="danger-link">Remove</button>
                </form>
              </td>
            </tr>
            `;
    })
    .join("")
    .trimEnd();

  const checkoutAction = checkoutBlocked
    ? `<p class="availability-warning">Update quantities or remove unavailable items before checking out.</p>`
    : `<p>Ready to send these plushies on their way?</p>
        <a class="button-link" href="/checkout">Proceed to checkout</a>`;

  return `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Price</th>
              <th scope="col">Quantity</th>
              <th scope="col">Total</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <article class="card cart-summary">
        <h2>Total: ${formatMoney(totalCents)}</h2>
        ${checkoutAction}
      </article>`;
}

function renderCartQuantity(
  item: CartItem,
  availability: CartItemAvailability,
  csrfToken: string,
): string {
  if (availability === "inactive") {
    return `<span class="availability-warning">No longer available</span>`;
  }
  if (availability === "out-of-stock") {
    return `<span class="availability-warning">Out of stock</span>`;
  }

  const quantityForm = renderQuantityForm(item, csrfToken);
  if (availability === "insufficient-inventory") {
    return `<div class="cart-quantity-control">
      <span class="availability-warning">Only ${item.inventory_count} available</span>
      ${quantityForm}
    </div>`;
  }

  return quantityForm;
}

function renderQuantityForm(item: CartItem, csrfToken: string): string {
  return `<form method="post" action="/cart/items/${item.product_id}" class="quantity-form">
    <input name="csrfToken" type="hidden" value="${escapeHtml(csrfToken)}">
    <input name="quantity" type="number" min="1" max="${Math.min(MAX_CART_QUANTITY, item.inventory_count)}" value="${item.quantity}" aria-label="Quantity for ${escapeHtml(item.name)}">
    <button type="submit">Update</button>
  </form>`;
}
