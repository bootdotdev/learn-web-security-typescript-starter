import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import multer from "multer";

const uploadDirectory = join(process.cwd(), "data", "uploads");

const allowedContentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    const storedName = `${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}${extension}`;
    callback(null, storedName);
  },
});

export const uploadTaxDocument = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    callback(null, allowedContentTypes.has(file.mimetype));
  },
}).single("document");
