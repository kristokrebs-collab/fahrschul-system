import { createHash } from "node:crypto";

/**
 * PROMPT -1 §12 – Datei- und Dokumentuploads: Prüfung des TATSÄCHLICHEN
 * Dateityps, nicht des behaupteten.
 *
 * ## Was vorher fehlte
 *
 * `routes/documents.ts` prüfte `file.mimetype` – das ist der Wert aus dem
 * `Content-Type` des Multipart-Teils, also **ein Feld, das der Client frei
 * setzt**. Eine `.exe` mit `Content-Type: image/png` kam durch. Der
 * Mock-Malware-Scanner meldet zusätzlich immer "sauber", also gab es keine
 * zweite Instanz, die es gemerkt hätte.
 *
 * ## Was jetzt geprüft wird, in dieser Reihenfolge
 *
 *  1. Größe (0 < n <= Grenze) – vor allem anderen, damit ein 500-MB-Upload
 *     nicht erst gehasht wird.
 *  2. Behaupteter MIME-Typ gegen die Allowlist.
 *  3. **Magic Bytes**: der erkannte Typ wird aus dem Dateikopf bestimmt.
 *  4. Der erkannte Typ muss (a) auf der Allowlist stehen UND (b) zum
 *     behaupteten passen. Ein Widerspruch ist ein FEHLER, kein Hinweis:
 *     eine Datei, die über ihren Typ lügt, wird abgewiesen (415).
 *  5. SHA-256 über den Inhalt – als Prüfsumme in der Datenbank und für die
 *     Idempotenzprüfung (derselbe Schlüssel + andere Datei = Konflikt).
 *
 * ## Warum keine Bibliothek (file-type/mmmagic)
 *
 * Der erlaubte Typenraum ist DREI Formate (JPEG, PNG, PDF). Eine Bibliothek
 * mit 400 Signaturen erhöht die Angriffsfläche und die Abhängigkeitslast, ohne
 * hier etwas zu können, was diese Datei nicht kann. Die Signaturen sind
 * kurz, öffentlich dokumentiert und einzeln getestet.
 */

export const ALLOWED_DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Signaturen. Bewusst als Byte-Präfixe (nicht als Regex über einen
 * String-Cast), weil eine Binärdatei in einer Zeichenkette je nach Kodierung
 * mutiert.
 */
