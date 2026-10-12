/**
 * Journal-v3 part of the trade form (P06) – pure. `TradeEditor` keeps it as `t.j` next to the bundle form state:
 * `journalDefaults()` → `defaultForm`, `journalFromTrade(trade)` → `formFromTrade`, `journalReset(j)` → `resetForNext`,
 * `journalRecord(j, base, prev)` → `toRecord`, `validateJournal(j, rec)` → `validateRecord`.
 *
 * Contract: an untouched form of a legacy trade writes NO new keys (every empty value is `undefined` and the editor
 * drops undefined keys before saving), and every key the stored trade had can be cleared again. Unknown keys inside
 * fills / targets / stop moves / psych survive an edit (the row keeps its source object).
 */
import type { Fill, MarginMode, MarketKind, ScreenshotRef, Side, StopChange, Trade, TradePsych, TradeRating, TradeStatus, TradeTarget } from "@/domain/types";
import { fillStats, QTY_EPS, relabelFills } from "@/domain/fills";
import { newId } from "@/lib/ids";
import { parseNumber, toInputString } from "@/lib/parse";

export interface FillRow {
  id: string;
  at: string;
  side: Fill["side"];
  price: string;
  qty: string;
  fee: string;
  /** The stored fill (passthrough keys such as a venue trade id survive an edit). */
  src?: Fill;
}

export interface TargetRow {
  id: string;
  price: string;
  pct: string;
  hit: boolean;
  src?: TradeTarget;
}

export interface StopRow {
  id: string;
  at: string;
  price: string;
  note: string;
  src?: StopChange;
}

export interface JournalForm {
  exitDate: string;
  qty: string;
  fundingFees: string;
  slippage: string;
  plannedEntry: string;
  margin: string;
  liqPrice: string;
  market: "" | MarketKind;
  marginMode: "" | MarginMode;
  exchange: string;
  exchangeAccount: string;
  fills: FillRow[];
  targets: TargetRow[];
  stops: StopRow[];
  tags: string[];
  rating: TradeRating | null;
  stress: number | null;
  confidence: number | null;
  flags: string[];
  exitReason: string;
  preNote: string;
  postNote: string;
  screenshots: ScreenshotRef[];
}

export const JOURNAL_MESSAGES = {
  exitBeforeEntry: "Die Ausstiegszeit liegt vor dem Einstieg.",
  fillIncomplete: "Ein Fill ist unvollständig: Preis und Menge angeben.",
  overClosed: "Die Fills schließen mehr, als eröffnet wurde.",
  targetIncomplete: "Ein Ziel der TP-Leiter hat keinen Preis.",
  targetsOver: "Die TP-Leiter verteilt mehr als 100 % der Position.",
  stopIncomplete: "Ein Stop im Verlauf hat keinen Preis.",
} as const;

/** Exit reasons offered as chips (free text is allowed too). */
export const EXIT_REASONS = ["Ziel erreicht", "Stop", "Trailing-Stop", "Manuell", "Zeitstop", "Signal dreht", "Liquidation"] as const;

export function journalDefaults(): JournalForm {
  return {
    exitDate: "",
    qty: "",
    fundingFees: "",
    slippage: "",
    plannedEntry: "",
    margin: "",
    liqPrice: "",
    market: "",
    marginMode: "",
    exchange: "",
    exchangeAccount: "",
    fills: [],
    targets: [],
    stops: [],
    tags: [],
    rating: null,
    stress: null,
    confidence: null,
    flags: [],
    exitReason: "",
    preNote: "",
    postNote: "",
    screenshots: [],
  };
}

const str = (v: number | null | undefined) => toInputString(v ?? null);
const slice16 = (v: string | undefined) => (v || "").slice(0, 16);

/** Form state of a stored trade (absent fields → defaults). */
export function journalFromTrade(t: Partial<Trade>): JournalForm {
  const p = t.psych ?? {};
  return {
    exitDate: slice16(t.exitDate),
    qty: str(t.qty),
    fundingFees: str(t.fundingFees),
    slippage: str(t.slippage),
    plannedEntry: str(t.plannedEntry),
    margin: str(t.margin),
    liqPrice: str(t.liqPrice),
    market: t.market ?? "",
    marginMode: t.marginMode ?? "",
    exchange: t.exchange ?? "",
    exchangeAccount: t.exchangeAccount ?? "",
    fills: (t.fills ?? []).map((f) => ({ id: f.id, at: slice16(f.at), side: f.side, price: str(f.price), qty: str(f.qty), fee: str(f.fee), src: f })),
    targets: (t.targets ?? []).map((x, i) => ({ id: `tp${i}`, price: str(x.price), pct: str(x.pct), hit: x.hit === true, src: x })),
    stops: (t.stopHistory ?? []).map((x, i) => ({ id: `st${i}`, at: slice16(x.at), price: str(x.price), note: x.note ?? "", src: x })),
    tags: [...(t.tags ?? [])],
    rating: t.rating ?? null,
    stress: p.stress ?? null,
    confidence: p.confidence ?? null,
    flags: [...(p.flags ?? [])],
    exitReason: p.exitReason ?? "",
    preNote: p.preNote ?? "",
    postNote: p.postNote ?? "",
    screenshots: [...(t.screenshots ?? [])],
  };
}

