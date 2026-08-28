import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Keyring } from "../storage/keyring.ts";

const uploadDirectory = join(process.cwd(), "data", "uploads");

type TaxDocumentType = {
  contentType: string;
  extension: string;
};

type StoredTaxDocument = {
  contentType: string;
  storagePath: string;
};

export function detectTaxDocumentType(buffer: Buffer): TaxDocumentType | undefined {
  if (buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return { contentType: "application/pdf", extension: ".pdf" };
  }

  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { contentType: "image/jpeg", extension: ".jpg" };
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", extension: ".png" };
  }

  if (
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return { contentType: "image/webp", extension: ".webp" };
  }

  return undefined;
}

export function encryptTaxDocument(buffer: Buffer, _keyring: Keyring | undefined): Buffer {
  return buffer;
}

export function storeTaxDocument(
  buffer: Buffer,
  keyring: Keyring | undefined,
): StoredTaxDocument | undefined {
  mkdirSync(uploadDirectory, { recursive: true });
  const storagePath = join(uploadDirectory, "uploaded-document");
  writeFileSync(storagePath, encryptTaxDocument(buffer, keyring));

  return { contentType: "application/octet-stream", storagePath };
}

export function readTaxDocument(storagePath: string, _keyring: Keyring | undefined): Buffer {
  return readFileSync(storagePath);
}
