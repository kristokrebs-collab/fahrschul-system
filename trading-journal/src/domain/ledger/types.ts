/**
 * Transaktionsbuch (F70): types. A ledger row is one money event of the journal – an opening, a closing, a fee, a funding
 * payment – with the time in UTC, the market, the quantity, the price, the fee and, for a closing, the realised result
 * matched to the openings first-in-first-out. It is an AUXILIARY CALCULATION (Hilfsrechnung) for a person who checks the
 * numbers or hands them to a tax adviser: no tax is computed, no holding period is claimed (the acquisition and disposal
 * DATES are columns, nothing is concluded from them), nothing is guessed – what cannot be matched or is missing carries a
 * visible flag.
 */
import type { AccountId } from "../types";

export type LedgerKind = "open" | "close" | "fee" | "funding";

export const KIND_LABEL: Readonly<Record<LedgerKind, string>> = { open: "Eröffnen", close: "Schließen", fee: "Gebühr", funding: "Funding" };

/** What a flag says. `warn` = the row's figures may be wrong or incomplete, `hint` = the row is right, here is how to read it. */
export type FlagId = "gap" | "duplicate" | "fee-missing" | "fee-diff" | "funding-missing" | "time-missing" | "diff" | "rest" | "lump" | "order";
export type FlagLevel = "warn" | "hint";

export interface LedgerFlag {
  id: FlagId;
  level: FlagLevel;
  text: string;
}

/** The levels of the flags, fixed per id. */
export const FLAG_LEVEL: Readonly<Record<FlagId, FlagLevel>> = {
  gap: "warn",
  duplicate: "warn",
  "fee-missing": "warn",
  "fee-diff": "warn",
  "funding-missing": "warn",
  "time-missing": "warn",
  diff: "warn",
  order: "warn",
  rest: "hint",
  lump: "hint",
};

/** Short names for the filter chips and the summary. */
export const FLAG_LABEL: Readonly<Record<FlagId, string>> = {
  gap: "Lücke im Bestand",
  duplicate: "Mögliche Dublette",
  "fee-missing": "Gebühr fehlt",
  "fee-diff": "Gebühr weicht ab",
  "funding-missing": "Funding fehlt",
  "time-missing": "Zeit fehlt",
  diff: "Weicht vom Journal ab",
  order: "Reihenfolge der Zeiten",
  rest: "Rest aus dem Eintrag",
  lump: "Summe statt Einzelzahlung",
};

/** One piece of a closing matched to one opening (first in, first out). */
export interface LotMatch {
  /** the opening row */
  openRowId: string;
  /** ms UTC of the opening */
  openAt: number;
  openPrice: number;
  closePrice: number;
  qty: number;
  /** gross result of this piece in the trading currency, signed for the position's direction */
  realized: number;
}

export interface LedgerRow {
  id: string;
  /** the journal trade it comes from */
  tradeId: string;
  /** ms UTC */
  at: number;
  account: AccountId;
  exchange: string | null;
  market: string;
  marketKind: "perp" | "spot";
  kind: LedgerKind;
  /** direction of the position */
  side: "long" | "short";
  /** Kauf / Verkauf of an opening or closing row */
  action: "Kauf" | "Verkauf" | null;
  qty: number | null;
  price: number | null;
  /** fee paid (positive = cost); on a `fee` row the amount of the fee */
  fee: number | null;
  /** funding paid (positive = paid, negative = received), only on `funding` rows */
  funding: number | null;
  /** closing rows: gross result of the matched pieces; `null` when nothing could be matched */
  realized: number | null;
  /** closing rows: the matched openings */
  matches: LotMatch[];
  /** closing rows: quantity that no opening could be found for */
  unmatchedQty: number;
  /** the figures stand on single executions or on the entry's own numbers */
  source: "fills" | "entry";
  flags: LedgerFlag[];
}

/** A position (or part of it) that is still open: not realised, not valued. */
export interface OpenLot {
  tradeId: string;
  market: string;
  account: AccountId;
  side: "long" | "short";
  qty: number;
  price: number;
  at: number;
}

/** A journal entry the ledger could not turn into rows – listed, never dropped. */
export interface Unresolved {
  tradeId: string;
  market: string;
  /** ms UTC of the entry, `null` without a readable time */
  at: number | null;
  reason: string;
}

export interface YearSummary {
  year: number;
  /** closing rows with a result */
  closes: number;
  /** Σ of the matched pieces with a gain / with a loss (loss negative) */
  gains: number;
  losses: number;
  /** gains + losses */
  gross: number;
  /** fees paid in the year (opening, closing and lump rows) */
  fees: number;
  fundingPaid: number;
  fundingReceived: number;
  /** paid − received */
  funding: number;
  /** gross − fees − funding */
  net: number;
  /** rows of the year with at least one `warn` flag */
  flagged: number;
  /** gross result that sits in rows flagged as a possible duplicate */
  duplicateGross: number;
  unmatchedQty: number;
}

export type Scope = "position" | "market";

export interface LedgerOptions {
  /** the zone the journal's wall-clock times were written in */
  sourceZone: string;
  /** the zone the book is read in (dates, years) */
  displayZone: string;
  /** which openings a closing is matched against: the entry's own (a journal position) or all entries of the market */
  scope: Scope;
}

export interface Ledger {
  rows: LedgerRow[];
  years: YearSummary[];
  openLots: OpenLot[];
  unresolved: Unresolved[];
  /** counts per flag id over all rows */
  flagCounts: Partial<Record<FlagId, number>>;
  currency: string;
  options: LedgerOptions;
  /** trades looked at */
  trades: number;
}
