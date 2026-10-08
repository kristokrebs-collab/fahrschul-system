/**
 * Settings-form strings of the Einstiegs-Check v2 thresholds (decisions 5, 6, 9, 10 — 2026-10-08), in the flat `sg*`
 * draft convention of the settings page (`draft.ts` spreads `partsToDraft` into the signal part and merges
 * `partsFromDraft` into `settings.signals` on save):
 *
 * | draft keys | stored | engine |
 * |---|---|---|
 * | `sgStrong` | `strongCloses` (1 … 6) | closes until "stark bestätigt" |
 * | `sgWhaleTop`, `sgWhaleRetail`, `sgWhaleBonus` | `whale.topPct` (50 … 90), `whale.retailPeriod`, `whale.bonusParts` (1 … 4) | Top-Trader-Kombi |
 * | `sgDiv*` | `div.{on, rsi, wt, hidden, midline, left, right, rangeMin, rangeMax, maxAge, weight}` | divergences |
 * | `sgSr*` | `sr.{on, internal, nearAtr, minR, eqLen, eqThreshold, weight}` | structure + support / resistance |
 *
 * Values shown are the ones the engine runs with (`sanitizeSignalCfg`); saving merges over the stored objects (unknown
 * keys of either app survive) and clamps like the engine's sanitiser. Pure.
 */
import { DEFAULT_DIV_CFG, DEFAULT_SR_CFG, DEFAULT_STRONG_CLOSES, DEFAULT_WHALE_CFG, PART_WEIGHT_MAX, sanitizeSignalCfg, STRONG_CLOSES_MAX, WHALE_RETAIL_PERIODS, type DivCfg, type SrCfg } from "@/domain/signals";
import { parseNumber, toInputString } from "@/lib/parse";

/** Draft keys that must parse as numbers when the signal part is saved (compared by value). */
export const PARTS_NUMERIC_KEYS = [
  "sgStrong",
  "sgWhaleTop",
  "sgWhaleBonus",
  "sgDivLeft",
  "sgDivRight",
  "sgDivMin",
  "sgDivMax",
  "sgDivAge",
  "sgDivWeight",
  "sgSrInt",
  "sgSrNear",
  "sgSrMinR",
  "sgSrEqLen",
  "sgSrEqThr",
  "sgSrWeight",
] as const;
/** Switches (`"on"` | `""`) and choices. */
export const PARTS_TEXT_KEYS = ["sgWhaleRetail", "sgDiv", "sgDivRsi", "sgDivWt", "sgDivHidden", "sgDivMid", "sgSr"] as const;
export const PARTS_DRAFT_KEYS = [...PARTS_NUMERIC_KEYS, ...PARTS_TEXT_KEYS] as const;

export type PartsDraftKey = (typeof PARTS_DRAFT_KEYS)[number];
export type PartsDraft = Record<PartsDraftKey, string>;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const on = (b: boolean): string => (b ? "on" : "");

/** Stored closes until "stark bestätigt", clamped to 1 … `STRONG_CLOSES_MAX` (not to the signal window). */
function storedStrong(signals: unknown): number {
  const v = isRec(signals) ? signals.strongCloses : undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(STRONG_CLOSES_MAX, Math.max(1, Math.round(n))) : DEFAULT_STRONG_CLOSES;
}

/** Stored `settings.signals` (any app's shape) → the strings, as the engine would run them. */
export function partsToDraft(signals: unknown): PartsDraft {
  const c = sanitizeSignalCfg(signals);
  const w = c.whale ?? DEFAULT_WHALE_CFG;
  const d = c.div ?? DEFAULT_DIV_CFG;
  const r = c.sr ?? DEFAULT_SR_CFG;
  return {
    // the stored value, not the window-capped runtime one (`sanitizeSignalCfg` caps it at signal window − 1): an
    // untouched draft never rewrites it
    sgStrong: String(storedStrong(signals)),
    sgWhaleTop: toInputString(w.topPct),
    sgWhaleRetail: w.retailPeriod,
    sgWhaleBonus: String(w.bonusParts),
    sgDiv: on(d.on),
    sgDivRsi: on(d.rsi),
    sgDivWt: on(d.wt),
    sgDivHidden: on(d.hidden),
    sgDivMid: on(d.midline),
    sgDivLeft: String(d.left),
    sgDivRight: String(d.right),
    sgDivMin: String(d.rangeMin),
    sgDivMax: String(d.rangeMax),
    sgDivAge: String(d.maxAge),
    sgDivWeight: String(d.weight),
    sgSr: on(r.on),
    sgSrInt: String(r.internal),
    sgSrNear: toInputString(r.nearAtr),
    sgSrMinR: toInputString(r.minR),
    sgSrEqLen: String(r.eqLen),
    sgSrEqThr: toInputString(r.eqThreshold),
    sgSrWeight: String(r.weight),
  };
}

