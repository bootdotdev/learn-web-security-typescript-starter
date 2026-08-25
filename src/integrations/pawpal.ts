import { createHmac } from "node:crypto";

const pawPalApiKey = "pawpal_test_insecure_hardcoded_key";

export function createPawPalReference(orderId: number, totalCents: number): string {
  const payload = `${orderId}:${totalCents}`;
  const signature = createHmac("sha256", pawPalApiKey).update(payload).digest("hex").slice(0, 16);
  return `pawpal_${orderId}_${signature}`;
}

export function createPawPalCheckoutUrl(orderId: number): string {
  const checkoutUrl = new URL("https://pawpal.example/checkout");
  checkoutUrl.searchParams.set("orderId", String(orderId));
  return checkoutUrl.toString();
}

export type PawPalWebhookVerification =
  | { outcome: "unauthorized" }
  | { outcome: "malformed" }
  | { outcome: "approved"; orderId: number };

export function verifyPawPalWebhook(payload: unknown): PawPalWebhookVerification {
  const payloadRecord =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const orderId = typeof payloadRecord.orderId === "number" ? payloadRecord.orderId : Number.NaN;

  return { outcome: "approved", orderId };
}
