/**
 * `settings.plan` – der versionierte Passthrough-Schlüssel des Handelsplans (Muster `settings.keyLevels`):
 * `{ v: 1, prefs, plans }`. `prefs` sind die Plan-Regeln des Nutzers (Deckel für eine Position, Cash-Puffer, kleinstes
 * Chance-Risiko, kleinster Positionswert), `plans` die gespeicherten Pläne – eine Liste von Objekten mit `id`, damit der
 * Zwei-Tab- und Cloud-Abgleich pro Plan zusammenführt. Lesen ist nachsichtig (`planCfgOf`), Schreiben (`withPlanCfg`) behält
 * jeden unbekannten Schlüssel der Wurzel und jeden Eintrag, den diese Version nicht lesen kann (`rejected`), und gibt
 * dasselbe Objekt zurück, wenn sich nichts ändert. Der Schlüssel fehlt, bis jemand etwas ändert oder einen Plan speichert.
 */
import { parseNumber } from "@/lib/parse";
import type { Side } from "../types";
import { formOf, type PlanForm } from "./form";

export const PLAN_VERSION = 1 as const;
export const MAX_PLANS = 20;

export interface PlanPrefs {
  /** cap of one position's value, fraction of the capital */
  maxPositionPct: number;
  /** share of the capital that stays free, fraction */
  cashBufferPct: number;
  /** smallest acceptable reward ÷ risk */
  minRewardRisk: number;
  /** smallest position value (quote currency) */
  minOrderValue: number;
}

export const DEFAULT_PREFS: Readonly<PlanPrefs> = Object.freeze({ maxPositionPct: 0.75, cashBufferPct: 0.1, minRewardRisk: 1, minOrderValue: 5 });

export type FlatByState = "pending" | "fired" | "missed";

/** The three alarms of a plan: two key levels of the app (by id) and the clock reminder. */
export interface PlanAlarms {
  stopId: string;
  targetId: string;
  flatBy: { at: number; state: FlatByState; firedAt: number | null } | null;
  createdAt: number;
}

export interface SavedPlan {
  id: string;
  savedAt: number;
  symbol: string;
  side: Side;
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  notional: number;
  /** loss at the stop incl. fees and slippage */
  maxLoss: number;
  rr: number | null;
  light: "green" | "amber" | "red";
  currency: string;
  /** "Binance USDⓈ-M" */
  sourceLabel: string;
  candlesUntil: number | null;
  fetchedAt: number | null;
  signalAt: number | null;
  flatByMs: number | null;
  /** IANA zone of the session (for the clock times in the list) */
  tz: string;
  sessionLabel: string;
  stopLabel: string;
  targetLabel: string;
  form: PlanForm;
  alarms: PlanAlarms | null;
  /** a journal draft was opened from this plan at that time */
  journalAt: number | null;
}

export interface PlanCfg {
  v: typeof PLAN_VERSION;
  prefs: PlanPrefs;
  plans: SavedPlan[];
}

export interface ParsedPlanCfg extends PlanCfg {
  /** stored plans this version could not read – written back untouched */
  rejected: unknown[];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = parseNumber(v);
  return n != null && Number.isFinite(n) ? n : null;
};
const numOr = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = num(v);
  return n != null && n >= lo && n <= hi ? n : d;
};
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

export function prefsOf(raw: unknown): PlanPrefs {
  const r: Raw = isObj(raw) ? raw : {};
  const d = DEFAULT_PREFS;
  return {
    maxPositionPct: numOr(r.maxPositionPct, 0.01, 10, d.maxPositionPct),
    cashBufferPct: numOr(r.cashBufferPct, 0, 0.9, d.cashBufferPct),
    minRewardRisk: numOr(r.minRewardRisk, 0, 50, d.minRewardRisk),
    minOrderValue: numOr(r.minOrderValue, 0, 1e9, d.minOrderValue),
  };
}

