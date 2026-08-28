type FulfillmentRequest = {
  name: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
};

type FulfillmentOptions = {
  delayMs: number;
  signal?: AbortSignal;
};

type FulfillmentTimeoutOptions = {
  delayMs: number;
  timeoutMs?: number;
};

export async function reserveAcornFulfillment(
  request: FulfillmentRequest,
  options: FulfillmentOptions,
): Promise<{ reservationId: string }> {
  const delayMs = options.delayMs;
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Invalid Acorn fulfillment delay");
  }

  await waitForFulfillment(delayMs, options.signal);
  return {
    reservationId: `acorn-${request.postalCode.toLowerCase()}`,
  };
}

export function reserveAcornFulfillmentWithTimeout(
  request: FulfillmentRequest,
  options: FulfillmentTimeoutOptions,
): Promise<{ reservationId: string }> {
  const timeoutMs = options.timeoutMs ?? 500;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid Acorn fulfillment timeout");
  }

  const fulfillmentOptions: FulfillmentOptions = {
    delayMs: options.delayMs,
    signal: AbortSignal.timeout(timeoutMs),
  };

  return reserveAcornFulfillment(request, fulfillmentOptions);
}

export function isAcornFulfillmentTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function waitForFulfillment(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, delayMs);

    function finish(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}
