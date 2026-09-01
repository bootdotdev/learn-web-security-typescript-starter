import { Router } from "express";
import type { Dependencies } from "../dependencies.ts";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  hasRecentAuthentication,
  requireAuth,
  requireRecentAuth,
  safeReturnTo,
} from "../auth/accessControl.ts";
import { setSessionCookie } from "../auth/sessionCookies.ts";
import { createSession, getCurrentSession } from "../auth/sessions.ts";
import {
  abandonTotpLoginChallenge,
  clearTotpLoginChallengeCookie,
  getTotpLoginChallengeToken,
} from "../auth/totpLoginChallenges.ts";
import {
  consumeChallenge,
  createChallenge,
  deletePasskeyCredential,
  findPasskeyByCredentialId,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  listPasskeyCredentials,
  rpName,
  storePasskeyCredential,
  updatePasskeyCounter,
  verifyRegistrationResponse,
} from "../auth/passkeys.ts";
import { findUserById } from "../auth/users.ts";
import {
  renderPasskeyLoginPage,
  renderPasskeyManagePage,
} from "../views/passkey.ts";
import { sendErrorPage } from "../errors.ts";
import { logEvent } from "../logger.ts";

type AuthenticationResponseVerifier =
  typeof import("../auth/passkeys.ts").verifyAuthenticationResponse;