/**
 * `Speichern & neu`: keeps what belongs to the venue / instrument (market, margin mode, exchange, account label) and
 * clears everything of the trade itself.
 */
export function journalReset(j: JournalForm): JournalForm {
  return { ...journalDefaults(), market: j.market, marginMode: j.marginMode, exchange: j.exchange, exchangeAccount: j.exchangeAccount };
}

/** A new, empty fill row (time = the entry time for the first, else empty). */
export function newFillRow(side: Fill["side"], at = ""): FillRow {
  return { id: newId("f_"), at, side, price: "", qty: "", fee: "" };
}
export function newTargetRow(): TargetRow {
  return { id: newId("tp_"), price: "", pct: "", hit: false };
}
export function newStopRow(at = ""): StopRow {
  return { id: newId("st_"), at, price: "", note: "" };
}

const filled = (s: string) => s.trim() !== "";

/** Valid fills of the form (rows with price and qty > 0), kinds labelled. */
export function fillsOf(rows: readonly FillRow[]): Fill[] {
  const out: Fill[] = [];
  for (const r of rows) {
    const price = parseNumber(r.price);
    const qty = parseNumber(r.qty);
    if (price == null || price <= 0 || qty == null || qty <= 0) continue;
    const fee = parseNumber(r.fee);
    const f: Fill = { ...(r.src ?? {}), id: r.id, at: r.at, side: r.side, price, qty, kind: r.src?.kind ?? (r.side === "open" ? "entry" : "exit") };
    if (fee != null) f.fee = fee;
    else delete f.fee;
    out.push(f);
  }
  return relabelFills(out);
}

/** What the fills fix in the bundle fields: Ø entry, notional size, Ø exit (when flat), quantity. `null` without fills. */
export interface FillFix {
  entry: number;
  size: number;
  qty: number;
  /** Ø exit when everything is closed, else `null` (the `Ausstieg` field prices the remainder). */
  exit: number | null;
  remaining: number;
  realized: number;
}

export function fillFix(rows: readonly FillRow[], side: Side): FillFix | null {
  const s = fillStats(fillsOf(rows), side);
  if (s.avgEntry == null) return null;
  return { entry: s.avgEntry, size: s.avgEntry * s.openQty, qty: s.openQty, exit: s.flat && s.avgExit != null ? s.avgExit : null, remaining: s.remaining, realized: s.realized };
}

const numOrUndef = (s: string): number | undefined => {
  const v = parseNumber(s);
  return v == null ? undefined : v;
};

/**
 * The v3 keys the form writes. Every empty value is `undefined` (the editor drops those keys, so an untouched legacy
 * trade gains nothing and a cleared field disappears). `prev` = the stored trade (its unknown psych keys survive).
 */
