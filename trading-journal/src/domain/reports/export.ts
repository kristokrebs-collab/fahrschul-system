/**
 * Report export (P04): Markdown (readable, for notes / a mentor), CSV (the app's CSV dialect: BOM, `;`, decimal comma,
 * formula guard – opens in Excel / Numbers) and JSON (machine readable; trades as ids, never the full records). The
 * PDF is the print view (`ReportPrint` + `print.css`, `window.print()`). `focus` limits the sections like on screen.
 * Pure – nothing here touches the DOM.
 */
import { CSV_BOM, csvCell, csvTextCell } from "../csv";
import { pct, pct0, r as fmtR, signed } from "@/lib/format";
import { FOCUS_LABEL, type Report, type ReportFocus } from "./build";

const has = (focus: ReportFocus, s: Exclude<ReportFocus, "all">): boolean => focus === "all" || focus === s;
const money = (v: number | null | undefined, cur: string) => `${signed(v, 0)} ${cur}`;
const dash = (v: string | null | undefined) => (v == null || v === "" ? "–" : v);
const dec = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d).replace(".", ","));
const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");
}

/** File name: `bericht-2026-W41.md` (`-strategie` etc. with a focus). */
export function reportFilename(r: Pick<Report, "period">, ext: "md" | "csv" | "json", focus: ReportFocus = "all"): string {
  const f = focus === "all" ? "" : `-${FOCUS_LABEL[focus].toLowerCase()}`;
  return `bericht-${r.period.key}${f}.${ext}`;
}

/** The report as Markdown. */
export function reportToMarkdown(r: Report, focus: ReportFocus = "all"): string {
  const c = r.currency;
  const out: string[] = [];
  out.push(`# ${r.title}${focus === "all" ? "" : ` – ${FOCUS_LABEL[focus]}`}`);
  out.push(`_${r.period.range} · erstellt ${new Date(r.generatedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}${r.complete ? "" : " · Zeitraum läuft noch"}_`);
  out.push("", r.summary);
  if (r.highlights.length) out.push("", ...r.highlights.map((h) => `- ${h.text}`));
  if (r.empty) return out.join("\n") + "\n";
  const p = r.performance;
  if (focus === "all") {
    out.push("", "## Performance", "");
    out.push(
      table(
        ["Kennzahl", "Wert"],
        [
          ["Netto", money(p.g.net, c)],
          ["Rendite", pct(p.returnPct)],
          ["Trades", `${p.g.n}`],
          ["Win-Rate", pct0(p.g.winRate)],
          ["Profit-Faktor", p.g.pf === Infinity ? "∞" : dec(p.g.pf, 2)],
          ["Ø R", fmtR(p.g.avgR)],
          ["Summe R", fmtR(p.sumR)],
          ["Max. Drawdown", pct(p.maxDD)],
          ["Handelstage", `${p.tradingDays} (${pct0(p.dayWinRate)} grün)`],
          ["Bester Tag", p.bestDay ? `${p.bestDay.key} · ${money(p.bestDay.net, c)}` : "–"],
          ["Schwächster Tag", p.worstDay ? `${p.worstDay.key} · ${money(p.worstDay.net, c)}` : "–"],
        ],
      ),
    );
  }
  if (has(focus, "strategy")) {
    out.push("", "## Strategie", "");
    out.push(table(["Setup", "Trades", "Netto", "Win-Rate", "Ø R"], r.strategy.setups.map((s) => [s.label, `${s.n}`, money(s.net, c), pct0(s.winRate), fmtR(s.avgR)])));
    if (r.strategy.sides.length) out.push("", table(["Richtung", "Trades", "Netto", "Win-Rate"], r.strategy.sides.map((s) => [s.label, `${s.n}`, money(s.net, c), pct0(s.winRate)])));
    if (r.strategy.sessions.length) out.push("", table(["Session", "Trades", "Netto", "Win-Rate"], r.strategy.sessions.map((s) => [s.label, `${s.n}`, money(s.net, c), pct0(s.winRate)])));
  }
  if (has(focus, "risk")) {
    const k = r.risk;
    out.push("", "## Risiko", "");
    out.push(
      table(
        ["Kennzahl", "Wert"],
        [
          ["Ø Risiko pro Trade", k.avgRiskPct == null ? "–" : `${dec(k.avgRiskPct * 100, 2)} %`],
          ["Max. Risiko pro Trade", k.maxRiskPct == null ? "–" : `${dec(k.maxRiskPct * 100, 2)} %`],
          ["Über der Grenze", `${k.overLimit}`],
          ["Ø Hebel", k.avgLeverage == null ? "–" : `${dec(k.avgLeverage)}×`],
          ["Max. Hebel", k.maxLeverage == null ? "–" : `${dec(k.maxLeverage)}×`],
          ["Schlechtester Trade", fmtR(k.worstR)],
          ["Verluste über 1 R", `${k.bigLosses}`],
          ["Tage über dem Tageslimit", `${k.dayBreaches}`],
          ["Längste Verlustserie", `${k.longestLosing}`],
        ],
      ),
    );
  }
  if (has(focus, "psychology")) {
    const s = r.psychology;
    out.push("", "## Psychologie", "");
    out.push(s.behaviors.length ? table(["Muster", "Anzahl", "P&L", "vs. saubere Trades"], s.behaviors.map((b) => [b.label, `${b.count}`, money(b.net, c), money(b.excess, c)])) : "Keine auffälligen Muster.");
    out.push("", `Plan befolgt: ${pct0(s.planRate)} · Ø Stimmung: ${dec(s.mood)} · Ø Stress: ${dec(s.stress)} · Ø Zuversicht: ${dec(s.confidence)}`);
  }
  if (has(focus, "mistakes")) {
    const m = r.mistakes;
    out.push("", "## Fehler", "");
    out.push(m.rows.length ? table(["Fehler", "Trades", "Kosten vs. saubere Trades"], m.rows.map((x) => [`${x.tag}${x.auto ? " (automatisch)" : ""}`, `${x.n}`, money(x.excess, c)])) : "Keine Fehler markiert oder erkannt.");
    out.push("", `Saubere Trades: ${pct0(m.cleanShare)}`);
  }
  if (focus === "all") {
    const g = r.goals;
    out.push("", "## Zielerreichung", "");
    out.push(`Disziplin Ø ${g.discipline == null ? "–" : Math.round(g.discipline)} · Serie ${g.streak} Tage · Journaling ${pct0(g.journalRate)} · Checkliste ${pct0(g.checklistRate)} · Regelverstöße ${g.ruleBreaks}`);
    if (g.rows.length) out.push("", table(["Ziel", "Ziel", "Ist", "Erreicht"], g.rows.map((x) => [x.title, x.targetText, x.actualText, x.met == null ? "–" : x.met ? "ja" : "nein"])));
    const { prev, cur } = r.compare;
    out.push("", "## Vergleich mit der Vorperiode", "");
    out.push(
      table(
        ["Kennzahl", r.period.label, r.prevPeriod.label],
        [
          ["Trades", `${cur.n}`, `${prev.n}`],
          ["Netto", money(cur.net, c), money(prev.net, c)],
          ["Win-Rate", pct0(cur.winRate), pct0(prev.winRate)],
          ["Ø R", fmtR(cur.avgR), fmtR(prev.avgR)],
          ["Profit-Faktor", dec(cur.pf, 2), dec(prev.pf, 2)],
          ["Disziplin", dash(cur.discipline == null ? null : `${Math.round(cur.discipline)}`), dash(prev.discipline == null ? null : `${Math.round(prev.discipline)}`)],
        ],
      ),
    );
  }
  return out.join("\n") + "\n";
}

