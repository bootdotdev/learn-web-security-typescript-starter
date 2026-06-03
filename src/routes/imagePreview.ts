import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { requireRole } from "../auth/accessControl.ts";
import {
  fetchRemoteImagePreview,
  RemoteImagePreviewError,
} from "../integrations/remoteImagePreview.ts";
import { renderImagePreviewPage } from "../views/imagePreview.ts";

export function createImagePreviewRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/admin/image-preview", (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    res.type("html").send(renderImagePreviewPage(current.user.display_name));
  });

  router.post("/admin/image-preview", async (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    const imageUrl = String(req.body.imageUrl ?? "").trim();
    if (!imageUrl) {
      res
        .status(400)
        .type("html")
        .send(renderImagePreviewPage(current.user.display_name, "Enter an image URL."));
      return;
    }

    try {
      const result = await fetchRemoteImagePreview(imageUrl, deps.maxUploadBytes);

      res.type("html").send(renderImagePreviewPage(current.user.display_name, undefined, result));
    } catch (error) {
      const message =
        error instanceof RemoteImagePreviewError
          ? error.message
          : "Bearly Secure could not fetch that URL.";
      res.status(502).type("html").send(renderImagePreviewPage(current.user.display_name, message));
    }
  });

  return router;
}
