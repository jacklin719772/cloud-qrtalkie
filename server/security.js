import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password, passwordHash) {
  const [method, salt, storedKey] = passwordHash.split(":");
  if (method !== "scrypt" || !salt || !storedKey) return false;

  const derivedKey = await scrypt(password, salt, 64);
  const storedBuffer = Buffer.from(storedKey, "hex");
  return storedBuffer.length === derivedKey.length && timingSafeEqual(storedBuffer, derivedKey);
}

export function createEmailToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function createSessionToken() {
  return createEmailToken();
}

export function createNumericCode() {
  return String(randomInt(100000, 1000000));
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
