/**
 * Die Eingaben des Handelsplans (Markt, Zeitrahmen, Sitzung, Stop- und Ziel-Regel, Konto, Risiko …) als reine Daten mit
 * einem nachsichtigen Leser: `formOf(irgendwas)` liefert immer ein gültiges Formular – unbekannte oder kaputte Werte fallen
 * auf die Voreinstellung, nichts wirft. Gespeichert wird das Formular einmal pro Gerät (zuletzt benutzt) und mit jedem
 * gespeicherten Plan (damit "Öffnen" genau die Annahmen von damals zurückholt).
 */
import { parseNumber } from "@/lib/parse";
import type { AccountId, Side } from "../types";
import type { EntrySides } from "./entry";
import type { StopRule, TargetRule } from "./exit";
import { DEFAULT_MANAGE, manageSpecOf, type ManageSpec } from "./manage";
import { symbolFits } from "./market";
import { isSessionId, sessionDef, type SessionId } from "./sessions";
import { MIN, parseDayKey, parseHHMM } from "./time";

export const PLAN_TFS = ["5m", "15m", "30m", "1h"] as const;
export type PlanTf = (typeof PLAN_TFS)[number];
export const TF_MS: Readonly<Record<PlanTf, number>> = { "5m": 5 * MIN, "15m": 15 * MIN, "30m": 30 * MIN, "1h": 60 * MIN };
export const TF_LABEL: Readonly<Record<PlanTf, string>> = { "5m": "5 Minuten", "15m": "15 Minuten", "30m": "30 Minuten", "1h": "1 Stunde" };
export const isPlanTf = (v: unknown): v is PlanTf => typeof v === "string" && (PLAN_TFS as readonly string[]).includes(v);

export const OR_CHOICES: readonly number[] = [5, 15, 30, 60];

export interface PlanForm {
  /** market symbol in the exchange's notation (`BTCUSDT`) */
  symbol: string;
  tf: PlanTf;
  session: SessionId;
  /** local calendar day of the session (`YYYY-MM-DD`), `null` = the latest session */
  day: string | null;
  orMinutes: number;
  sides: EntrySides;
  /** the signal candle needs this multiple of the range's average volume; `null` = off */
  minVolumeX: number | null;
  /** last entry, minutes after the open; `null` = the session's default */
  cutoffMin: number | null;
  /** a price the trader types instead of the signal's close / the breakout level */
  manualEntry: number | null;
  /** direction while there is no signal (plan ahead) or a typed entry */
  manualSide: Side;
  stop: StopRule;
  target: TargetRule;
  /** how the trade is managed after the entry (break-even, partial target, trailing) – all off by default (F65) */
  manage: ManageSpec;
  /** "flat by" clock time in the session's zone; `null` = five minutes before the end */
  flatBy: string | null;
  account: AccountId;
  /** risk per trade as a fraction of the capital; `null` = from the risk settings */
  riskPct: number | null;
  /** leverage for the buying power (1 = none) */
  leverage: number;
  /** quantity step; `null` = the default of the market kind */
  lot: number | null;
  /** price step; `null` = read from the candles */
  tick: number | null;
}

export const DEFAULT_FORM: Readonly<PlanForm> = Object.freeze({
  symbol: "BTCUSDT",
  tf: "5m" as PlanTf,
  session: "newyork" as SessionId,
  day: null,
  orMinutes: 15,
  sides: "both" as EntrySides,
  minVolumeX: null,
  cutoffMin: null,
  manualEntry: null,
  manualSide: "long" as Side,
  stop: { kind: "range-mid" } as StopRule,
  target: { kind: "r", r: 2 } as TargetRule,
  manage: DEFAULT_MANAGE as ManageSpec,
  flatBy: null,
  account: "scalp" as AccountId,
  riskPct: null,
  leverage: 1,
  lot: null,
  tick: null,
});

/** The ticker a stock form starts on when it holds none that fits (an example, like BTCUSDT for crypto). */
export const DEFAULT_STOCK_SYMBOL = "AAPL";

/** Default quantity step: crypto trades in thousandths, stocks in whole shares. */
export const DEFAULT_LOT = { crypto: 0.001, stocks: 1 } as const;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const posNum = (v: unknown, lo: number, hi: number): number | null => {
  const n = parseNumber(v);
  return n != null && n > lo - 1e-12 && n <= hi ? n : null;
};

