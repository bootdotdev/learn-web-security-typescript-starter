import crypto from "node:crypto";

const challenge = process.argv[2];
const baseURL = process.argv[3] ?? "http://localhost:3000";
const configuredRPID = process.argv[4];
const mode = process.argv[5];
const userVerified = mode !== "no-uv";
const badSignature = mode === "bad-sig";

if (!challenge) {
  process.exit(1);
}

const parsedBaseURL = new URL(baseURL);
const rpID = configuredRPID ?? parsedBaseURL.hostname;
const origin = parsedBaseURL.origin;
const privateKeyB64 =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgfZz8HHXgNEigLYw+NSxsZ15rlOWCsL62wKoMBtOYusmhRANCAAR3iqSaGS3AlikcaUNgzM4y2IXu9/ETjC3lOwASEs3SSW2Fb74iCs/8xqjomTmEPvR1n41oFnU5Uu4g5qwdYTsx";

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privateKeyB64, "base64"),
  format: "der",
  type: "pkcs8",
});

const rpIdHash = crypto.hash("sha256", rpID, "buffer");
const flags = Buffer.from([userVerified ? 0x05 : 0x01]);
const counter = Buffer.alloc(4);
const authData = Buffer.concat([rpIdHash, flags, counter]);

const clientData = {
  type: "webauthn.get",
  challenge,
  origin,
  crossOrigin: false,
};
const clientDataJSON = Buffer.from(JSON.stringify(clientData));
const clientDataHash = crypto.hash("sha256", clientDataJSON, "buffer");

const sigBase = badSignature
  ? Buffer.concat([authData, Buffer.alloc(clientDataHash.length)])
  : Buffer.concat([authData, clientDataHash]);
const signature = crypto.sign("SHA256", sigBase, {
  key: privateKey,
  dsaEncoding: "der",
});

console.log(`authenticatorData=${authData.toString("base64url")}`);
console.log(`clientDataJSON=${clientDataJSON.toString("base64url")}`);
console.log(`signature=${signature.toString("base64url")}`);
