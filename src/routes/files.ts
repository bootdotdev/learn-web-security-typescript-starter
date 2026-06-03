import { Router } from "express";
import { getCurrentSession } from "../auth/sessions.ts";
import { findUploadedFileById } from "../uploads/index.ts";

export const router = Router();

router.get("/files/:id/download", (req, res) => {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return;
  }

  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId)) {
    res.status(404).send("File not found");
    return;
  }

  const file = findUploadedFileById(fileId);
  if (!file) {
    res.status(404).send("File not found");
    return;
  }

  res.download(file.storage_path, file.original_name);
});
