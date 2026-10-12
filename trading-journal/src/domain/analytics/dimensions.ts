/**
 * Breakdown dimensions (P03): how a closed trade falls into buckets – strategy, asset, exchange, weekday, time of day,
 * session, holding time, regime (Lage at entry), volatility (ATR %), side, setup × session, position size (risk % of
 * the account capital), leverage, timeframe, conviction, emotion, month, box grade, origin / bot, account, tags and
 * the entry-check strength.
 *
 * Journal-v3 fields (P06: `exitDate`, `atrPct`, `exchange`, `tags`, `origin`, `boxSnap`) are read defensively: a trade
 * without them lands in the dimension's "ohne" bucket (`NONE_KEY`), never in a guessed one.
 */
import type { EnrichedTrade, Settings } from "../types";
import { EMOTIONS, TIMEFRAMES } from "../types";
import { holdMs } from "../excursion";
import { pairKey } from "../grouping";
import { boxGradeOf } from "../boxes/snapshot";
import { snapOf } from "../insights/signal";
import { accountOf } from "../insights/shared";
import { SESSIONS, sessionOf } from "../insights/time";
import { STRENGTH_LABEL } from "../signals/config";
import { monthKey, monthLabel, tradeTime } from "@/lib/dates";

export type DimensionKey =
  | "setup"
  | "asset"
  | "exchange"
  | "weekday"
  | "hour"
  | "session"
  | "hold"
  | "regime"
  | "volatility"
  | "side"
  | "setupSession"
  | "riskPct"
  | "leverage"
  | "timeframe"
  | "conviction"
  | "emotion"
  | "month"
  | "box"
  | "origin"
  | "account"
  | "tag"
  | "strength";

/** Bucket of trades without the dimension's data. */
export const NONE_KEY = "__none";

export interface DimensionCtx {
  settings: Pick<Settings, "setups" | "capital">;
}

export interface Dimension {
  key: DimensionKey;
  /** German name ("Strategie") */
  label: string;
  /** one line what it groups by */
  hint: string;
  /** bucket keys of a trade (several for setups / tags / setup × session); `[NONE_KEY]` without data */
  keys(t: EnrichedTrade, ctx: DimensionCtx): string[];
  labelOf(key: string, ctx: DimensionCtx): string;
  /** natural order of the buckets (ordinal dimensions keep it; others sort by result) */
  order?: readonly string[];
  /** a trade can sit in several buckets */
  multi?: boolean;
  /** label of the "ohne" bucket */
  none: string;
}

type Bucket = { key: string; label: string; test: (v: number) => boolean };
const bucketOf = (defs: readonly Bucket[], v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return NONE_KEY;
  return defs.find((d) => d.test(v))?.key ?? NONE_KEY;
};
const labelFrom = (defs: readonly Bucket[]) => (k: string) => defs.find((d) => d.key === k)?.label ?? k;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const HOURS = Array.from({ length: 12 }, (_, i) => String(i * 2).padStart(2, "0"));