/** The report as CSV rows `Abschnitt;Kennzahl;Wert` (numbers as numbers, decimal comma). */
export function reportToCsv(r: Report, focus: ReportFocus = "all"): string {
  const rows: (string | number | null)[][] = [["Abschnitt", "Kennzahl", "Wert"]];
  const add = (sec: string, key: string, v: string | number | null) => rows.push([sec, key, v]);
  add("Bericht", "Zeitraum", r.period.label);
  add("Bericht", "Schlüssel", r.period.key);
  const p = r.performance;
  if (focus === "all") {
    add("Performance", "Netto", p.g.net);
    add("Performance", "Trades", p.g.n);
    add("Performance", "Win-Rate", p.g.winRate);
    add("Performance", "Profit-Faktor", p.g.pf === Infinity ? null : p.g.pf);
    add("Performance", "Ø R", p.g.avgR);
    add("Performance", "Summe R", p.sumR);
    add("Performance", "Max. Drawdown", p.maxDD);
    for (const d of p.days) add("Performance", `Tag ${d.key}`, d.net);
  }
  if (has(focus, "strategy")) for (const s of r.strategy.setups) add("Strategie", s.label, s.net);
  if (has(focus, "risk")) {
    add("Risiko", "Ø Risiko pro Trade", r.risk.avgRiskPct);
    add("Risiko", "Max. Risiko pro Trade", r.risk.maxRiskPct);
    add("Risiko", "Über der Grenze", r.risk.overLimit);
    add("Risiko", "Ø Hebel", r.risk.avgLeverage);
    add("Risiko", "Tage über dem Tageslimit", r.risk.dayBreaches);
  }
  if (has(focus, "psychology")) for (const b of r.psychology.behaviors) add("Psychologie", b.label, b.count);
  if (has(focus, "mistakes")) for (const m of r.mistakes.rows) add("Fehler", m.tag, m.excess);
  if (focus === "all") {
    add("Ziele", "Disziplin", r.goals.discipline);
    add("Ziele", "Regelverstöße", r.goals.ruleBreaks);
    for (const g of r.goals.rows) add("Ziele", g.title, g.actual);
    add("Vergleich", "Netto Vorperiode", r.compare.prev.net);
  }
  return CSV_BOM + rows.map((row, i) => row.map((v, j) => (i === 0 || j < 2 ? csvTextCell(v ?? "") : csvCell(v))).join(";")).join("\n");
}

/** The report as JSON (trades as ids). */
export function reportToJson(r: Report, focus: ReportFocus = "all"): string {
  const { trades, ...rest } = r;
  const body: Record<string, unknown> = {
    format: "trading-journal-report",
    version: 1,
    focus,
    ...rest,
    performance: { ...rest.performance, g: { ...rest.performance.g, best: rest.performance.g.best?.id ?? null, worst: rest.performance.g.worst?.id ?? null } },
    tradeIds: trades.map((t) => t.id),
  };
  if (!has(focus, "strategy")) delete body.strategy;
  if (!has(focus, "risk")) delete body.risk;
  if (!has(focus, "psychology")) delete body.psychology;
  if (!has(focus, "mistakes")) delete body.mistakes;
  return JSON.stringify(body, (_k, v) => (v === Infinity ? "Infinity" : v), 2);
}