export function createPasskeyRouter(deps: Dependencies): Router {
  const { db } = deps;
  const rpOrigin = deps.appOrigin;
  const rpID = new URL(rpOrigin).hostname;
  const router = Router();

  router.get("/auth/passkey", (req, res) => {
    const returnTo = safeReturnTo(req.query.returnTo);
    res.type("html").send(renderPasskeyLoginPage(undefined, returnTo));
  });

  router.post("/auth/passkey/begin", async (_req, res) => {
    const stored = createChallenge(db);

    const options = await generateAuthenticationOptions({
      rpID,
      challenge: isoBase64URL.toBuffer(stored.challenge),
      userVerification: "required",
      allowCredentials: [],
    });

    res.json({ challengeId: stored.id, publicKey: options });
  });

  router.post("/auth/passkey", async (req, res) => {
    const {
      challengeId,
      returnTo: rawReturnTo,
      ...assertionBody
    } = req.body as Record<string, unknown>;
    const returnTo = safeReturnTo(rawReturnTo);

    const stored = consumeChallenge(db, String(challengeId ?? ""));
    if (!stored) {
      res
        .status(400)
        .type("html")
        .send(
          renderPasskeyLoginPage("Challenge expired. Try again.", returnTo),
        );
      return;
    }

    const credentialId =
      typeof assertionBody.id === "string" ? assertionBody.id : undefined;
    if (!credentialId) {
      res
        .status(400)
        .type("html")
        .send(renderPasskeyLoginPage("Invalid passkey response.", returnTo));
      return;
    }

    const credential = findPasskeyByCredentialId(db, credentialId);
    if (!credential) {
      res
        .status(401)
        .type("html")
        .send(renderPasskeyLoginPage("Passkey not recognised.", returnTo));
      return;
    }

    const passkeyVerificationInput = {
      response:
        assertionBody as unknown as Parameters<AuthenticationResponseVerifier>[0]["response"],
      credential: {
        id: credential.credential_id,
        publicKey: isoBase64URL.toBuffer(credential.public_key),
        counter: credential.counter,
        ...(credential.transports
          ? {
              transports: JSON.parse(
                credential.transports,
              ) as AuthenticatorTransport[],
            }
          : {}),
      },
    };

    let verification;
    try {
      verification = {
        verified: false,
        authenticationInfo: {
          newCounter: passkeyVerificationInput.credential.counter,
        },
      };
    } catch (error) {
      logEvent("passkey_login_failed", { credentialId, error: String(error) });
      res
        .status(401)
        .type("html")
        .send(renderPasskeyLoginPage("Passkey verification failed.", returnTo));
      return;
    }

    if (!verification.verified) {
      logEvent("passkey_login_failed", { credentialId });
      res
        .status(401)
        .type("html")
        .send(renderPasskeyLoginPage("Passkey verification failed.", returnTo));
      return;
    }

    updatePasskeyCounter(
      db,
      credential.credential_id,
      verification.authenticationInfo.newCounter,
    );

    const user = findUserById(db, credential.user_id);
    if (!user) {
      res
        .status(500)
        .type("html")
        .send(renderPasskeyLoginPage("User not found.", returnTo));
      return;
    }

    const session = createSession(db, user.id);

    logEvent("passkey_login_success", {
      userId: user.id,
      email: user.email,
      credentialId,
    });

    const totpChallengeToken = getTotpLoginChallengeToken(req.header("cookie"));
    abandonTotpLoginChallenge(db, req.header("cookie"));
    setSessionCookie(res, session);
    if (totpChallengeToken) {
      clearTotpLoginChallengeCookie(res);
    }

    res.redirect(returnTo);
  });

  router.get("/account/passkey", (req, res) => {
    const current = requireAuth(db, req, res);
    if (!current) {
      return;
    }

    const credentials = listPasskeyCredentials(db, current.user.id);
    res
      .type("html")
      .send(renderPasskeyManagePage(credentials, current.user.display_name));
  });

  router.post("/account/passkey/begin", async (req, res) => {
    const current = getCurrentSession(db, req.header("cookie"));
    if (!current) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!hasRecentAuthentication(current)) {
      res
        .status(403)
        .json({ error: "Log in again before registering a passkey" });
      return;
    }

    const existing = listPasskeyCredentials(db, current.user.id);
    const stored = createChallenge(db, current.user.id);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(String(current.user.id)),
      userName: current.user.email,
      userDisplayName: current.user.display_name,
      challenge: isoBase64URL.toBuffer(stored.challenge),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: existing.map((c) => ({
        id: c.credential_id,
        ...(c.transports
          ? { transports: JSON.parse(c.transports) as AuthenticatorTransport[] }
          : {}),
      })),
    });

    res.json({ challengeId: stored.id, publicKey: options });
  });

  router.post("/account/passkey/verify", async (req, res) => {
    const current = getCurrentSession(db, req.header("cookie"));
    if (!current) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!hasRecentAuthentication(current)) {
      res
        .status(403)
        .type("html")
        .send(
          renderPasskeyManagePage(
            listPasskeyCredentials(db, current.user.id),
            current.user.display_name,
            "Log in again before registering a passkey.",
          ),
        );
      return;
    }

    const { challengeId, ...registrationBody } = req.body as Record<
      string,
      unknown
    >;

    const stored = consumeChallenge(db, String(challengeId ?? ""));
    if (!stored || stored.user_id !== current.user.id) {
      res
        .status(400)
        .type("html")
        .send(
          renderPasskeyManagePage(
            listPasskeyCredentials(db, current.user.id),
            current.user.display_name,
            "Challenge expired. Try again.",
          ),
        );
      return;
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: registrationBody as unknown as Parameters<
          typeof verifyRegistrationResponse
        >[0]["response"],
        expectedChallenge: stored.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      logEvent("passkey_registration_failed", {
        userId: current.user.id,
        error: String(error),
      });
      res
        .status(400)
        .type("html")
        .send(
          renderPasskeyManagePage(
            listPasskeyCredentials(db, current.user.id),
            current.user.display_name,
            "Registration failed. Try again.",
          ),
        );
      return;
    }

    if (!verification.verified || !verification.registrationInfo) {
      logEvent("passkey_registration_failed", { userId: current.user.id });
      res
        .status(400)
        .type("html")
        .send(
          renderPasskeyManagePage(
            listPasskeyCredentials(db, current.user.id),
            current.user.display_name,
            "Registration failed. Try again.",
          ),
        );
      return;
    }

    const { credential } = verification.registrationInfo;

    storePasskeyCredential(
      db,
      current.user.id,
      credential.id,
      credential.publicKey,
      credential.counter,
      credential.transports,
    );

    logEvent("passkey_registered", {
      userId: current.user.id,
      email: current.user.email,
      credentialId: credential.id,
    });

    res.redirect("/account/passkey");
  });

  router.post("/account/passkey/:id/delete", (req, res) => {
    const current = requireRecentAuth(db, req, res, "/account/passkey");
    if (!current) {
      return;
    }

    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) {
      sendErrorPage(
        res,
        404,
        "Passkey Not Found",
        "We couldn't find that passkey.",
      );
      return;
    }

    deletePasskeyCredential(db, id, current.user.id);

    logEvent("passkey_deleted", { userId: current.user.id, passkeyId: id });

    res.redirect("/account/passkey");
  });

  return router;
}
