import multer from "multer";

export function createUploadMiddleware(maxBytes: number, fieldName: string) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
    },
  }).single(fieldName);
}
