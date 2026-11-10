/**
 * Branchen-Signal → Papier-Position (C1). Pure: the rules and the book, no network, no storage, no order.
 *
 *   signal (grün | rot)  →  candidate check with the Zeitmaschine  →  risk rule  →  exactly ONE paper position  →  history
 *
 * - **Grün** = the industry is in the market in the rule's simulation → a LONG position in an ETF that stands for the industry (a
 *   rough proxy, said so everywhere). **Rot** = cash: an open position of that industry is closed, nothing is ever sold short.
 * - **Idempotent.** A signal has an id (`signalIdOf`: source, strategy, industry, direction, day); a position's id (= its trade id) is
 *   derived from it, so the same signal arriving twice, or the button pressed twice, makes ONE position. A second green signal for
 *   an industry / instrument that is already held opens nothing.
 * - **Nothing on old data.** The age of the signal (its last data day) and of the instrument's last candle is checked first; with
 *   too old data the check says why and nothing opens. (The Ken-French file is weeks old by design: this gate usually refuses it –
 *   the bridge opens positions once fresh signals arrive, e.g. from TradingView.)
 * - **Not-Aus** (kill switch): no new position while it is on; closing stays possible.
 * - **Paper only.** Every position says `modus: "PAPIER"`, `gesendet: false`. Fills are the instrument's last close, an assumption.
 * Simulation ≠ forecast: the Zeitmaschine's verdict is a gate against a plan that looks clearly bad in the model, not a promise.
 */
import { atrSeries } from "../backtest/bars";
import type { Bar } from "../backtest/types";
import { sha256Hex } from "../timemachine/hash";
import { MIN_POOL_BARS } from "../timemachine/types";
import type { AmpelRow } from "./ampel";
import { fmtDay, industryName } from "./config";

/* ------------------------------------------------------------------------------------------------ constants */

/** The paper account (an assumption of this module, shown in the UI; there is no real account behind it). */
export const PAPER_CAPITAL = 10_000;
/** Risk per position (entry → stop) as a share of the paper capital. */
export const RISK_PCT = 0.01;
/** No position larger than this share of the capital (no leverage). */
export const MAX_POSITION_PCT = 0.25;
/** Open positions at the same time. */
export const MAX_OPEN = 5;
/** A signal whose last data day is older than this many calendar days is too old to act on. */
export const MAX_SIGNAL_AGE_DAYS = 4;
/** The last closed candle of the instrument must be younger than this (calendar days). */
export const MAX_BAR_AGE_DAYS = 5;
/** Simulated sessions the check needs at least. */
export const MIN_SIM_RUNS = 1_000;
/** The plan the check plays through: stop `STOP_ATR` × ATR(14) under the entry, target `TARGET_R` × the risk above it, time stop `HORIZON` days. */
export const CHECK_PLAN = { atrLen: 14, stopAtr: 2, targetR: 2, horizon: 20 } as const;
/** History entries kept on the device. */
export const MAX_POSITIONS = 500;

/* ------------------------------------------------------------------------------------------------ instruments */

export interface Instrument {
  symbol: string;
  name: string;
}

/**
 * A rough stand-in per industry: a US ETF that follows a similar group of shares. NOT the same thing as Ken French's value-weighted
 * industry portfolio, and not a recommendation; industries without a fitting ETF have no entry and open nothing.
 */
