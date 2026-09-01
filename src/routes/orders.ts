import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { requireAuth } from "../auth/accessControl.ts";
import { sendErrorPage } from "../errors.ts";
import {
  findOrderById,
  listOrderItems,
  listOrdersForUser,
} from "../orders/index.ts";
import { renderOrderPage, renderOrdersPage } from "../views/orders.ts";

export function createOrdersRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/account/orders", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const orders = listOrdersForUser(db, current.user.id);

    res.type("html").send(renderOrdersPage(current.user.display_name, orders));
  });

  router.get("/orders/:id", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const orderId = Number(req.params.id);
    if (!Number.isSafeInteger(orderId)) {
      sendErrorPage(
        res,
        404,
        "Order Not Found",
        "We couldn't find that order.",
      );
      return;
    }

    const order = findOrderById(db, orderId);
    if (!order) {
      sendErrorPage(
        res,
        404,
        "Order Not Found",
        "We couldn't find that order.",
      );
      return;
    }

    res
      .type("html")
      .send(
        renderOrderPage(
          current.user.display_name,
          order,
          listOrderItems(db, order.id),
        ),
      );
  });

  return router;
}
