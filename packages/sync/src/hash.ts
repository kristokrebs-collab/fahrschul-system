import { sha256Hex } from "./crypto.js";

/**
 * PROMPT -1 §8 – Pflichtfeld "Request-Hash".
 *
 * Die Kanonisierung ist ABSICHTLICH zeichengleich mit
 * `apps/api/src/lib/idempotency.ts` (`canonicalize`): Objektschlüssel
 * sortiert, `idempotencyKey` entfernt, `Date` als ISO-String. Nur dann
 * bedeutet "gleicher Hash" auf beiden Seiten dasselbe, und nur dann kann der
 * Client vor dem Senden feststellen, ob ein gespeicherter Vorgang mit einer
 * inzwischen GEÄNDERTEN Nutzlast erneut abgeschickt würde – was serverseitig
 * ein 409 `idempotency_key_conflict` wäre.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== "idempotencyKey")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(operation: string, target: string, body: unknown): Promise<string> {
  return sha256Hex(`${operation} ${target} ${canonicalize(body)}`);
}
