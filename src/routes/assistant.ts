import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { buildAssistantRequest, runSimulatedAssistant } from "../assistant.ts";
import { requireAuth } from "../auth/accessControl.ts";
import { renderAssistantPage } from "../views/assistant.ts";

export function createAssistantRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/account/assistant", (req, res) => {
    const current = requireAuth(db, req, res, {
      returnTo: "/account/assistant",
    });
    if (!current) {
      return;
    }

    res.type("html").send(renderAssistantPage(current.user.display_name));
  });

  router.post("/account/assistant", (req, res) => {
    const current = requireAuth(db, req, res, {
      returnTo: "/account/assistant",
    });
    if (!current) {
      return;
    }

    const userMessage = String(req.body.message ?? "").trim();
    if (!userMessage) {
      res
        .status(400)
        .type("html")
        .send(
          renderAssistantPage(
            current.user.display_name,
            "Ask a question about an order.",
          ),
        );
      return;
    }

    const request = buildAssistantRequest(db, current.user.id, userMessage);
    const answer = runSimulatedAssistant(request);
    res
      .type("html")
      .send(renderAssistantPage(current.user.display_name, answer));
  });

  return router;
}