const SIGNATURES: ReadonlyArray<{
  mime: AllowedDocumentMime;
  prefix: readonly number[];
  /** Zusätzliche Bedingung, falls das Präfix nicht ausreicht. */
  extra?: (buffer: Buffer) => boolean;
}> = [
  // JPEG: FF D8 FF (SOI + erster Marker)
  { mime: "image/jpeg", prefix: [0xff, 0xd8, 0xff] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png", prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // PDF: %PDF-
  { mime: "application/pdf", prefix: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/**
 * Typen, die AKTIV als gefährlich erkannt und benannt werden. Sie sind ohnehin
 * nicht auf der Allowlist – aber "erkannt als ausführbare Datei" ist eine
 * bessere Fehlermeldung und ein besserer Auditeintrag als "unbekannter Typ".
 */
const DANGEROUS_SIGNATURES: ReadonlyArray<{ label: string; prefix: readonly number[] }> = [
  { label: "windows-executable", prefix: [0x4d, 0x5a] }, // MZ (PE/DOS)
  { label: "elf-executable", prefix: [0x7f, 0x45, 0x4c, 0x46] }, // ELF
  { label: "mach-o-executable", prefix: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: "java-class", prefix: [0xca, 0xfe, 0xba, 0xbe] },
  { label: "zip-or-office-container", prefix: [0x50, 0x4b, 0x03, 0x04] }, // PK.. (auch docx/xlsx/jar)
  { label: "shell-script", prefix: [0x23, 0x21] }, // #!
];

function startsWith(buffer: Buffer, prefix: readonly number[]): boolean {
  if (buffer.byteLength < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (buffer[i] !== prefix[i]) return false;
  }
  return true;
}

export interface SniffResult {
  /** Erkannter Typ oder null. */
  mime: AllowedDocumentMime | null;
  /** Bezeichnung eines erkannten, aber unerwünschten Typs. */
  dangerous: string | null;
}

export function sniffMimeType(buffer: Buffer): SniffResult {
  for (const signature of SIGNATURES) {
    if (startsWith(buffer, signature.prefix) && (signature.extra?.(buffer) ?? true)) {
      return { mime: signature.mime, dangerous: null };
    }
  }
  for (const bad of DANGEROUS_SIGNATURES) {
    if (startsWith(buffer, bad.prefix)) return { mime: null, dangerous: bad.label };
  }
  // HTML/SVG erkennt man nicht an Magic Bytes, aber an einem Präfix nach
  // Whitespace. Beide sind aktive Inhalte (Skript!) und müssen benannt werden.
  const head = buffer.subarray(0, 256).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return { mime: null, dangerous: "svg-or-xml" };
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    return { mime: null, dangerous: "html" };
  }
  return { mime: null, dangerous: null };
}

export type FileValidationError =
  | "empty"
  | "too_large"
  | "declared_type_not_allowed"
  | "detected_type_not_allowed"
  | "type_mismatch"
  | "checksum_mismatch";

export interface FileValidationResult {
  ok: boolean;
  error?: FileValidationError;
  /** Für die Fehlermeldung/Quarantänebegründung. */
  detail?: string;
  declaredMime: string;
  detectedMime: AllowedDocumentMime | null;
  dangerous: string | null;
  sizeBytes: number;
  checksumSha256: string;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Vollständige Prüfung. Liefert IMMER die Metadaten mit (Prüfsumme, Größe,
 * erkannter Typ), auch im Fehlerfall – die Ablehnung soll auditierbar sein,
 * nicht nur abgewiesen.
 */
export function validateUpload(input: {
  buffer: Buffer;
  declaredMime: string;
  maxBytes?: number;
  /** Optional vom Client angekündigte Prüfsumme (resumable Upload). */
  expectedChecksum?: string | null;
  /** Erlaubte Typen; Standard ist die Dokument-Allowlist. */
  allowed?: readonly string[];
}): FileValidationResult {
  const maxBytes = input.maxBytes ?? MAX_DOCUMENT_BYTES;
  const allowed = input.allowed ?? ALLOWED_DOCUMENT_MIME_TYPES;
  const sizeBytes = input.buffer.byteLength;
  const sniffed = sniffMimeType(input.buffer);
  const checksumSha256 = sizeBytes > 0 ? sha256(input.buffer) : "";

  const base = {
    declaredMime: input.declaredMime,
    detectedMime: sniffed.mime,
    dangerous: sniffed.dangerous,
    sizeBytes,
    checksumSha256,
  };

  if (sizeBytes === 0) return { ok: false, error: "empty", ...base };
  if (sizeBytes > maxBytes) {
    return { ok: false, error: "too_large", detail: `${sizeBytes} > ${maxBytes}`, ...base };
  }
  if (input.expectedChecksum && input.expectedChecksum !== checksumSha256) {
    return {
      ok: false,
      error: "checksum_mismatch",
      detail: "Angekündigte Prüfsumme stimmt nicht mit dem empfangenen Inhalt überein.",
      ...base,
    };
  }
  if (!allowed.includes(input.declaredMime)) {
    return { ok: false, error: "declared_type_not_allowed", detail: input.declaredMime, ...base };
  }
  if (!sniffed.mime) {
    return {
      ok: false,
      error: "detected_type_not_allowed",
      detail: sniffed.dangerous
        ? `Inhalt wurde als "${sniffed.dangerous}" erkannt`
        : "Inhalt entspricht keinem erlaubten Format (Magic Bytes)",
      ...base,
    };
  }
  if (sniffed.mime !== input.declaredMime) {
    return {
      ok: false,
      error: "type_mismatch",
      detail: `behauptet "${input.declaredMime}", erkannt "${sniffed.mime}"`,
      ...base,
    };
  }
  return { ok: true, ...base };
}

/** HTTP-Status je Fehlerart – zentral, damit alle Uploadpfade gleich antworten. */
export function statusForValidationError(error: FileValidationError): number {
  switch (error) {
    case "empty":
      return 400;
    case "too_large":
      return 413;
    case "checksum_mismatch":
      return 422;
    default:
      return 415;
  }
}
