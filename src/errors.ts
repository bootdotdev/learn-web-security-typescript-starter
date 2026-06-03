import type { ErrorRequestHandler } from "express";
import { renderPage } from "./html.ts";
import { logEvent } from "./logger.ts";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const details = error instanceof Error ? error : new Error(String(error));

  logEvent("unhandled_error", {
    method: req.method,
    path: req.originalUrl,
    message: details.message,
    stack: details.stack,
  });

  console.error(details);

  if (res.headersSent) {
    return;
  }

  res
    .status(500)
    .type("html")
    .send(
      renderPage(
        "Application Error",
        `
        <a href="/">Back to store</a>
        <h1>Something went wrong</h1>
        <p>The request failed, but here are the diagnostic details.</p>
        <article class="card">
          <h2>${details.name}</h2>
          <p>${details.message}</p>
          <pre>${details.stack ?? "No stack trace available"}</pre>
        </article>
      `,
      ),
    );
};
