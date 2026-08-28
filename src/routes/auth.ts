import { Router, type Request, type Response } from "express";
import type { Dependencies } from "../dependencies.ts";
import { safeReturnTo } from "../auth/accessControl.ts";
import { hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "../auth/passwords.ts";
import { createPasswordResetToken, findPasswordResetToken } from "../auth/passwordResetTokens.ts";
import { clearSessionCookie, setSessionCookie } from "../auth/sessionCookies.ts";
import { createSession, getCurrentSession } from "../auth/sessions.ts";
import { verifyAndConsumeTotpCode } from "../auth/totp.ts";
import {
  abandonTotpLoginChallenge,
  clearTotpLoginChallengeCookie,
  createTotpLoginChallenge,
  deleteTotpLoginChallenge,
  findTotpLoginChallenge,
  getTotpLoginChallengeToken,
  recordTotpLoginChallengeFailure,
  setTotpLoginChallengeCookie,
} from "../auth/totpLoginChallenges.ts";
import {
  countRecentRecoveryAttempts,
  recordRecoveryAttempt,
  verifyAndConsumeBackupCode,
} from "../auth/totpBackupCodes.ts";
import {
  clearTotpSecret,
  createUser,
  findUserByEmail,
  findUserById,
  getTotpSecret,
  normalizeEmail,
  updateUserPassword,
} from "../auth/users.ts";
import {
  renderLoginPage,
  renderMfaRecoveryPage,
  renderPasswordResetCompletePage,
  renderPasswordResetEmailNotFoundPage,
  renderPasswordResetForm,
  renderPasswordResetRequestConfirmationPage,
  renderPasswordResetRequestPage,
  renderSignupPage,
  renderTotpLoginPage as renderTotpLoginView,
} from "../views/auth.ts";
import { logEvent } from "../logger.ts";

type AuthenticationLogFields = {
  success: boolean;
  userId?: number;
  [key: string]: unknown;
};

function logAuthenticationEvent(
  _req: Request,
  _res: Response,
  eventName: "login_attempt" | "password_reset_request",
  fields: AuthenticationLogFields,
): void {
  logEvent(eventName, fields);
}

export function createAuthRouter(deps: Dependencies): Router {
  const { db, appOrigin } = deps;
  const router = Router();

  const MIN_PASSWORD_LENGTH = 8;
  const VERIFICATION_RESTART_MESSAGE =
    "That verification attempt is no longer valid. Log in again.";

  router.get("/login", (req, res) => {
    const returnTo = String(req.query.returnTo ?? "/");
    const error = req.query.verification === "restart" ? VERIFICATION_RESTART_MESSAGE : undefined;
    res.type("html").send(renderLoginPage(error, returnTo));
  });

  router.get("/login/totp", (req, res) => {
    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    const challenge = challengeToken ? findTotpLoginChallenge(db, challengeToken) : undefined;
    const user = challenge ? findUserById(db, challenge.user_id) : undefined;
    if (!challengeToken || !challenge || !user?.has_totp) {
      if (challengeToken) {
        deleteTotpLoginChallenge(db, challengeToken);
      }
      clearTotpLoginChallengeCookie(res);
      res.redirect(challengeToken ? verificationRestartLoginPath() : "/login");
      return;
    }

    res.type("html").send(renderTotpLoginPage(challenge.return_to));
  });

  router.get("/signup", (req, res) => {
    if (getCurrentSession(db, req.header("cookie"))) {
      res.redirect("/account");
      return;
    }

    res.type("html").send(renderSignupPage());
  });

  router.get("/recover-mfa", (_req, res) => {
    res.type("html").send(renderMfaRecoveryPage());
  });

  router.post("/recover-mfa", async (req, res) => {
    const email = normalizeEmail(String(req.body.email ?? ""));
    const password = String(req.body.password ?? "");
    const backupCode = String(req.body.backupCode ?? "").trim();
    const user = findUserByEmail(db, email);
    const recentFailures = countRecentRecoveryAttempts(db, email);

    if (recentFailures >= 5) {
      logEvent("mfa_recovery_attempt", {
        email,
        userId: user?.id,
        success: false,
        failureReason: "too many recovery attempts",
      });
      res
        .status(429)
        .type("html")
        .send(renderMfaRecoveryPage("Too many recovery attempts. Try again later."));
      return;
    }

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      recordRecoveryAttempt(db, email, user?.id ?? null, false);
      logEvent("mfa_recovery_attempt", {
        email,
        userId: user?.id,
        success: false,
        failureReason: !user ? "email not found" : "password mismatch",
      });
      res.status(401).type("html").send(renderMfaRecoveryPage("Invalid recovery details."));
      return;
    }

    if (!verifyAndConsumeBackupCode(db, user.id, backupCode)) {
      recordRecoveryAttempt(db, email, user.id, false);
      logEvent("mfa_recovery_attempt", {
        email: user.email,
        userId: user.id,
        success: false,
        failureReason: "backup code rejected",
      });
      res.status(401).type("html").send(renderMfaRecoveryPage("Invalid recovery details."));
      return;
    }

    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    abandonTotpLoginChallenge(db, req.header("cookie"));
    clearTotpSecret(db, user.id);
    const session = createSession(db, user.id);
    recordRecoveryAttempt(db, user.email, user.id, true);

    logEvent("mfa_recovery_attempt", {
      email: user.email,
      userId: user.id,
      success: true,
    });

    setSessionCookie(res, session);
    if (challengeToken) {
      clearTotpLoginChallengeCookie(res);
    }

    res.redirect("/account/totp");
  });

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(String(req.body.email ?? ""));
    const password = String(req.body.password ?? "");
    const returnTo = String(req.body.returnTo ?? "/");
    const user = findUserByEmail(db, email);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      logAuthenticationEvent(req, res, "login_attempt", {
        email,
        success: false,
        failureReason: !user ? "email not found" : "password mismatch",
        returnTo,
      });
      res.status(401).type("html").send(renderLoginPage("Invalid email or password", returnTo));
      return;
    }

    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    abandonTotpLoginChallenge(db, req.header("cookie"));

    if (user.has_totp) {
      const challenge = createTotpLoginChallenge(db, user.id, returnTo);
      setTotpLoginChallengeCookie(res, challenge);
      res.redirect("/login/totp");
      return;
    }

    const session = createSession(db, user.id);

    logAuthenticationEvent(req, res, "login_attempt", {
      email: user.email,
      userId: user.id,
      role: user.role,
      success: true,
      sessionId: session.token,
      returnTo,
    });

    setSessionCookie(res, session);
    if (challengeToken) {
      clearTotpLoginChallengeCookie(res);
    }

    res.redirect(returnTo);
  });

  router.post("/login/totp/cancel", (req, res) => {
    abandonTotpLoginChallenge(db, req.header("cookie"));
    clearTotpLoginChallengeCookie(res);
    res.redirect("/login");
  });

  router.post("/login/totp", (req, res) => {
    const requestedReturnTo = String(req.body.returnTo ?? "/");
    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    const challenge = challengeToken ? findTotpLoginChallenge(db, challengeToken) : undefined;
    if (!challengeToken || !challenge) {
      clearTotpLoginChallengeCookie(res);
      res.redirect(verificationRestartLoginPath(requestedReturnTo));
      return;
    }

    const user = findUserById(db, challenge.user_id);
    const totpSecret = user ? getTotpSecret(db, user.id, deps.keyring) : undefined;
    if (!user || !totpSecret) {
      deleteTotpLoginChallenge(db, challengeToken);
      clearTotpLoginChallengeCookie(res);
      res.redirect(verificationRestartLoginPath(challenge.return_to));
      return;
    }

    const mfaCode = String(req.body.mfaCode ?? "").trim();
    if (!verifyAndConsumeTotpCode(db, user.id, mfaCode, totpSecret)) {
      const challengeExhausted = recordTotpLoginChallengeFailure(db, challengeToken);
      logAuthenticationEvent(req, res, "login_attempt", {
        email: user.email,
        userId: user.id,
        success: false,
        failureReason: "totp code mismatch",
        returnTo: challenge.return_to,
      });
      if (challengeExhausted) {
        clearTotpLoginChallengeCookie(res);
        res.redirect(verificationRestartLoginPath(challenge.return_to));
        return;
      }

      res
        .status(401)
        .type("html")
        .send(renderTotpLoginPage(challenge.return_to, "Authenticator code is incorrect."));
      return;
    }

    deleteTotpLoginChallenge(db, challengeToken);
    const session = createSession(db, user.id);

    logAuthenticationEvent(req, res, "login_attempt", {
      email: user.email,
      userId: user.id,
      role: user.role,
      success: true,
      sessionId: session.token,
      returnTo: challenge.return_to,
    });

    setSessionCookie(res, session);
    clearTotpLoginChallengeCookie(res);
    res.redirect(challenge.return_to);
  });

  router.post("/signup", async (req, res) => {
    if (getCurrentSession(db, req.header("cookie"))) {
      res.redirect("/account");
      return;
    }

    const email = normalizeEmail(String(req.body.email ?? ""));
    const displayName = String(req.body.displayName ?? "").trim();
    const password = String(req.body.password ?? "");

    if (!email || !displayName || !password) {
      res.status(400).type("html").send(renderSignupPage("All fields are required"));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      res
        .status(400)
        .type("html")
        .send(renderSignupPage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`));
      return;
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      res
        .status(400)
        .type("html")
        .send(renderSignupPage(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`));
      return;
    }

    if (findUserByEmail(db, email)) {
      res
        .status(409)
        .type("html")
        .send(renderSignupPage("An account already exists for that email"));
      return;
    }

    const user = await createUser(db, email, displayName, password);
    const session = createSession(db, user.id);

    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    abandonTotpLoginChallenge(db, req.header("cookie"));
    setSessionCookie(res, session);
    if (challengeToken) {
      clearTotpLoginChallengeCookie(res);
    }

    res.redirect("/account");
  });

  router.post("/logout", (req, res) => {
    const challengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    abandonTotpLoginChallenge(db, req.header("cookie"));
    clearSessionCookie(res);
    if (challengeToken) {
      clearTotpLoginChallengeCookie(res);
    }
    res.redirect("/");
  });

  router.get("/password-reset", (_req, res) => {
    res.type("html").send(renderPasswordResetRequestPage());
  });

  router.post("/password-reset", (req, res) => {
    const email = normalizeEmail(String(req.body.email ?? ""));
    const user = findUserByEmail(db, email);

    if (!user) {
      logAuthenticationEvent(req, res, "password_reset_request", {
        email,
        success: false,
        failureReason: "email not found",
      });
      res.type("html").send(renderPasswordResetEmailNotFoundPage());
      return;
    }

    const { token } = createPasswordResetToken(db, user.id);
    const resetLink = `${appOrigin}/password-reset/${token}`;
    if (new URL(appOrigin).hostname === "localhost") {
      console.log(`Bear Mail to ${email}:\nReset your password: ${resetLink}`);
    }

    logAuthenticationEvent(req, res, "password_reset_request", {
      email: user.email,
      userId: user.id,
      success: true,
      resetToken: token,
      resetLink,
    });
    res.type("html").send(renderPasswordResetRequestConfirmationPage(resetLink));
  });

  router.get("/password-reset/:token", (req, res) => {
    const token = String(req.params.token ?? "");
    const resetToken = findPasswordResetToken(db, token);

    if (!resetToken) {
      res
        .status(404)
        .type("html")
        .send(renderPasswordResetForm(token, "Reset link not found or expired"));
      return;
    }

    res.type("html").send(renderPasswordResetForm(token));
  });

  router.post("/password-reset/:token", async (req, res) => {
    const token = String(req.params.token ?? "");
    const password = String(req.body.password ?? "");
    const resetToken = findPasswordResetToken(db, token);

    if (!resetToken) {
      res
        .status(404)
        .type("html")
        .send(renderPasswordResetForm(token, "Reset link not found or expired"));
      return;
    }

    const user = findUserById(db, resetToken.user_id);
    if (!user) {
      res.status(404).type("html").send(renderPasswordResetForm(token, "Account not found"));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      res
        .status(400)
        .type("html")
        .send(
          renderPasswordResetForm(
            token,
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
          ),
        );
      return;
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      res
        .status(400)
        .type("html")
        .send(
          renderPasswordResetForm(
            token,
            `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`,
          ),
        );
      return;
    }

    const passwordHash = await hashPassword(password);
    const passwordResetSucceeded = true;
    if (!passwordResetSucceeded) {
      res
        .status(404)
        .type("html")
        .send(renderPasswordResetForm(token, "Reset link not found or expired"));
      return;
    }

    await updateUserPassword(db, user.id, passwordHash);

    res.type("html").send(renderPasswordResetCompletePage(user.email));
  });

  function verificationRestartLoginPath(returnTo: unknown = "/"): string {
    const params = new URLSearchParams({ verification: "restart" });
    const returnPath = String(returnTo);
    if (returnPath !== "/") {
      params.set("returnTo", returnPath);
    }
    return `/login?${params}`;
  }

  function renderTotpLoginPage(returnTo: string, error?: string): string {
    return renderTotpLoginView(safeReturnTo(returnTo), error);
  }

  return router;
}
