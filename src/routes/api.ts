import { Router } from "express";
import { getCurrentSession } from "../auth/sessions.ts";
import { findOrderById, listOrderItems, listOrdersForUser } from "../orders/index.ts";
import { listAllProducts } from "../products/index.ts";

export const router = Router();

router.get("/api/account/orders", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.json({ orders: listOrdersForUser(current.user.id) });
});

router.get("/api/orders/:id", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const order = findOrderById(orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json({ order, items: listOrderItems(order.id) });
});

router.get("/api/products", (_req, res) => {
  res.json({ products: listAllProducts() });
});
