/**
 * PII scrubbing for error reports (P09) – used by the client (`reportError`) AND again by the `/api/v1/log` function
 * (never trust the client). PURE and alias-free: the functions import this file by relative path.
 *
 * Removed: e-mail addresses, JWTs / bearer tokens / Supabase keys, UUIDs, IP addresses, query strings and fragments of
 * URLs (the trades filter lives in the hash), and every number with three or more digits or a decimal part (prices,
 * sizes, P&L – never trade values in a log). Stack line / column numbers (`:12:345`) survive.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}\b/g, "[token]"],
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  [/\bsb_(?:publishable|secret)_[\w-]+/g, "[key]"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  // URL query strings and fragments (keep scheme, host and path)
  [/(\bhttps?:\/\/[^\s?#"')]+)[?#][^\s"')]*/g, "$1"],
  // numbers: ≥ 3 digits or with a decimal part, not a stack line/column (`:12:34`) and not inside a word (`v2`, hashes)
  [/(^|[^:\w.])(?:\d+[.,]\d+(?:[.,]\d+)*|\d{3,})(?![\w])/g, "$1[n]"],
];

/** Scrubs one string and cuts it to `max` characters. */
export function scrubText(input: unknown, max = 2000): string {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Scrubbed stack: at most `lines` lines, `max` characters. */
export function scrubStack(stack: unknown, lines = 30, max = 8000): string | null {
  if (typeof stack !== "string" || !stack.trim()) return null;
  return scrubText(stack.split("\n").slice(0, lines).join("\n"), max);
}

/** `origin + path` of a URL – no query, no fragment, no credentials (`null` for anything unparseable). */
export function scrubUrl(url: unknown, max = 500): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return scrubText(`${u.origin}${u.pathname}`, max);
  } catch {
    return null;
  }
}

/** Plain JSON values of `extra`, scrubbed: strings scrubbed, numbers dropped, depth ≤ 2, ≤ 20 keys. */
export function scrubExtra(extra: unknown, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(extra)) {
    if (n++ >= 20) break;
    const key = scrubText(k, 40);
    if (/secret|password|token|key|auth|cookie|mail|note|reason|pnl|price|size|entry|exit/i.test(key)) continue;
    if (typeof v === "string") out[key] = scrubText(v, 200);
    else if (typeof v === "boolean") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v) && depth < 1) out[key] = scrubExtra(v, depth + 1);
  }
  return out;
}

/** Stable short fingerprint of an error: message without numbers + first stack frame. */
export function errorFingerprint(message: string, stack: string | null): string {
  const frame = (stack ?? "").split("\n").find((l) => /\bat\b|@/.test(l)) ?? "";
  const s = `${message.replace(/\d+/g, "#")}|${frame.replace(/:\d+:\d+/g, "").trim()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `e${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}
