/**
 * What the preview shows of a candidate – one row per field with its state – and the edits the trader can make there
 * (F29 "nur Unsicheres ergänzen") – pure.
 *
 * A row is `missing` / `uncertain` when the trader has to look at it; optional fields that simply are not in the
 * screenshot (fees, funding …) are neutral (`optional`) and never block or nag.
 */
import type { Side } from "@/domain/types";
import { newId } from "@/lib/ids";
import { averagePrice, cell, editedCell, firstAt, lastAt, normalizePair, totalQty, typedNumber, UNSURE, type Candidate, type Cell, type FieldState, type Leg } from "./candidate";
import type { FieldKey } from "./checks";
import { impliedEntries, type ImpliedBasis } from "./implied";

export interface Row {
  key: FieldKey;
  label: string;
  /** German display text ("67.250,5"), `—` when nothing was read. */
  text: string;
  state: FieldState;
  /** The model's confidence, `null` for derived rows. */
  conf: number | null;
  note?: string;
  /** A missing value of an optional field – shown quietly, not highlighted. */
  optional: boolean;
  /** The preview offers an input for it. */
  editable: boolean;
}

/** Shown under the entry row of a trade whose opening order is not in the screenshot. */
export const ENTRY_MISSING = "Einstieg fehlt im Bild – die Eröffnungsorder ist nicht zu sehen.";

const nf = (d: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d });
export const fmtPrice = (v: number): string => nf(8).format(v);
const fmtMoney = (v: number): string => nf(4).format(v);
const fmtTime = (at: string): string => at.replace("T", " ").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3.$2.$1");

function fromCell<T>(key: FieldKey, label: string, c: Cell<T>, text: (v: T) => string, opts: { optional?: boolean; editable?: boolean } = {}): Row {
  return { key, label, text: c.value == null ? "—" : text(c.value), state: c.state, conf: c.edited ? 1 : c.conf, ...(c.note ? { note: c.note } : {}), optional: !!opts.optional, editable: !!opts.editable };
}

function legsState(legs: readonly Leg[], conf: number): FieldState {
  if (!legs.length) return "missing";
  return conf < UNSURE || legs.some((l) => l.uncertain) ? "uncertain" : "ok";
}

const legNotes = (legs: readonly Leg[]): string | undefined => {
  const n = [...new Set(legs.flatMap((l) => l.notes))];
  return n.length ? n.join(" · ") : undefined;
};

