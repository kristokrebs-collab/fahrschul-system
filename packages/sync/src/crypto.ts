import type { KeyValueStore } from "./store.js";

/**
 * PROMPT -1 §7 – "Entwürfe werden lokal VERSCHLÜSSELT gespeichert."
 *
 * ## Was das hier leistet – und was ausdrücklich nicht
 *
 * Umgesetzt ist AES-256-GCM (WebCrypto) mit einem zufälligen 256-Bit-Schlüssel
 * je Gerät und Benutzer und einem frischen 96-Bit-IV je Datensatz. Der
 * Klartext eines Entwurfs (Fahrstundenbericht, Mangelmeldung,
 * Selbsteinschätzung) liegt damit NICHT im Klartext im Browser-Speicher.
 *
 * **Geschützt wird gegen:** Einblick in `localStorage` über die
 * Entwicklerwerkzeuge auf einem geteilten Gerät, Profil-/Backup-Kopien der
 * Browserdaten, versehentliches Mitschreiben des Speichers in Fehlerberichten
 * oder Support-Exporten.
 *
 * **NICHT geschützt wird gegen:** einen Angreifer, der auf diesem Origin
 * JavaScript ausführen kann (XSS). Er kann den Schlüssel genauso lesen wie die
 * App. Das ist keine Schwäche DIESER Umsetzung, sondern eine Eigenschaft jeder
 * rein clientseitigen Verschlüsselung ohne zweiten Faktor: irgendwo muss der
 * Schlüssel für die App erreichbar sein. Wer etwas anderes behauptet,
 * beschreibt die Lage falsch.
 *
 * **SEAM Phase 3 (§17 Step-up-Auth):** `deriveKeyFromPassphrase` existiert
 * bereits und leitet den Schlüssel per PBKDF2 aus einer Eingabe ab, statt ihn
 * abzulegen. Sobald es eine Step-up-Authentisierung gibt, wird der
 * Geräteschlüssel damit gewrappt und ist ohne Benutzereingabe nicht mehr
 * benutzbar. Ohne Step-up-Auth wäre die Funktion heute nur Theater –
 * deshalb ist sie vorhanden, aber nicht verdrahtet.
 *
 * Zusätzlich gilt (§8): der Schlüssel ist an den BENUTZER gebunden. Nach einem
 * Benutzerwechsel auf demselben Gerät sind die Entwürfe des Vorgängers nicht
 * entschlüsselbar – `reconcile()` erkennt das als Identitätswechsel und
 * sendet sie NIEMALS unter der neuen Identität.
 */

export interface EncryptedBlob {
  /** Format-Version, damit ein späterer Algorithmuswechsel migrierbar bleibt. */
  v: 1;
  /** Initialisierungsvektor, base64. */
  iv: string;
  /** Geheimtext inkl. GCM-Tag, base64. */
  ct: string;
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EncryptedBlob).v === 1 &&
    typeof (value as EncryptedBlob).iv === "string" &&
    typeof (value as EncryptedBlob).ct === "string"
  );
}

export class DecryptionError extends Error {
  constructor(message = "Entwurf konnte nicht entschlüsselt werden") {
    super(message);
    this.name = "DecryptionError";
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "WebCrypto (crypto.subtle) ist nicht verfügbar – Entwürfe können nicht verschlüsselt gespeichert werden.",
    );
  }
  return c.subtle;
}

/**
 * Explizit über einen eigenen `ArrayBuffer` konstruierte Ansichten. Nötig,
 * weil `Uint8Array<ArrayBufferLike>` seit TS 5.7 nicht mehr als `BufferSource`
 * gilt (ein `SharedArrayBuffer` wäre nicht erlaubt).
 */
function neueBytes(laenge: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(laenge));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = neueBytes(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const KEY_PREFIX = "draftkey:";

/**
 * Lädt (oder erzeugt) den Entwurfsschlüssel für einen Benutzer auf diesem
 * Gerät. Der Schlüssel ist NICHT exportierbar markiert, sobald er importiert
 * ist – das Rohmaterial liegt allerdings im Store, siehe Bedrohungsmodell oben.
 */
export async function loadDraftKey(store: KeyValueStore, benutzerId: string): Promise<CryptoKey> {
  const storageKey = KEY_PREFIX + benutzerId;
  let raw = store.get(storageKey);
  if (!raw) {
    const bytes = neueBytes(32);
    globalThis.crypto.getRandomValues(bytes);
    raw = toBase64(bytes);
    store.set(storageKey, raw);
  }
  return subtle().importKey("raw", fromBase64(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Verwirft den Entwurfsschlüssel eines Benutzers. Wird beim Abmelden
 * aufgerufen: danach sind zurückgebliebene Entwürfe kryptografisch
 * unlesbar – "Abmelden" löscht damit wirksam, auch wenn eine Zeile
 * physisch übrig bleibt.
 */
export function forgetDraftKey(store: KeyValueStore, benutzerId: string): void {
  store.remove(KEY_PREFIX + benutzerId);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = neueBytes(12);
  globalThis.crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(JSON.stringify(value ?? null));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, data);
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(blob.iv) },
      key,
      fromBase64(blob.ct),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch (err) {
    // GCM schlägt bei falschem Schlüssel ODER manipulierten Daten fehl. Beide
    // Fälle sind derselbe: der Entwurf ist nicht vertrauenswürdig und wird
    // NICHT gesendet.
    throw new DecryptionError((err as Error)?.message);
  }
}

/**
 * SEAM Phase 3 (§17): Schlüsselableitung aus einer Benutzereingabe statt
 * Ablage im Store. Vorhanden und getestet, aber absichtlich nicht verdrahtet –
 * ohne Step-up-Authentisierung gäbe es keine Eingabe, aus der abzuleiten wäre.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = 210_000,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** SHA-256 als Hex – Grundlage des §8-Pflichtfelds "Request-Hash". */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
