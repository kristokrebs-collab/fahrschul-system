/**
 * `settings.forward` – the versioned passthrough key of the forward test (F23): `{ v: 1, accounts: [{ id, … }] }`. Reading is
 * strict per account (an entry that cannot be read goes to `rejected` and is written back untouched, never repaired
 * silently); writing keeps every unknown key of the root. The accounts are an id list, so the cloud / two-tab merge
 * (`merge3`) works per account and per trade; the cursor carries a check value (`cursorSig`) that makes a mixed-up merge
 * detectable – the account is then rebuilt from the candles (deterministic, nothing is lost that the candles still hold).
 */
import { feePreset } from "../backtest/fees";
import { HIST_MS, type EngineCarry, type SlippageModel } from "../backtest/types";
import { customKey, MAX_NAME as MAX_IDEA_NAME, sanitizeCustom, validateCustom } from "../lab/rules/tree";
import type { CustomConfig } from "../lab/rules/types";
import { sanitizeSignalCfg, type SignalCfg } from "../signals";
import {
  FORWARD_VERSION,
  MAX_ACCOUNTS,
  MAX_NAME,
  MAX_PAUSES,
  MAX_TRADES,
  type ForwardAccount,
  type ForwardCfg,
  type ForwardCursor,
  type ForwardFunding,
  type ForwardSource,
  type ForwardStatus,
  type Pause,
  type SourceKind,
  type StoredTrade,
} from "./types";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => fin(v) && v >= lo && v <= hi;

export const EMPTY_FORWARD: ForwardCfg = Object.freeze({ v: FORWARD_VERSION, accounts: [], rejected: [] }) as ForwardCfg;

/** Check value of a cursor: any mixture of two cursors (a merge of two devices) or a hand edit breaks it. */
export function cursorSig(c: Pick<ForwardCursor, "t" | "c" | "carry" | "nTrades" | "pnlSum" | "done">): string {
  // key order does not matter (a database may sort the keys of a stored object)
  const json = canon([c.t, c.c, c.carry, c.nTrades, c.pnlSum, c.done]);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 33) ^ json.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function emptyCursor(): ForwardCursor {
  const base = { t: null, c: null, carry: null, nTrades: 0, pnlSum: 0, done: false };
  return { ...base, sig: cursorSig(base) };
}

const REASONS = ["stop", "target", "time", "signal", "end", "breakeven", "trail"] as const;

function tradeOf(raw: unknown): StoredTrade | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 40) return null;
  if (raw.side !== "long" && raw.side !== "short") return null;
  if (!(REASONS as readonly unknown[]).includes(raw.reason)) return null;
  const nums = ["entryTime", "exitTime", "entry", "exit", "stop", "qty", "notional", "pnl", "fees", "funding", "slippage", "r", "move", "bars"] as const;
  for (const k of nums) if (!fin(raw[k])) return null;
  if (raw.target !== null && !fin(raw.target)) return null;
  const t: StoredTrade = {
    id: raw.id,
    side: raw.side,
    entryTime: raw.entryTime as number,
    exitTime: raw.exitTime as number,
    entry: raw.entry as number,
    exit: raw.exit as number,
    stop: raw.stop as number,
    target: raw.target as number | null,
    qty: raw.qty as number,
    notional: raw.notional as number,
    pnl: raw.pnl as number,
    fees: raw.fees as number,
    funding: raw.funding as number,
    slippage: raw.slippage as number,
    r: raw.r as number,
    move: raw.move as number,
    bars: raw.bars as number,
    reason: raw.reason as StoredTrade["reason"],
  };
  if (fin(raw.stopExit)) t.stopExit = raw.stopExit;
  if (raw.ambiguous === true) t.ambiguous = true;
  if (Array.isArray(raw.partials)) {
    const ps = raw.partials.filter((p): p is Raw => isObj(p) && fin(p.time) && fin(p.price) && fin(p.qty) && fin(p.pnl) && fin(p.fee)).slice(0, 4);
    if (ps.length) t.partials = ps.map((p) => ({ time: p.time as number, price: p.price as number, qty: p.qty as number, pnl: p.pnl as number, fee: p.fee as number }));
  }
  return t;
}

