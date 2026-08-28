const postalCodeInput = document.querySelector("#postal-code");
const estimateButton = document.querySelector("#estimate-button");
const estimateOutput = document.querySelector("#estimate-output");
const hostAccess = document.querySelector("#host-access");

if (
  postalCodeInput instanceof HTMLInputElement &&
  estimateButton instanceof HTMLButtonElement &&
  estimateOutput instanceof HTMLParagraphElement
) {
  estimateButton.addEventListener("click", () => {
    const postalCode = postalCodeInput.value.trim();
    estimateOutput.textContent = postalCode
      ? `Estimated delivery to ${postalCode}: 3–5 business days`
      : "Enter a postal code to estimate delivery.";
  });
}

if (hostAccess instanceof HTMLParagraphElement) {
  try {
    void window.parent.document.title;
    hostAccess.textContent = "Host access: available";
    hostAccess.dataset.access = "available";
  } catch {
    hostAccess.textContent = "Host access: blocked";
    hostAccess.dataset.access = "blocked";
  }
}
