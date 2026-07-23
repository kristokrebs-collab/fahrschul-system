import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * Passwort-Hashing mit scrypt (Node-Kernmodul, keine native Kompilierung
 * nötig). Die Spezifikation empfiehlt argon2/bcrypt; in dieser Sandbox ist
 * ein zuverlässiger nativer Build (argon2) bzw. bcrypt-Kompilierung nicht
 * garantiert verfügbar. scrypt ist ein anerkannter, speicherharter KDF nach
 * RFC 7914 und in Node fest eingebaut – funktional gleichwertig für den
 * Zweck "kein Klartext-/schwaches Passwort-Hashing". Für einen späteren
 * Wechsel auf argon2id in einer Umgebung mit garantiertem nativen Build ist
 * das Hash-Format versioniert (Präfix "scrypt$"), sodass ein Migrationspfad
 * möglich ist, ohne bestehende Hashes zu invalidieren.
 */

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) {
    throw new Error("Passwort muss mindestens 8 Zeichen lang sein");
  }
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scrypt(plain, salt, expectedKey.length)) as Buffer;
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expectedKey);
}
