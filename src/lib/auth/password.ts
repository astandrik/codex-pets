import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;

function getPasswordPepper(): string {
  const pepper = process.env.PASSWORD_PEPPER?.trim();
  if (!pepper) {
    throw new Error("PASSWORD_PEPPER is required for app-session auth.");
  }
  return pepper;
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const peppered = `${password}${getPasswordPepper()}`;
  const derived = (await scrypt(peppered, salt, KEY_LENGTH)) as Buffer;
  return `${HASH_PREFIX}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [prefix, salt, expectedHex] = storedHash.split("$");
  if (prefix !== HASH_PREFIX || !salt || !expectedHex) {
    return false;
  }

  const peppered = `${password}${getPasswordPepper()}`;
  const derived = (await scrypt(peppered, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