export const INSTRUMENTS: Readonly<Record<string, Instrument>> = {
  Agric: { symbol: "MOO", name: "VanEck Agribusiness ETF" },
  Food: { symbol: "PBJ", name: "Invesco Food & Beverage ETF" },
  Drugs: { symbol: "XPH", name: "SPDR S&P Pharmaceuticals ETF" },
  Hlth: { symbol: "XLV", name: "Health Care Select Sector SPDR" },
  MedEq: { symbol: "IHI", name: "iShares U.S. Medical Devices ETF" },
  Chems: { symbol: "XLB", name: "Materials Select Sector SPDR" },
  Steel: { symbol: "SLX", name: "VanEck Steel ETF" },
  Mines: { symbol: "XME", name: "SPDR S&P Metals & Mining ETF" },
  Gold: { symbol: "GDX", name: "VanEck Gold Miners ETF" },
  Oil: { symbol: "XLE", name: "Energy Select Sector SPDR" },
  Util: { symbol: "XLU", name: "Utilities Select Sector SPDR" },
  Telcm: { symbol: "IYZ", name: "iShares U.S. Telecommunications ETF" },
  Comps: { symbol: "XLK", name: "Technology Select Sector SPDR" },
  Chips: { symbol: "SMH", name: "VanEck Semiconductor ETF" },
  Banks: { symbol: "KBE", name: "SPDR S&P Bank ETF" },
  Insur: { symbol: "KIE", name: "SPDR S&P Insurance ETF" },
  Fin: { symbol: "XLF", name: "Financial Select Sector SPDR" },
  RlEst: { symbol: "XLRE", name: "Real Estate Select Sector SPDR" },
  Rtail: { symbol: "XRT", name: "SPDR S&P Retail ETF" },
  Cnstr: { symbol: "XHB", name: "SPDR S&P Homebuilders ETF" },
  Aero: { symbol: "ITA", name: "iShares U.S. Aerospace & Defense ETF" },
  Trans: { symbol: "IYT", name: "iShares Transportation Average ETF" },
};

export const instrumentOf = (code: string): Instrument | null => INSTRUMENTS[code] ?? null;

/* ------------------------------------------------------------------------------------------------ signals */

export type SignalSource = "ken-french" | "tradingview" | "manual";
export type SignalState = "gruen" | "rot";

export interface TrendSignal {
  signalId: string;
  /** the industry's code in Ken French's library (`Food`) */
  branche: string;
  state: SignalState;
  /** the day the state began (`YYYYMMDD`); `00000000` = since the data begins */
  datum: string;
  /** the last day of the data the signal rests on (`YYYYMMDD`) – its age is what is checked */
  asOf: string;
  source: SignalSource;
  strategie: string;
}

/** The id of a signal: the same signal (source, strategy, industry, direction, day) always gets the same id. */
export function signalIdOf(s: Pick<TrendSignal, "source" | "strategie" | "branche" | "state" | "datum">): string {
  return `sig_${sha256Hex(`${s.source}|${s.strategie}|${s.branche}|${s.state}|${s.datum}`).slice(0, 20)}`;
}

/** The signal of a row of the Ampel (`kauf` → grün, `cash` → rot). */
export function signalOfRow(row: Pick<AmpelRow, "code" | "state" | "since">, asOf: number | string, strategie: string, source: SignalSource = "ken-french"): TrendSignal {
  const base = {
    branche: row.code,
    state: (row.state === "kauf" ? "gruen" : "rot") as SignalState,
    datum: row.since == null ? "00000000" : String(row.since),
    asOf: String(asOf),
    source,
    strategie,
  };
  return { ...base, signalId: signalIdOf(base) };
}

const DAY_MS = 86_400_000;

/** Age of a data day in calendar days: from the end of that day (UTC) to `now`; `Infinity` for a date that is no date. */
export function signalAgeDays(asOf: string, now: number): number {
  if (!/^\d{8}$/.test(asOf)) return Infinity;
  const t = Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(4, 6)) - 1, Number(asOf.slice(6, 8)), 23, 59, 59);
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : Infinity;
}

/** The id of the position (= its trade id) a signal can open – derived, so a second try finds the first. */
export const positionIdOf = (signalId: string): string => `pp_${sha256Hex(`position|${signalId}`).slice(0, 20)}`;

/* ------------------------------------------------------------------------------------------------ the plan of the check */