/** The rows of a candidate in display order (fields that make no sense for its status are left out). */
export function rowsOf(c: Candidate, currency: string): Row[] {
  const planned = c.status === "planned";
  const rows: Row[] = [];
  rows.push(fromCell("pair", "Markt", c.pair, (v) => v, { editable: true }));
  rows.push(fromCell("side", "Richtung", c.side, (v) => (v === "long" ? "Long" : "Short"), { editable: true }));
  if (c.kind.value || c.kind.raw) rows.push(fromCell("kind", "Handelsart", c.kind, (v) => (v === "spot" ? "Spot" : "Perpetual"), { optional: true }));
  rows.push(fromCell("exchange", "Börse", c.exchange, (v) => v, { optional: true }));

  if (planned) {
    rows.push(fromCell("entry", "Geplanter Einstieg", c.plannedEntry, fmtPrice, { editable: true }));
  } else {
    const entry = averagePrice(c.entries);
    const noEntry = !c.entries.length;
    const state = legsState(c.entries, c.entriesConf);
    rows.push({
      key: "entry",
      label: c.entryAssumed ? "Einstieg (berechnet)" : c.entries.length > 1 ? `Einstieg (Ø aus ${c.entries.length})` : "Einstieg",
      text: entry == null ? "—" : fmtPrice(entry),
      state,
      conf: c.entries.length && !c.entryAssumed ? c.entriesConf : null,
      ...(noEntry ? { note: ENTRY_MISSING } : legNotes(c.entries) ? { note: legNotes(c.entries) } : {}),
      optional: false,
      editable: c.entries.length <= 1,
    });
    // the closing orders carry the quantity when the opening order is not in the picture
    const qtyLegs = noEntry ? c.exits : c.entries;
    const qty = totalQty(qtyLegs);
    rows.push({
      key: "qty",
      label: noEntry ? "Menge (laut Ausstieg)" : "Menge",
      text: qty == null ? "—" : fmtPrice(qty),
      state: qty == null ? "missing" : legsState(qtyLegs, noEntry ? c.exitsConf : c.entriesConf),
      conf: noEntry ? c.exitsConf : c.entriesConf,
      optional: noEntry && qty == null,
      editable: c.entries.length === 1,
    });
    const at = firstAt(c.entries);
    rows.push({
      key: "date",
      label: "Einstiegszeit",
      text: at ? fmtTime(at) : "—",
      state: at ? (c.entries.some((l) => l.uncertain && l.notes.some((n) => /Jahr|Reihenfolge|Datum|Zeit/.test(n))) ? "uncertain" : "ok") : "missing",
      conf: null,
      // without an opening order the time cannot be there either: the missing entry is the one thing to look at
      optional: noEntry,
      editable: false,
      ...(noEntry ? { note: "Fehlt im Bild – im Editor setzen." } : {}),
    });
    if (c.status === "closed" || c.exits.length) {
      const exit = averagePrice(c.exits);
      rows.push({
        key: "exit",
        label: c.exits.length > 1 ? `Ausstieg (Ø aus ${c.exits.length})` : "Ausstieg",
        text: exit == null ? "—" : fmtPrice(exit),
        state: c.exits.length ? legsState(c.exits, c.exitsConf) : c.pnl.value != null ? "ok" : "missing",
        conf: c.exits.length ? c.exitsConf : 0,
        ...(legNotes(c.exits) ? { note: legNotes(c.exits) } : {}),
        optional: !!(c.pnl.value != null && !c.exits.length),
        editable: c.exits.length <= 1,
      });
      const exitAt = lastAt(c.exits);
      rows.push({ key: "exitDate", label: "Ausstiegszeit", text: exitAt ? fmtTime(exitAt) : "—", state: exitAt ? "ok" : "missing", conf: null, optional: true, editable: false });
    }
  }
  rows.push(fromCell("stop", c.stopOriginal ? "Stop" : "Stop (Stand im Screenshot)", c.stop, fmtPrice, { optional: true, editable: true }));
  rows.push({
    key: "targets",
    label: "Ziele",
    text: c.targets.length ? c.targets.map((t) => fmtPrice(t.value!)).join(" · ") : "—",
    state: c.targets.length ? (c.targets.some((t) => t.state === "uncertain") ? "uncertain" : "ok") : "missing",
    conf: c.targets.length ? Math.min(...c.targets.map((t) => t.conf)) : 0,
    optional: true,
    editable: false,
  });
  rows.push(fromCell("leverage", "Hebel", c.leverage, (v) => `${nf(2).format(v)}×`, { optional: true, editable: true }));
  if (!planned) {
    rows.push(fromCell("fees", `Gebühren (${currency})`, c.fees, fmtMoney, { optional: true, editable: true }));
    rows.push(fromCell("funding", `Funding (${currency}, + = gezahlt)`, c.funding, fmtMoney, { optional: true, editable: true }));
    if (c.status === "closed" || c.pnl.value != null) rows.push(fromCell("pnl", `Ergebnis laut Screenshot (${currency})`, c.pnl, (v) => (v > 0 ? "+" : "") + fmtMoney(v), { optional: c.exits.length > 0, editable: true }));
  }
  return rows;
}

/** Rows the trader still has to look at (missing or uncertain, optional gaps excluded). */
export function attentionRows(rows: readonly Row[]): Row[] {
  return rows.filter((r) => (r.state === "uncertain" && !(r.optional && r.text === "—")) || (r.state === "missing" && !r.optional));
}

/* ------------------------------------------------------------------ edits */

const withLeg = (legs: readonly Leg[], patch: (l: Leg) => Leg): Leg[] => {
  const base: Leg = legs[0] ?? { id: newId("leg_"), price: 0, qty: null, at: null, conf: 1, uncertain: false, notes: [] };
  return [patch({ ...base, conf: 1, uncertain: false, notes: [] }), ...legs.slice(1)];
};

/**
 * The trader typed a value for `key` (`text` = the input; empty clears it). Single-leg executions are edited in place;
 * a typed value is treated as confirmed.
 */