function slippageOf(raw: unknown): SlippageModel | null {
  if (!isObj(raw)) return null;
  if (raw.kind === "none") return { kind: "none" };
  if (raw.kind === "fixed" && inRange(raw.bps, 0, 500)) return { kind: "fixed", bps: raw.bps };
  if (raw.kind === "spread" && inRange(raw.bps, 0, 500)) return { kind: "spread", bps: raw.bps };
  if (raw.kind === "atr" && inRange(raw.frac, 0, 5)) return { kind: "atr", frac: raw.frac };
  return null;
}

const SOURCE_KINDS: readonly SourceKind[] = ["editor", "draft", "template", "playbook"];

function sourceOf(raw: unknown): ForwardSource {
  const r = isObj(raw) ? raw : {};
  const kind = (SOURCE_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as SourceKind) : "editor";
  const out: ForwardSource = { kind, label: typeof r.label === "string" ? r.label.slice(0, 80) : "" };
  if (fin(r.versionNo) && r.versionNo >= 1 && r.versionNo <= 9999) out.versionNo = Math.round(r.versionNo);
  if (r.foreign === true) out.foreign = true;
  return out;
}

function cursorOf(raw: unknown): ForwardCursor {
  if (!isObj(raw)) return emptyCursor();
  const carry = isObj(raw.carry) ? (raw.carry as unknown as EngineCarry) : null;
  const c: ForwardCursor = {
    t: fin(raw.t) ? raw.t : null,
    c: fin(raw.c) ? raw.c : null,
    carry,
    nTrades: fin(raw.nTrades) ? raw.nTrades : 0,
    pnlSum: fin(raw.pnlSum) ? raw.pnlSum : 0,
    done: raw.done === true,
    sig: typeof raw.sig === "string" ? raw.sig : "",
  };
  return c;
}

/** One stored account → `ForwardAccount`, or `null` when it cannot be read. */
export function accountOf(raw: unknown): ForwardAccount | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || !/^[\w-]{1,40}$/.test(raw.id)) return null;
  const status: ForwardStatus | null = raw.status === "running" || raw.status === "paused" || raw.status === "ended" ? raw.status : null;
  if (!status) return null;
  if (!isObj(raw.config) || raw.config.version !== 1) return null;
  const config = sanitizeCustom(raw.config);
  if (typeof raw.symbol !== "string" || !/^[A-Z0-9]{2,24}$/.test(raw.symbol)) return null;
  if (!inRange(raw.startMs, 0, 4e12) || !inRange(raw.createdAt, 0, 4e12)) return null;
  if (!inRange(raw.capital, 100, 1e9) || !inRange(raw.riskPct, 0.05, 10) || !inRange(raw.maxLeverage, 1, 125)) return null;
  const slippage = slippageOf(raw.slippage);
  if (!slippage) return null;
  const funding: ForwardFunding = raw.funding === "history" || raw.funding === "flat" || raw.funding === "none" ? raw.funding : "flat";
  const pauses: Pause[] = [];
  if (Array.isArray(raw.pauses)) {
    for (const p of raw.pauses.slice(0, MAX_PAUSES)) {
      if (isObj(p) && fin(p.from) && (p.to === null || fin(p.to))) pauses.push({ from: p.from, to: p.to as number | null });
    }
  }
  const trades: StoredTrade[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(raw.trades) ? raw.trades.slice(0, MAX_TRADES + 1) : []) {
    const s = tradeOf(t);
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      trades.push(s);
    }
  }
  trades.sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : config.name;
  const acct: ForwardAccount = {
    id: raw.id,
    name,
    createdAt: raw.createdAt,
    status,
    pauses,
    symbol: raw.symbol,
    interval: config.interval,
    startMs: raw.startMs,
    capital: raw.capital,
    riskPct: raw.riskPct,
    maxLeverage: raw.maxLeverage,
    exchange: feePreset(typeof raw.exchange === "string" ? raw.exchange : "binance").exchange,
    slippage,
    funding,
    config,
    key: customKey(config),
    signal: sanitizeSignalCfg(raw.signal),
    source: sourceOf(raw.source),
    cursor: cursorOf(raw.cursor),
    trades,
  };
  if (fin(raw.endedAt)) acct.endedAt = raw.endedAt;
  if (raw.endReason === "user" || raw.endReason === "limit") acct.endReason = raw.endReason;
  return acct;
}

