/**
 * Settings form state (Bundle `K$` lines 50121–50235): every numeric value is edited as a de-DE
 * string (`nt`), parsed with `rt`; backtest percentages are shown ×100 (2 decimals) and stored ÷100.
 * NEW: `rules` (Grundregeln) are part of the draft and saved with the same `Speichern`.
 * NEW (merge): the `Einstiegs-Check` config (`settings.signals`, flat `sg*` strings like the other journal's draft
 * keys), the mistake tags (`settings.mistakes`) and the discipline limits (`settings.discipline`). Each of those
 * three is written ONLY when its draft part differs from the saved value – an untouched part keeps the stored value
 * byte for byte (absent stays absent, unknown keys survive), so a save from this page never invents data.
 */
import { disciplineLimits } from "@/domain/insights/discipline";
import { DEFAULT_SIGNAL_CFG, SIGNAL_TFS, parseWhalePeriods, sanitizeSignalCfg, tfSeconds, whaleFromDraft, whaleToDraft } from "@/domain/signals";
import type { Rule, Settings } from "@/domain/types";
import { fractionToPercentInput, parseNumber, percentInputToFraction, toInputString } from "@/lib/parse";
import { PARTS_NUMERIC_KEYS, PARTS_TEXT_KEYS, partsFromDraft, partsToDraft, type PartsDraft } from "./signalPartsDraft";

/** One editable mistake tag (`id` only keys the row while editing; the stored value is the plain string list). */
export interface MistakeRow {
  id: string;
  text: string;
}

/** `sg*` strings of the Einstiegs-Check v2 thresholds (candle-close N, Top-Trader-Kombi, divergences, S/R) live in `PartsDraft` (`signalPartsDraft.ts`). */
export interface SettingsDraft extends PartsDraft {
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
  /** `Einstiegs-Check` ladder: active timeframes, comma separated (`30m,45m,1h,4h`). */
  sgLadder: string;
  sgReq: string;
  sgLook: string;
  sgRsiOs: string;
  sgRsiOb: string;
  sgRsiNear: string;
  sgWtOs: string;
  sgWtOb: string;
  sgZoneTf: string;
  sgSwing: string;
  sgCh: string;
  sgAvg: string;
  sgSig: string;
  /** System notification on a new valid entry (`"on"` | `""`). */
  sgNotify: string;
  /** Notify (toast + system) only from this strength on, `1`..`4`. */
  sgNotifyMin: string;
  /** "Top-Trader kaufen · Retail rot" (`settings.signals.whale`, see `@/domain/signals` whaleDraft.ts): `"on"` | `""`. */
  sgWhale: string;
  /** its Binance periods, comma separated (`30m,1h`) */
  sgWhalePeriods: string;
  /** consecutive closed periods, `1`..`6` */
  sgWhaleMin: string;
  /** score points, `0`..`30` */
  sgWhaleWeight: string;
  /** Mistake tags (`settings.mistakes`). */
  mistakes: MistakeRow[];
  /** Discipline limits (`settings.discipline`): % per trade / day, max trades per day and account. */
  dlTrade: string;
  dlDay: string;
  dlMakro: string;
  dlScalp: string;
}

export type DraftTextKey = Exclude<keyof SettingsDraft, "rules" | "mistakes">;

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

/** `Einstiegs-Check` numbers: must parse when the signal part is saved; compared by value. */
export const SIGNAL_NUMERIC_FIELDS = [
  "sgReq",
  "sgLook",
  "sgRsiOs",
  "sgRsiOb",
  "sgRsiNear",
  "sgWtOs",
  "sgWtOb",
  "sgSwing",
  "sgCh",
  "sgAvg",
  "sgSig",
  "sgNotifyMin",
  "sgWhaleMin",
  "sgWhaleWeight",
  ...PARTS_NUMERIC_KEYS,
] as const satisfies readonly DraftTextKey[];
/** Every draft key of the signal part (written together, only when one of them changed). */
export const SIGNAL_KEYS = [...SIGNAL_NUMERIC_FIELDS, "sgLadder", "sgZoneTf", "sgNotify", "sgWhale", "sgWhalePeriods", ...PARTS_TEXT_KEYS] as const satisfies readonly DraftTextKey[];
/** Discipline limits: must parse when the part is saved. */
export const DISCIPLINE_FIELDS = ["dlTrade", "dlDay", "dlMakro", "dlScalp"] as const satisfies readonly DraftTextKey[];

export const CURRENCIES = ["USDT", "USD", "EUR"] as const;

