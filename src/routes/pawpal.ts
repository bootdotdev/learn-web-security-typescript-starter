import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { verifyPawPalWebhook } from "../integrations/pawpal.ts";
import { logEvent } from "../logger.ts";
import { approvePawPalOrder } from "../orders/index.ts";

export function createPawPalRouter(deps: Dependencies): Router {
  const router = Router();

  router.post("/integrations/pawpal/webhook", (req, res) => {
    const verification = verifyPawPalWebhook(req.body);
    if (verification.outcome === "unauthorized") {
      res.sendStatus(401);
      return;
    }

    if (verification.outcome === "malformed") {
      res.sendStatus(400);
      return;
    }

    if (!approvePawPalOrder(deps.db, verification.orderId)) {
      res.sendStatus(404);
      return;
    }

    logEvent("pawpal_payment_approved", { orderId: verification.orderId });
    res.sendStatus(204);
  });

  return router;
}