export function editField(c: Candidate, key: FieldKey, text: string): Candidate {
  const t = text.trim();
  const num = typedNumber(t);
  const price = num.value != null && num.value > 0 ? num.value : null;
  switch (key) {
    case "pair":
      return { ...c, pair: t ? editedCell(normalizePair(t) ?? t.toUpperCase()) : cell({ edited: true }) };
    case "entry":
      if (c.status === "planned") return { ...c, plannedEntry: price == null ? cell({ edited: true }) : editedCell(price) };
      // a value the trader types replaces a computed one for good: from here on it is theirs, not an assumption
      return { ...c, entries: price == null ? [] : withLeg(c.entries, (l) => ({ ...l, price })), entriesConf: 1, entryAssumed: null };
    case "exit":
      return { ...c, exits: price == null ? [] : withLeg(c.exits, (l) => ({ ...l, price })), exitsConf: 1 };
    case "qty": {
      const q = price;
      return { ...c, entries: c.entries.length ? withLegAt(c.entries, q) : c.entries };
    }
    case "stop":
      return { ...c, stop: price == null ? cell({ edited: true }) : editedCell(price) };
    case "leverage":
      return { ...c, leverage: price == null ? cell({ edited: true }) : editedCell(price) };
    case "fees":
      return { ...c, fees: num.value == null ? cell({ edited: true }) : editedCell(Math.abs(num.value)) };
    case "funding":
      return { ...c, funding: num.value == null ? cell({ edited: true }) : editedCell(num.value) };
    case "pnl":
      return { ...c, pnl: num.value == null ? cell({ edited: true }) : editedCell(num.value), pnlMode: "auto" };
    default:
      return c;
  }
}

function withLegAt(legs: readonly Leg[], qty: number | null): Leg[] {
  return legs.map((l, i) => (i === 0 ? { ...l, qty, conf: 1, uncertain: false } : l));
}

export const setSide = (c: Candidate, side: Side): Candidate => ({ ...c, side: editedCell(side) });

/**
 * Takes the COMPUTED entry (`implied.ts`) for a trade without an opening order – only ever called for a button the
 * trader pressed. `basis: null` drops it again. The leg carries the closed quantity, no time, and is marked uncertain, so
 * the preview, the draft's notes and the checks keep calling it an assumption. An entry the trader typed stays.
 */
export function setImpliedEntry(c: Candidate, basis: ImpliedBasis | null): Candidate {
  if (basis === null) return c.entryAssumed ? { ...c, entries: [], entriesConf: 0, entryAssumed: null } : c;
  if (c.entries.length && !c.entryAssumed) return c;
  const imp = impliedEntries({ ...c, entries: [] });
  const pick = imp?.[basis];
  if (!imp || !pick) return c;
  const leg: Leg = {
    id: c.entries[0]?.id ?? newId("leg_"),
    price: pick.price,
    qty: imp.qty,
    at: null,
    conf: 0,
    uncertain: true,
    notes: [`Berechnet aus dem Ergebnis (Annahme: ${basis === "gross" ? "PnL vor Gebühr" : "PnL nach Gebühr"}) – nicht im Screenshot gelesen`],
    label: null,
  };
  return { ...c, entries: [leg], entriesConf: 0, entryAssumed: { basis, price: pick.price } };
}

/** What the trader did in the preview – replayed on freshly built candidates when the time zone choice changes. */
export type Edit =
  | { id: string; kind: "field"; key: FieldKey; text: string }
  | { id: string; kind: "side"; value: Side }
  | { id: string; kind: "stopOriginal"; value: boolean }
  | { id: string; kind: "pnlMode"; value: "shot" | "calc" }
  | { id: string; kind: "impliedEntry"; basis: ImpliedBasis | null };

export function applyEdits(list: readonly Candidate[], edits: readonly Edit[]): Candidate[] {
  return list.map((c) =>
    edits
      .filter((e) => e.id === c.id)
      .reduce<Candidate>((acc, e) => {
        if (e.kind === "field") return editField(acc, e.key, e.text);
        if (e.kind === "side") return setSide(acc, e.value);
        if (e.kind === "stopOriginal") return { ...acc, stopOriginal: e.value };
        if (e.kind === "impliedEntry") return setImpliedEntry(acc, e.basis);
        return { ...acc, pnlMode: e.value };
      }, c),
  );
}
