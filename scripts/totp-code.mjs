import crypto from "node:crypto";

const secret = process.argv[2];

if (!secret) {
  process.exit(1);
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let bits = "";

for (const ch of secret.toUpperCase().replace(/=+$/, "")) {
  const index = alphabet.indexOf(ch);
  if (index >= 0) {
    bits += index.toString(2).padStart(5, "0");
  }
}

const bytes = [];
for (let i = 0; i + 8 <= bits.length; i += 8) {
  bytes.push(parseInt(bits.slice(i, i + 8), 2));
}

const counter = Math.floor(Date.now() / 30000);
const counterBuffer = Buffer.alloc(8);
counterBuffer.writeBigUInt64BE(BigInt(counter));

const hmac = crypto.createHmac("sha1", Buffer.from(bytes)).update(counterBuffer).digest();
const offset = hmac[hmac.length - 1] & 0xf;
const binary =
  ((hmac[offset] & 0x7f) << 24) |
  ((hmac[offset + 1] & 0xff) << 16) |
  ((hmac[offset + 2] & 0xff) << 8) |
  (hmac[offset + 3] & 0xff);

const code = String(binary % 1000000).padStart(6, "0");

process.stdout.write(code);
