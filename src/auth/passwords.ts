import { hash, timingSafeEqual } from "node:crypto";

export const MAX_PASSWORD_LENGTH = 128;
const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function hashPassword(password: string): string {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`,
    );
  }

  return hash("sha256", password, "hex");
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): boolean {
  if (password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }

  if (!LEGACY_SHA256_PATTERN.test(passwordHash)) {
    return false;
  }

  const candidateHash = Buffer.from(hashPassword(password), "hex");
  const storedHash = Buffer.from(passwordHash, "hex");
  return timingSafeEqual(candidateHash, storedHash);
}
