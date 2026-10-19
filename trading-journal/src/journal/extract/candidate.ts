/**
 * From the model's text-valued extraction to typed, uncertainty-aware candidates (F29) – pure.
 *
 * A `Candidate` is one proposed trade. Every scalar is a `Cell`: the value, the text it was read from, the model's
 * confidence and a state – `ok`, `uncertain` (low confidence, an ambiguous number or an assumed year) or `missing`
 * (nothing read). Executions are `Leg`s (partial entries / exits stay separate). Nothing here is saved or invented:
 * an unknown stays `null`, and an assumption is written down in `notes`.
 */
import { fillStats, relabelFills } from "@/domain/fills";
import type { Fill, FillSide, MarketKind, Side } from "@/domain/types";
import { newId } from "@/lib/ids";
import { parseNumber } from "@/lib/parse";
import type { ConfidenceKey, Extraction, ExtractedExecution, ExtractedTrade } from "./contract";
import { parseOrderLabel } from "./orders";
import { detectNumberStyle, parseLeverage, parseShotNumber, type NumberStyle, type ParsedNumber } from "./numbers";
import { localZoneId, parseShotTime, parseZone, toLocalWall, type ZoneSpec } from "./time";

/** Below this the model itself says it is unsure; the preview highlights the field. */
export const UNSURE = 0.7;

export type FieldState = "ok" | "uncertain" | "missing";

export interface Cell<T> {
  value: T | null;
  /** The text the value was read from (`null` for derived / typed-in values). */
  raw: string | null;
  conf: number;
  state: FieldState;
  note?: string;
  /** Typed in or corrected by the trader in the preview – counts as confirmed. */
  edited?: boolean;
}

export interface Leg {
  id: string;
  price: number;
  qty: number | null;
  /** Local wall clock `YYYY-MM-DDTHH:mm[:ss]`, `null` when the screenshot shows no (usable) time. */
  at: string | null;
  conf: number;
  /** Something about this leg is a guess (ambiguous number, assumed year, time zone). */
  uncertain: boolean;
  notes: string[];
  /** The order's name as displayed („Long schließen“), `null` when the screenshot shows none. */
  label?: string | null;
}

/**
 * An entry the trader had COMPUTED from the exit, quantity and realised PnL (`implied.ts`) because the opening order is
 * not in the screenshot. It is an assumption, not a reading: the preview, the draft's notes and the checks say so until
 * the trader types a value of their own.
 */
export interface EntryAssumption {
  basis: "gross" | "net";
  price: number;
}

export type CandidateStatus = "planned" | "open" | "closed";

export interface Candidate {
  id: string;
  /** 0-based screenshot numbers the trade was read from. */
  sources: number[];
  /** How many extracted trades were merged into this one (1 = none). */
  merged: number;
  status: CandidateStatus;
  statusConf: number;
  pair: Cell<string>;
  side: Cell<Side>;
  kind: Cell<MarketKind>;
  exchange: Cell<string>;
  plannedEntry: Cell<number>;
  entries: Leg[];
  entriesConf: number;
  exits: Leg[];
  exitsConf: number;
  stop: Cell<number>;
  /** The trader says the visible stop was the original one (default only for a planned trade). */
  stopOriginal: boolean;
  targets: Cell<number>[];
  leverage: Cell<number>;
  /** Positive = a cost. */
  fees: Cell<number>;
  /** Positive = paid (cost), negative = received – the journal's convention. */
  funding: Cell<number>;
  /** Realised result as the screenshot states it. */
  pnl: Cell<number>;
  pnlCurrency: string | null;
  /** Which result goes into the trade: the screenshot's number or the one computed from the prices. */
  pnlMode: "auto" | "shot" | "calc";
  /** Set while the only entry is the computed one (`implied.ts`); cleared by any entry the trader types. */
  entryAssumed?: EntryAssumption | null;
  unreadable: string[];
  notes: string[];
}

export const cell = <T>(over: Partial<Cell<T>> = {}): Cell<T> => ({ value: null, raw: null, conf: 0, state: "missing", ...over });

/** A cell for a read value: missing without a value, uncertain when unsure or flagged, else ok. */
export function readCell<T>(value: T | null, raw: string | null, conf: number, flag?: string): Cell<T> {
  if (value == null) return cell<T>({ raw, conf: 0 });
  const unsure = conf < UNSURE || flag != null;
  return { value, raw, conf, state: unsure ? "uncertain" : "ok", ...(flag ? { note: flag } : {}) };
}

