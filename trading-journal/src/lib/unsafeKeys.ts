/**
 * Object keys that must never be copied from imported JSON into a plain object: `out[k] = v` with `k === "__proto__"`
 * calls the prototype setter, so a backup could hand the record attacker-chosen inherited defaults. `JSON.parse`
 * makes `__proto__` an OWN property of the parsed value, which is exactly what makes `out[k] = …` and a recursive
 * merge dangerous. Used by the backup import (`store/backup.ts`) and the playbook check.
 */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export const isUnsafeKey = (k: string): boolean => UNSAFE_KEYS.has(k);

/** Matches text that may contain such a key; a cheap pre-check so ordinary files are parsed without a reviver. */
const MAY_HAVE_UNSAFE_KEY = /__proto__|"constructor"|"prototype"/;

/**
 * `JSON.parse` that drops every unsafe key at any depth (the value is gone, not renamed). Text without any of the
 * three words takes the plain, fast path. Throws like `JSON.parse` on invalid JSON.
 */
export function parseJsonSafe(text: string): unknown {
  return MAY_HAVE_UNSAFE_KEY.test(text) ? JSON.parse(text, (k, v: unknown) => (UNSAFE_KEYS.has(k) ? undefined : v)) : JSON.parse(text);
}
