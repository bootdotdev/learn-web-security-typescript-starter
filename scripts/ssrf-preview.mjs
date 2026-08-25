import { fetchRemoteImagePreview } from "../src/integrations/remoteImagePreview.ts";

const webpFixture = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function makeResponse(url, { status = 200, body = webpFixture, onBodyRead } = {}) {
  const encodedBody = typeof body === "string" ? new TextEncoder().encode(body) : body;
  let bodyRead = false;

  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "content-type": "image/webp" }),
    body: {
      getReader() {
        return {
          async read() {
            if (bodyRead) {
              return { done: true };
            }

            bodyRead = true;
            onBodyRead?.();
            return { done: false, value: encodedBody };
          },
          async cancel() {
            bodyRead = true;
          },
          releaseLock() {},
        };
      },
    },
  };
}

async function probeRejectedUrl(imageUrl) {
  let fetchCalled = false;
  let rejected = false;

  try {
    await fetchRemoteImagePreview(imageUrl, 1024 * 1024, async (input) => {
      fetchCalled = true;
      return makeResponse(String(input));
    });
  } catch {
    rejected = true;
  }

  return { rejected, fetchCalled };
}

async function probeApprovedUrl(imageUrl) {
  let fetchCalled = false;
  let timeoutMilliseconds = null;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    timeoutMilliseconds = milliseconds;
    return originalTimeout(milliseconds);
  };

  let result;
  try {
    result = await fetchRemoteImagePreview(imageUrl, 1024 * 1024, async (input) => {
      fetchCalled = true;
      return makeResponse(String(input));
    });
  } finally {
    AbortSignal.timeout = originalTimeout;
  }

  return {
    fetched: fetchCalled,
    timeoutMilliseconds,
    preview:
      result.contentType === "image/webp" && result.byteLength === webpFixture.byteLength
        ? "approved image"
        : null,
    contentType: result.contentType,
    byteLength: result.byteLength,
  };
}

const approvedUrl =
  "https://storage.googleapis.com/qvault-webapp-dynamic-assets/course_assets/zBWqBYp-540x720.jpg";

let redirectMode;
let redirectBodyRead = false;
let redirectRejected = false;

try {
  await fetchRemoteImagePreview(approvedUrl, 1024 * 1024, async (input, init) => {
    redirectMode = init?.redirect;
    return makeResponse(String(input), {
      status: 302,
      body: "internal redirect response",
      onBodyRead() {
        redirectBodyRead = true;
      },
    });
  });
} catch {
  redirectRejected = true;
}

console.log(
  JSON.stringify({
    approved: await probeApprovedUrl(approvedUrl),
    unapprovedHost: await probeRejectedUrl("https://cdn.example.com/teddy.webp"),
    malformed: await probeRejectedUrl("not a valid URL"),
    credentials: await probeRejectedUrl(
      "https://preview-user:preview-password@storage.googleapis.com/teddy.webp",
    ),
    insecureScheme: await probeRejectedUrl("http://storage.googleapis.com/teddy.webp"),
    suffixHost: await probeRejectedUrl("https://storage.googleapis.com.attacker.test/teddy.webp"),
    loopback: await probeRejectedUrl("https://127.0.0.1:3000/health"),
    nonDefaultPort: await probeRejectedUrl("https://storage.googleapis.com:8443/teddy.webp"),
    redirect: {
      rejected: redirectRejected,
      mode: redirectMode ?? null,
      bodyRead: redirectBodyRead,
    },
  }),
);
