import { escapeHtml, renderAccountLink, renderPage } from "./layout.ts";

export function renderAssistantPage(displayName: string, answer: string = ""): string {
  const response = answer
    ? `<section class="card-grid"><article class="card"><h2>Assistant</h2><p>${escapeHtml(answer)}</p></article></section>`
    : "";

  return renderPage(
    "Order Assistant",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/account/orders">Orders</a></nav>
      <p class="eyebrow">Local Simulation</p>
      <h1>Order Assistant</h1>
      <p class="subtitle">Ask about an order, and the local assistant will choose a tool to answer.</p>
      <form method="post" action="/account/assistant" class="account-form">
        <label>
          Message
          <textarea name="message" rows="4" required></textarea>
        </label>
        <button type="submit">Ask assistant</button>
      </form>
      ${response}`,
  );
}
