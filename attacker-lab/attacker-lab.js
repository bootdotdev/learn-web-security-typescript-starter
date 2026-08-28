const targetForm = document.querySelector("#target-form");
const targetInput = document.querySelector("#target-origin");
const targetStatus = document.querySelector("#target-status");
const csrfForm = document.querySelector("#csrf-form");
const csrfStatus = document.querySelector("#csrf-status");
const sopButton = document.querySelector("#sop-button");
const sopOutput = document.querySelector("#sop-output");
const corsButton = document.querySelector("#cors-button");
const corsOutput = document.querySelector("#cors-output");
const clickjackingFrame = document.querySelector("#clickjacking-frame");
const csrfButton = csrfForm.querySelector("button");
let targetOrigin;

function setOutput(element, message, state) {
  element.textContent = message;
  element.dataset.state = state;
}

function resetResults() {
  for (const output of [sopOutput, corsOutput]) {
    output.textContent = "Not run yet.";
    delete output.dataset.state;
  }
  csrfStatus.textContent = "";
  delete csrfStatus.dataset.state;
}

function setLabControlsDisabled(disabled) {
  csrfButton.disabled = disabled;
  sopButton.disabled = disabled;
  corsButton.disabled = disabled;
}

function updateTargets() {
  try {
    const target = new URL(targetInput.value);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("The target must use HTTP or HTTPS.");
    }

    targetOrigin = target.origin;
    csrfForm.action = `${targetOrigin}/cart/items`;
    clickjackingFrame.src = `${targetOrigin}/account`;
    setLabControlsDisabled(false);
    resetResults();
    setOutput(targetStatus, `Targeting ${targetOrigin}`, "success");
  } catch (error) {
    targetOrigin = undefined;
    csrfForm.removeAttribute("action");
    clickjackingFrame.src = "about:blank";
    setLabControlsDisabled(true);
    resetResults();
    const message = error instanceof Error ? error.message : "Invalid target.";
    setOutput(targetStatus, message, "error");
  }
}

targetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateTargets();
});

targetInput.addEventListener("input", () => {
  setOutput(
    targetStatus,
    targetOrigin
      ? `Changes are not applied. Still targeting ${targetOrigin}.`
      : "Select Update target to apply this value.",
    "pending",
  );
});

csrfForm.addEventListener("submit", () => {
  setOutput(
    csrfStatus,
    "Request submitted. Check your Bearly Secure cart to confirm the effect.",
    "success",
  );
});

sopButton.addEventListener("click", async () => {
  setOutput(sopOutput, "Requesting the account page...", "pending");
  sopButton.disabled = true;
  const requestedOrigin = targetOrigin;

  try {
    const response = await fetch(`${requestedOrigin}/account`, {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    if (requestedOrigin !== targetOrigin) {
      return;
    }
    setOutput(
      sopOutput,
      `The response was readable (HTTP ${response.status}).\n\n${body.slice(0, 800)}`,
      "warning",
    );
  } catch {
    if (requestedOrigin !== targetOrigin) {
      return;
    }
    setOutput(
      sopOutput,
      "Not readable. If Bearly Secure is running, the browser blocked this origin from reading the account page response.",
      "success",
    );
  } finally {
    sopButton.disabled = targetOrigin === undefined;
  }
});

corsButton.addEventListener("click", async () => {
  setOutput(corsOutput, "Requesting the account API...", "pending");
  corsButton.disabled = true;
  const requestedOrigin = targetOrigin;

  try {
    const response = await fetch(`${requestedOrigin}/api/account/orders`, {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    if (requestedOrigin !== targetOrigin) {
      return;
    }
    setOutput(
      corsOutput,
      `Readable response (HTTP ${response.status}):\n\n${body.slice(0, 1_500)}`,
      "warning",
    );
  } catch {
    if (requestedOrigin !== targetOrigin) {
      return;
    }
    setOutput(
      corsOutput,
      "Not readable. If Bearly Secure is running, the browser blocked this origin from reading the account API response.",
      "success",
    );
  } finally {
    corsButton.disabled = targetOrigin === undefined;
  }
});

updateTargets();
