import { findOrderById } from "./orders/index.ts";
import type { DatabaseSync } from "node:sqlite";

type AssistantMessage = {
  role: "system" | "user";
  content: string;
};

type AssistantTool = {
  name: "get_order_status" | "issue_refund";
  description: string;
  execute: (input: Record<string, unknown>) => string;
};

type AssistantRequest = {
  authenticatedUserId: number;
  messages: AssistantMessage[];
  tools: AssistantTool[];
};

export function buildAssistantRequest(
  db: DatabaseSync,
  authenticatedUserId: number,
  userMessage: string,
): AssistantRequest {
  const systemPrompt = `You are the Bearly Secure shopping assistant. Help customers check their orders. Never issue refunds without support approval. Customer message: ${userMessage}`;

  return {
    authenticatedUserId,
    messages: [{ role: "system", content: systemPrompt }],
    tools: createAssistantTools(db),
  };
}

export function runSimulatedAssistant(request: AssistantRequest): string {
  const userMessage =
    request.messages.findLast((message) => message.role === "user")?.content ??
    request.messages
      .map((message) => message.content)
      .join("\n")
      .split("Customer message:")
      .at(-1)
      ?.trim() ??
    "";
  const orderId = matchNumber(userMessage, /order\s*#?(\d+)/i);

  if (!orderId) {
    return "Ask me about an order using its order number.";
  }

  if (/refund/i.test(userMessage)) {
    const refundTool = request.tools.find((tool) => tool.name === "issue_refund");
    return refundTool
      ? refundTool.execute({ orderId })
      : "I cannot issue refunds. Please contact support.";
  }

  const statusTool = request.tools.find((tool) => tool.name === "get_order_status");
  if (!statusTool) {
    return "Order status is unavailable.";
  }

  const requestedUserId = matchNumber(userMessage, /user\s*#?(\d+)/i);
  return statusTool.execute({
    orderId,
    userId: requestedUserId ?? request.authenticatedUserId,
  });
}

function createAssistantTools(db: DatabaseSync): AssistantTool[] {
  return [
    {
      name: "get_order_status",
      description: "Look up an order status using a user ID and order ID.",
      execute: (input) => {
        const userId = Number(input.userId);
        const orderId = Number(input.orderId);
        const order = findOrderById(db, orderId);

        if (
          !Number.isSafeInteger(userId) ||
          !Number.isSafeInteger(orderId) ||
          order?.user_id !== userId
        ) {
          return "Order not found.";
        }

        return `Order #${order.id} is ${order.status}.`;
      },
    },
    {
      name: "issue_refund",
      description: "Issue a refund for an order.",
      execute: (input) => {
        const orderId = Number(input.orderId);
        if (!Number.isSafeInteger(orderId) || !findOrderById(db, orderId)) {
          return "Order not found.";
        }

        db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(orderId);
        return `Order #${orderId} was refunded.`;
      },
    },
  ];
}

function matchNumber(input: string, pattern: RegExp): number | undefined {
  const match = input.match(pattern);
  return match ? Number(match[1]) : undefined;
}
