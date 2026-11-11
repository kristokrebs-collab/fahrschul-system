/**
 * One read trade → what the OPEN trade form receives (PURE): the import's own `toDraft` mapping (the same values a direct
 * write would save), the margin mode the card shows, the import notes (source, zone, derived / corrected values) and the
 * import tag – plus one MARK per form field from the preview's cells, so the editor shows what was read, what was
 * derived and what needs a look. Doubtful, implausible and missing required cells are `review`; nothing is guessed.
 */
import type { Candidate } from "@/journal/extract/candidate";
import { IMPORT_TAG, toDraft } from "@/journal/extract/draft";
import { FILL_LABEL, type FillKey, type FillMark, type ShotFill } from "@/journal/editor/shotFill";
import { importNotes } from "./commit";
import type { CellKey, PreviewRow } from "./preview";
import { correctionTexts, type ReadRecord } from "./records";

export interface FillContext {
  zoneText: string;
  viewLabel: string;
  currency: string;
  /** Short names of the cut-off cards of the same picture(s) („BTCUSDT – im Bild abgeschnitten …“) – named, never entered. */
  incomplete: readonly string[];
}

const CELL_TO_FIELD: Partial<Record<CellKey, FillKey>> = {
  pair: "pair",
  side: "side",
  qty: "qty",
  entry: "entry",
  exit: "exit",
  pnl: "pnlManual",
  date: "date",
  exitDate: "exitDate",
  leverage: "leverage",
  fees: "fees",
};

/** Whether the draft carries a value for a form field. */
function has(d: ReturnType<typeof toDraft>, k: FillKey): boolean {
  const v = (d as Record<string, unknown>)[k];
  return v != null && v !== "";
}

const DERIVED_FEES = "Preise × Menge − Ergebnis";

export function shotFillOf(c: Candidate, row: PreviewRow, recs: readonly ReadRecord[], ctx: FillContext): Omit<ShotFill, "seq"> {
  const d = toDraft(c, []);
  delete d.screenshots; // the form keeps its own pictures
  const marginMode = recs.find((r) => r.marginMode)?.marginMode ?? null;
  if (marginMode && d.market !== "spot") {
    d.marginMode = marginMode;
    d.market ??= "perp";
  }
  d.tags = [IMPORT_TAG];
  d.notes = [...importNotes(c, recs, ctx, ctx.currency), ...(d.notes ? [d.notes] : [])].join("\n");

  const marks: Partial<Record<FillKey, FillMark>> = {};
  for (const cell of row.cells) {
    const k = CELL_TO_FIELD[cell.key];
    if (!k) continue;
    if (cell.state === "missing") {
      if (cell.required) marks[k] = { state: "review", note: "nicht im Screenshot lesbar – bitte eintragen" };
      continue;
    }
    if (!has(d, k)) continue;
    const note = cell.notes.join(" · ") || undefined;
    if (cell.state === "uncertain") marks[k] = { state: "review", ...(note ? { note } : {}) };
    else if (cell.derived) marks[k] = { state: "derived", note: k === "fees" ? DERIVED_FEES : note };
    else marks[k] = { state: "read" };
  }
  if (has(d, "size")) {
    const doubt = marks.entry?.state === "review" || marks.qty?.state === "review";
    marks.size = { state: doubt ? "review" : "derived", note: "Einstieg × Menge" };
  }
  if (d.market) marks.market = { state: "read" };
  if (d.marginMode) marks.marginMode = { state: "read" };

  const keys = Object.keys(marks) as FillKey[];
  const taken = keys.filter((k) => has(d, k));
  const review = keys.filter((k) => marks[k]!.state === "review");
  const parts = [`Aus Screenshot übernommen (${ctx.viewLabel}, auf diesem Gerät gelesen, ohne KI): ${taken.length} Felder, jedes ist markiert.`];
  parts.push(review.length ? `Bitte prüfen: ${review.map((k) => FILL_LABEL[k]).join(", ")} (gelb).` : "Nichts Unsicheres – prüf die Werte trotzdem kurz.");
  // the zone sentence of the sheet without its pointer to the sheet's own select
  parts.push(`Zeiten: ${ctx.zoneText.replace(/\s*Falls[^.]*\.\s*$/, "")}`);
  parts.push(...correctionTexts(recs));
  for (const t of ctx.incomplete) parts.push(`Nicht übernommen: ${t}.`);
  parts.push("Gespeichert wird erst mit „Speichern“.");
  return { draft: d, marks, note: parts.join(" ") };
}
