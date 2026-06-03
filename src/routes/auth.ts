import { Router } from "express";
import { verifyPassword } from "../auth/passwords.ts";
import { createPasswordResetToken, findPasswordResetToken } from "../auth/passwordResetTokens.ts";
import { createSession, getCurrentSession } from "../auth/sessions.ts";
import { createUser, findUserByEmail, findUserById, updateUserPassword } from "../auth/users.ts";
import { renderPage } from "../html.ts";
import { logEvent } from "../logger.ts";

export const router = Router();

router.get("/login", (req, res) => {
  const returnTo = String(req.query.returnTo ?? "/");
  res.type("html").send(renderLoginPage(undefined, returnTo));
});

router.get("/signup", (req, res) => {
  if (getCurrentSession(req.header("cookie"))) {
    res.redirect("/account");
    return;
  }

  res.type("html").send(renderSignupPage());
});

router.post("/login", (req, res) => {
  const email = String(req.body.email ?? "");
  const password = String(req.body.password ?? "");
  const returnTo = String(req.body.returnTo ?? "/");
  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    logEvent("login_attempt", {
      email,
      success: false,
      failureReason: !user ? "email not found" : "password mismatch",
      returnTo,
    });
    res.status(401).type("html").send(renderLoginPage("Invalid email or password", returnTo));
    return;
  }

  const session = createSession(user.id);

  logEvent("login_attempt", {
    email: user.email,
    userId: user.id,
    role: user.role,
    success: true,
    sessionId: session.id,
    returnTo,
  });

  res.cookie("session_id", session.id);
  res.redirect(returnTo);
});

router.post("/signup", (req, res) => {
  if (getCurrentSession(req.header("cookie"))) {
    res.redirect("/account");
    return;
  }

  const email = String(req.body.email ?? "").trim();
  const displayName = String(req.body.displayName ?? "").trim();
  const password = String(req.body.password ?? "");

  if (!email || !displayName || !password) {
    res.status(400).type("html").send(renderSignupPage("All fields are required"));
    return;
  }

  if (password.length < 8) {
    res.status(400).type("html").send(renderSignupPage("Password must be at least 8 characters"));
    return;
  }

  if (findUserByEmail(email)) {
    res.status(409).type("html").send(renderSignupPage("An account already exists for that email"));
    return;
  }

  const user = createUser(email, displayName, password);
  const session = createSession(user.id);

  res.cookie("session_id", session.id);
  res.redirect("/account");
});

router.post("/logout", (_req, res) => {
  res.clearCookie("session_id");
  res.redirect("/");
});

router.get("/password-reset", (_req, res) => {
  res.type("html").send(renderPasswordResetRequestPage());
});

router.post("/password-reset", (req, res) => {
  const email = String(req.body.email ?? "").trim();
  const user = findUserByEmail(email);

  if (!user) {
    logEvent("password_reset_request", {
      email,
      success: false,
      failureReason: "email not found",
    });
    res
      .status(404)
      .type("html")
      .send(renderPasswordResetRequestPage(undefined, "No account found for that email"));
    return;
  }

  const resetToken = createPasswordResetToken(user.id);
  const resetLink = `/password-reset/${resetToken.token}`;

  logEvent("password_reset_request", {
    email: user.email,
    userId: user.id,
    success: true,
    resetToken: resetToken.token,
    resetLink,
  });

  res.type("html").send(renderPasswordResetRequestPage(resetLink));
});

router.get("/password-reset/:token", (req, res) => {
  const token = String(req.params.token ?? "");
  const resetToken = findPasswordResetToken(token);

  if (!resetToken) {
    res.status(404).type("html").send(renderPasswordResetForm(token, "Reset link not found"));
    return;
  }

  res.type("html").send(renderPasswordResetForm(token));
});

router.post("/password-reset/:token", (req, res) => {
  const token = String(req.params.token ?? "");
  const password = String(req.body.password ?? "");
  const resetToken = findPasswordResetToken(token);

  if (!resetToken) {
    res.status(404).type("html").send(renderPasswordResetForm(token, "Reset link not found"));
    return;
  }

  const user = findUserById(resetToken.user_id);
  if (!user) {
    res.status(404).type("html").send(renderPasswordResetForm(token, "Account not found"));
    return;
  }

  if (password.length < 8) {
    res
      .status(400)
      .type("html")
      .send(renderPasswordResetForm(token, "Password must be at least 8 characters"));
    return;
  }

  updateUserPassword(user.id, password);

  res.type("html").send(
    renderPage(
      "Password Reset Complete",
      `
        <nav><a href="/">Back to store</a></nav>
        <h1>Password Reset Complete</h1>
        <p class="subtitle">The password for <strong>${user.email}</strong> has been changed.</p>
        <p class="auth-link"><a href="/login">Log in with the new password</a></p>
      `,
    ),
  );
});

function renderLoginPage(error?: string, returnTo: string = "/"): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  return renderPage(
    "Log In",
    `
      <nav><a href="/">Back to store</a></nav>
      <h1>Log In</h1>
      ${errorMessage}
      <form method="post" action="/login" class="auth-form">
        <input name="returnTo" type="hidden" value="${returnTo}">
        <label>
          Email
          <input name="email" type="email" required autofocus>
        </label>
        <label>
          Password
          <input name="password" type="password" required>
        </label>
        <button type="submit">Log in</button>
      </form>
      <p class="auth-link">New here? <a href="/signup">Create an account</a>.</p>
      <p class="auth-link"><a href="/password-reset">Forgot your password?</a></p>
    `,
  );
}

function renderSignupPage(error?: string): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  return renderPage(
    "Create Account",
    `
      <nav><a href="/">Back to store</a></nav>
      <h1>Create Account</h1>
      ${errorMessage}
      <form method="post" action="/signup" class="auth-form">
        <label>
          Name
          <input name="displayName" type="text" required autofocus>
        </label>
        <label>
          Email
          <input name="email" type="email" required>
        </label>
        <label>
          Password
          <input name="password" type="password" minlength="8" required>
        </label>
        <button type="submit">Create account</button>
      </form>
      <p class="auth-link">Already have an account? <a href="/login">Log in</a>.</p>
    `,
  );
}

function renderPasswordResetRequestPage(resetLink?: string, error?: string): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";
  const linkMessage = resetLink
    ? `<article class="card"><h2>Reset Link</h2><p>Bear Mail is offline, so here’s the reset link:</p><p><a href="${resetLink}">${resetLink}</a></p></article>`
    : "";

  return renderPage(
    "Reset Password",
    `
      <nav><a href="/login">Back to login</a></nav>
      <h1>Reset Password</h1>
      <p class="subtitle">Enter your email address and Bear Mail will send a reset link.</p>
      ${errorMessage}
      <form method="post" action="/password-reset" class="auth-form">
        <label>
          Email
          <input name="email" type="email" required autofocus>
        </label>
        <button type="submit">Send reset link</button>
      </form>
      ${linkMessage}
    `,
  );
}

function renderPasswordResetForm(token: string, error?: string): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  return renderPage(
    "Choose New Password",
    `
      <nav><a href="/login">Back to login</a></nav>
      <h1>Choose New Password</h1>
      ${errorMessage}
      <form method="post" action="/password-reset/${token}" class="auth-form">
        <label>
          New password
          <input name="password" type="password" minlength="8" required autofocus>
        </label>
        <button type="submit">Reset password</button>
      </form>
    `,
  );
}