export interface CheckPlan {
  entry: number;
  stop: number;
  target: number;
  atr: number;
  /** close of the last candle (ms) */
  lastCloseMs: number;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Entry at the last close, stop `stopAtr` × ATR below, target `targetR` × the risk above. `null` when the candles cannot carry an ATR. */
export function planFromBars(bars: readonly Bar[], secLen = 86_400): CheckPlan | null {
  if (bars.length < CHECK_PLAN.atrLen + 2) return null;
  const atr = atrSeries([...bars]);
  const a = atr[atr.length - 1];
  const last = bars[bars.length - 1]!;
  if (a == null || !Number.isFinite(a) || !(a > 0) || !(last.c > 0)) return null;
  const entry = r4(last.c);
  const stop = r4(last.c - CHECK_PLAN.stopAtr * a);
  if (!(stop > 0) || !(stop < entry)) return null;
  const target = r4(entry + CHECK_PLAN.targetR * (entry - stop));
  return { entry, stop, target, atr: a, lastCloseMs: (last.t + secLen) * 1000 };
}

/* ------------------------------------------------------------------------------------------------ positions and the book */

export interface PaperPosition {
  v: 1;
  /** = `tradeId` */
  id: string;
  tradeId: string;
  signalId: string;
  simulationId: string;
  branche: string;
  symbol: string;
  name: string;
  side: "long";
  qty: number;
  entry: number;
  stop: number;
  target: number;
  /** money at risk (entry → stop) and the position value */
  riskAmount: number;
  notional: number;
  openedAt: number;
  /** the data day of the signal and its age when the position opened (calendar days) */
  signalAsOf: string;
  signalAgeDays: number;
  status: "open" | "closed";
  closedAt?: number;
  exit?: number;
  exitReason?: "rot" | "manuell";
  exitSignalId?: string;
  pnl?: number;
  r?: number;
  modus: "PAPIER";
  gesendet: false;
}

export interface PaperBook {
  v: 1;
  /** Not-Aus: while on, no position opens */
  killSwitch: boolean;
  positions: PaperPosition[];
}

export const emptyBook = (): PaperBook => ({ v: 1, killSwitch: false, positions: [] });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function positionFrom(v: unknown): PaperPosition | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const str = (k: string, re: RegExp): string | null => (typeof o[k] === "string" && re.test(o[k] as string) ? (o[k] as string) : null);
  const id = str("id", /^pp_[0-9a-f]{20}$/);
  const signalId = str("signalId", /^sig_[0-9a-f]{20}$/);
  const simulationId = str("simulationId", /^sim_[0-9a-f]{20,64}$/);
  const branche = str("branche", /^[A-Za-z0-9 .&-]{1,20}$/);
  const symbol = str("symbol", /^[A-Z0-9.-]{1,12}$/);
  if (!id || !signalId || !simulationId || !branche || !symbol || o.tradeId !== id || o.side !== "long") return null;
  for (const k of ["qty", "entry", "stop", "target", "riskAmount", "notional", "openedAt", "signalAgeDays"] as const) if (!isNum(o[k])) return null;
  if (o.status !== "open" && o.status !== "closed") return null;
  const closed = o.status === "closed";
  if (closed && (!isNum(o.closedAt) || !isNum(o.exit))) return null;
  return {
    v: 1,
    id,
    tradeId: id,
    signalId,
    simulationId,
    branche,
    symbol,
    name: typeof o.name === "string" ? o.name.slice(0, 80) : symbol,
    side: "long",
    qty: o.qty as number,
    entry: o.entry as number,
    stop: o.stop as number,
    target: o.target as number,
    riskAmount: o.riskAmount as number,
    notional: o.notional as number,
    openedAt: o.openedAt as number,
    signalAsOf: typeof o.signalAsOf === "string" ? o.signalAsOf.slice(0, 8) : "",
    signalAgeDays: o.signalAgeDays as number,
    status: o.status,
    ...(closed ? { closedAt: o.closedAt as number, exit: o.exit as number } : {}),
    ...(o.exitReason === "rot" || o.exitReason === "manuell" ? { exitReason: o.exitReason } : {}),
    ...(typeof o.exitSignalId === "string" ? { exitSignalId: o.exitSignalId.slice(0, 30) } : {}),
    ...(isNum(o.pnl) ? { pnl: o.pnl } : {}),
    ...(isNum(o.r) ? { r: o.r } : {}),
    modus: "PAPIER",
    gesendet: false,
  };
}

/** Reads what was stored (anything unreadable is left out, never repaired; duplicate ids keep the first). */
export function bookOfStored(v: unknown): PaperBook {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const positions: PaperPosition[] = [];
  for (const x of Array.isArray(o.positions) ? o.positions.slice(-MAX_POSITIONS) : []) {
    const p = positionFrom(x);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      positions.push(p);
    }
  }
  return { v: 1, killSwitch: o.killSwitch === true, positions };
}

