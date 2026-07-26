#!/usr/bin/env node
/**
 * Gibt den aktuell gültigen 6-stelligen TOTP-Code der Mitarbeiter-Testkonten
 * aus dem Seed aus (buero@, fahrlehrer@, finanzen@, leitung@example.test).
 *
 * NUR für lokales manuelles Testen. Das Secret ist das statische
 * Entwicklungs-Secret aus packages/database/src/seed.ts; echte Konten
 * bekommen ihr Secret über den regulären MFA-Einrichtungsweg.
 *
 *   node scripts/dev-totp.mjs          # einmal ausgeben
 *   node scripts/dev-totp.mjs --watch  # bei jedem Wechsel neu ausgeben
 */
import { createHmac } from "node:crypto";

const SECRET = "KREBSDEVTOTPSECRETTESTONLYAAAAAA";
const STEP = 30;
const DIGITS = 6;

/** RFC 4648 base32 → Bytes (ohne Padding, Grossbuchstaben). */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`Ungültiges base32-Zeichen: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP-HMAC-SHA1, identisch zu packages/auth/src/totp.ts. */
function totp(secret, forTime = Date.now()) {
  const counter = Math.floor(forTime / 1000 / STEP);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

function remainingSeconds() {
  return STEP - (Math.floor(Date.now() / 1000) % STEP);
}

function print() {
  console.log(`TOTP: ${totp(SECRET)}   (noch ${remainingSeconds()} s gültig)`);
}

print();

if (process.argv.includes("--watch")) {
  console.log("Beenden mit Strg+C.\n");
  let last = totp(SECRET);
  setInterval(() => {
    const current = totp(SECRET);
    if (current !== last) {
      last = current;
      print();
    }
  }, 1000);
}
