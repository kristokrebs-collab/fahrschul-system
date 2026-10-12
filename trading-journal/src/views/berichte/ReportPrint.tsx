/**
 * Print view of a report (P04) – the PDF export. The export card mounts `<ReportPrint>` (portalled to <body>); it sets
 * `html.tj-report-printing`, opens the browser's print dialog ("Als PDF sichern") and cleans up on `afterprint`.
 * `print.css` hides the app for print and lays the report out on white A4 – always light, plain tables, the curve as a
 * static SVG. The sections follow the focus like the Markdown export.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FOCUS_LABEL, type Report, type ReportFocus } from "@/domain/reports";
import { pct, pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { equityPoints } from "@/motion/fx/EquityDraw";
import "./print.css";

export const PRINT_CLASS = "tj-report-printing";

const money = (v: number | null | undefined, cur: string) => (v == null || !Number.isFinite(v) ? "–" : `${signed(v, 0)} ${cur}`);
const dec = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d).replace(".", ","));
const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v === 0 ? undefined : v > 0 ? "rp-win" : "rp-loss");
const has = (focus: ReportFocus, s: Exclude<ReportFocus, "all">) => focus === "all" || focus === s;

function Table({ head, rows, numeric = [] }: { head: string[]; rows: (string | { v: string; c?: string })[][]; numeric?: number[] }) {
  return (
    <table className="rp-table">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={`${h}-${i}`} className={numeric.includes(i) ? "rp-n" : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => {
              const c = typeof cell === "string" ? { v: cell } : cell;
              return (
                <td key={j} className={[numeric.includes(j) ? "rp-n" : "", c.c ?? ""].join(" ").trim() || undefined}>
                  {c.v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Curve({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const w = 600;
  const h = 90;
  const pts = equityPoints(values, w, h, 4, values[0]);
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg className="rp-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke={up ? "#12823f" : "#c4161f"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The printable document of a report (hidden on screen). */
export function ReportDocument({ report: r, focus }: { report: Report; focus: ReportFocus }) {
  const c = r.currency;
  const p = r.performance;
  return (
    <article className="rp" data-testid="report-print">
      <header className="rp-head">
        <div>
          <div className="rp-brand">Trading Journal · Bericht</div>
          <h1 className="rp-title">
            {r.title}
            {focus === "all" ? "" : ` – ${FOCUS_LABEL[focus]}`}
          </h1>
          <div className="rp-mute">
            {r.period.range}
            {r.complete ? "" : " · Zeitraum läuft noch"}
          </div>
        </div>
        <div className="rp-meta">
          <div className={`rp-net ${tone(p.g.net) ?? ""}`}>{money(p.g.net, c)}</div>
          <div>erstellt {new Date(r.generatedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>
        </div>
      </header>
      <p className="rp-summary">{r.summary}</p>
      {r.highlights.length > 0 && (
        <ul className="rp-highlights">
          {r.highlights.map((h) => (
            <li key={h.text}>{h.text}</li>
          ))}
        </ul>
      )}
      {!r.empty && (
        <>
          <dl className="rp-figures">
            {[
              ["Trades", `${p.g.n}`],
              ["Win-Rate", pct0(p.g.winRate)],
              ["Ø R", fmtR(p.g.avgR)],
              ["Profit-Faktor", p.g.pf == null ? "–" : fmtPf(p.g.pf)],
              ["Max. Drawdown", pct(p.maxDD)],
              ["Rendite", pct(p.returnPct)],
            ].map(([k, v]) => (
              <div key={k} className="rp-figure">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {focus === "all" && <Curve values={p.equity} />}
          {focus === "all" && (
            <section className="rp-section">
              <h2>Performance</h2>
              <Table
                head={["Kennzahl", "Wert"]}
                numeric={[1]}
                rows={[
                  ["Summe R", fmtR(p.sumR)],
                  ["Handelstage", `${p.tradingDays} (${pct0(p.dayWinRate)} grün)`],
                  ["Bester Tag", p.bestDay ? `${p.bestDay.key} · ${money(p.bestDay.net, c)}` : "–"],
                  ["Schwächster Tag", p.worstDay ? `${p.worstDay.key} · ${money(p.worstDay.net, c)}` : "–"],
                ]}
              />
            </section>
          )}
          {has(focus, "strategy") && (
            <section className="rp-section">
              <h2>Strategie</h2>
              <Table head={["Setup", "Trades", "Netto", "Win-Rate", "Ø R"]} numeric={[1, 2, 3, 4]} rows={r.strategy.setups.map((s) => [s.label, `${s.n}`, { v: money(s.net, c), c: tone(s.net) }, pct0(s.winRate), fmtR(s.avgR)])} />
              {r.strategy.sessions.length > 0 && <Table head={["Session", "Trades", "Netto", "Win-Rate"]} numeric={[1, 2, 3]} rows={r.strategy.sessions.map((s) => [s.label, `${s.n}`, { v: money(s.net, c), c: tone(s.net) }, pct0(s.winRate)])} />}
            </section>
          )}
          {has(focus, "risk") && (
            <section className="rp-section">
              <h2>Risiko</h2>
              <Table
                head={["Kennzahl", "Wert"]}
                numeric={[1]}
                rows={[
                  ["Ø Risiko pro Trade", r.risk.avgRiskPct == null ? "–" : `${dec(r.risk.avgRiskPct * 100, 2)} %`],
                  ["Max. Risiko pro Trade", r.risk.maxRiskPct == null ? "–" : `${dec(r.risk.maxRiskPct * 100, 2)} %`],
                  ["Über der Grenze", `${r.risk.overLimit}`],
                  ["Ø / max. Hebel", `${r.risk.avgLeverage == null ? "–" : `${dec(r.risk.avgLeverage)}×`} / ${r.risk.maxLeverage == null ? "–" : `${dec(r.risk.maxLeverage)}×`}`],
                  ["Schlechtester Trade", fmtR(r.risk.worstR)],
                  ["Verluste über 1 R", `${r.risk.bigLosses}`],
                  ["Tage über dem Tageslimit", `${r.risk.dayBreaches}`],
                  ["Längste Verlustserie", `${r.risk.longestLosing}`],
                ]}
              />
            </section>
          )}
          {has(focus, "psychology") && (
            <section className="rp-section">
              <h2>Psychologie</h2>
              {r.psychology.behaviors.length ? (
                <Table head={["Muster", "Anzahl", "P&L", "vs. saubere Trades"]} numeric={[1, 2, 3]} rows={r.psychology.behaviors.map((b) => [b.label, `${b.count}`, money(b.net, c), { v: money(b.excess, c), c: tone(b.excess) }])} />
              ) : (
                <p>Keine auffälligen Muster.</p>
              )}
              <p className="rp-mute">
                Plan befolgt {pct0(r.psychology.planRate)} · Ø Stimmung {dec(r.psychology.mood)} · Ø Stress {dec(r.psychology.stress)} · Ø Zuversicht {dec(r.psychology.confidence)}
              </p>
            </section>
          )}
          {has(focus, "mistakes") && (
            <section className="rp-section">
              <h2>Fehler</h2>
              {r.mistakes.rows.length ? (
                <Table head={["Fehler", "Trades", "Kosten vs. saubere Trades"]} numeric={[1, 2]} rows={r.mistakes.rows.map((x) => [`${x.tag}${x.auto ? " (erkannt)" : ""}`, `${x.n}`, { v: money(x.excess, c), c: tone(x.excess) }])} />
              ) : (
                <p>Keine Fehler markiert oder erkannt.</p>
              )}
              <p className="rp-mute">Saubere Trades: {pct0(r.mistakes.cleanShare)}</p>
            </section>
          )}
          {focus === "all" && (
            <section className="rp-section">
              <h2>Zielerreichung</h2>
              <p>
                Disziplin Ø {r.goals.discipline == null ? "–" : Math.round(r.goals.discipline)} · Serie {r.goals.streak} Tage · Journaling {pct0(r.goals.journalRate)} · Checkliste {pct0(r.goals.checklistRate)} · Regelverstöße {r.goals.ruleBreaks}
              </p>
              {r.goals.rows.length > 0 && <Table head={["Ziel", "Ziel", "Ist", "Erreicht"]} rows={r.goals.rows.map((x) => [x.title, x.targetText, x.actualText, { v: x.met == null ? "–" : x.met ? "ja" : "nein", c: x.met == null ? "rp-mute" : x.met ? "rp-win" : "rp-loss" }])} />}
            </section>
          )}
          {focus === "all" && (
            <section className="rp-section">
              <h2>Vergleich mit der Vorperiode</h2>
              <Table
                head={["Kennzahl", r.period.label, r.prevPeriod.label]}
                numeric={[1, 2]}
                rows={[
                  ["Trades", `${r.compare.cur.n}`, `${r.compare.prev.n}`],
                  ["Netto", money(r.compare.cur.net, c), money(r.compare.prev.net, c)],
                  ["Win-Rate", pct0(r.compare.cur.winRate), pct0(r.compare.prev.winRate)],
                  ["Ø R", fmtR(r.compare.cur.avgR), fmtR(r.compare.prev.avgR)],
                  ["Profit-Faktor", dec(r.compare.cur.pf, 2), dec(r.compare.prev.pf, 2)],
                  ["Disziplin", r.compare.cur.discipline == null ? "–" : `${Math.round(r.compare.cur.discipline)}`, r.compare.prev.discipline == null ? "–" : `${Math.round(r.compare.prev.discipline)}`],
                ]}
              />
            </section>
          )}
        </>
      )}
      <footer className="rp-foot">Berechnet aus deinem Journal – auf deinem Gerät. Keine Anlageberatung.</footer>
    </article>
  );
}

/** Portal host: mounted only while printing (the export card mounts it on "PDF"). */
export function ReportPrint({ report, focus, onDone }: { report: Report; focus: ReportFocus; onDone: () => void }) {
  const doneRef = useRef(onDone);
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });
  // once per mount: a new callback identity must never open a second dialog
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(PRINT_CLASS);
    let done = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      html.classList.remove(PRINT_CLASS);
      doneRef.current();
    };
    window.addEventListener("afterprint", finish);
    // one frame so the portal is laid out before the dialog snapshots the page
    const raf = requestAnimationFrame(() => {
      try {
        window.print();
      } catch {
        finish();
        return;
      }
      // print() blocks in Chromium / Safari and snapshots the document in Firefox: once it returned the page is free
      settle = setTimeout(finish, 500);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      window.removeEventListener("afterprint", finish);
      html.classList.remove(PRINT_CLASS);
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="report-print-root">
      <ReportDocument report={report} focus={focus} />
    </div>,
    document.body,
  );
}
