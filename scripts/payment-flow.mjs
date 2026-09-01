import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const databasePath =
  process.env.DATABASE_URL ??
  join(process.cwd(), "data", "bearly-secure.sqlite");

if (process.argv[2] !== "webhook") {
  throw new Error(
    "Usage: node scripts/payment-flow.mjs webhook <base-url> <order-id>",
  );
}

const baseURL = process.argv[3];
const orderId = Number(process.argv[4]);
const pawPalApiKey = process.env.PAWPAL_API_KEY;

if (
  !baseURL ||
  !Number.isSafeInteger(orderId) ||
  orderId <= 0 ||
  !pawPalApiKey
) {
  throw new Error(
    "Usage: node scripts/payment-flow.mjs webhook <base-url> <order-id>",
  );
}

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const invalidKeyResponse = await sendWebhook("wrong-key", {
    orderId,
    status: "approved",
  });
  const orderAfterInvalidKey = readOrder();

  const malformedResponse = await sendWebhook(pawPalApiKey, {
    customerId: orderId,
    status: "approved",
  });
  const orderAfterMalformedPayload = readOrder();

  const unapprovedResponse = await sendWebhook(pawPalApiKey, {
    orderId,
    status: "declined",
  });
  const orderAfterUnapprovedStatus = readOrder();

  const approvedResponse = await sendWebhook(pawPalApiKey, {
    orderId,
    status: "approved",
  });
  const orderAfterApproval = readOrder();

  const orderColumns = database
    .prepare("PRAGMA table_info(orders)")
    .all()
    .map((column) => column.name);
  const forbiddenColumns = [
    "card_number",
    "cardNumber",
    "cvv",
    "expiry",
    "payment_token",
    "paymentToken",
  ];
  const logPath = join(process.cwd(), "data", "bearly-secure.log");
  const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const checkoutEvent = logText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .findLast(
      (entry) =>
        entry.event === "checkout_started" && entry.orderId === orderId,
    );

  console.log(
    JSON.stringify({
      invalidKeyRejected: invalidKeyResponse.status === 401,
      invalidKeyLeftOrderPending: orderAfterInvalidKey.status === "pending",
      malformedPayloadRejected: malformedResponse.status === 400,
      malformedPayloadLeftOrderPending:
        orderAfterMalformedPayload.status === "pending",
      unapprovedStatusRejected: unapprovedResponse.status === 400,
      unapprovedStatusLeftOrderPending:
        orderAfterUnapprovedStatus.status === "pending",
      approvedWebhookAccepted: approvedResponse.status === 204,
      orderMarkedPaid: orderAfterApproval.status === "paid",
      serverCalculatedTotal: orderAfterApproval.total_cents === 2499,
      noRawPaymentColumns: forbiddenColumns.every(
        (column) => !orderColumns.includes(column),
      ),
      webhookKeyAbsentFromLogs: !logText.includes(pawPalApiKey),
      checkoutLogKeepsOrderContext:
        checkoutEvent?.totalCents === 2499 &&
        !Object.hasOwn(checkoutEvent, "cardNumber") &&
        !Object.hasOwn(checkoutEvent, "paymentToken"),
    }),
  );
} finally {
  database.close();
}

async function sendWebhook(apiKey, body) {
  return fetch(new URL("/integrations/pawpal/webhook", baseURL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PawPal-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
}

function readOrder() {
  const order = database
    .prepare("SELECT status, total_cents FROM orders WHERE id = ?")
    .get(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} was not found`);
  }
  return order;
}