const MIN = 60_000;
const HOLD: readonly Bucket[] = [
  { key: "h0", label: "< 15 Min", test: (v) => v < 15 * MIN },
  { key: "h1", label: "15–60 Min", test: (v) => v < 60 * MIN },
  { key: "h2", label: "1–4 Std", test: (v) => v < 240 * MIN },
  { key: "h3", label: "4–24 Std", test: (v) => v < 1440 * MIN },
  { key: "h4", label: "1–3 Tage", test: (v) => v < 3 * 1440 * MIN },
  { key: "h5", label: "> 3 Tage", test: () => true },
];
const VOL: readonly Bucket[] = [
  { key: "v0", label: "ATR < 1 %", test: (v) => v < 1 },
  { key: "v1", label: "ATR 1–2 %", test: (v) => v < 2 },
  { key: "v2", label: "ATR 2–4 %", test: (v) => v < 4 },
  { key: "v3", label: "ATR > 4 %", test: () => true },
];
const RISK: readonly Bucket[] = [
  { key: "r0", label: "≤ 0,5 %", test: (v) => v <= 0.005 },
  { key: "r1", label: "0,5–1 %", test: (v) => v <= 0.01 },
  { key: "r2", label: "1–2 %", test: (v) => v <= 0.02 },
  { key: "r3", label: "2–3 %", test: (v) => v <= 0.03 },
  { key: "r4", label: "> 3 %", test: () => true },
];
const LEV: readonly Bucket[] = [
  { key: "l0", label: "1–2x", test: (v) => v <= 2 },
  { key: "l1", label: "3–5x", test: (v) => v <= 5 },
  { key: "l2", label: "6–10x", test: (v) => v <= 10 },
  { key: "l3", label: "11–20x", test: (v) => v <= 20 },
  { key: "l4", label: "> 20x", test: () => true },
];
const REGIME: Record<string, string> = { green: "Lage grün", amber: "Lage gelb", red: "Lage rot" };
const ORIGIN: Record<string, string> = { manual: "Manuell", api: "Börsen-API", csv: "CSV-Import", bot: "Bot", webhook: "Webhook" };

/** Risk of a trade in % of its account's capital (`risk` ÷ `capital[account]`), `null` without stop or capital. */
export function riskPctOf(t: EnrichedTrade, ctx: DimensionCtx): number | null {
  const cap = ctx.settings.capital?.[accountOf(t)];
  const capital = typeof cap === "number" ? cap : Number(cap);
  return fin(t.risk) && t.risk > 0 && capital > 0 ? t.risk / capital : null;
}

const knownSetups = (ctx: DimensionCtx): Map<string, string> => new Map(ctx.settings.setups.map((s) => [s.id, s.name]));

