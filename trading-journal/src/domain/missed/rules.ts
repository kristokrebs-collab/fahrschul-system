/**
 * Regelstand (F25/F31): a version for the RULES a signal came from. The app has no „strategy file“ with version numbers for its
 * live checks – the Einstiegs-Check, the Box engine and a key level are settings that can be changed at any time – so a
 * version here is a fingerprint of the settings that change the evaluation, and a running number the app gives each new
 * fingerprint the first time it sees it (per kind, and per level for key levels). The same settings later get the same
 * number again; a changed setting starts the next one. Nothing is inferred about what changed – only THAT it changed, and since
 * when. Pure; the registry lives in the browser (`@/market/ruleVersions`).
 */
import type { RuleRef, SignalSource } from "./archive";

export const RULE_VERSIONS_VERSION = 1;
/** The registry keeps the newest entries of each (kind, scope) and this many in all. */
export const RULE_VERSIONS_CAP = 150;
const PER_SCOPE_CAP = 30;

export const RULE_KIND_LABEL: Readonly<Record<SignalSource, string>> = { entry: "Einstiegs-Check", box: "Box-zu-Box", key: "Schlüsselmarke" };

/** FNV-1a (32 bit) of a string as 8 hex digits – stable, no secret, enough to tell two settings apart. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface RuleVersion {
  kind: SignalSource;
  /** `""` for the Einstiegs-Check and the Box engine, the level id for a key level */
  scope: string;
  hash: string;
  /** running number within (kind, scope), from 1 */
  n: number;
  /** ms the app first saw this fingerprint */
  since: number;
}

const HEX = /^[0-9a-f]{8}$/;
const KINDS: readonly SignalSource[] = ["entry", "box", "key"];

/** The reference to store on a signal, and the registry with the fingerprint added when it is new. */
export function registerRule(items: readonly RuleVersion[], kind: SignalSource, scope: string, hash: string, now: number): { items: RuleVersion[]; ref: RuleRef; added: boolean } {
  const known = items.find((r) => r.kind === kind && r.scope === scope && r.hash === hash);
  if (known) return { items: [...items], ref: { kind, hash, n: known.n, since: known.since }, added: false };
  const n = items.filter((r) => r.kind === kind && r.scope === scope).reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const next = [...items, { kind, scope, hash, n, since: now }];
  return { items: trim(next), ref: { kind, hash, n, since: now }, added: true };
}

/** Keeps the newest entries of each scope and `RULE_VERSIONS_CAP` in all (oldest first dropped). */
function trim(items: RuleVersion[]): RuleVersion[] {
  const count = new Map<string, number>();
  const kept: RuleVersion[] = [];
  for (const r of [...items].sort((a, b) => b.since - a.since)) {
    const k = `${r.kind}|${r.scope}`;
    const c = (count.get(k) ?? 0) + 1;
    count.set(k, c);
    if (c <= PER_SCOPE_CAP) kept.push(r);
  }
  return kept.slice(0, RULE_VERSIONS_CAP).sort((a, b) => a.since - b.since);
}

/** Tolerant read of the stored registry. */
export function parseRuleVersions(raw: unknown): RuleVersion[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const w = raw as { v?: unknown; items?: unknown };
  if (w.v !== RULE_VERSIONS_VERSION || !Array.isArray(w.items)) return [];
  const out: RuleVersion[] = [];
  for (const it of w.items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (!KINDS.includes(o.kind as SignalSource) || typeof o.scope !== "string" || typeof o.hash !== "string" || !HEX.test(o.hash)) continue;
    if (typeof o.n !== "number" || !Number.isFinite(o.n) || o.n < 1 || typeof o.since !== "number" || !Number.isFinite(o.since)) continue;
    out.push({ kind: o.kind as SignalSource, scope: o.scope.slice(0, 80), hash: o.hash, n: Math.round(o.n), since: o.since });
  }
  return trim(out);
}

/** `Einstiegs-Check · Regelstand 3 (a1b2c3d4)` · without a number: `Einstiegs-Check · Regelstand a1b2c3d4`. */
export function ruleLabel(ref: RuleRef): string {
  return `${RULE_KIND_LABEL[ref.kind]} · Regelstand ${ref.n != null ? `${ref.n} (${ref.hash})` : ref.hash}`;
}