export function stopRuleOf(raw: unknown): StopRule {
  if (!isObj(raw)) return DEFAULT_FORM.stop;
  switch (raw.kind) {
    case "range-mid":
      return { kind: "range-mid" };
    case "range-far":
      return { kind: "range-far" };
    case "atr": {
      const m = posNum(raw.mult, 0.1, 20);
      return m != null ? { kind: "atr", mult: m } : DEFAULT_FORM.stop;
    }
    case "pct": {
      const p = posNum(raw.pct, 0.01, 99);
      return p != null ? { kind: "pct", pct: p } : DEFAULT_FORM.stop;
    }
    case "price": {
      const p = posNum(raw.price, 1e-12, 1e12);
      return p != null ? { kind: "price", price: p } : DEFAULT_FORM.stop;
    }
    default:
      return DEFAULT_FORM.stop;
  }
}

export function targetRuleOf(raw: unknown): TargetRule {
  if (!isObj(raw)) return DEFAULT_FORM.target;
  switch (raw.kind) {
    case "r": {
      const r = posNum(raw.r, 0.1, 50);
      return r != null ? { kind: "r", r } : DEFAULT_FORM.target;
    }
    case "range-projection": {
      const m = posNum(raw.mult, 0.1, 20);
      return { kind: "range-projection", mult: m ?? 1 };
    }
    case "level": {
      const p = posNum(raw.price, 1e-12, 1e12);
      return p != null ? { kind: "level", price: p, name: typeof raw.name === "string" ? raw.name.slice(0, 60) : "Schlüsselmarke" } : DEFAULT_FORM.target;
    }
    case "price": {
      const p = posNum(raw.price, 1e-12, 1e12);
      return p != null ? { kind: "price", price: p } : DEFAULT_FORM.target;
    }
    default:
      return DEFAULT_FORM.target;
  }
}

/** Anything → a valid form (invalid parts fall back to the defaults, valid parts are kept). */
export function formOf(raw: unknown): PlanForm {
  const r: Raw = isObj(raw) ? raw : {};
  const d = DEFAULT_FORM;
  const session = isSessionId(r.session) ? r.session : d.session;
  // the symbol has to fit the market of the session: a crypto pair (3–20 letters / digits) or a US ticker (AAPL, BRK.B)
  const rawSymbol = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
  const symbol = rawSymbol && symbolFits(rawSymbol, sessionDef(session).market) ? rawSymbol : sessionDef(session).market === "stocks" ? DEFAULT_STOCK_SYMBOL : d.symbol;
  const or = posNum(r.orMinutes, 1, 480);
  const cutoff = posNum(r.cutoffMin, 5, 24 * 60);
  const risk = posNum(r.riskPct, 0.0001, 1);
  const vol = posNum(r.minVolumeX, 0.1, 100);
  const lev = posNum(r.leverage, 1, 125);
  const lot = posNum(r.lot, 1e-9, 1e9);
  const tick = posNum(r.tick, 1e-9, 1e9);
  const entry = posNum(r.manualEntry, 1e-12, 1e12);
  return {
    symbol,
    tf: isPlanTf(r.tf) ? r.tf : d.tf,
    session,
    day: typeof r.day === "string" && parseDayKey(r.day) ? r.day : null,
    orMinutes: or != null ? Math.round(or) : d.orMinutes,
    sides: r.sides === "long" || r.sides === "short" || r.sides === "both" ? r.sides : d.sides,
    minVolumeX: vol,
    cutoffMin: cutoff != null ? Math.round(cutoff) : null,
    manualEntry: entry,
    manualSide: r.manualSide === "short" ? "short" : "long",
    stop: stopRuleOf(r.stop),
    target: targetRuleOf(r.target),
    manage: manageSpecOf(r.manage),
    flatBy: typeof r.flatBy === "string" && parseHHMM(r.flatBy) != null ? r.flatBy.trim() : null,
    account: r.account === "makro" ? "makro" : "scalp",
    riskPct: risk,
    leverage: lev ?? 1,
    lot,
    tick,
  };
}
