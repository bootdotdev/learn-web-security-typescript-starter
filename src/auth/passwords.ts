import { createHash, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const candidate = hashPassword(password);

  if (!/^[a-f0-9]{64}$/i.test(passwordHash)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(passwordHash, "hex"));
}