/** `settings.forward` (anything) → the accounts. A duplicated id keeps the first entry. */
export function forwardCfgOf(raw: unknown): ForwardCfg {
  if (!isObj(raw)) return EMPTY_FORWARD;
  const accounts: ForwardAccount[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw.accounts) ? raw.accounts : []) {
    const a = accountOf(e);
    if (!a) rejected.push(e);
    else if (!seen.has(a.id) && accounts.length < MAX_ACCOUNTS) {
      seen.add(a.id);
      accounts.push(a);
    }
  }
  return { v: FORWARD_VERSION, accounts, rejected };
}

export const forwardOfSettings = (s: { forward?: unknown } | null | undefined): ForwardCfg => forwardCfgOf(s?.forward);

/** Cheap check for the host: does any account still need the app's attention (running, or ended but not flattened yet)? */
export function hasActiveForward(raw: unknown): boolean {
  if (!isObj(raw) || !Array.isArray(raw.accounts)) return false;
  return raw.accounts.some((a) => isObj(a) && (a.status === "running" || a.status === "paused" || (a.status === "ended" && isObj(a.cursor) && a.cursor.done !== true)));
}

/**
 * `settings.forward` with the accounts replaced – the unknown keys of the root and the `rejected` entries survive. Returns the
 * SAME object when nothing changes (the caller skips the save).
 */
export function withAccounts(raw: unknown, accounts: readonly ForwardAccount[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = forwardCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: FORWARD_VERSION, accounts: [...accounts, ...cur.rejected] };
  const same = isObj(raw) && canon(prev) === canon(next);
  return same ? (raw as Record<string, unknown>) : next;
}

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

// ── a new account ────────────────────────────────────────────────────────────────────────────────────────────────

export interface NewAccountInput {
  id: string;
  name: string;
  config: CustomConfig;
  signal: SignalCfg;
  symbol: string;
  capital: number;
  /** percent */
  riskPct: number;
  maxLeverage: number;
  exchange: string;
  slippage: SlippageModel;
  funding: ForwardFunding;
  source: ForwardSource;
}

/** Open time (ms) of the candle that contains `now`: the first one the account may decide on (its close is after the start). */
export const startOf = (interval: CustomConfig["interval"], now: number): number => Math.floor(now / HIST_MS[interval]) * HIST_MS[interval];

/** Why an account cannot be created from this input (`null` = it can). The rules must run: errors of the check block it. */
export function newAccountError(input: Pick<NewAccountInput, "config" | "symbol" | "capital" | "riskPct" | "maxLeverage">, existing: readonly ForwardAccount[]): string | null {
  if (existing.length >= MAX_ACCOUNTS) return `Mehr als ${MAX_ACCOUNTS} virtuelle Konten gehen nicht. Beende und lösche eines, um Platz zu schaffen.`;
  const bad = validateCustom(sanitizeCustom(input.config)).find((i) => i.level === "error");
  if (bad) return `Die Regeln lassen sich so nicht laufen lassen: ${bad.text}`;
  if (!/^[A-Z0-9]{2,24}$/.test(input.symbol)) return "Bitte einen Markt wie BTCUSDT angeben.";
  if (!inRange(input.capital, 100, 1e9)) return "Das Startkapital muss zwischen 100 und 1 000 000 000 liegen.";
  if (!inRange(input.riskPct, 0.05, 10)) return "Das Risiko pro Trade muss zwischen 0,05 % und 10 % liegen.";
  if (!inRange(input.maxLeverage, 1, 125)) return "Der maximale Hebel muss zwischen 1 und 125 liegen.";
  return null;
}

/** The account at the moment of its start: nothing processed, no trades. The rules are frozen as a sanitised copy. */
export function newAccount(input: NewAccountInput, now: number): ForwardAccount {
  const config = sanitizeCustom(input.config);
  return {
    id: input.id,
    name: input.name.trim().slice(0, MAX_NAME) || config.name.slice(0, MAX_IDEA_NAME),
    createdAt: now,
    status: "running",
    pauses: [],
    symbol: input.symbol,
    interval: config.interval,
    startMs: startOf(config.interval, now),
    capital: input.capital,
    riskPct: input.riskPct,
    maxLeverage: input.maxLeverage,
    exchange: feePreset(input.exchange).exchange,
    slippage: input.slippage,
    funding: input.funding,
    config,
    key: customKey(config),
    signal: sanitizeSignalCfg(input.signal),
    source: { ...input.source, label: input.source.label.slice(0, 80) },
    cursor: emptyCursor(),
    trades: [],
  };
}
