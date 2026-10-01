/**
 * Settings form state (Bundle `K$` lines 50121–50235): every numeric value is edited as a de-DE
 * string (`nt`), parsed with `rt`; backtest percentages are shown ×100 (2 decimals) and stored ÷100.
 * NEW: `rules` (Grundregeln) are part of the draft and saved with the same `Speichern`.
 */
import type { Rule, Settings } from "@/domain/types";
import { fractionToPercentInput, parseNumber, percentInputToFraction, toInputString } from "@/lib/parse";

export interface SettingsDraft {
  makro: string;
  scalp: string;
  currency: string;
  pair: string;
  startDate: string;
  symbol: string;
  longTrigger: string;
  longStop: string;
  shortTrigger: string;
  lowerHigh: string;
  rsiWeekly: string;
  invalidation: string;
  zoneLow: string;
  zoneHigh: string;
  hbLong: string;
  hbLongField: string;
  hbDelta: string;
  hbDeltaField: string;
  hbCoin: string;
  hbExchange: string;
  hbTf: string;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  expectancy: string;
  label: string;
  rules: Rule[];
}

export type DraftTextKey = Exclude<keyof SettingsDraft, "rules">;

/** The 14 fields that must parse (`Bitte alle Zahlenfelder ausfüllen`). */
export const NUMERIC_FIELDS = [
  "makro",
  "scalp",
  "longTrigger",
  "longStop",
  "shortTrigger",
  "lowerHigh",
  "rsiWeekly",
  "invalidation",
  "zoneLow",
  "zoneHigh",
  "winRate",
  "avgWin",
  "avgLoss",
  "expectancy",
] as const satisfies readonly DraftTextKey[];

export const CURRENCIES = ["USDT", "USD", "EUR"] as const;

export const FALLBACKS = {
  currency: "USDT",
  pair: "BTC/USDT",
  symbol: "BINANCE:BTCUSDT",
  coin: "BTC",
  timeframe: "1h",
  label: "Backtest",
} as const;

export function settingsToDraft(s: Settings): SettingsDraft {
  const m = s.market;
  const b = s.backtest;
  return {
    makro: toInputString(s.capital.makro),
    scalp: toInputString(s.capital.scalp),
    currency: s.currency,
    pair: s.pair,
    startDate: s.startDate,
    symbol: m.symbol,
    longTrigger: toInputString(m.longTrigger),
    longStop: toInputString(m.longStop),
    shortTrigger: toInputString(m.shortTrigger),
    lowerHigh: toInputString(m.lowerHigh),
    rsiWeekly: toInputString(m.rsiWeekly),
    invalidation: toInputString(m.invalidation),
    zoneLow: toInputString(m.zoneLow),
    zoneHigh: toInputString(m.zoneHigh),
    hbLong: s.hyblock.longEndpoint,
    hbLongField: s.hyblock.longField,
    hbDelta: s.hyblock.deltaEndpoint,
    hbDeltaField: s.hyblock.deltaField,
    hbCoin: s.hyblock.coin,
    hbExchange: s.hyblock.exchange,
    hbTf: s.hyblock.timeframe,
    winRate: fractionToPercentInput(b.winRate),
    avgWin: fractionToPercentInput(b.avgWin),
    avgLoss: fractionToPercentInput(b.avgLoss),
    expectancy: fractionToPercentInput(b.expectancy),
    label: b.label,
    rules: s.rules.map((r) => ({ ...r })),
  };
}

export type DraftResult = { ok: true; settings: Settings } | { ok: false; error: "numeric"; field: DraftTextKey };

/**
 * Draft → Settings. Validates the 14 numeric fields, applies the bundle fallbacks and keeps every
 * other key of `base` (setups, unknown fields) untouched. Rules: trimmed, empty ones dropped.
 */
export function draftToSettings(d: SettingsDraft, base: Settings): DraftResult {
  const nums: Partial<Record<DraftTextKey, number>> = {};
  for (const k of NUMERIC_FIELDS) {
    const v = parseNumber(d[k]);
    if (v == null) return { ok: false, error: "numeric", field: k };
    nums[k] = v;
  }
  const n = (k: (typeof NUMERIC_FIELDS)[number]): number => nums[k] as number;
  const pct = (k: "winRate" | "avgWin" | "avgLoss" | "expectancy"): number => percentInputToFraction(d[k]) as number;
  return {
    ok: true,
    settings: {
      ...base,
      currency: d.currency || FALLBACKS.currency,
      pair: (d.pair || "").trim() || FALLBACKS.pair,
      startDate: d.startDate || "",
      capital: { makro: n("makro"), scalp: n("scalp") },
      market: {
        symbol: (d.symbol || "").trim() || FALLBACKS.symbol,
        longTrigger: n("longTrigger"),
        longStop: n("longStop"),
        shortTrigger: n("shortTrigger"),
        lowerHigh: n("lowerHigh"),
        rsiWeekly: n("rsiWeekly"),
        invalidation: n("invalidation"),
        zoneLow: n("zoneLow"),
        zoneHigh: n("zoneHigh"),
      },
      hyblock: {
        longEndpoint: (d.hbLong || "").trim(),
        longField: (d.hbLongField || "").trim(),
        deltaEndpoint: (d.hbDelta || "").trim(),
        deltaField: (d.hbDeltaField || "").trim(),
        coin: (d.hbCoin || FALLBACKS.coin).trim(),
        exchange: (d.hbExchange || "").trim(),
        timeframe: (d.hbTf || FALLBACKS.timeframe).trim(),
      },
      backtest: {
        winRate: pct("winRate"),
        avgWin: pct("avgWin"),
        avgLoss: pct("avgLoss"),
        expectancy: pct("expectancy"),
        label: (d.label || "").trim() || FALLBACKS.label,
      },
      rules: d.rules.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text),
    },
  };
}

/** A draft entry that can differ from the saved settings (`rules` as a whole). */
export type DraftKey = DraftTextKey | "rules";

const NUMERIC = new Set<DraftTextKey>(NUMERIC_FIELDS);

function sameText(key: DraftTextKey, a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (NUMERIC.has(key)) {
    const x = parseNumber(a ?? "");
    const y = parseNumber(b ?? "");
    if (x != null && y != null) return Math.abs(x - y) < 1e-9;
  }
  return (a ?? "").trim() === (b ?? "").trim();
}

/** Rules as saved: trimmed, empty ones dropped (exactly what `draftToSettings` keeps). */
function savedRules(rules: readonly Rule[]): string {
  return rules
    .map((r) => [r.id, r.text.trim()] as const)
    .filter(([, text]) => text)
    .map(([id, text]) => `${id}\u0000${text}`)
    .join("\u0001");
}

/**
 * Entries of `draft` whose SAVED meaning differs from `saved` (normally `settingsToDraft(settings)`): numbers
 * compare by value (`25.000` = `25000`), text trimmed, rules by id + trimmed text ignoring empty rows – so a draft
 * that would save to the same settings reports nothing, and a successful save clears every mark.
 */
export function changedKeys(draft: SettingsDraft, saved: SettingsDraft): Set<DraftKey> {
  const out = new Set<DraftKey>();
  for (const key of Object.keys(saved) as (keyof SettingsDraft)[]) {
    if (key === "rules") continue;
    if (!sameText(key, draft[key], saved[key])) out.add(key);
  }
  if (savedRules(draft.rules) !== savedRules(saved.rules)) out.add("rules");
  return out;
}