/** A cell the trader typed or corrected. */
export const editedCell = <T>(value: T | null): Cell<T> => (value == null ? cell<T>({ edited: true }) : { value, raw: null, conf: 1, state: "ok", edited: true });

/* ------------------------------------------------------------------ pair */

const QUOTES = ["USDT", "USDC", "BUSD", "USD", "EUR", "BTC", "ETH"];

/** Comparison key of a symbol: `BTC/USDT`, `BTCUSDT`, `BTC-USDT-SWAP`, `BTCUSDT.P` → `BTCUSDT`. */
export function pairKey(pair: string | null | undefined): string {
  return String(pair ?? "")
    .toUpperCase()
    .replace(/PERPETUAL|PERP|SWAP|FUTURES?|SPOT|\.P$|:[A-Z]+$/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** The journal's pair format (`BTC/USDT`) where the quote asset is recognisable, else the text as shown (upper case). */
export function normalizePair(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = pairKey(raw);
  if (!key) return null;
  for (const q of QUOTES) if (key.length > q.length + 1 && key.endsWith(q)) return `${key.slice(0, -q.length)}/${q}`;
  return String(raw).trim().toUpperCase();
}

/* ------------------------------------------------------------------ zone */

export interface ZoneChoice {
  zone: ZoneSpec;
  /** Where it came from. */
  source: "user" | "screenshot" | "journal";
  /** German line for the preview ("Zeiten gelesen als UTC+8 …"). */
  text: string;
}

/** Zone of the displayed times: the trader's choice, else what the screenshot names, else the journal's own zone. */
export function resolveZone(shotZone: string | null | undefined, user: ZoneSpec | null, localId = localZoneId()): ZoneChoice {
  if (user) return { zone: user, source: "user", text: `Zeiten gelesen als ${user.label} (deine Wahl) und in ${localId} umgerechnet.` };
  const named = parseZone(shotZone);
  if (named) return { zone: named, source: "screenshot", text: `Der Screenshot nennt ${shotZone} – Zeiten sind nach ${localId} umgerechnet.` };
  return {
    zone: { kind: "iana", id: localId, label: localId },
    source: "journal",
    text: `Der Screenshot nennt keine Zeitzone – angenommen: ${localId} (deine Zeit). Falls er eine andere zeigt, wähle sie oben.`,
  };
}

/* ------------------------------------------------------------------ build */

export interface BuildContext {
  now: Date;
  zone: ZoneChoice;
  localZone?: string;
  /** Forces the number style; default = what the screenshot's own numbers prove. */
  style?: NumberStyle | null;
  /**
   * Style for a number the screenshot's own numbers do not settle ("67.000"): the device language's (a German phone
   * writes 67.000 for 67000). The number is still reported as ambiguous, with the other reading.
   */
  fallbackStyle?: NumberStyle | null;
}

/** `parseShotNumber` with the device-language fallback for ambiguous texts (kept flagged as ambiguous). */
function readNumber(raw: string | null | undefined, style: NumberStyle | null, fallback: NumberStyle | null | undefined): ParsedNumber | null {
  const p = parseShotNumber(raw, style);
  if (!p?.ambiguous || !fallback) return p;
  const q = parseShotNumber(raw, fallback);
  if (!q) return p;
  return { ...q, ambiguous: true, alt: q.value === p.value ? p.alt : p.value };
}

const conf = (t: ExtractedTrade, k: ConfidenceKey): number => t.confidence[k] ?? 0;

function allRaws(ex: Extraction): string[] {
  const out: string[] = [];
  for (const t of ex.trades) {
    for (const e of [...t.entries, ...t.exits]) out.push(e.price, ...(e.qty ? [e.qty] : []));
    out.push(...[t.plannedEntry, t.stop, t.leverage, t.fees, t.funding, t.realizedPnl].filter((x): x is string => !!x), ...t.targets);
  }
  return out;
}

function priceCell(raw: string | null, c: number, style: NumberStyle | null, fb: NumberStyle | null | undefined): Cell<number> {
  const p = readNumber(raw, style, fb);
  if (!p) return cell<number>({ raw, conf: 0 });
  return readCell(p.value, raw, c, p.ambiguous ? `Zahlenformat unklar: „${raw}“ könnte auch ${String(p.alt).replace(".", ",")} heißen.` : undefined);
}

function buildLegs(list: readonly ExtractedExecution[], c: number, style: NumberStyle | null, ctx: BuildContext, fallbackDate: string | null): { legs: Leg[]; dropped: number } {
  const localId = ctx.localZone ?? localZoneId();
  let dropped = 0;
  const legs: Leg[] = [];
  for (const e of list) {
    const price = readNumber(e.price, style, ctx.fallbackStyle);
    if (!price || price.value <= 0) {
      dropped += 1;
      continue;
    }
    const qty = e.qty ? readNumber(e.qty, style, ctx.fallbackStyle) : null;
    const notes: string[] = [];
    let uncertain = c < UNSURE;
    if (price.ambiguous) {
      uncertain = true;
      notes.push(`Preis „${e.price}“: Zahlenformat unklar`);
    }
    if (qty?.ambiguous) {
      uncertain = true;
      notes.push(`Menge „${e.qty}“: Zahlenformat unklar`);
    }
    let at: string | null = null;
    if (e.time) {
      const t = parseShotTime(e.time, { now: ctx.now });
      const date = t?.date ?? fallbackDate;
      if (t && date) {
        at = toLocalWall(date, t.time, t.seconds, ctx.zone.zone, localId);
        if (t.assumed.includes("year")) {
          uncertain = true;
          notes.push("Jahr fehlte im Screenshot (angenommen)");
        }
        if (t.assumed.includes("order")) {
          uncertain = true;
          notes.push("Tag/Monat-Reihenfolge angenommen");
        }
        if (!t.date) notes.push("Datum fehlte – vom anderen Fill übernommen");
      } else notes.push(t ? "Datum fehlt im Screenshot" : `Zeit „${e.time}“ nicht lesbar`);
    }
    legs.push({ id: newId("leg_"), price: price.value, qty: qty && qty.value > 0 ? Math.abs(qty.value) : null, at, conf: c, uncertain, notes, label: e.label ?? null });
  }
  return { legs, dropped };
}

/** First date (`YYYY-MM-DD`) any of the displayed times names – a time of day alone borrows it. */
function dateOfAny(list: readonly ExtractedExecution[], now: Date): string | null {
  for (const e of list) {
    const t = parseShotTime(e.time, { now });
    if (t?.date) return t.date;
  }
  return null;
}

/** Quantity-weighted Ø of legs (plain mean when a quantity is unknown); `null` for none. */
export function averagePrice(legs: readonly Leg[]): number | null {
  if (!legs.length) return null;
  if (legs.every((l) => l.qty != null && l.qty > 0)) {
    const q = legs.reduce((n, l) => n + l.qty!, 0);
    return legs.reduce((n, l) => n + l.price * l.qty!, 0) / q;
  }
  return legs.reduce((n, l) => n + l.price, 0) / legs.length;
}

export const totalQty = (legs: readonly Leg[]): number | null => (legs.length && legs.every((l) => l.qty != null) ? legs.reduce((n, l) => n + l.qty!, 0) : null);

/** The earliest / latest known time of legs (local wall clocks compare as text). */
export const firstAt = (legs: readonly Leg[]): string | null => legs.map((l) => l.at).filter((a): a is string => !!a).sort()[0] ?? null;
export const lastAt = (legs: readonly Leg[]): string | null => legs.map((l) => l.at).filter((a): a is string => !!a).sort().at(-1) ?? null;

const SIDE_DE = { long: "Long", short: "Short" } as const;

/**
 * Sorts the executions by what their own NAME says („Long schließen“ is an exit, „Short öffnen“ an entry) and reads the
 * position side from it. The model's sorting and `side` are kept wherever the names are silent; a contradiction is
 * resolved in favour of the displayed text and written down.
 */
function routeByLabel(t: ExtractedTrade): { entries: ExtractedExecution[]; exits: ExtractedExecution[]; side: Side | null; sideLabel: string | null; sideConflict: boolean; notes: string[] } {
  const entries: ExtractedExecution[] = [];
  const exits: ExtractedExecution[] = [];
  const notes: string[] = [];
  const sides = new Map<Side, string>();
  const note = (e: ExtractedExecution, is: "Einstieg" | "Ausstieg") => notes.push(`Auftrag „${e.label}“ ist ein ${is}, stand aber bei den ${is === "Ausstieg" ? "Einstiegen" : "Ausstiegen"} – umsortiert.`);
  for (const e of t.entries) {
    const o = parseOrderLabel(e.label);
    if (o) sides.set(o.side, e.label!);
    if (o?.action === "close") {
      exits.push(e);
      note(e, "Ausstieg");
    } else entries.push(e);
  }
  for (const e of t.exits) {
    const o = parseOrderLabel(e.label);
    if (o) sides.set(o.side, e.label!);
    if (o?.action === "open") {
      entries.push(e);
      note(e, "Einstieg");
    } else exits.push(e);
  }
  const only = sides.size === 1 ? [...sides.entries()][0]! : null;
  return { entries, exits, side: only?.[0] ?? null, sideLabel: only?.[1] ?? null, sideConflict: sides.size > 1, notes };
}

/**
 * The position side: what the orders' own names say wins over the model's `side` (a „Long schließen“ is a LONG position
 * whatever the colour or the sell direction suggested); two different sides in the names are a conflict, left unsure.
 */
function sideCell(t: ExtractedTrade, r: ReturnType<typeof routeByLabel>): Cell<Side> {
  const c = conf(t, "side");
  if (r.sideConflict) return t.side ? { ...readCell<Side>(t.side, t.side, c), state: "uncertain", note: "Die Auftragsnamen nennen Long und Short – Richtung prüfen." } : cell<Side>({ note: "Die Auftragsnamen nennen Long und Short – Richtung prüfen.", state: "missing" });
  if (!r.side) return readCell<Side>(t.side, t.side, c);
  const note = t.side && t.side !== r.side ? `Position ${SIDE_DE[r.side]} laut „${r.sideLabel}“ – die KI hatte ${SIDE_DE[t.side]} gemeldet; der Auftragsname gilt.` : undefined;
  return { value: r.side, raw: r.sideLabel, conf: Math.max(0.9, t.side === r.side ? c : 0), state: "ok", ...(note ? { note } : {}) };
}

/** Builds the candidates of an extraction (one per extracted trade). */
export function buildCandidates(ex: Extraction, ctx: BuildContext): Candidate[] {
  const style = ctx.style !== undefined ? ctx.style : detectNumberStyle(allRaws(ex));
  return ex.trades.map((t, i): Candidate => {
    const notes: string[] = [];
    const routed = routeByLabel(t);
    notes.push(...routed.notes);
    const moved = routed.notes.length > 0;
    const dateHint = dateOfAny([...routed.entries, ...routed.exits], ctx.now);
    const en = buildLegs(routed.entries, conf(t, "entries"), style, ctx, dateHint);
    const ex2 = buildLegs(routed.exits, moved ? Math.max(conf(t, "exits"), conf(t, "entries")) : conf(t, "exits"), style, ctx, dateHint);
    if (en.dropped + ex2.dropped) notes.push(`${en.dropped + ex2.dropped} Preis nicht lesbar – ausgelassen.`);

    const kindRaw = t.productType;
    const kind: Cell<MarketKind> =
      kindRaw === "perp" || kindRaw === "spot" ? readCell<MarketKind>(kindRaw, kindRaw, conf(t, "productType")) : cell<MarketKind>({ raw: kindRaw, conf: 0 });
    if (kindRaw && kindRaw !== "perp" && kindRaw !== "spot") notes.push(`Handelsart „${kindRaw}“ hat im Journal keine Entsprechung – nicht übernommen.`);

    const fees = readNumber(t.fees, style, ctx.fallbackStyle);
    const funding = readNumber(t.funding, style, ctx.fallbackStyle);
    const pnl = readNumber(t.realizedPnl, style, ctx.fallbackStyle);
    const fundingSigned = t.funding ? /^[\s]*[+\-−]/.test(t.funding) : false;
    let fundingCell: Cell<number>;
    if (funding) {
      // shown negative = money left the account = paid (journal: positive = paid); an unsigned value is a guess
      const paid = fundingSigned ? -funding.value : Math.abs(funding.value);
      const flag = funding.ambiguous ? "Zahlenformat unklar" : !fundingSigned ? "Vorzeichen unklar – als gezahlt gewertet" : undefined;
      fundingCell = readCell(paid, t.funding, conf(t, "funding"), flag);
    } else fundingCell = cell<number>({ raw: t.funding });

    const pair = normalizePair(t.market);
    const stopCell = priceCell(t.stop, conf(t, "stop"), style, ctx.fallbackStyle);
    const status = t.status;
    return {
      id: `c${i}`,
      sources: [...t.sources],
      merged: 1,
      status,
      statusConf: conf(t, "status"),
      pair: readCell(pair, t.market, conf(t, "market")),
      side: sideCell(t, routed),
      kind,
      exchange: readCell(t.exchange, t.exchange, conf(t, "exchange")),
      plannedEntry: priceCell(t.plannedEntry, conf(t, "entries"), style, ctx.fallbackStyle),
      entries: en.legs,
      entriesConf: conf(t, "entries"),
      exits: ex2.legs,
      exitsConf: conf(t, "exits"),
      stop: stopCell,
      stopOriginal: status === "planned",
      targets: t.targets.map((x) => priceCell(x, conf(t, "targets"), style, ctx.fallbackStyle)).filter((c) => c.value != null),
      leverage: (() => {
        const v = parseLeverage(t.leverage);
        return readCell(v, t.leverage, conf(t, "leverage"));
      })(),
      fees: fees ? readCell(Math.abs(fees.value), t.fees, conf(t, "fees"), fees.ambiguous ? "Zahlenformat unklar" : undefined) : cell<number>({ raw: t.fees }),
      funding: fundingCell,
      pnl: pnl ? readCell(pnl.value, t.realizedPnl, conf(t, "realizedPnl"), pnl.ambiguous ? "Zahlenformat unklar" : undefined) : cell<number>({ raw: t.realizedPnl }),
      pnlCurrency: t.pnlCurrency,
      pnlMode: "auto",
      entryAssumed: null,
      unreadable: [...t.unreadable],
      notes,
    };
  });
}

/** Turns a typed-in text into a number cell with the app's own tolerant reading (comma or point, as in the trade form). */
export function typedNumber(text: string): Cell<number> {
  return editedCell(parseNumber(text));
}

/* ------------------------------------------------------------------ executions */

/**
 * The legs as journal fills (`Trade.fills`), or `null` when a quantity is missing (then the trade keeps plain entry /
 * exit). A leg without a time takes the earliest known time (entries) or the latest (exits) so the order stays
 * entry → exit; with no time at all the fills stay untimed (`at: ""`), which the fill maths accepts.
 */
export function fillsOf(c: Pick<Candidate, "entries" | "exits">): Fill[] | null {
  const legs = [...c.entries, ...c.exits];
  if (!c.entries.length || legs.some((l) => l.qty == null || !(l.qty > 0))) return null;
  const known = legs
    .map((l) => l.at)
    .filter((a): a is string => !!a)
    .sort();
  const earliest = known[0] ?? "";
  const latest = known.at(-1) ?? "";
  const mk = (l: Leg, side: FillSide): Fill => ({ id: l.id, at: l.at ?? (side === "open" ? earliest : latest), side, price: l.price, qty: l.qty!, kind: side === "open" ? "entry" : "exit" });
  return relabelFills([...c.entries.map((l) => mk(l, "open")), ...c.exits.map((l) => mk(l, "close"))]);
}

/** Gross result (before fees and funding) from the legs, or `null` when it cannot be computed. */
export function grossPnl(c: Pick<Candidate, "entries" | "exits" | "side">, side: Side | null = c.side.value): number | null {
  if (!side || !c.entries.length || !c.exits.length) return null;
  const fills = fillsOf(c);
  if (fills) {
    const s = fillStats(fills, side);
    return s.closeQty > 0 ? s.realized : null;
  }
  const entry = averagePrice(c.entries);
  if (entry == null) return null;
  const dir = side === "short" ? -1 : 1;
  const qtys = c.exits.every((l) => l.qty != null) ? c.exits.map((l) => l.qty!) : c.exits.length === 1 && totalQty(c.entries) != null ? [totalQty(c.entries)!] : null;
  if (!qtys) return null;
  return c.exits.reduce((n, l, i) => n + (l.price - entry) * qtys[i]! * dir, 0);
}
