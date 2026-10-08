/**
 * Settings and the phase-2 gate of the Lage-Ampel.
 *
 * Settings live in `settings.signals.lage = { on, mode }` — `settings.signals` is a passthrough object (unknown keys
 * kept by the store, by `sanitizeSignalCfg` and by the settings page's save, which merges over the stored object), so
 * the key is additive: absent = defaults (on, `block`), invalid values fall back to the defaults, unknown keys inside
 * `lage` survive every write.
 */
import { LAGE_STATE_WORD } from "./copy";
import { metSigns } from "./compute";
import type { Lage, LageGate, LageSettings, LageSnapshot, LageState } from "./types";

export const DEFAULT_LAGE_SETTINGS: Readonly<LageSettings> = Object.freeze({ on: true, mode: "block" });

export const LAGE_MODES: readonly LageSettings["mode"][] = ["block", "warn"];
export const LAGE_MODE_TEXT: Readonly<Record<LageSettings["mode"], string>> = {
  block: "Sperre (Signale zählen nur bei Grün)",
  warn: "nur Warnung",
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** `settings.signals` (raw, any shape) → the Lage settings, sanitised. */
export function lageSettingsOf(rawSignals: unknown): LageSettings {
  const l = obj(obj(rawSignals)?.lage);
  if (!l) return { ...DEFAULT_LAGE_SETTINGS };
  return {
    on: typeof l.on === "boolean" ? l.on : DEFAULT_LAGE_SETTINGS.on,
    mode: l.mode === "block" || l.mode === "warn" ? l.mode : DEFAULT_LAGE_SETTINGS.mode,
  };
}

/**
 * `settings.signals` with the Lage settings written: every other key (and every unknown key inside `lage`) kept.
 * Returns the SAME object when nothing changes (no needless store write).
 */
export function withLageSettings(rawSignals: unknown, patch: Partial<LageSettings>): Record<string, unknown> {
  const base = obj(rawSignals) ?? {};
  const prev = obj(base.lage) ?? {};
  const cur = lageSettingsOf(rawSignals);
  const next: LageSettings = {
    on: typeof patch.on === "boolean" ? patch.on : cur.on,
    mode: patch.mode === "block" || patch.mode === "warn" ? patch.mode : cur.mode,
  };
  if (obj(rawSignals) && obj(base.lage) && prev.on === next.on && prev.mode === next.mode) return base;
  return { ...base, lage: { ...prev, on: next.on, mode: next.mode } };
}

const NO_GATE = (state: LageState): LageGate => ({ state, counts: true, blocked: false, label: null });

/**
 * Whether an entry counts under the Lage (phase 2 wiring: the engine's `valid`, notifications, the ladder text).
 * Long entries only — the Lage is the falling-knife protection; a short is never gated.
 * - off, no Lage, `none` (no data) or green → counts, no label;
 * - red → `Lage rot – zählt nicht (fällt noch)`; amber → `Lage gelb – Umkehr bildet sich (2/4)`;
 *   mode `block`: does not count; mode `warn`: counts, the label stays as the warning (`… – nur Warnung …`).
 */
export function lageGate(lage: Pick<Lage, "state" | "signsMet"> | null | undefined, cfg: LageSettings, side: "long" | "short" = "long"): LageGate {
  if (!lage || !cfg.on || side !== "long") return NO_GATE(lage?.state ?? "none");
  if (lage.state === "green" || lage.state === "none") return NO_GATE(lage.state);
  const block = cfg.mode === "block";
  const label =
    lage.state === "red"
      ? block
        ? "Lage rot – zählt nicht (fällt noch)"
        : "Lage rot – nur Warnung (fällt noch)"
      : block
        ? `Lage gelb – Umkehr bildet sich (${lage.signsMet}/4)`
        : `Lage gelb – nur Warnung (${lage.signsMet}/4)`;
  return { state: lage.state, counts: !block, blocked: block, label };
}

/** Stored form on trades (`trade.signal.lage`, phase 2): distances rounded to 0.01 %, EMA to 0.1. */
export function toLageSnapshot(l: Lage | null | undefined): LageSnapshot | null {
  if (!l || l.state === "none") return null;
  const r = (x: number | null, k: number): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * k) / k);
  return { state: l.state, signs: metSigns(l), ema21_1d: r(l.ema21_1d, 10), dist: r(l.dist, 10_000) };
}

/** Reads a stored snapshot (any shape) → normalised copy or `null`. */
export function parseLageSnapshot(v: unknown): LageSnapshot | null {
  const o = obj(v);
  if (!o) return null;
  const state = o.state;
  if (state !== "red" && state !== "amber" && state !== "green") return null;
  const signs = Array.isArray(o.signs) ? o.signs.filter((s): s is LageSnapshot["signs"][number] => s === "U1" || s === "U2" || s === "U3" || s === "U4") : [];
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return { ...o, state, signs, ema21_1d: num(o.ema21_1d), dist: num(o.dist) } as LageSnapshot;
}

/** `Lage Rot · 2 von 4` style text of a snapshot (trade detail). */
export const lageSnapshotText = (s: LageSnapshot): string => `Lage ${LAGE_STATE_WORD[s.state]}${s.state === "green" ? "" : ` · ${s.signs.length} von 4`}`;
