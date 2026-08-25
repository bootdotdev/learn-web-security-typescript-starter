import type { RequestHandler } from "express";
import { renderPage } from "../views/layout.ts";

type BotRiskTier = "low" | "medium" | "high";

type BotRiskAssessment = {
  score: number;
  tier: BotRiskTier;
  reasons: string[];
};

type BotRiskSignals = {
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
  honeypot?: string;
};

const automationUserAgent = /\b(bot|crawler|curl|httpie|scrapy|spider|wget)\b/i;
const headlessBrowserUserAgent = /\bHeadlessChrome\b/i;

export function calculateBotRisk(signals: BotRiskSignals): BotRiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (signals.honeypot?.trim()) {
    score += 5;
    reasons.push("honeypot field was filled");
  }

  if (!signals.userAgent) {
    score += 2;
    reasons.push("user agent is missing");
  } else if (automationUserAgent.test(signals.userAgent)) {
    score += 4;
    reasons.push("user agent identifies an automation client");
  } else if (headlessBrowserUserAgent.test(signals.userAgent)) {
    score += 2;
    reasons.push("user agent identifies a headless browser");
  }

  if (!signals.acceptLanguage) {
    score += 1;
    reasons.push("accept-language is missing");
  }

  if (!signals.accept?.includes("text/html")) {
    score += 1;
    reasons.push("accept header is inconsistent with a browser form");
  }

  return {
    score,
    tier: score >= 5 ? "high" : score >= 2 ? "medium" : "low",
    reasons,
  };
}

export const protectSignupFromBots: RequestHandler = (req, res, next) => {
  const userAgent = req.header("user-agent");
  const accept = req.header("accept");
  const acceptLanguage = req.header("accept-language");
  const signals: BotRiskSignals = {
    honeypot: String(req.body?.companyWebsite ?? ""),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(accept === undefined ? {} : { accept }),
    ...(acceptLanguage === undefined ? {} : { acceptLanguage }),
  };
  const assessment = calculateBotRisk(signals);
  res.locals.botRisk = assessment;

  if (assessment.tier === "high") {
    res.setHeader("Retry-After", "60");
    res
      .status(429)
      .type("html")
      .send(
        renderPage(
          "Request Could Not Be Completed",
          `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a><a href="/login">Log in</a></nav>
          <h1>Request could not be completed</h1>
          <p class="page-action"><a href="/signup">Try creating an account again</a></p>`,
        ),
      );
    return;
  }

  if (assessment.tier === "medium") {
    res
      .status(403)
      .type("html")
      .send(
        renderPage(
          "Additional Verification Required",
          `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a><a href="/login">Log in</a></nav>
          <h1>Additional verification required</h1>
          <p class="page-action"><a href="/signup">Try creating an account again</a></p>`,
        ),
      );
    return;
  }

  next();
};
