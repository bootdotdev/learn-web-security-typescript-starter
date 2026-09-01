import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { requireAuth } from "../auth/accessControl.ts";
import { getCurrentSession } from "../auth/sessions.ts";
import { listCartItems } from "../cart.ts";
import { csrfTokensMatch } from "../csrf.ts";
import { sendErrorPage } from "../errors.ts";
import { findProductById } from "../products.ts";
import {
  createReview,
  listReviewsForProduct,
  parseReviewBody,
} from "../reviews.ts";
import { renderProductPage } from "../views/products.ts";

export function createProductsRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/products/:id", (req, res) => {
    const current = getCurrentSession(db, req.header("cookie"));
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId)) {
      sendErrorPage(
        res,
        404,
        "Product Not Found",
        "We couldn't find that product.",
      );
      return;
    }

    const product = findProductById(db, productId);
    if (!product) {
      sendErrorPage(
        res,
        404,
        "Product Not Found",
        "We couldn't find that product.",
      );
      return;
    }

    const reviews = listReviewsForProduct(db, product.id);
    const quantityInCart = current
      ? (listCartItems(db, current.user.id).find(
          (item) => item.product_id === product.id,
        )?.quantity ?? 0)
      : 0;
    const remainingInventory = Math.max(
      0,
      product.inventory_count - quantityInCart,
    );
    res
      .type("html")
      .send(renderProductPage(current, product, reviews, remainingInventory));
  });

  router.post("/products/:id/reviews", (req, res) => {
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

    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || !findProductById(db, productId)) {
      sendErrorPage(
        res,
        404,
        "Product Not Found",
        "We couldn't find that product.",
      );
      return;
    }

    const rating = Number(req.body.rating);
    const body = parseReviewBody(req.body.body);

    if (
      !Number.isSafeInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      body === undefined
    ) {
      sendErrorPage(
        res,
        400,
        "Invalid Review",
        "Enter a rating and review text.",
      );
      return;
    }

    createReview(db, current.user.id, productId, rating, body);
    res.redirect(`/products/${productId}`);
  });

  return router;
}