export const openPositions = (b: PaperBook): PaperPosition[] => b.positions.filter((p) => p.status === "open");
export const openNotional = (b: PaperBook): number => openPositions(b).reduce((s, p) => s + p.notional, 0);

/* ------------------------------------------------------------------------------------------------ the risk rule */

export type CheckId = "notaus" | "gruen" | "alter" | "instrument" | "doppel" | "offen" | "kerzen" | "zeitmaschine" | "limit" | "groesse";

export interface RuleCheck {
  id: CheckId;
  ok: boolean;
  text: string;
}

export interface Sizing {
  qty: number;
  entry: number;
  stop: number;
  target: number;
  riskPerShare: number;
  riskAmount: number;
  notional: number;
}

export interface Decision {
  /** every check passed → a position may open */
  ok: boolean;
  checks: RuleCheck[];
  sizing: Sizing | null;
}

/** What the rule needs from the Zeitmaschine's saved simulation. */
export interface SimFacts {
  simulationId: string;
  tradeId: string | null;
  symbol: string;
  runs: number;
  verdictId: string;
  verdict: string;
  targetP: number;
  stopP: number;
  expectancyR: number;
  plan: { side: string; entry: number; stop: number; target: number };
}

export interface DecideInput {
  signal: TrendSignal;
  now: number;
  book: PaperBook;
  instrument: Instrument | null;
  /** closed daily candles of the instrument (`null` = not loaded: the checks that need them fail with the reason) */
  bars: readonly Bar[] | null;
  /** why the candles are missing, when they are */
  barsProblem?: string | null;
  plan: CheckPlan | null;
  sim: SimFacts | null;
}

