/**
 * What the import preview shows per trade (PURE): the list of fields with their state – sure, doubtful (yellow),
 * missing – the reasons, the assumptions, what blocks writing, duplicates, and the edits the trader makes in place.
 * The doubt comes from the OCR's own per-field confidence and the plausibility checks (`records.ts`); the values come
 * from the import's candidates (`@/journal/extract`), so what is shown is exactly what would be written.
 */
import type { Side, Trade } from "@/domain/types";
import { averagePrice, firstAt, lastAt, totalQty, type Candidate } from "@/journal/extract/candidate";
import { checksOf, type Check } from "@/journal/extract/checks";
import { toDraft } from "@/journal/extract/draft";
import { applyEdits, fmtPrice, type Edit } from "@/journal/extract/rows";
import { parseShotTime } from "@/journal/extract/time";
import { toInputString } from "@/lib/parse";
import { findDuplicateLoose } from "./duplicates";
import { checkRecord, type PlauField } from "./plausibility";
import type { ReadRecord, RField } from "./records";
import type { Box } from "./types";

export type CellKey = "pair" | "side" | "qty" | "entry" | "exit" | "pnl" | "date" | "exitDate" | "leverage" | "fees";
export type CellState = "ok" | "uncertain" | "missing";

export interface PreviewCell {
  key: CellKey;
  label: string;
  /** How it reads in the list. */
  text: string;
  /** What an input starts with (the number in the form's own notation). */
  input: string;
  state: CellState;
  /** Why it is doubtful / how it came about (German). */
  notes: string[];
  /** Derived or assumed, not read: shown with its own mark. */
  derived: boolean;
  /** A required field: while it is missing the trade cannot be written. */
  required: boolean;
}

export interface PreviewRow {
  id: string;
  title: string;
  cells: PreviewCell[];
  /** Doubtful or missing required cells (what the summary counts). */
  attention: number;
  /** Why the trade cannot be written yet, or `null`. */
  blocked: string | null;
  duplicate: { text: string; trade: Trade } | null;
  /** Warnings that are not about one cell (the prices vs. the result …). */
  warnings: string[];
  /** Where in which picture the trade stands (for the crop). */
  crops: { page: number; box: Box }[];
  status: Candidate["status"];
}

/** An edit of the preview: the import's own edits plus a typed time. */
export type OcrEdit = Edit | { id: string; kind: "time"; key: "date" | "exitDate"; text: string };

const isTimeEdit = (e: OcrEdit): e is Extract<OcrEdit, { kind: "time" }> => e.kind === "time";
const p2 = (n: number): string => String(n).padStart(2, "0");

/** Local wall clock `YYYY-MM-DDTHH:mm:ss` of a typed time (no zone move: the trader types their own time). */
export function typedWall(text: string, now: Date): string | null {
  const t = parseShotTime(text, { now });
  if (!t?.date) return null;
  return `${t.date}T${t.time}:${p2(t.seconds ?? 0)}`;
}

/** A typed entry has no quantity of its own: it takes the one the closing order(s) show. */
function withEntryQty(c: Candidate): Candidate {
  if (!c.entries.length || c.entries[0]!.qty != null) return c;
  const q = totalQty(c.exits);
  return q == null ? c : { ...c, entries: c.entries.map((l, i) => (i === 0 ? { ...l, qty: q } : l)) };
}

/**
 * The exchange's result is NET of fees; when the screenshot shows no fee, the fees follow from the CURRENT prices, quantity and
 * result (gross - result) - after an edit too. Only a believable amount is taken, and it is marked derived in the preview.
 */
function withDerivedFees(c: Candidate): Candidate {
  if (c.fees.value != null || c.status !== "closed" || c.pnl.value == null || !c.side.value || !c.entries.length || !c.exits.length) return c;
  const d = checkRecord({ side: c.side.value, entry: averagePrice(c.entries), exit: averagePrice(c.exits), qty: totalQty(c.entries) ?? totalQty(c.exits), pnl: c.pnl.value, roi: null, leverage: null, fee: null }).derivedFees;
  return d == null ? c : { ...c, fees: { value: Number(d.toPrecision(12)), raw: null, conf: 0.8, state: "ok" } };
}

/** The import's edits, the typed times, and the entry quantity fix – on freshly built candidates. */
export function applyOcrEdits(list: readonly Candidate[], edits: readonly OcrEdit[], now: Date): Candidate[] {
  const base = applyEdits(
    list,
    edits.filter((e): e is Edit => !isTimeEdit(e)),
  )
    .map(withEntryQty)
    .map(withDerivedFees);
  return base.map((c) =>
    edits
      .filter(isTimeEdit)
      .filter((e) => e.id === c.id)
      .reduce<Candidate>((acc, e) => {
        const at = typedWall(e.text, now);
        if (!at) return acc;
        if (e.key === "date") return { ...acc, entries: acc.entries.map((l, i) => (i === 0 ? { ...l, at, conf: 1, uncertain: false, notes: [] } : l)) };
        return { ...acc, exits: acc.exits.map((l, i) => (i === acc.exits.length - 1 ? { ...l, at, conf: 1, uncertain: false, notes: [] } : l)) };
      }, c),
  );
}

