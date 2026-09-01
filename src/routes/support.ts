import { Router } from "express";
import { requireRole } from "../auth/accessControl.ts";
import type { Dependencies } from "../dependencies.ts";
import { sendErrorPage } from "../errors.ts";
import {
  findOrderById,
  listAllOrders,
  listOrderItems,
} from "../orders/index.ts";
import { decryptShippingDetails } from "../orders/shipping.ts";
import { listAllUploadedFiles } from "../uploads/index.ts";
import { listImportedTaxDocuments } from "../uploads/importedTaxDocuments.ts";
import {
  renderSupportDashboard,
  renderSupportOrderPage,
  renderSupportOrdersPage,
  renderTaxExemptionsPage,
} from "../views/support.ts";

export function createSupportRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/support", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) return;
    res
      .type("html")
      .send(
        renderSupportDashboard(
          current.user.display_name,
          current.user.role === "admin",
        ),
      );
  });

  router.get("/support/orders", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) return;
    res
      .type("html")
      .send(
        renderSupportOrdersPage(
          listAllOrders(db),
          current.user.display_name,
          current.user.role === "admin",
        ),
      );
  });

  router.get("/support/tax-exemptions", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) return;
    res
      .type("html")
      .send(
        renderTaxExemptionsPage(
          listAllUploadedFiles(db),
          listImportedTaxDocuments(db),
          current.user.display_name,
          current.user.role === "admin",
        ),
      );
  });

  router.get("/support/orders/:id", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) return;

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

    const shippingDetails = order.shipping_details_encrypted
      ? decryptShippingDetails(order.shipping_details_encrypted, deps.keyring)
      : undefined;
    res
      .type("html")
      .send(
        renderSupportOrderPage(
          order,
          listOrderItems(db, order.id),
          shippingDetails,
          current.user.display_name,
          current.user.role === "admin",
        ),
      );
  });

  return router;
}
