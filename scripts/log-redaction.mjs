import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logEvent } from "../src/logger.ts";

const mode = process.argv[2];
if (mode !== "security-fields" && mode !== "pii-fields") {
  throw new Error(
    "Usage: node scripts/log-redaction.mjs <security-fields|pii-fields>",
  );
}

const logPath = resolve("data/bearly-secure.log");
const logExisted = existsSync(logPath);
const originalLog = logExisted ? readFileSync(logPath) : Buffer.alloc(0);
const fields =
  mode === "security-fields"
    ? {
        sessionId: "session-secret",
        resetToken: "reset-token-secret",
        resetLink: "/password-reset/reset-link-secret",
        secret: "totp-secret",
        adminNotes: "internal-order-notes",
        storagePath: "/private/uploads/tax-document.pdf",
        userId: 42,
        success: true,
      }
    : {
        email: "customer@example.com",
        shippingName: "Cipher Bear",
        shippingAddress: "12 Encryption Lane",
        shippingCity: "Lockbox",
        shippingRegion: "VA",
        shippingPostalCode: "22030",
        originalName: "customer-tax-document.pdf",
        userId: 42,
        success: true,
      };

try {
  logEvent("log_redaction_probe", fields);

  const updatedLog = readFileSync(logPath);
  const appendedEntry = updatedLog
    .subarray(originalLog.length)
    .toString("utf8")
    .trim();
  const parsedEntry = JSON.parse(appendedEntry);

  console.log(JSON.stringify(parsedEntry));
} finally {
  if (logExisted) {
    writeFileSync(logPath, originalLog);
  } else {
    rmSync(logPath, { force: true });
  }
}
