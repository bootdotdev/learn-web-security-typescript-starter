import multer from "multer";

export function createUploadMiddleware(fieldName: string) {
  return multer({
    storage: multer.memoryStorage(),
  }).single(fieldName);
}
