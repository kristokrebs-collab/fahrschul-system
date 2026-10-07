/**
 * Settings-form strings of "Top-Trader kaufen · Retail rot" (`settings.signals.whale`) — the flat `sg*` draft
 * convention of the settings page (`src/views/settings/draft.ts` calls these three helpers):
 * - `whaleToDraft(stored signals)` → `{ sgWhale: "on" | "", sgWhalePeriods: "30m,1h", sgWhaleMin: "2", sgWhaleWeight: "10" }`
 * - `whaleFromDraft(draft, stored signals)` → the `whale` object to save, merged over the stored one (unknown keys
 *   survive), or the field to reveal when it cannot be saved.
 */
import { DEFAULT_WHALE_CFG, sanitizeWhaleCfg, tfSeconds, WHALE_MIN_RUN_MAX, WHALE_PERIODS, WHALE_WEIGHT_MAX, type WhaleCfg } from "./config";

export const WHALE_DRAFT_KEYS = ["sgWhale", "sgWhalePeriods", "sgWhaleMin", "sgWhaleWeight"] as const;
export type WhaleDraftKey = (typeof WHALE_DRAFT_KEYS)[number];
export type WhaleDraft = Record<WhaleDraftKey, string>;

/** Weight choices of the settings card (score points). */
export const WHALE_WEIGHTS: readonly number[] = [0, 5, 10, 15, 20, 30];

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Comma list → valid periods, unique, small → large. */
export function parseWhalePeriods(s: string): string[] {
  const list = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => WHALE_PERIODS.includes(x));
  return [...new Set(list)].sort((a, b) => tfSeconds(a) - tfSeconds(b));
}

/** Stored `settings.signals` (any app's shape) → the four strings, as the engine would run them. */
export function whaleToDraft(signals: unknown): WhaleDraft {
  const w = sanitizeWhaleCfg(isRec(signals) ? signals.whale : undefined);
  return { sgWhale: w.on ? "on" : "", sgWhalePeriods: w.periods.join(","), sgWhaleMin: String(w.minRun), sgWhaleWeight: String(w.weight) };
}

/** The defaults as draft strings ("Standardwerte setzen"). */
export const defaultWhaleDraft = (): WhaleDraft => whaleToDraft({ whale: { ...DEFAULT_WHALE_CFG } });

export type WhaleFromDraft = { ok: true; whale: WhaleCfg } | { ok: false; field: WhaleDraftKey };

/**
 * Draft strings → the `whale` object to store, spread over the stored one. Refuses an empty period list
 * (`sgWhalePeriods`) and non-numeric counts (`sgWhaleMin` / `sgWhaleWeight`); numbers are clamped like the sanitiser.
 */
export function whaleFromDraft(d: Partial<WhaleDraft>, signals: unknown): WhaleFromDraft {
  const stored = isRec(signals) && isRec(signals.whale) ? signals.whale : {};
  const def = defaultWhaleDraft();
  const periods = parseWhalePeriods(d.sgWhalePeriods ?? def.sgWhalePeriods);
  if (!periods.length) return { ok: false, field: "sgWhalePeriods" };
  const min = Number((d.sgWhaleMin ?? def.sgWhaleMin).replace(",", "."));
  if (!Number.isFinite(min)) return { ok: false, field: "sgWhaleMin" };
  const weight = Number((d.sgWhaleWeight ?? def.sgWhaleWeight).replace(",", "."));
  if (!Number.isFinite(weight)) return { ok: false, field: "sgWhaleWeight" };
  return {
    ok: true,
    whale: {
      ...stored,
      on: (d.sgWhale ?? def.sgWhale) === "on",
      periods,
      minRun: Math.min(WHALE_MIN_RUN_MAX, Math.max(1, Math.round(min))),
      weight: Math.min(WHALE_WEIGHT_MAX, Math.max(0, Math.round(weight))),
    },
  };
}