export interface PartsPatch {
  strongCloses: number;
  /** merged into the `whale` object the whale draft writes */
  whale: { topPct: number; retailPeriod: string; bonusParts: number };
  div: DivCfg & Record<string, unknown>;
  sr: SrCfg & Record<string, unknown>;
}
export type PartsFromDraft = { ok: true; patch: PartsPatch } | { ok: false; field: PartsDraftKey };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clampInt = (v: number, lo: number, hi: number): number => Math.round(clamp(v, lo, hi));

/**
 * Draft strings → the v2 values to store (merged over the stored `div` / `sr` objects; `whale` fields are merged by the
 * caller over the whale draft's object). Refuses a non-numeric value with the field to reveal; numbers are clamped
 * like `sanitizeSignalCfg`, `rangeMax ≥ rangeMin`.
 */
export function partsFromDraft(d: Partial<PartsDraft>, signals: unknown): PartsFromDraft {
  const def = partsToDraft(signals);
  const nums = {} as Record<(typeof PARTS_NUMERIC_KEYS)[number], number>;
  for (const k of PARTS_NUMERIC_KEYS) {
    const v = parseNumber(d[k] ?? def[k]);
    if (v == null) return { ok: false, field: k };
    nums[k] = v;
  }
  const flag = (k: PartsDraftKey): boolean => (d[k] ?? def[k]) === "on";
  const stored = isRec(signals) ? signals : {};
  const storedDiv = isRec(stored.div) ? stored.div : {};
  const storedSr = isRec(stored.sr) ? stored.sr : {};
  const retail = d.sgWhaleRetail ?? def.sgWhaleRetail;
  const rangeMin = clampInt(nums.sgDivMin, 1, 200);
  return {
    ok: true,
    patch: {
      strongCloses: clampInt(nums.sgStrong, 1, STRONG_CLOSES_MAX),
      whale: {
        topPct: clamp(nums.sgWhaleTop, 50, 90),
        retailPeriod: WHALE_RETAIL_PERIODS.includes(retail) ? retail : DEFAULT_WHALE_CFG.retailPeriod,
        bonusParts: clampInt(nums.sgWhaleBonus, 1, 4),
      },
      div: {
        ...storedDiv,
        on: flag("sgDiv"),
        rsi: flag("sgDivRsi"),
        wt: flag("sgDivWt"),
        hidden: flag("sgDivHidden"),
        midline: flag("sgDivMid"),
        left: clampInt(nums.sgDivLeft, 1, 20),
        right: clampInt(nums.sgDivRight, 1, 20),
        rangeMin,
        rangeMax: Math.max(rangeMin, clampInt(nums.sgDivMax, 1, 300)),
        maxAge: clampInt(nums.sgDivAge, 0, 50),
        weight: clampInt(nums.sgDivWeight, 0, PART_WEIGHT_MAX),
      },
      sr: {
        ...storedSr,
        on: flag("sgSr"),
        internal: clampInt(nums.sgSrInt, 2, 20),
        nearAtr: clamp(nums.sgSrNear, 0.1, 10),
        minR: clamp(nums.sgSrMinR, 0.5, 10),
        eqLen: clampInt(nums.sgSrEqLen, 2, 20),
        eqThreshold: clamp(nums.sgSrEqThr, 0, 2),
        weight: clampInt(nums.sgSrWeight, 0, PART_WEIGHT_MAX),
      },
    },
  };
}
