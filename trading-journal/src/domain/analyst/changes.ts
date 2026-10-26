/**
 * "Was sich geändert hat" in plain German sentences with the numbers, and the notes about the data (derived quarters,
 * restatements, lagging facts, one-offs). Pure: every figure in a sentence comes from the `AnalystResult` it is built from.
 * No adjectives that the numbers do not carry ("stark", "schwach") – only direction and size.
 */
import { daysBetween, msOfIso } from "@/market/sec/days";
import type { SecFilingsPayload } from "@/market/sec/wire";
import { dateDe, levelText, money, perShare, pctText, pointsText, quarterLabel, shareCount, calendarLabel } from "./fmt";
import { CASHFLOW_DERIVED_TEXT, CONSENSUS_TEXT, DERIVATION_TEXT, EPS_APPROX_TEXT, SEASONAL_TEXT } from "./texts";
import type { AnalystResult, Cell, ChangeLine, Delta, Note, QuarterRow } from "./types";
import { MINUS } from "@/lib/format";

/** "+16,4 %" or the reason there is no percentage. */
function pctOrWhy(d: Delta | null | undefined): string | null {
  if (!d) return null;
  if (d.pct != null) return pctText(d.pct);
  return d.note === "base-negative" ? "Vorwert negativ, ohne Prozentwert" : "Vorwert null, ohne Prozentwert";
}

const signedMoney = (v: number, cur: string): string => `${v > 0 ? "+" : ""}${money(v, cur)}`.replace("-", MINUS);

/** `"+16,4 % zum Vorjahresquartal (94,04 Mrd. USD)"`, or `null` when there is nothing to compare with. */
function versus(d: Delta | null | undefined, label: string, other: string | null): string | null {
  const p = pctOrWhy(d);
  if (!p) return null;
  return `${p} ${label}${other ? ` (${other})` : ""}`;
}

const join = (parts: (string | null)[]): string => parts.filter((x): x is string => !!x).join(", ");

