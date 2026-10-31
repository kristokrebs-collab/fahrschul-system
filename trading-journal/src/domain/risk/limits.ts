/**
 * Live limits (P05), pure: daily loss, weekly loss, drawdown from the peak, trades per day, leverage and open risk,
 * each with the state ok / warn / breach, plus the pause (cooldown) after a breached day or a losing streak.
 *
 * - Limits: `riskLimits(settings)` – the daily loss, the loss per trade and the trades per day come from
 *   `settings.discipline` (the same numbers the discipline score uses), the leverage rule from `ED.LEVERAGE_RULE`.
 * - Money limits are fractions of the account's start capital (`settings.capital`, like the discipline rules). With the
 *   scope "all" every account is checked against its own limit and the worst account is reported.
 * - Realised P&L counts on the day / week the trade CLOSED: `exitDate` when the trade has one, else the moment the guard
 *   saw it close (`marks`), else its entry time (old records).
 * - The journal is never blocked: these states only drive warnings, toasts and the pause.
 */
import { accountView } from "../account";
import type { AccountId, EnrichedTrade, Settings } from "../types";
import { localDateKey, tradeTime, weekStart } from "@/lib/dates";
import { n0 } from "@/lib/format";
import { riskLimits, type RiskLimits } from "./config";
import { openRiskOf } from "./exposure";

export type LimitKey = "day" | "week" | "drawdown" | "trade" | "trades" | "leverage" | "openRisk";
export type LimitState = "ok" | "warn" | "breach";
export type RiskScope = "all" | AccountId;

export const LIMIT_ORDER: readonly LimitKey[] = ["day", "week", "drawdown", "openRisk", "trade", "trades", "leverage"];

export const LIMIT_LABELS: Readonly<Record<LimitKey, string>> = {
  day: "Tagesverlust",
  week: "Wochenverlust",
  drawdown: "Drawdown",
  trade: "Größter Verlust",
  trades: "Trades heute",
  leverage: "Hebel",
  openRisk: "Offenes Risiko",
};

export interface LimitRow {
  key: LimitKey;
  label: string;
  /** used amount: a loss as a positive number, a count, a leverage */
  used: number;
  limit: number;
  /** used ÷ limit */
  ratio: number;
  state: LimitState;
  unit: "money" | "count" | "x" | "pct";
  /** account the row refers to (scope "all": the worst one; drawdown / venue leverage: null) */
  account: AccountId | null;
  /** German detail line */
  detail: string;
}

export interface Cooldown {
  reason: "day" | "losses";
  /** epoch ms the pause started (the closing loss) */
  since: number;
  endsAt: number;
  /** losses in a row at the start */
  losses: number;
}

/** Minimal shape of an exchange position the limits read (P11 `ExchangePosition`). */
export interface LeveragedPosition {
  symbol: string;
  leverage: number | null;
}

export interface LimitInput {
  /** every enriched trade of the journal (all accounts; the scope filters) */
  trades: readonly EnrichedTrade[];
  settings: Settings & { risk?: unknown; discipline?: unknown };
  scope: RiskScope;
  now: number;
  /** live exchange positions (their leverage counts against the rule) */
  positions?: readonly LeveragedPosition[];
  /** trade id → epoch ms the guard saw it close (for trades without `exitDate`) */
  marks?: Readonly<Record<string, number>>;
}

export interface LimitReport {
  scope: RiskScope;
  rows: LimitRow[];
  worst: LimitState;
  cooldown: Cooldown | null;
  limits: RiskLimits;
  /** start capital of the scope */
  capital: number;
  /** realised P&L of today / this week in the scope (all accounts summed) */
  dayPnl: number;
  weekPnl: number;
  /** Σ distance-to-stop × qty of the open trades in the scope */
  openRisk: number;
  /** open trades in the scope without a stop */
  openNoStop: number;
  tradesToday: number;
  currency: string;
}

