import type { Dependencies } from "../dependencies.ts";
import { Router, type Response } from "express";
import { requireAuth } from "../auth/accessControl.ts";
import {
  getCartItemAvailability,
  listCartItems,
  type CartItem,
} from "../cart.ts";
import { sendErrorPage } from "../errors.ts";
import {
  renderCheckoutPage,
  renderPawPalProcessingPage,
} from "../views/checkout.ts";
import { reserveAcornFulfillment } from "../integrations/acornFulfillment.ts";
import {
  createPawPalCheckoutUrl,
  createPawPalReference,
} from "../integrations/pawpal.ts";
import { logEvent } from "../logger.ts";
import {
  createOrderFromCart,
  findOrderById,
  InsufficientInventoryError,
} from "../orders/index.ts";

export function sendFulfillmentTimeout(
  response: Response,
  items: CartItem[],
  csrfToken: string,
  displayName: string,
): void {
  response
    .status(503)
    .set("Retry-After", "1")
    .type("html")
    .send(
      renderCheckoutPage(
        items,
        csrfToken,
        displayName,
        "Shipping is temporarily unavailable. Try again shortly.",
      ),
    );
}

export function createCheckoutRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/checkout", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const items = listCartItems(db, current.user.id);
    if (items.length === 0) {
      res.redirect("/cart");
      return;
    }

    if (findUnavailableCartItem(items)) {
      res.redirect("/cart");
      return;
    }

    res
      .type("html")
      .send(
        renderCheckoutPage(
          items,
          current.session.csrf_token,
          current.user.display_name,
        ),
      );
  });

  router.post("/checkout", async (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    let items = listCartItems(db, current.user.id);
    if (items.length === 0) {
      res.redirect("/cart");
      return;
    }

    const unavailableItem = findUnavailableCartItem(items);
    if (unavailableItem) {
      res
        .status(409)
        .type("html")
        .send(
          renderCheckoutPage(
            items,
            current.session.csrf_token,
            current.user.display_name,
            `${unavailableItem.name} is no longer available in the requested quantity. Update your cart before checking out.`,
          ),
        );
      return;
    }

    const shippingName = String(req.body.shippingName ?? "").trim();
    const shippingAddress = String(req.body.shippingAddress ?? "").trim();
    const shippingCity = String(req.body.shippingCity ?? "").trim();
    const shippingRegion = String(req.body.shippingRegion ?? "").trim();
    const shippingPostalCode = String(req.body.shippingPostalCode ?? "").trim();
    const discountCents = Number(req.body.discountCents ?? 0);

    if (
      !shippingName ||
      !shippingAddress ||
      !shippingCity ||
      !shippingRegion ||
      !shippingPostalCode
    ) {
      res
        .status(400)
        .type("html")
        .send(
          renderCheckoutPage(
            items,
            current.session.csrf_token,
            current.user.display_name,
            "All shipping fields are required",
          ),
        );
      return;
    }

    const shippingDetails = {
      name: shippingName,
      address: shippingAddress,
      city: shippingCity,
      region: shippingRegion,
      postalCode: shippingPostalCode,
    };
    await reserveAcornFulfillment(shippingDetails, {
      delayMs: deps.acornFulfillmentDelayMs,
    });

    items = listCartItems(db, current.user.id);
    if (items.length === 0) {
      res.redirect("/cart");
      return;
    }

    const newlyUnavailableItem = findUnavailableCartItem(items);
    if (newlyUnavailableItem) {
      res
        .status(409)
        .type("html")
        .send(
          renderCheckoutPage(
            items,
            current.session.csrf_token,
            current.user.display_name,
            `${newlyUnavailableItem.name} is no longer available in the requested quantity. Update your cart before checking out.`,
          ),
        );
      return;
    }

    const adminNotes = "Awaiting PawPal payment.";
    let order: ReturnType<typeof createOrderFromCart>;
    try {
      order = createOrderFromCart(
        db,
        current.user.id,
        items,
        discountCents,
        shippingDetails,
        adminNotes,
        deps.keyring,
      );
    } catch (error) {
      if (!(error instanceof InsufficientInventoryError)) {
        throw error;
      }

      const currentItems = listCartItems(db, current.user.id);
      res
        .status(409)
        .type("html")
        .send(
          renderCheckoutPage(
            currentItems,
            current.session.csrf_token,
            current.user.display_name,
            error.message,
          ),
        );
      return;
    }

    const pawPalReference = createPawPalReference(order.id, order.total_cents);

    logEvent("checkout_started", {
      userId: current.user.id,
      email: current.user.email,
      orderId: order.id,
      totalCents: order.total_cents,
      pawPalReference,
      shippingName,
      shippingAddress,
      shippingCity,
      shippingRegion,
      shippingPostalCode,
      adminNotes,
    });

    res.redirect(createPawPalCheckoutUrl(order.id));
  });

  function findUnavailableCartItem(items: CartItem[]): CartItem | undefined {
    return items.find((item) => getCartItemAvailability(item) !== "available");
  }

  router.get("/pawpal/processing/:orderId", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const orderId = Number(req.params.orderId);
    const order = Number.isSafeInteger(orderId)
      ? findOrderById(db, orderId)
      : undefined;

    if (!order || order.user_id !== current.user.id) {
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
        renderPawPalProcessingPage(
          orderId,
          String(res.locals.cspNonce),
          current.user.display_name,
        ),
      );
  });

  return router;
}