const pc = (v: number): string => `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
const num = (v: number): string => v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const days = (v: number): string => (Number.isFinite(v) ? `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tage` : "unbekannt");

/**
 * The rules, in this order, every one with its reason: Not-Aus · Grün · Alter des Signals · Instrument · kein Doppelsignal · keine
 * zweite Position · Kerzen · Zeitmaschine · Grenzen · Größe. A position may open only when ALL pass.
 */
export function decide(i: DecideInput): Decision {
  const { signal, now, book } = i;
  const checks: RuleCheck[] = [];
  const add = (id: CheckId, ok: boolean, text: string): void => void checks.push({ id, ok, text });

  add("notaus", !book.killSwitch, book.killSwitch ? "Der Not-Aus ist an: es wird keine neue Position eröffnet." : "Der Not-Aus ist aus.");
  add("gruen", signal.state === "gruen", signal.state === "gruen" ? "Das Signal ist grün: Long im Instrument." : "Das Signal ist rot: das heißt Cash. Es wird nie eine Short-Position eröffnet.");

  const age = signalAgeDays(signal.asOf, now);
  add("alter", age <= MAX_SIGNAL_AGE_DAYS, age <= MAX_SIGNAL_AGE_DAYS ? `Das Signal ist ${days(age)} alt (Grenze ${MAX_SIGNAL_AGE_DAYS}).` : `Das Signal ist veraltet: Datenstand ${fmtDay(signal.asOf)}, ${days(age)} alt (Grenze ${MAX_SIGNAL_AGE_DAYS}). Mit alten Daten wird keine Position eröffnet.`);

  add("instrument", i.instrument != null, i.instrument ? `Instrument: ${i.instrument.symbol} (${i.instrument.name}) – eine Näherung für „${industryName(signal.branche)}“.` : `Für „${industryName(signal.branche)}“ gibt es keinen passenden ETF in der Liste: es wird nichts eröffnet.`);

  const positionId = positionIdOf(signal.signalId);
  const same = book.positions.find((p) => p.signalId === signal.signalId || p.id === positionId);
  add("doppel", !same, same ? `Dieses Signal hat schon eine Position (${same.status === "open" ? "offen" : "geschlossen"}): ein Doppelsignal eröffnet keine zweite.` : "Dieses Signal ist neu.");

  const held = i.instrument ? openPositions(book).find((p) => p.symbol === i.instrument!.symbol || p.branche === signal.branche) : undefined;
  const open = openPositions(book).length;
  add("offen", !held && open < MAX_OPEN, held ? `Es ist schon eine Position offen (${held.symbol}): je Branche und Instrument höchstens eine.` : open >= MAX_OPEN ? `Es sind schon ${open} Positionen offen (Grenze ${MAX_OPEN}).` : `Offene Positionen: ${open} von ${MAX_OPEN}.`);

  const last = i.bars && i.bars.length ? i.bars[i.bars.length - 1]! : null;
  const barAge = last ? Math.max(0, (now - (last.t + 86_400) * 1000) / DAY_MS) : Infinity;
  const barsOk = !!i.bars && i.bars.length >= MIN_POOL_BARS && barAge <= MAX_BAR_AGE_DAYS;
  add("kerzen", barsOk, !i.bars ? (i.barsProblem ?? "Die Kerzen des Instruments sind nicht geladen.") : i.bars.length < MIN_POOL_BARS ? `Nur ${i.bars.length} Tageskerzen – mindestens ${MIN_POOL_BARS} sind nötig.` : barAge > MAX_BAR_AGE_DAYS ? `Die letzte Kerze ist ${days(barAge)} alt (Grenze ${MAX_BAR_AGE_DAYS}): der Kurs ist veraltet.` : `${i.bars.length} Tageskerzen, die letzte ist ${days(barAge)} alt.`);

  const sim = i.sim;
  const simMatches = !!sim && !!i.plan && sim.tradeId === positionId && sim.symbol === (i.instrument?.symbol ?? "") && sim.plan.side === "long" && sim.plan.entry === i.plan.entry && sim.plan.stop === i.plan.stop && sim.plan.target === i.plan.target;
  if (!sim) add("zeitmaschine", false, "Die Zeitmaschine hat diesen Kandidaten noch nicht durchgespielt.");
  else if (!simMatches) add("zeitmaschine", false, "Die gespeicherte Simulation gehört nicht zu diesem Plan.");
  else if (sim.runs < MIN_SIM_RUNS) add("zeitmaschine", false, `Nur ${sim.runs} Sitzungen simuliert – mindestens ${MIN_SIM_RUNS} sind nötig.`);
  else if (sim.verdictId === "strongStop") add("zeitmaschine", false, `Die Zeitmaschine sieht den Stop deutlich vor dem Ziel (Ziel zuerst ${pc(sim.targetP)}, Stop zuerst ${pc(sim.stopP)}): so wird nichts eröffnet. Eine Simulation, keine Prognose.`);
  else add("zeitmaschine", true, `Zeitmaschine: ${sim.verdict} (Ziel zuerst ${pc(sim.targetP)}, Stop zuerst ${pc(sim.stopP)}, Ø ${num(sim.expectancyR)} R). Eine Simulation, keine Prognose.`);

  let sizing: Sizing | null = null;
  if (i.plan) {
    const perShare = i.plan.entry - i.plan.stop;
    const byRisk = perShare > 0 ? Math.floor((PAPER_CAPITAL * RISK_PCT) / perShare) : 0;
    const byCap = Math.floor((PAPER_CAPITAL * MAX_POSITION_PCT) / i.plan.entry);
    const byCash = Math.floor(Math.max(0, PAPER_CAPITAL - openNotional(book)) / i.plan.entry);
    const qty = Math.max(0, Math.min(byRisk, byCap, byCash));
    if (qty >= 1) sizing = { qty, entry: i.plan.entry, stop: i.plan.stop, target: i.plan.target, riskPerShare: r4(perShare), riskAmount: r4(qty * perShare), notional: r4(qty * i.plan.entry) };
    const why = byCash < 1 ? "Das Papierkonto hat nicht genug freies Geld." : byCap < 1 ? "Ein Stück ist größer als der Positionsdeckel." : byRisk < 1 ? "Schon ein Stück riskiert mehr als die Grenze je Position." : "";
    add("limit", qty >= 1, qty >= 1 ? `Risiko je Position ${pc(RISK_PCT)} (${num(PAPER_CAPITAL * RISK_PCT)} $), Deckel ${pc(MAX_POSITION_PCT)} des Kontos, kein Hebel.` : `Zu klein für die Grenzen: ${why}`);
    add("groesse", qty >= 1, qty >= 1 ? `${qty} Stück zu ${num(i.plan.entry)} $ = ${num(qty * i.plan.entry)} $, Risiko am Stop ${num(qty * perShare)} $.` : "Es ergibt sich kein ganzes Stück.");
  } else {
    add("limit", false, "Ohne Plan (Kerzen oder ATR fehlen) lässt sich die Größe nicht bestimmen.");
    add("groesse", false, "Ohne Plan keine Größe.");
  }

  return { ok: checks.every((c) => c.ok), checks, sizing };
}

/* ------------------------------------------------------------------------------------------------ the book: open and close */

export type OpenOutcome = { status: "opened"; book: PaperBook; position: PaperPosition } | { status: "duplicate"; book: PaperBook; position: PaperPosition } | { status: "refused"; book: PaperBook; decision: Decision };

/**
 * Opens THE position of a signal. Re-checks the rule on the book as it is NOW (two clicks, two tabs), so a second call with the same
 * signal returns `duplicate` with the first position and never adds another.
 */
export function openPosition(i: DecideInput & { simulationId: string }): OpenOutcome {
  const positionId = positionIdOf(i.signal.signalId);
  const existing = i.book.positions.find((p) => p.id === positionId || p.signalId === i.signal.signalId);
  if (existing) return { status: "duplicate", book: i.book, position: existing };
  const decision = decide(i);
  if (!decision.ok || !decision.sizing || !i.instrument) return { status: "refused", book: i.book, decision };
  const s = decision.sizing;
  const position: PaperPosition = {
    v: 1,
    id: positionId,
    tradeId: positionId,
    signalId: i.signal.signalId,
    simulationId: i.simulationId,
    branche: i.signal.branche,
    symbol: i.instrument.symbol,
    name: i.instrument.name,
    side: "long",
    qty: s.qty,
    entry: s.entry,
    stop: s.stop,
    target: s.target,
    riskAmount: s.riskAmount,
    notional: s.notional,
    openedAt: i.now,
    signalAsOf: i.signal.asOf,
    signalAgeDays: Math.round(signalAgeDays(i.signal.asOf, i.now) * 10) / 10,
    status: "open",
    modus: "PAPIER",
    gesendet: false,
  };
  return { status: "opened", book: { ...i.book, positions: [...i.book.positions, position].slice(-MAX_POSITIONS) }, position };
}

/** Closes an open position at `price` (the instrument's last close) – never blocked by the Not-Aus. `null` when there is no such open position. */
export function closePosition(book: PaperBook, id: string, price: number, reason: "rot" | "manuell", now: number, exitSignalId?: string): { book: PaperBook; position: PaperPosition } | null {
  const p = book.positions.find((x) => x.id === id && x.status === "open");
  if (!p || !Number.isFinite(price) || !(price > 0)) return null;
  const pnl = r4((price - p.entry) * p.qty);
  const per = p.riskAmount > 0 ? p.riskAmount : 0;
  const closed: PaperPosition = { ...p, status: "closed", closedAt: now, exit: r4(price), exitReason: reason, ...(exitSignalId ? { exitSignalId } : {}), pnl, r: per > 0 ? r4(pnl / per) : 0 };
  return { book: { ...book, positions: book.positions.map((x) => (x.id === id ? closed : x)) }, position: closed };
}

/** A red signal for an industry: the open position of that industry (if any) is the one to close – nothing else happens, never a short. */
export function positionForRed(book: PaperBook, signal: Pick<TrendSignal, "branche" | "state">): PaperPosition | null {
  return signal.state === "rot" ? (openPositions(book).find((p) => p.branche === signal.branche) ?? null) : null;
}

/** Result of the paper book in money (closed positions) and in R, for the header of the history. */
export function bookStats(book: PaperBook): { open: number; closed: number; pnl: number; r: number } {
  const closed = book.positions.filter((p) => p.status === "closed");
  return { open: openPositions(book).length, closed: closed.length, pnl: r4(closed.reduce((s, p) => s + (p.pnl ?? 0), 0)), r: r4(closed.reduce((s, p) => s + (p.r ?? 0), 0)) };
}