const ACCOUNTS: readonly AccountId[] = ["makro", "scalp"];
const ACC_LABEL: Record<AccountId, string> = { makro: "Makro", scalp: "Scalp" };
const accountOf = (t: { account?: AccountId }): AccountId => t.account ?? "scalp";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Parses the journal's local wall clock ("YYYY-MM-DDTHH:mm[:ss]"); NaN when absent / invalid. */
export function parseLocal(s: string | null | undefined): number {
  if (!s || typeof s !== "string") return NaN;
  const t = new Date(s.length === 10 ? `${s}T00:00` : s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** When the trade closed: `exitDate`, else the guard's mark, else the entry time (old records). */
export function closeAt(t: Pick<EnrichedTrade, "id" | "date" | "createdAt"> & { exitDate?: string }, marks?: Readonly<Record<string, number>>): number {
  const x = parseLocal(t.exitDate);
  if (Number.isFinite(x)) return x;
  const m = marks?.[t.id];
  if (fin(m)) return m;
  return +tradeTime(t);
}

/** Local midnight after `now`. */
export function nextMidnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** State of a ratio: breach at ≥ 1 (`strict`: only above 1), warn from `warnAt`. */
export function stateOf(ratio: number, warnAt: number, strict = false): LimitState {
  if (!Number.isFinite(ratio)) return "breach";
  if (strict ? ratio > 1 + 1e-9 : ratio >= 1 - 1e-9) return "breach";
  return ratio >= warnAt ? "warn" : "ok";
}

const RANK: Record<LimitState, number> = { ok: 0, warn: 1, breach: 2 };
export const worstState = (states: readonly LimitState[]): LimitState => states.reduce<LimitState>((w, s) => (RANK[s] > RANK[w] ? s : w), "ok");

const money = (x: number, cur: string): string => `${n0(x)} ${cur}`;
const pctText = (x: number): string => `${(Math.round(x * 1000) / 10).toString().replace(".", ",")} %`;
const xText = (x: number): string => `${(Math.round(x * 10) / 10).toString().replace(".", ",")}×`;

/** Pause after a breached day (until midnight) or `cooldownLosses` losses in a row (`cooldownMin` after the last). */
export function cooldownOf(input: { closed: readonly EnrichedTrade[]; now: number; limits: RiskLimits; marks?: Readonly<Record<string, number>>; dayBreach: boolean }): Cooldown | null {
  const { now, limits, marks } = input;
  const seq = input.closed
    .filter((t) => t.result !== "open")
    .map((t) => ({ t, at: closeAt(t, marks) }))
    .filter((x) => x.at <= now)
    .sort((a, b) => a.at - b.at);
  let streak = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]!.t.result === "loss"; i--) streak++;
  const last = seq[seq.length - 1];
  const out: Cooldown[] = [];
  if (input.dayBreach) {
    const today = localDateKey(new Date(now));
    const lastLossToday = [...seq].reverse().find((x) => x.t.result === "loss" && localDateKey(new Date(x.at)) === today);
    out.push({ reason: "day", since: lastLossToday?.at ?? now, endsAt: nextMidnight(now), losses: streak });
  }
  if (limits.cooldownLosses > 0 && limits.cooldownMin > 0 && last && streak >= limits.cooldownLosses) {
    const endsAt = last.at + limits.cooldownMin * 60_000;
    if (now < endsAt) out.push({ reason: "losses", since: last.at, endsAt, losses: streak });
  }
  if (!out.length) return null;
  return out.sort((a, b) => b.endsAt - a.endsAt)[0]!;
}

interface AccNumbers {
  acc: AccountId;
  capital: number;
  dayPnl: number;
  weekPnl: number;
  /** largest single loss closed today (positive) */
  worstToday: number;
  tradesToday: number;
  openRisk: number;
  openNoStop: number;
  maxLev: number | null;
}