const DIMS: Dimension[] = [
  {
    key: "setup",
    label: "Strategie",
    hint: "Grundlage des Trades (ein Trade mit zwei Grundlagen zählt in beiden)",
    multi: true,
    none: "Ohne Grundlage",
    keys: (t, ctx) => {
      const known = knownSetups(ctx);
      const ids = (t.setups ?? []).filter((id) => known.has(id));
      return ids.length ? [...new Set(ids)] : [NONE_KEY];
    },
    labelOf: (k, ctx) => knownSetups(ctx).get(k) ?? k,
  },
  {
    key: "asset",
    label: "Asset",
    hint: "Handelspaar",
    none: "Ohne Paar",
    keys: (t) => {
      const k = pairKey(t.pair || "");
      return [k || NONE_KEY];
    },
    labelOf: (k) => k,
  },
  {
    key: "exchange",
    label: "Börse",
    hint: "Börse aus dem Trade (Journal v3)",
    none: "Ohne Börse",
    keys: (t) => [typeof t.exchange === "string" && t.exchange.trim() ? t.exchange.trim().toLowerCase() : NONE_KEY],
    labelOf: (k) => k.charAt(0).toUpperCase() + k.slice(1),
  },
  {
    key: "weekday",
    label: "Wochentag",
    hint: "Wochentag des Einstiegs (Ortszeit)",
    none: "–",
    order: WEEKDAYS.map((_, i) => String(i)),
    keys: (t) => [String((tradeTime(t).getDay() + 6) % 7)],
    labelOf: (k) => WEEKDAYS[+k] ?? k,
  },
  {
    key: "hour",
    label: "Uhrzeit",
    hint: "Zwei-Stunden-Block des Einstiegs (Ortszeit)",
    none: "–",
    order: HOURS,
    keys: (t) => [String(Math.floor(tradeTime(t).getHours() / 2) * 2).padStart(2, "0")],
    labelOf: (k) => `${k}–${String(+k + 2).padStart(2, "0")} Uhr`,
  },
  {
    key: "session",
    label: "Session",
    hint: "Handels-Session in UTC (Asien, London, New York, Spät, Wochenende)",
    none: "–",
    order: SESSIONS.map((s) => s.key),
    keys: (t) => [sessionOf(tradeTime(t))],
    labelOf: (k) => SESSIONS.find((s) => s.key === k)?.label ?? k,
  },
  {
    key: "hold",
    label: "Haltedauer",
    hint: "Zeit zwischen Einstieg und Ausstieg (braucht die Ausstiegszeit)",
    none: "Ohne Ausstiegszeit",
    order: HOLD.map((b) => b.key),
    keys: (t) => [bucketOf(HOLD, holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt }))],
    labelOf: labelFrom(HOLD),
  },
  {
    key: "regime",
    label: "Regime",
    hint: "Lage-Ampel beim Einstieg (aus dem gespeicherten Einstiegs-Check)",
    none: "Ohne Lage",
    order: ["green", "amber", "red"],
    keys: (t) => {
      const st = snapOf(t)?.lage?.state;
      return [st && st !== "none" ? st : NONE_KEY];
    },
    labelOf: (k) => REGIME[k] ?? k,
  },
  {
    key: "volatility",
    label: "Volatilität",
    hint: "ATR(14) in % des Preises beim Einstieg",
    none: "Ohne ATR",
    order: VOL.map((b) => b.key),
    keys: (t) => [bucketOf(VOL, t.atrPct)],
    labelOf: labelFrom(VOL),
  },
  {
    key: "side",
    label: "Long/Short",
    hint: "Richtung",
    none: "–",
    order: ["long", "short"],
    keys: (t) => [t.side === "short" ? "short" : "long"],
    labelOf: (k) => (k === "short" ? "Short" : "Long"),
  },
  {
    key: "setupSession",
    label: "Setup × Session",
    hint: "Jede Grundlage getrennt nach Session",
    multi: true,
    none: "Ohne Grundlage",
    keys: (t, ctx) => {
      const known = knownSetups(ctx);
      const ids = [...new Set((t.setups ?? []).filter((id) => known.has(id)))];
      const s = sessionOf(tradeTime(t));
      return ids.length ? ids.map((id) => `${id}|${s}`) : [NONE_KEY];
    },
    labelOf: (k, ctx) => {
      const [id = "", s = ""] = k.split("|");
      return `${knownSetups(ctx).get(id) ?? id} · ${SESSIONS.find((x) => x.key === s)?.short ?? s}`;
    },
  },
  {
    key: "riskPct",
    label: "Positionsgröße",
    hint: "Risiko bis zum Stop in % des Kontokapitals",
    none: "Ohne Stop",
    order: RISK.map((b) => b.key),
    keys: (t, ctx) => [bucketOf(RISK, riskPctOf(t, ctx))],
    labelOf: labelFrom(RISK),
  },
  {
    key: "leverage",
    label: "Hebel",
    hint: "Hebel des Trades",
    none: "Ohne Hebel",
    order: LEV.map((b) => b.key),
    keys: (t) => [bucketOf(LEV, fin(t.leverage) && t.leverage > 0 ? t.leverage : null)],
    labelOf: labelFrom(LEV),
  },
  {
    key: "timeframe",
    label: "Timeframe",
    hint: "Timeframe des Trades",
    none: "Ohne Timeframe",
    order: TIMEFRAMES,
    keys: (t) => [t.timeframe?.trim() ? t.timeframe.trim() : NONE_KEY],
    labelOf: (k) => k,
  },
  {
    key: "conviction",
    label: "Überzeugung",
    hint: "Überzeugung 1–5 beim Einstieg",
    none: "Ohne Angabe",
    order: ["1", "2", "3", "4", "5"],
    keys: (t) => [t.conviction != null && t.conviction >= 1 && t.conviction <= 5 ? String(t.conviction) : NONE_KEY],
    labelOf: (k) => `Überzeugung ${k}`,
  },
  {
    key: "emotion",
    label: "Emotion",
    hint: "Gefühl beim Einstieg",
    none: "Ohne Gefühl",
    order: EMOTIONS,
    keys: (t) => [t.emotion?.trim() ? t.emotion.trim() : NONE_KEY],
    labelOf: (k) => k,
  },
  {
    key: "month",
    label: "Monat",
    hint: "Kalendermonat des Einstiegs",
    none: "–",
    keys: (t) => [monthKey(tradeTime(t))],
    labelOf: (k) => monthLabel(k),
  },
  {
    key: "box",
    label: "Box-Note",
    hint: "Note des Box-zu-Box-Setups beim Einstieg",
    none: "Ohne Box",
    order: ["A+", "A", "B", "C"],
    keys: (t) => [boxGradeOf(t) ?? NONE_KEY],
    labelOf: (k) => `Note ${k}`,
  },
  {
    key: "origin",
    label: "Herkunft",
    hint: "Wer den Trade angelegt hat (manuell, Börse, CSV, Bot)",
    none: "Manuell",
    keys: (t) => {
      const o = t.origin;
      if (!o || typeof o !== "object" || !o.kind || o.kind === "manual") return ["manual"];
      return [o.kind === "bot" && o.botId ? `bot:${o.botId}` : o.kind];
    },
    labelOf: (k) => (k.startsWith("bot:") ? `Bot · ${k.slice(4)}` : (ORIGIN[k] ?? k)),
  },
  {
    key: "account",
    label: "Konto",
    hint: "Makro oder Scalp",
    none: "–",
    order: ["makro", "scalp"],
    keys: (t) => [accountOf(t)],
    labelOf: (k) => (k === "makro" ? "Makro" : "Scalp"),
  },
  {
    key: "tag",
    label: "Tags",
    hint: "Freie Tags (ein Trade mit zwei Tags zählt in beiden)",
    multi: true,
    none: "Ohne Tag",
    keys: (t) => {
      const tags = Array.isArray(t.tags) ? [...new Set(t.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))] : [];
      return tags.length ? tags : [NONE_KEY];
    },
    labelOf: (k) => `#${k}`,
  },
  {
    key: "strength",
    label: "Signal-Stärke",
    hint: "Stärke des Einstiegs-Checks beim Eintragen",
    none: "Ohne Check",
    order: ["4", "3", "2", "1", "0"],
    keys: (t) => {
      const s = snapOf(t)?.strength;
      return [fin(s) ? String(Math.max(0, Math.min(4, Math.round(s)))) : NONE_KEY];
    },
    labelOf: (k) => STRENGTH_LABEL[+k] ?? k,
  },
];

export const DIMENSIONS: Readonly<Record<DimensionKey, Dimension>> = Object.fromEntries(DIMS.map((d) => [d.key, d])) as Record<DimensionKey, Dimension>;
/** Menu order of the dimensions. */
export const DIMENSION_ORDER: readonly DimensionKey[] = DIMS.map((d) => d.key);

export const isDimensionKey = (v: unknown): v is DimensionKey => typeof v === "string" && v in DIMENSIONS;

/** Label of a bucket (the dimension's "ohne" label for `NONE_KEY`). */
export function bucketLabel(dim: Dimension, key: string, ctx: DimensionCtx): string {
  return key === NONE_KEY ? dim.none : dim.labelOf(key, ctx);
}

/** Closed trades grouped by a dimension (multi-bucket trades appear in each of their buckets). */
export function groupByDimension(closed: readonly EnrichedTrade[], dim: Dimension, ctx: DimensionCtx): Map<string, EnrichedTrade[]> {
  const m = new Map<string, EnrichedTrade[]>();
  for (const t of closed) {
    for (const k of dim.keys(t, ctx)) {
      const arr = m.get(k);
      if (arr) arr.push(t);
      else m.set(k, [t]);
    }
  }
  return m;
}