const nf = (d: number): Intl.NumberFormat => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d });
export const fmtWhen = (at: string | null): string => (at ? at.replace("T", " ").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3.$2.$1") : "—");
const num = (v: number | null | undefined, d = 8): string => (v == null ? "—" : nf(d).format(v));

function fieldsOf(recs: readonly ReadRecord[], pick: (r: ReadRecord) => RField | null | undefined): RField | null {
  for (const r of recs) {
    const f = pick(r);
    if (f) return f;
  }
  return null;
}

export interface PreviewContext {
  trades: readonly Trade[];
  currency: string;
  now: Date;
  edits: readonly OcrEdit[];
}

const edited = (edits: readonly OcrEdit[], id: string, key: CellKey): boolean =>
  edits.some((e) => e.id === id && ((e.kind === "field" && (e.key === key || (key === "pair" && e.key === "pair"))) || (e.kind === "side" && key === "side") || (e.kind === "time" && e.key === key)));

/** The fields of one candidate with their doubt. */
export function cellsOf(c: Candidate, recs: readonly ReadRecord[], ctx: PreviewContext): PreviewCell[] {
  const planned = c.status === "planned";
  const entry = averagePrice(c.entries);
  const exit = averagePrice(c.exits);
  const qty = totalQty(c.entries) ?? totalQty(c.exits);
  const closed = c.status === "closed";
  const mk = (key: CellKey, label: string, text: string, input: string, rf: RField | null, value: unknown, over: Partial<PreviewCell> = {}): PreviewCell => {
    const missing = value == null || value === "";
    const doubt = rf != null && rf.conf < 0.7;
    const isEdited = edited(ctx.edits, c.id, key);
    const notes = isEdited ? [] : [...(rf?.notes ?? [])];
    return {
      key,
      label,
      text: missing ? "—" : text,
      input,
      state: missing ? "missing" : doubt && !isEdited ? "uncertain" : "ok",
      notes,
      derived: !isEdited && !!rf?.derived,
      required: false,
      ...over,
    };
  };
  const symbol = fieldsOf(recs, (r) => r.symbol);
  const sideDerived = recs.some((r) => r.side.derived);
  const sideConf = recs[0]?.side.conf ?? 1;
  const sideNotes = recs.flatMap((r) => r.side.notes);
  const plau = checkRecord({ side: c.side.value, entry: averagePrice(c.entries), exit: averagePrice(c.exits), qty, pnl: c.pnl.value, roi: recs.find((r) => r.nums.roi?.value != null)?.nums.roi?.value ?? null, leverage: c.leverage.value, fee: null });
  const cells: PreviewCell[] = [
    mk("pair", "Markt", c.pair.value ?? "", c.pair.value ?? "", symbol, c.pair.value, { required: true }),
    {
      key: "side",
      label: "Richtung",
      text: c.side.value ? (c.side.value === "long" ? "Long" : "Short") : "—",
      input: c.side.value ?? "",
      state: !c.side.value ? "missing" : (sideConf < 0.7 || sideDerived) && !edited(ctx.edits, c.id, "side") ? "uncertain" : "ok",
      notes: edited(ctx.edits, c.id, "side") ? [] : sideNotes,
      derived: sideDerived && !edited(ctx.edits, c.id, "side"),
      required: true,
    },
    mk("qty", "Menge", num(qty), qty == null ? "" : toInputString(Number(qty.toPrecision(12))), fieldsOf(recs, (r) => r.nums.qty), qty, { required: !planned }),
    mk("entry", planned ? "Geplanter Einstieg" : "Einstieg", num(entry), entry == null ? "" : toInputString(Number(entry.toPrecision(12))), fieldsOf(recs, (r) => r.nums.entry ?? r.nums.price ?? r.nums.orderPrice), entry, { required: true }),
  ];
  if (closed || c.exits.length) cells.push(mk("exit", "Ausstieg", num(exit), exit == null ? "" : toInputString(Number(exit.toPrecision(12))), fieldsOf(recs, (r) => r.nums.exit ?? (r.action?.action === "close" ? r.nums.price : null)), exit, { required: closed }));
  if (closed || c.pnl.value != null) {
    const pf = fieldsOf(recs, (r) => r.nums.pnl);
    cells.push(mk("pnl", `Ergebnis (${ctx.currency})`, c.pnl.value == null ? "—" : `${c.pnl.value > 0 ? "+" : ""}${nf(8).format(c.pnl.value)}`, c.pnl.value == null ? "" : toInputString(c.pnl.value), pf, c.pnl.value, { required: false }));
  }
  const t0 = firstAt(c.entries);
  const t1 = lastAt(c.exits);
  const fResult = (key: "openTime" | "closeTime" | "time"): RField | null => fieldsOf(recs, (r) => r.times[key]);
  const dateField = mk("date", "Einstiegszeit", fmtWhen(t0), t0 ? t0.replace("T", " ") : "", fResult("openTime") ?? fResult("time"), t0, { required: true });
  if (t0 && c.entries.some((l) => l.uncertain && l.notes.some((n) => /Jahr|Reihenfolge|Datum|Zeit/.test(n))) && dateField.state === "ok" && !edited(ctx.edits, c.id, "date")) {
    dateField.state = "uncertain";
    dateField.notes = [...new Set([...dateField.notes, ...c.entries.flatMap((l) => l.notes).filter((n) => /Jahr|Reihenfolge|Datum|Zeit/.test(n))])];
  }
  cells.push(dateField);
  if (closed || c.exits.length) cells.push(mk("exitDate", "Ausstiegszeit", fmtWhen(t1), t1 ? t1.replace("T", " ") : "", fResult("closeTime"), t1, { required: false }));
  if (c.leverage.value != null || recs.some((r) => r.leverage)) cells.push(mk("leverage", "Hebel", c.leverage.value == null ? "—" : `${nf(2).format(c.leverage.value)}×`, c.leverage.value == null ? "" : toInputString(c.leverage.value), recs[0]?.leverage ?? null, c.leverage.value));
  if (c.fees.value != null) {
    // derived: from the record's own derivation or from the current numbers (a fee the picture shows has the text it was read from)
    const derivedFees = (recs.some((r) => r.derivedFees != null) || (c.fees.raw == null && !c.fees.edited)) && !edited(ctx.edits, c.id, "fees");
    cells.push({ ...mk("fees", `Gebühren (${ctx.currency})`, nf(4).format(c.fees.value), toInputString(Number(c.fees.value.toPrecision(12))), null, c.fees.value), state: "ok", derived: derivedFees, notes: derivedFees ? ["abgeleitet: Preise × Menge − Ergebnis (inkl. Funding), nicht im Screenshot gelesen"] : [] });
  }
  // what the numbers say about each other: a field that does not fit the others is doubtful until it is corrected
  const keyOf: Partial<Record<PlauField, CellKey>> = { entry: "entry", exit: "exit", qty: "qty", pnl: "pnl", leverage: "leverage", side: "side" };
  for (const flag of plau.flags) {
    if (flag.code === "side_hint" && !flag.fields.includes("entry")) continue;
    for (const f of flag.fields) {
      const cell = cells.find((x) => x.key === keyOf[f]);
      if (!cell || cell.state === "missing" || edited(ctx.edits, c.id, cell.key)) continue;
      cell.state = "uncertain";
      if (!cell.notes.includes(flag.text)) cell.notes.push(flag.text);
    }
  }
  return cells;
}

/** Why the trade cannot be written yet. */
export function blockedReason(cells: readonly PreviewCell[]): string | null {
  const miss = cells.filter((c) => c.required && c.state === "missing").map((c) => c.label);
  return miss.length ? `${miss.join(", ")} fehlt${miss.length > 1 ? "en" : ""}` : null;
}

export function previewRows(cands: readonly Candidate[], recordsOf: ReadonlyMap<string, readonly ReadRecord[]>, ctx: PreviewContext): PreviewRow[] {
  return cands.map((c) => {
    const recs = recordsOf.get(c.id) ?? [];
    const cells = cellsOf(c, recs, ctx);
    const checks = checksOf(c, { trades: ctx.trades, now: ctx.now, currency: ctx.currency });
    const dup = checks.find((k): k is Check & { duplicate: NonNullable<Check["duplicate"]> } => k.level === "dup" && !!k.duplicate);
    const loose = dup ? null : findDuplicateLoose(c, ctx.trades);
    const draft = toDraft(c, []);
    const live = checkRecord({ side: c.side.value, entry: averagePrice(c.entries), exit: averagePrice(c.exits), qty: totalQty(c.entries) ?? totalQty(c.exits), pnl: c.pnl.value, roi: recs.find((r) => r.nums.roi?.value != null)?.nums.roi?.value ?? null, leverage: c.leverage.value, fee: null });
    const warnings = [
      ...live.flags.filter((f) => f.code !== "side_hint" || f.fields.includes("entry")).map((f) => f.text),
      ...checks.filter((k) => k.level === "warn" && !["pnl_mismatch", "side_flip", "entry_missing", "entry_implied", "stop_not_original", "no_time"].includes(k.code)).map((k) => k.text),
    ];
    const title = [c.pair.value ?? "Markt unbekannt", c.side.value ? (c.side.value === "long" ? "Long" : "Short") : null, c.leverage.value != null ? `${nf(2).format(c.leverage.value)}×` : null].filter(Boolean).join(" · ");
    return {
      id: c.id,
      title: draft.pair ? title : title,
      cells,
      attention: cells.filter((x) => x.state !== "ok" && (x.state === "uncertain" || x.required)).length,
      blocked: blockedReason(cells),
      duplicate: dup ? { text: dup.text, trade: dup.duplicate.trade } : loose,
      warnings: [...new Set(warnings)],
      crops: recs.map((r) => ({ page: r.page, box: r.box })),
      status: c.status,
    };
  });
}

export { fmtPrice };
export type { Side };