function numbersOf(acc: AccountId, trades: readonly EnrichedTrade[], capital: number, now: number, marks?: Readonly<Record<string, number>>): AccNumbers {
  const today = localDateKey(new Date(now));
  const wk = weekStart(new Date(now)).getTime();
  let dayPnl = 0;
  let weekPnl = 0;
  let worstToday = 0;
  let tradesToday = 0;
  let openRisk = 0;
  let openNoStop = 0;
  let maxLev: number | null = null;
  for (const t of trades) {
    if (accountOf(t) !== acc) continue;
    if (localDateKey(tradeTime(t)) === today) tradesToday++;
    if (t.result === "open") {
      // what is still open (after partial exits only the remainder, review MM-1)
      const risk = openRiskOf(t);
      if (fin(risk) && risk > 0) openRisk += risk;
      else if (!(fin(t.stop) && t.stop > 0)) openNoStop++;
      if (fin(t.leverage) && t.leverage > 0) maxLev = Math.max(maxLev ?? 0, t.leverage);
      continue;
    }
    if (!fin(t.pnl)) continue;
    const at = closeAt(t, marks);
    if (at > now) continue;
    if (localDateKey(new Date(at)) === today) {
      dayPnl += t.pnl;
      worstToday = Math.max(worstToday, -t.pnl);
    }
    if (at >= wk) weekPnl += t.pnl;
  }
  return { acc, capital, dayPnl, weekPnl, worstToday, tradesToday, openRisk, openNoStop, maxLev };
}

