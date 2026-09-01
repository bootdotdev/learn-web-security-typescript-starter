import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { getCurrentSession } from "../auth/sessions.ts";
import { listCartItems } from "../cart.ts";
import { listProducts, searchProducts } from "../products.ts";
import { renderSearchPage, renderStorefrontPage } from "../views/storefront.ts";

export function createStorefrontRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/", (req, res) => {
    const current = getCurrentSession(db, req.header("cookie"));
    const products = listProducts(db);
    const cartQuantities = current
      ? getCartQuantities(current.user.id)
      : new Map<number, number>();

    res
      .type("html")
      .send(renderStorefrontPage(current, products, cartQuantities));
  });

  router.get("/search", (req, res) => {
    const current = getCurrentSession(db, req.header("cookie"));
    const cartQuantities = current
      ? getCartQuantities(current.user.id)
      : new Map<number, number>();
    const query = String(req.query.q ?? "").trim();
    const products = query.length > 0 ? searchProducts(db, query) : [];
    res
      .type("html")
      .send(renderSearchPage(current, query, products, cartQuantities));
  });

  function getCartQuantities(userId: number): Map<number, number> {
    return new Map(
      listCartItems(db, userId).map((cartItem) => [
        cartItem.product_id,
        cartItem.quantity,
      ]),
    );
  }

  return router;
}