export function buildChanges(r: AnalystResult): ChangeLine[] {
  const q = r.quarters[0];
  const c = r.comparisons[0];
  if (!q || !c) return [];
  const cur = r.currency;
  const byEnd = new Map(r.quarters.map((x) => [x.end, x]));
  const prev = q.prevEnd ? byEnd.get(q.prevEnd) ?? null : null;
  const year = q.yearAgoEnd ? byEnd.get(q.yearAgoEnd) ?? null : null;
  const out: ChangeLine[] = [];
  const push = (id: string, group: ChangeLine["group"], text: string): void => {
    out.push({ id, group, text });
  };
  const derivedNames = incomeCells(q).filter(([, c]) => c?.derived && c.derived !== "calc").map(([name]) => name);
  const derivedHow = derivedNames.length ? ` Nicht als Einzelquartal gemeldet, sondern abgeleitet: ${derivedNames.join(", ")}.` : "";
  push("head", "quarter", `Quartal ${quarterLabel(q)} (${calendarLabel(q.calendar)}), Ende ${dateDe(q.end)}.${derivedHow}`);

  if (q.revenue) {
    const text = join([versus(c.yoy.revenue, "zum Vorjahresquartal", year?.revenue ? money(year.revenue.value, cur) : null) ?? "kein Vorjahresquartal in den Daten", versus(c.qoq.revenue, "zum Vorquartal", prev?.revenue ? money(prev.revenue.value, cur) : null) ?? "kein Vorquartal in den Daten"]);
    push("revenue", "growth", `Umsatz ${money(q.revenue.value, cur)}: ${text}.`);
  }
  if (q.operatingIncome) {
    const v = versus(c.yoy.operatingIncome, "zum Vorjahresquartal", year?.operatingIncome ? money(year.operatingIncome.value, cur) : null);
    const alt = c.yoy.operatingIncome && c.yoy.operatingIncome.pct == null ? ` (Veränderung ${signedMoney(c.yoy.operatingIncome.abs, cur)})` : "";
    push("operating", "profit", `Operatives Ergebnis ${money(q.operatingIncome.value, cur)}${v ? `: ${v}` : ""}${alt}.`);
  }
  if (q.netIncome || q.epsDiluted) {
    const ni = q.netIncome ? `Nettoergebnis ${money(q.netIncome.value, cur)}${c.yoy.netIncome ? ` (${pctOrWhy(c.yoy.netIncome)} zum Vorjahresquartal${c.yoy.netIncome.pct == null ? `, Veränderung ${signedMoney(c.yoy.netIncome.abs, cur)}` : ""})` : ""}` : null;
    const eps = q.epsDiluted ? `verwässertes EPS ${perShare(q.epsDiluted.value, cur)}${c.yoy.epsDiluted ? ` (${pctOrWhy(c.yoy.epsDiluted)} zum Vorjahresquartal)` : ""}${q.epsDiluted.approx ? " – näherungsweise" : ""}` : null;
    push("net", "profit", `${[ni, eps].filter(Boolean).join("; ")}.`.replace(/^./, (s) => s.toUpperCase()));
  }
  const margins: [string, string, number | null, number | null, number | null][] = [
    ["gross", "Bruttomarge", q.grossMargin, c.marginQoq.gross, c.marginYoy.gross],
    ["opmargin", "Operative Marge", q.operatingMargin, c.marginQoq.operating, c.marginYoy.operating],
    ["netmargin", "Nettomarge", q.netMargin, c.marginQoq.net, c.marginYoy.net],
  ];
  for (const [id, label, level, dq, dy] of margins) {
    if (level == null) continue;
    const parts = join([dq != null ? `${pointsText(dq)} zum Vorquartal` : null, dy != null ? `${pointsText(dy)} zum Vorjahresquartal` : null]);
    push(id, "margin", `${label} ${levelText(level)}${parts ? ` (${parts})` : " (kein Vergleich in den Daten)"}.`);
  }
  if (q.freeCashFlow && q.operatingCashFlow && q.capex) {
    const v = versus(c.yoy.freeCashFlow, "zum Vorjahresquartal", year?.freeCashFlow ? money(year.freeCashFlow.value, cur) : null);
    push("fcf", "cash", `Freier Cashflow ${money(q.freeCashFlow.value, cur)} (operativer Cashflow ${money(q.operatingCashFlow.value, cur)} minus Investitionen ${money(Math.abs(q.capex.value), cur)})${v ? `: ${v}` : ""}.`);
  } else if (q.operatingCashFlow) {
    push("ocf", "cash", `Operativer Cashflow ${money(q.operatingCashFlow.value, cur)}; Investitionen nicht gemeldet, daher kein freier Cashflow.`);
  }
  if (q.debt) {
    const yoy = versus(c.debtYoy, "zum Vorjahresquartal", year?.debt ? money(year.debt.value, cur) : null);
    const cash = q.cash != null ? `, Kasse ${money(q.cash, cur)}` : "";
    const net = q.netDebt != null ? (q.netDebt >= 0 ? `, Nettoverschuldung ${money(q.netDebt, cur)}` : `, Nettoguthaben ${money(-q.netDebt, cur)} (mehr Kasse und Wertpapiere als Schulden)`) : "";
    push("debt", "debt", `Finanzschulden ${money(q.debt.value, cur)}${yoy ? ` (${yoy})` : ""}${cash}${net}.`);
  }
  if (q.sharesDiluted) {
    const v = versus(c.yoy.sharesDiluted, "zum Vorjahresquartal", year?.sharesDiluted ? shareCount(year.sharesDiluted.value) : null);
    push("shares", "shares", `Verwässerte Aktienzahl (Durchschnitt im Quartal) ${shareCount(q.sharesDiluted.value)}${v ? `: ${v}` : ""}.`);
  }
  const missing: string[] = [];
  if (!q.revenue) missing.push("Umsatz");
  if (!q.grossProfit) missing.push("Bruttoergebnis");
  if (!q.operatingIncome) missing.push("operatives Ergebnis");
  if (!q.netIncome) missing.push("Nettoergebnis");
  if (!q.epsDiluted) missing.push("verwässertes EPS");
  if (!q.freeCashFlow) missing.push("freier Cashflow");
  if (!q.debt) missing.push("Finanzschulden");
  if (!q.sharesDiluted) missing.push("verwässerte Aktienzahl");
  if (missing.length) push("missing", "caution", `Keine Daten für dieses Quartal: ${missing.join(", ")}.`);
  return out;
}

const labelOf = (q: QuarterRow): string => `${quarterLabel(q)} (bis ${dateDe(q.end)})`;

/** The income-statement figures of a row with their German names (cash-flow figures have their own note). */
function incomeCells(q: QuarterRow): [string, Cell | null][] {
  return [
    ["Umsatz", q.revenue],
    ["Bruttoergebnis", q.grossProfit],
    ["operatives Ergebnis", q.operatingIncome],
    ["Nettoergebnis", q.netIncome],
    ["verwässertes EPS", q.epsDiluted],
  ];
}

export interface NoteContext {
  skippedUnits: readonly string[];
  filings: SecFilingsPayload | null;
  now: number;
  allRows: readonly QuarterRow[];
}