/** The live limit status of a scope (see the module comment). */
export function limitStatus(input: LimitInput): LimitReport {
  const { trades, settings, scope, now, marks } = input;
  const limits = riskLimits(settings);
  const cur = settings.currency;
  const accs = scope === "all" ? ACCOUNTS : [scope];
  const nums = accs.map((a) => numbersOf(a, trades, settings.capital[a] ?? 0, now, marks)).filter((x) => x.capital > 0);
  const tag = (a: AccountId) => (scope === "all" ? ` · ${ACC_LABEL[a]}` : "");
  const rows: LimitRow[] = [];
  const pick = (cands: LimitRow[]) => {
    if (cands.length) rows.push(cands.sort((a, b) => RANK[b.state] - RANK[a.state] || b.ratio - a.ratio)[0]!);
  };

  // daily / weekly loss
  pick(
    nums.map((n) => {
      const limit = limits.maxLossDayPct * n.capital;
      const used = Math.max(0, -n.dayPnl);
      const ratio = used / limit;
      return { key: "day", label: LIMIT_LABELS.day, used, limit, ratio, state: stateOf(ratio, limits.warnAt), unit: "money", account: n.acc, detail: `${used > 0 ? "−" : ""}${money(used, cur)} von ${money(limit, cur)} heute${tag(n.acc)}` } satisfies LimitRow;
    }),
  );
  pick(
    nums.map((n) => {
      const limit = limits.maxLossWeekPct * n.capital;
      const used = Math.max(0, -n.weekPnl);
      const ratio = used / limit;
      return { key: "week", label: LIMIT_LABELS.week, used, limit, ratio, state: stateOf(ratio, limits.warnAt), unit: "money", account: n.acc, detail: `${used > 0 ? "−" : ""}${money(used, cur)} von ${money(limit, cur)} diese Woche${tag(n.acc)}` } satisfies LimitRow;
    }),
  );

  // drawdown from the equity peak of the scope
  const capital = nums.reduce((s, n) => s + n.capital, 0);
  if (capital > 0) {
    const v = accountView(trades, settings, scope);
    const used = Math.max(0, -v.curDD);
    const ratio = used / limits.maxDrawdownPct;
    rows.push({ key: "drawdown", label: LIMIT_LABELS.drawdown, used, limit: limits.maxDrawdownPct, ratio, state: stateOf(ratio, limits.warnAt), unit: "pct", account: null, detail: `${used > 0 ? "−" : ""}${pctText(used)} vom Hoch · Grenze ${pctText(limits.maxDrawdownPct)}` });
  }

  // open risk
  pick(
    nums.map((n) => {
      const limit = limits.maxOpenRiskPct * n.capital;
      const ratio = n.openRisk / limit;
      // a trade without a stop has no bounded risk: at least "warn"
      const state = n.openNoStop > 0 && stateOf(ratio, limits.warnAt) === "ok" ? "warn" : stateOf(ratio, limits.warnAt);
      const noStop = n.openNoStop ? ` · ${n.openNoStop} ohne Stop` : "";
      return { key: "openRisk", label: LIMIT_LABELS.openRisk, used: n.openRisk, limit, ratio, state, unit: "money", account: n.acc, detail: `${money(n.openRisk, cur)} von ${money(limit, cur)} bis zu den Stops${noStop}${tag(n.acc)}` } satisfies LimitRow;
    }),
  );

  // the largest single loss of today against the per-trade limit (settings.discipline.maxLossTradePct)
  pick(
    nums.map((n) => {
      const limit = limits.maxLossTradePct * n.capital;
      const ratio = n.worstToday / limit;
      return { key: "trade", label: LIMIT_LABELS.trade, used: n.worstToday, limit, ratio, state: stateOf(ratio, limits.warnAt, true), unit: "money", account: n.acc, detail: `${n.worstToday > 0 ? "−" : ""}${money(n.worstToday, cur)} von ${money(limit, cur)} pro Trade${tag(n.acc)}` } satisfies LimitRow;
    }),
  );

  // trades per day: the limit itself is allowed, only more is a breach
  pick(
    nums.map((n) => {
      const limit = limits.maxTrades[n.acc];
      const ratio = n.tradesToday / limit;
      const state = n.tradesToday > limit ? "breach" : n.tradesToday === limit ? "warn" : stateOf(ratio, limits.warnAt, true);
      const detail = n.tradesToday >= limit ? `${n.tradesToday} von ${limit} – kein weiterer Trade heute${tag(n.acc)}` : `${n.tradesToday} von ${limit} heute${tag(n.acc)}`;
      return { key: "trades", label: LIMIT_LABELS.trades, used: n.tradesToday, limit, ratio, state, unit: "count", account: n.acc, detail } satisfies LimitRow;
    }),
  );

  // leverage of open trades (per account rule) and of venue positions (the scope's strictest rule)
  const levCands: LimitRow[] = nums
    .filter((n) => n.maxLev != null)
    .map((n) => {
      const limit = limits.leverageRule[n.acc];
      const ratio = n.maxLev! / limit;
      return { key: "leverage", label: LIMIT_LABELS.leverage, used: n.maxLev!, limit, ratio, state: stateOf(ratio, limits.warnAt, true), unit: "x", account: n.acc, detail: `${xText(n.maxLev!)} offen · Regel ${xText(limit)}${tag(n.acc)}` } satisfies LimitRow;
    });
  const posLev = (input.positions ?? []).map((p) => p.leverage).filter((l): l is number => fin(l) && l > 0);
  if (posLev.length && nums.length) {
    const limit = Math.min(...nums.map((n) => limits.leverageRule[n.acc]));
    const used = Math.max(...posLev);
    const ratio = used / limit;
    levCands.push({ key: "leverage", label: LIMIT_LABELS.leverage, used, limit, ratio, state: stateOf(ratio, limits.warnAt, true), unit: "x", account: null, detail: `${xText(used)} an der Börse · Regel ${xText(limit)}` });
  }
  if (levCands.length) pick(levCands);
  else if (nums.length) {
    const limit = Math.min(...nums.map((n) => limits.leverageRule[n.acc]));
    rows.push({ key: "leverage", label: LIMIT_LABELS.leverage, used: 0, limit, ratio: 0, state: "ok", unit: "x", account: null, detail: `kein offener Hebel · Regel ${xText(limit)}` });
  }

  rows.sort((a, b) => LIMIT_ORDER.indexOf(a.key) - LIMIT_ORDER.indexOf(b.key));
  const dayBreach = rows.some((r) => r.key === "day" && r.state === "breach");
  const scoped = trades.filter((t) => accs.includes(accountOf(t)));
  const cooldown = cooldownOf({ closed: scoped, now, limits, marks, dayBreach });
  return {
    scope,
    rows,
    worst: worstState(rows.map((r) => r.state)),
    cooldown,
    limits,
    capital,
    dayPnl: nums.reduce((s, n) => s + n.dayPnl, 0),
    weekPnl: nums.reduce((s, n) => s + n.weekPnl, 0),
    openRisk: nums.reduce((s, n) => s + n.openRisk, 0),
    openNoStop: nums.reduce((s, n) => s + n.openNoStop, 0),
    tradesToday: nums.reduce((s, n) => s + n.tradesToday, 0),
    currency: cur,
  };
}