export function journalRecord(j: JournalForm, base: { status: TradeStatus; side: Side }, prev?: Partial<Trade>): Partial<Trade> {
  const fills = fillsOf(j.fills);
  const targets: TradeTarget[] = [];
  for (const r of j.targets) {
    const price = parseNumber(r.price);
    if (price == null) continue;
    const t: TradeTarget = { ...(r.src ?? {}), price };
    const pct = parseNumber(r.pct);
    if (pct != null) t.pct = pct;
    else delete t.pct;
    if (r.hit) t.hit = true;
    else delete t.hit;
    targets.push(t);
  }
  const stops: StopChange[] = [];
  for (const r of j.stops) {
    const price = parseNumber(r.price);
    if (price == null) continue;
    const s: StopChange = { ...(r.src ?? {}), at: r.at, price };
    if (r.note.trim()) s.note = r.note.trim();
    else delete s.note;
    stops.push(s);
  }
  const known: TradePsych = {};
  if (j.stress != null) known.stress = j.stress;
  if (j.confidence != null) known.confidence = j.confidence;
  if (j.flags.length) known.flags = [...j.flags];
  if (j.exitReason.trim()) known.exitReason = j.exitReason.trim();
  if (j.preNote.trim()) known.preNote = j.preNote.trim();
  if (j.postNote.trim()) known.postNote = j.postNote.trim();
  const prevPsych = prev?.psych ?? {};
  const { stress: _s, confidence: _c, flags: _f, exitReason: _e, preNote: _p, postNote: _q, ...psychExtra } = prevPsych;
  const psych: TradePsych = { ...psychExtra, ...known };
  const closed = base.status !== "open";
  return {
    exitDate: closed && filled(j.exitDate) ? j.exitDate : undefined,
    qty: numOrUndef(j.qty) ?? (fills.length ? (fillFix(j.fills, base.side)?.qty ?? undefined) : undefined),
    fills: fills.length ? fills : undefined,
    fundingFees: numOrUndef(j.fundingFees),
    slippage: numOrUndef(j.slippage),
    plannedEntry: numOrUndef(j.plannedEntry),
    margin: numOrUndef(j.margin),
    marginMode: j.marginMode || undefined,
    liqPrice: numOrUndef(j.liqPrice),
    market: j.market || undefined,
    exchange: j.exchange.trim() || undefined,
    exchangeAccount: j.exchangeAccount.trim() || undefined,
    targets: targets.length ? targets : undefined,
    stopHistory: stops.length ? stops : undefined,
    tags: j.tags.length ? [...j.tags] : undefined,
    rating: j.rating ?? undefined,
    psych: Object.keys(psych).length ? psych : undefined,
    screenshots: j.screenshots.length ? [...j.screenshots] : undefined,
  };
}

/** Keys `journalRecord` writes (the editor removes them when `undefined`). */
export const JOURNAL_KEYS = [
  "exitDate",
  "qty",
  "fills",
  "fundingFees",
  "slippage",
  "plannedEntry",
  "margin",
  "marginMode",
  "liqPrice",
  "market",
  "exchange",
  "exchangeAccount",
  "targets",
  "stopHistory",
  "tags",
  "rating",
  "psych",
  "screenshots",
] as const satisfies readonly (keyof Trade)[];

/** Removes the journal keys whose value is `undefined` (mutates and returns `rec`). */
export function dropEmptyJournalKeys<T extends object>(rec: T): T {
  const r = rec as Record<string, unknown>;
  for (const k of JOURNAL_KEYS) if (k in r && r[k] === undefined) delete r[k];
  return rec;
}

/** First problem of the v3 part, `null` when valid. `date` = the entry time of the form. */
export function validateJournal(j: JournalForm, ctx: { date: string; status: TradeStatus; side: Side }): string | null {
  if (ctx.status !== "open" && filled(j.exitDate) && ctx.date && new Date(j.exitDate).getTime() < new Date(ctx.date).getTime()) return JOURNAL_MESSAGES.exitBeforeEntry;
  for (const r of j.fills) {
    const any = filled(r.price) || filled(r.qty) || filled(r.fee);
    if (!any) continue;
    const price = parseNumber(r.price);
    const qty = parseNumber(r.qty);
    if (price == null || price <= 0 || qty == null || qty <= 0) return JOURNAL_MESSAGES.fillIncomplete;
  }
  const s = fillStats(fillsOf(j.fills), ctx.side);
  if (s.closeQty - s.openQty > QTY_EPS * Math.max(1, s.openQty)) return JOURNAL_MESSAGES.overClosed;
  let pct = 0;
  for (const r of j.targets) {
    if ((filled(r.pct) || r.hit) && parseNumber(r.price) == null) return JOURNAL_MESSAGES.targetIncomplete;
    pct += parseNumber(r.pct) ?? 0;
  }
  if (pct > 100 + 1e-9) return JOURNAL_MESSAGES.targetsOver;
  for (const r of j.stops) if ((filled(r.note) || filled(r.at)) && parseNumber(r.price) == null) return JOURNAL_MESSAGES.stopIncomplete;
  return null;
}

/** Comparable form of the v3 part (row order kept; tag / flag order ignored). */
export function journalKey(j: JournalForm): unknown {
  return { ...j, tags: [...j.tags].sort(), flags: [...j.flags].sort() };
}

/** Prefill of a draft (`openEditor({ draft })`): the v3 form part plus the keys the form does not edit. */
export function draftJournal(draft: Partial<Trade>): JournalForm {
  return journalFromTrade(draft);
}