export function buildNotes(r: AnalystResult, ctx: NoteContext): Note[] {
  const notes: Note[] = [{ kind: "consensus", text: CONSENSUS_TEXT }];
  const q = r.quarters[0];
  const cur = r.currency;
  if (r.stamp.stale) notes.push({ kind: "stale", text: `Die SEC war gerade nicht erreichbar. Gezeigt wird die letzte gute Kopie vom ${dateDe(new Date(r.stamp.fetchedAt).toISOString().slice(0, 10))}.` });
  if (!q) {
    notes.push({ kind: "missing", text: "In den SEC-Daten dieser Firma gibt es keine Quartalszahlen (Umsatz, Nettoergebnis oder EPS). Häufige Gründe: Fonds und ETFs, Firmen ohne US-GAAP-Berichte, neue Börsengänge." });
    return notes;
  }
  const filingReport = ctx.filings?.report ?? null;
  if (filingReport?.reportDate && daysBetween(q.end, filingReport.reportDate) > 20) {
    notes.push({
      kind: "lag",
      text: `Die SEC-Zahlen enden am ${dateDe(q.end)}, aber ein ${filingReport.form} für den Zeitraum bis ${dateDe(filingReport.reportDate)} wurde am ${dateDe(filingReport.filed)} eingereicht. Dieses Dokument selbst lesen, bevor du etwas zusammenfasst.`,
      url: filingReport.url,
    });
  }
  const end = msOfIso(q.end);
  if (end != null && (ctx.now - end) / 86_400_000 > 200) notes.push({ kind: "old", text: `Das neueste Quartal in den Daten endet am ${dateDe(q.end)} – das ist älter als ein halbes Jahr.` });

  const shown = r.quarters;
  for (const row of shown.slice(0, 4)) {
    const by = new Map<string, string[]>();
    for (const [name, c] of incomeCells(row)) {
      if (!c?.derived || c.derived === "calc") continue;
      by.set(DERIVATION_TEXT[c.derived], [...(by.get(DERIVATION_TEXT[c.derived]) ?? []), name]);
    }
    if (by.size) notes.push({ kind: "derived", text: `${labelOf(row)} ist nicht als Einzelquartal gemeldet: ${[...by].map(([how, names]) => `${names.join(", ")} = ${how}`).join("; ")}.` });
  }
  if (shown.some((x) => x.epsDiluted?.derived && x.epsDiluted.derived !== "calc")) notes.push({ kind: "derived", text: EPS_APPROX_TEXT });
  if (shown.some((x) => (x.operatingCashFlow?.derived ?? null) !== null || (x.capex?.derived ?? null) !== null)) notes.push({ kind: "derived", text: CASHFLOW_DERIVED_TEXT });
  if (shown.some((x) => [x.revenue, x.operatingIncome, x.netIncome, x.epsDiluted, x.operatingCashFlow, x.capex].some((c) => c?.inputsRevised))) {
    notes.push({ kind: "mixed", text: "Ein abgeleiteter Wert stützt sich auf eine Zahl, die eine spätere Einreichung geändert hat. Die Teile passen dann nicht exakt zusammen." });
  }

  let restated = 0;
  for (const row of shown) {
    const cells: [string, typeof row.revenue, boolean][] = [
      ["Umsatz", row.revenue, false],
      ["Operatives Ergebnis", row.operatingIncome, false],
      ["Nettoergebnis", row.netIncome, false],
      ["Verwässertes EPS", row.epsDiluted, true],
    ];
    for (const [name, c, per] of cells) {
      if (!c?.revised || restated >= 6) continue;
      restated++;
      const f = (v: number): string => (per ? perShare(v, cur) : money(v, cur));
      notes.push({ kind: "restated", text: `${name} ${labelOf(row)}: ursprünglich ${f(c.revised.original)} (eingereicht ${dateDe(c.revised.originalFiled)}), nach einer späteren Einreichung ${f(c.value)} (${dateDe(c.filed)}). Gezeigt wird der neuere Wert.` });
    }
  }

  const absent: string[] = [];
  if (!q.grossProfit) absent.push("Bruttoergebnis (bei Banken und Versicherungen üblich: sie melden kein Bruttoergebnis)");
  if (!q.operatingIncome) absent.push("operatives Ergebnis");
  if (!q.debt) absent.push("Finanzschulden (kein langfristiger Schuldenposten gemeldet)");
  if (!q.freeCashFlow) absent.push("freier Cashflow (Cashflow oder Investitionen nicht gemeldet)");
  if (!q.sharesDiluted) absent.push("verwässerte Aktienzahl");
  if (absent.length) notes.push({ kind: "missing", text: `Keine Daten im neuesten Quartal: ${absent.join("; ")}. Es wird nichts geschätzt.` });
  if (q.debt && !q.debt.complete) notes.push({ kind: "missing", text: "Der kurzfristige Teil der langfristigen Schulden ist nicht gemeldet: die Finanzschulden sind eine Untergrenze." });

  if (q.netIncome && q.operatingIncome && q.netIncome.value > q.operatingIncome.value) {
    notes.push({ kind: "oneoff", text: `Das Nettoergebnis (${money(q.netIncome.value, cur)}) liegt über dem operativen Ergebnis (${money(q.operatingIncome.value, cur)}): Erträge außerhalb des Kerngeschäfts (Anlagen, Steuern, Einmalposten) sind enthalten. Im 10-Q nachlesen, bevor du es als Wachstum liest.` });
  }
  if (cur !== "USD") notes.push({ kind: "currency", text: `Alle Beträge in ${cur}, so wie die Firma sie gemeldet hat – nichts wurde umgerechnet.` });
  if (ctx.skippedUnits.length) notes.push({ kind: "currency", text: `Nicht verwendet, weil die Einheit nicht zu ${cur} passt: ${ctx.skippedUnits.join(", ")}.` });
  notes.push({ kind: "seasonal", text: SEASONAL_TEXT });
  return notes;
}
