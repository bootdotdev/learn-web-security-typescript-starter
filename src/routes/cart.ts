import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import {
  addProductToCart,
  getCartTotalCents,
  listCartItems,
  MAX_CART_QUANTITY,
  updateCartItemQuantity,
} from "../cart.ts";
import { requireAuth } from "../auth/accessControl.ts";
import { csrfTokensMatch } from "../csrf.ts";
import { sendErrorPage } from "../errors.ts";
import { findProductById } from "../products.ts";
import { renderCartPage } from "../views/cart.ts";

export function createCartRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/cart", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const items = listCartItems(db, current.user.id);
    const totalCents = getCartTotalCents(items);

    res
      .type("html")
      .send(
        renderCartPage(
          current.user.display_name,
          items,
          totalCents,
          current.session.csrf_token,
        ),
      );
  });

  router.post("/cart/items", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    if (!csrfTokensMatch(current.session.csrf_token, req.body?.csrfToken)) {
      sendErrorPage(
        res,
        403,
        "Forbidden",
        "Your request could not be verified.",
      );
      return;
    }

    const productId = Number(req.body.productId);
    const quantity = parseCartQuantity(req.body.quantity, 1);

    if (!Number.isSafeInteger(productId) || !findProductById(db, productId)) {
      sendErrorPage(
        res,
        404,
        "Product Not Found",
        "We couldn't find that product.",
      );
      return;
    }

    if (quantity === undefined) {
      sendErrorPage(res, 400, "Invalid Quantity", "Enter a valid quantity.");
      return;
    }

    if (!addProductToCart(db, current.user.id, productId, quantity)) {
      sendErrorPage(
        res,
        400,
        "Unable to Update Cart",
        "That quantity is no longer available.",
      );
      return;
    }

    res.redirect("/cart");
  });

  router.post("/cart/items/:productId", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    if (!csrfTokensMatch(current.session.csrf_token, req.body?.csrfToken)) {
      sendErrorPage(
        res,
        403,
        "Forbidden",
        "Your request could not be verified.",
      );
      return;
    }

    const productId = Number(req.params.productId);
    const quantity = parseCartQuantity(req.body.quantity, 0);

    if (!Number.isSafeInteger(productId)) {
      sendErrorPage(
        res,
        404,
        "Product Not Found",
        "We couldn't find that product.",
      );
      return;
    }

    if (quantity === undefined) {
      sendErrorPage(res, 400, "Invalid Quantity", "Enter a valid quantity.");
      return;
    }

    if (!updateCartItemQuantity(db, current.user.id, productId, quantity)) {
      sendErrorPage(
        res,
        400,
        "Unable to Update Cart",
        "That quantity is no longer available.",
      );
      return;
    }
    res.redirect("/cart");
  });

  return router;
}

function parseCartQuantity(value: unknown, minimum: 0 | 1): number | undefined {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) &&
    quantity >= minimum &&
    quantity <= MAX_CART_QUANTITY
    ? quantity
    : undefined;
}