function alarmsOf(raw: unknown): PlanAlarms | null {
  if (!isObj(raw)) return null;
  const stopId = str(raw.stopId, 60);
  const targetId = str(raw.targetId, 60);
  const createdAt = num(raw.createdAt);
  if (!stopId || !targetId || createdAt == null) return null;
  let flatBy: PlanAlarms["flatBy"] = null;
  if (isObj(raw.flatBy)) {
    const at = num(raw.flatBy.at);
    const st = raw.flatBy.state;
    if (at != null && (st === "pending" || st === "fired" || st === "missed")) flatBy = { at, state: st, firedAt: num(raw.flatBy.firedAt) };
  }
  return { stopId, targetId, flatBy, createdAt };
}

/** One stored plan → `SavedPlan`, or `null` when it cannot be read (kept aside by the caller). */
export function normalizePlan(raw: unknown): SavedPlan | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 60);
  const entry = num(raw.entry);
  const stop = num(raw.stop);
  const qty = num(raw.qty);
  const savedAt = num(raw.savedAt);
  if (!id || entry == null || stop == null || qty == null || savedAt == null || !(entry > 0) || !(stop > 0) || !(qty > 0)) return null;
  if (raw.side !== "long" && raw.side !== "short") return null;
  const light = raw.light === "green" || raw.light === "amber" || raw.light === "red" ? raw.light : null;
  if (!light) return null;
  const target = num(raw.target);
  return {
    id,
    savedAt,
    symbol: str(raw.symbol, 20) ?? "BTCUSDT",
    side: raw.side,
    entry,
    stop,
    target: target != null && target > 0 ? target : null,
    qty,
    notional: numOr(raw.notional, 0, 1e15, entry * qty),
    maxLoss: numOr(raw.maxLoss, 0, 1e15, 0),
    rr: num(raw.rr),
    light,
    currency: str(raw.currency, 8) ?? "USDT",
    sourceLabel: str(raw.sourceLabel) ?? "keine Daten",
    candlesUntil: num(raw.candlesUntil),
    fetchedAt: num(raw.fetchedAt),
    signalAt: num(raw.signalAt),
    flatByMs: num(raw.flatByMs),
    tz: str(raw.tz, 40) ?? "UTC",
    sessionLabel: str(raw.sessionLabel, 120) ?? "",
    stopLabel: str(raw.stopLabel) ?? "",
    targetLabel: str(raw.targetLabel) ?? "",
    form: formOf(raw.form),
    alarms: alarmsOf(raw.alarms),
    journalAt: num(raw.journalAt),
  };
}

export const EMPTY_PLAN_CFG: ParsedPlanCfg = Object.freeze({ v: PLAN_VERSION, prefs: DEFAULT_PREFS as PlanPrefs, plans: [], rejected: [] }) as ParsedPlanCfg;

/** `settings.plan` (anything) → a full config. Duplicated ids keep the first entry. */
export function planCfgOf(raw: unknown): ParsedPlanCfg {
  if (!isObj(raw)) return EMPTY_PLAN_CFG;
  const plans: SavedPlan[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.plans) ? raw.plans : []) {
    const p = normalizePlan(entry);
    if (!p) rejected.push(entry);
    else if (!seen.has(p.id) && plans.length < MAX_PLANS) {
      seen.add(p.id);
      plans.push(p);
    }
  }
  return { v: PLAN_VERSION, prefs: prefsOf(raw.prefs), plans, rejected };
}

/** `settings.plan` of a settings object. */
export const planOfSettings = (s: { plan?: unknown } | null | undefined): ParsedPlanCfg => planCfgOf(s?.plan);

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/**
 * `settings.plan` with `patch` applied – unknown root keys and the `rejected` entries survive. The SAME object comes back when
 * nothing changes (the caller skips the save).
 */
export function withPlanCfg(raw: unknown, patch: { prefs?: Partial<PlanPrefs>; plans?: SavedPlan[] }): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = planCfgOf(raw);
  const next: Record<string, unknown> = { ...prev };
  next.v = PLAN_VERSION;
  next.prefs = patch.prefs ? prefsOf({ ...cur.prefs, ...patch.prefs }) : cur.prefs;
  next.plans = [...(patch.plans ?? cur.plans), ...cur.rejected];
  // an untouched, absent key stays absent: only a real change creates it
  const same = isObj(raw) && canon(prev) === canon(next);
  if (!isObj(raw) && !patch.prefs && !patch.plans) return raw as unknown as Record<string, unknown>;
  return same ? (raw as Record<string, unknown>) : next;
}
