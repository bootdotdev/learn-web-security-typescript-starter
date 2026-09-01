import type { ErrorRequestHandler, Response } from "express";
import multer from "multer";
import { escapeHtml, renderPage } from "./views/layout.ts";
import { logEvent } from "./logger.ts";

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const details = error instanceof Error ? error : new Error(String(error));

  logEvent("unhandled_error", {
    method: req.method,
    path:
      typeof req.route?.path === "string" ? req.route.path : "unmatched route",
    message: details.message,
    stack: details.stack,
  });

  console.error(details);

  if (res.headersSent) {
    next(error);
    return;
  }

  if (isContentTooLarge(error)) {
    sendErrorPage(
      res,
      413,
      "Content Too Large",
      "The submitted request exceeds the allowed size.",
    );
    return;
  }

  res
    .status(500)
    .type("html")
    .send(
      renderPage(
        "Application Error",
        `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
        <p class="eyebrow">Error 500</p>
        <h1>Something went wrong</h1>
        <p class="subtitle">The request failed, but here are the diagnostic details.</p>
        <article class="card">
          <h2>${escapeHtml(details.name)}</h2>
          <p>${escapeHtml(details.message)}</p>
          <pre>${escapeHtml(details.stack ?? "No stack trace available")}</pre>
        </article>`,
      ),
    );
};

function isContentTooLarge(error: unknown): boolean {
  if (error instanceof multer.MulterError) {
    return error.code === "LIMIT_FILE_SIZE";
  }
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  return candidate.status === 413 || candidate.statusCode === 413;
}

export function sendErrorPage(
  response: Response,
  statusCode: number,
  title: string,
  message: string,
): void {
  response
    .status(statusCode)
    .type("html")
    .send(
      renderPage(
        title,
        `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a></nav>
        <p class="eyebrow">Error ${statusCode}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">${escapeHtml(message)}</p>
        <p class="page-action"><a class="button-link" href="/">Return to the store</a></p>`,
      ),
    );
}
