const { startAuthentication, startRegistration } = window.SimpleWebAuthnBrowser;

function showPasskeyError(messageAreaId, message) {
  const messageArea = document.getElementById(messageAreaId);
  if (!messageArea) return;

  const errorParagraph = document.createElement("p");
  errorParagraph.className = "error";
  errorParagraph.textContent = message;
  messageArea.replaceChildren(errorParagraph);
}

// ── Passkey login ─────────────────────────────────────────────────────────────

const loginBtn = document.getElementById("passkey-login-btn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    loginBtn.disabled = true;
    loginBtn.textContent = "Waiting for passkey…";

    try {
      const beginRes = await fetch("/auth/passkey/begin", { method: "POST" });
      if (!beginRes.ok) throw new Error("Failed to start passkey login");
      const { challengeId, publicKey } = await beginRes.json();

      const assertion = await startAuthentication({ optionsJSON: publicKey });

      const returnTo = loginBtn.dataset.returnTo ?? "/";

      const verifyRes = await fetch("/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, returnTo, ...assertion }),
        redirect: "follow",
      });

      if (verifyRes.redirected) {
        window.location.href = verifyRes.url;
      } else if (!verifyRes.ok) {
        const text = await verifyRes.text();
        document.open();
        document.write(text);
        document.close();
      }
    } catch (err) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in with passkey";
      const msg = err instanceof Error ? err.message : "Unknown error";
      showPasskeyError("passkey-login-message", msg);
    }
  });
}

// ── Passkey registration ──────────────────────────────────────────────────────

const registerBtn = document.getElementById("passkey-register-btn");
const passkeyManagementLoginUrl = "/login?returnTo=%2Faccount%2Fpasskey";
if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    registerBtn.disabled = true;
    registerBtn.textContent = "Waiting for passkey…";

    try {
      const beginRes = await fetch("/account/passkey/begin", {
        method: "POST",
      });
      if (beginRes.status === 401 || beginRes.status === 403) {
        window.location.href = passkeyManagementLoginUrl;
        return;
      }
      if (!beginRes.ok) throw new Error("Failed to start passkey registration");
      const { challengeId, publicKey } = await beginRes.json();

      const credential = await startRegistration({ optionsJSON: publicKey });

      const verifyRes = await fetch("/account/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, ...credential }),
        redirect: "follow",
      });

      if (verifyRes.status === 401 || verifyRes.status === 403) {
        window.location.href = passkeyManagementLoginUrl;
      } else if (verifyRes.redirected) {
        window.location.href = verifyRes.url;
      } else if (!verifyRes.ok) {
        const text = await verifyRes.text();
        document.open();
        document.write(text);
        document.close();
      }
    } catch (err) {
      registerBtn.disabled = false;
      registerBtn.textContent = "Register new passkey";
      const msg = err instanceof Error ? err.message : "Unknown error";
      showPasskeyError("passkey-register-message", msg);
    }
  });
}