/** Ladder string → valid, unique timeframes sorted small → large (≥ 30m, from `SIGNAL_TFS`). */
export function parseLadder(v: string): string[] {
  const list = (v || "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => SIGNAL_TFS.includes(t));
  return [...new Set(list)].sort((a, b) => tfSeconds(a) - tfSeconds(b));
}

/** Mistake rows → the stored list: trimmed, empty rows dropped, duplicates merged (first wins). */
export function mistakesFromRows(rows: readonly MistakeRow[]): string[] {
  return [...new Set(rows.map((r) => r.text.trim()).filter(Boolean))];
}

const pctInput = (x: number): string => toInputString(+(x * 100).toFixed(2));

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
    ...signalsToDraft(s.signals),
    mistakes: (Array.isArray(s.mistakes) ? s.mistakes : []).map((text, i) => ({ id: `m${i}`, text: String(text) })),
    ...disciplineToDraft(s),
  };
}

type SignalDraft = Pick<SettingsDraft, (typeof SIGNAL_KEYS)[number]>;

/** `settings.signals` (raw, any app's shape) → the card's strings; values the engine would use (sanitised). */
export function signalsToDraft(raw: unknown): SignalDraft {
  const c = sanitizeSignalCfg(raw);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const min = typeof r.notifyMinStrength === "number" && Number.isFinite(r.notifyMinStrength) ? Math.min(4, Math.max(1, Math.round(r.notifyMinStrength))) : 1;
  return {
    sgLadder: c.ladder.join(","),
    sgReq: String(c.required),
    sgLook: toInputString(c.signalLookback),
    sgRsiOs: toInputString(c.rsiOs),
    sgRsiOb: toInputString(c.rsiOb),
    sgRsiNear: toInputString(c.rsiNear),
    sgWtOs: toInputString(c.wtOs),
    sgWtOb: toInputString(c.wtOb),
    sgZoneTf: c.zoneTf,
    sgSwing: toInputString(c.swingLookback),
    sgCh: toInputString(c.wtChannel),
    sgAvg: toInputString(c.wtAverage),
    sgSig: toInputString(c.wtSignal),
    sgNotify: c.notify ? "on" : "",
    sgNotifyMin: String(min),
    ...whaleToDraft(raw),
    ...partsToDraft(raw),
  };
}

/** The other journal's defaults as card strings (`Standardwerte`), keeping the notification choices of `keep`. */
export function defaultSignalDraft(keep: Pick<SettingsDraft, "sgNotify" | "sgNotifyMin">): SignalDraft {
  return { ...signalsToDraft(DEFAULT_SIGNAL_CFG), sgNotify: keep.sgNotify, sgNotifyMin: keep.sgNotifyMin };
}

function disciplineToDraft(s: Settings): Pick<SettingsDraft, (typeof DISCIPLINE_FIELDS)[number]> {
  const l = disciplineLimits(s as { discipline?: unknown });
  return { dlTrade: pctInput(l.maxLossTradePct), dlDay: pctInput(l.maxLossDayPct), dlMakro: toInputString(l.maxTrades.makro), dlScalp: toInputString(l.maxTrades.scalp) };
}

export type DraftResult = { ok: true; settings: Settings } | { ok: false; error: "numeric"; field: DraftTextKey };

const clampInt = (v: number, lo: number, hi = Infinity): number => Math.min(hi, Math.max(lo, Math.round(v)));
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const objectOr = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Draft → Settings. Validates the 14 numeric fields, applies the bundle fallbacks and keeps every
 * other key of `base` (setups, unknown fields) untouched. Rules: trimmed, empty ones dropped.
 * `signals` / `mistakes` / `discipline`: written only when their draft part changed (see the module note); the
 * signal part is merged over the stored object (unknown keys kept), lengths clamped like the engine's sanitiser.
 */
