import { createSignedDownloadPath, verifySignedDownload } from "../src/uploads/signedDownloads.ts";

const signingKey = Buffer.alloc(32, 1);
const signedPath = createSignedDownloadPath(signingKey, 1, 1000);
const url = new URL(signedPath, "http://localhost");
const expires = url.searchParams.get("expires") ?? "";
const signature = url.searchParams.get("signature") ?? "";

console.log(
  JSON.stringify({
    validBeforeExpiration: verifySignedDownload(signingKey, 1, expires, signature, 1299),
    rejectedAfterExpiration: !verifySignedDownload(signingKey, 1, expires, signature, 1301),
    malformedExpirationRejected: !verifySignedDownload(
      signingKey,
      1,
      "not-a-timestamp",
      signature,
      1000,
    ),
    malformedSignatureRejected: !verifySignedDownload(
      signingKey,
      1,
      expires,
      "not-a-signature",
      1000,
    ),
  }),
);