export function draftToSettings(d: SettingsDraft, base: Settings): DraftResult {
  const nums: Partial<Record<DraftTextKey, number>> = {};
  for (const k of NUMERIC_FIELDS) {
    const v = parseNumber(d[k]);
    if (v == null) return { ok: false, error: "numeric", field: k };
    nums[k] = v;
  }
  const saved = settingsToDraft(base);

  let signals: unknown = base.signals;
  if (SIGNAL_KEYS.some((k) => !sameText(k, d[k], saved[k]))) {
    const sg: Partial<Record<(typeof SIGNAL_NUMERIC_FIELDS)[number], number>> = {};
    for (const k of SIGNAL_NUMERIC_FIELDS) {
      const v = parseNumber(d[k]);
      if (v == null) return { ok: false, error: "numeric", field: k };
      sg[k] = v;
    }
    const ladder = parseLadder(d.sgLadder);
    if (!ladder.length) return { ok: false, error: "numeric", field: "sgLadder" };
    const g = (k: (typeof SIGNAL_NUMERIC_FIELDS)[number]): number => sg[k] as number;
    const whale = whaleFromDraft(d, base.signals);
    if (!whale.ok) return { ok: false, error: "numeric", field: whale.field };
    const parts = partsFromDraft(d, base.signals);
    if (!parts.ok) return { ok: false, error: "numeric", field: parts.field };
    signals = {
      ...objectOr(base.signals),
      ladder,
      required: clampInt(g("sgReq"), 1, ladder.length),
      signalLookback: clampInt(g("sgLook"), 1),
      rsiOs: clampNum(g("sgRsiOs"), 0, 100),
      rsiOb: clampNum(g("sgRsiOb"), 0, 100),
      rsiNear: clampNum(g("sgRsiNear"), 0, 100),
      wtOs: g("sgWtOs"),
      wtOb: g("sgWtOb"),
      zoneTf: SIGNAL_TFS.includes(d.sgZoneTf) ? d.sgZoneTf : DEFAULT_SIGNAL_CFG.zoneTf,
      swingLookback: clampInt(g("sgSwing"), 20),
      wtChannel: clampInt(g("sgCh"), 2),
      wtAverage: clampInt(g("sgAvg"), 2),
      wtSignal: clampInt(g("sgSig"), 1),
      notify: d.sgNotify === "on",
      notifyMinStrength: clampInt(g("sgNotifyMin"), 1, 4),
      whale: { ...whale.whale, ...parts.patch.whale },
      strongCloses: parts.patch.strongCloses,
      div: parts.patch.div,
      sr: parts.patch.sr,
    };
  }

  let discipline: unknown = (base as { discipline?: unknown }).discipline;
  if (DISCIPLINE_FIELDS.some((k) => !sameText(k, d[k], saved[k]))) {
    const dl: Partial<Record<(typeof DISCIPLINE_FIELDS)[number], number>> = {};
    for (const k of DISCIPLINE_FIELDS) {
      const v = parseNumber(d[k]);
      if (v == null || v <= 0) return { ok: false, error: "numeric", field: k };
      dl[k] = v;
    }
    const prev = objectOr(discipline);
    discipline = {
      ...prev,
      maxLossTradePct: clampNum((dl.dlTrade as number) / 100, 0.0001, 1),
      maxLossDayPct: clampNum((dl.dlDay as number) / 100, 0.0001, 1),
      maxTrades: { ...objectOr(prev.maxTrades), makro: clampInt(dl.dlMakro as number, 1, 1000), scalp: clampInt(dl.dlScalp as number, 1, 1000) },
    };
  }

  const nextMistakes = mistakesFromRows(d.mistakes);
  const mistakes = sameList(nextMistakes, mistakesFromRows(saved.mistakes)) ? base.mistakes : nextMistakes;

  const n = (k: (typeof NUMERIC_FIELDS)[number]): number => nums[k] as number;
  const pct = (k: "winRate" | "avgWin" | "avgLoss" | "expectancy"): number => percentInputToFraction(d[k]) as number;
  const out: Settings = {
    ...base,
    currency: d.currency || FALLBACKS.currency,
    pair: (d.pair || "").trim() || FALLBACKS.pair,
    startDate: d.startDate || "",
    capital: { makro: n("makro"), scalp: n("scalp") },
    market: {
      ...base.market,
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
      ...base.hyblock,
      longEndpoint: (d.hbLong || "").trim(),
      longField: (d.hbLongField || "").trim(),
      deltaEndpoint: (d.hbDelta || "").trim(),
      deltaField: (d.hbDeltaField || "").trim(),
      coin: (d.hbCoin || FALLBACKS.coin).trim(),
      exchange: (d.hbExchange || "").trim(),
      timeframe: (d.hbTf || FALLBACKS.timeframe).trim(),
    },
    backtest: {
      ...base.backtest,
      winRate: pct("winRate"),
      avgWin: pct("avgWin"),
      avgLoss: pct("avgLoss"),
      expectancy: pct("expectancy"),
      label: (d.label || "").trim() || FALLBACKS.label,
    },
    rules: d.rules.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text),
    mistakes,
  };
  if (signals !== undefined) out.signals = signals;
  if (discipline !== undefined) (out as Settings & { discipline?: unknown }).discipline = discipline;
  return { ok: true, settings: out };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** A draft entry that can differ from the saved settings (`rules` / `mistakes` as a whole). */
export type DraftKey = DraftTextKey | "rules" | "mistakes";

const NUMERIC = new Set<DraftTextKey>([...NUMERIC_FIELDS, ...SIGNAL_NUMERIC_FIELDS, ...DISCIPLINE_FIELDS]);

function sameText(key: DraftTextKey, a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (key === "sgLadder") return parseLadder(a ?? "").join() === parseLadder(b ?? "").join();
  if (key === "sgWhalePeriods") return parseWhalePeriods(a ?? "").join() === parseWhalePeriods(b ?? "").join();
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
    if (key === "rules" || key === "mistakes") continue;
    if (!sameText(key, draft[key], saved[key])) out.add(key);
  }
  if (savedRules(draft.rules) !== savedRules(saved.rules)) out.add("rules");
  if (!sameList(mistakesFromRows(draft.mistakes), mistakesFromRows(saved.mistakes))) out.add("mistakes");
  return out;
}
