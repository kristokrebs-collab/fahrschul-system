/**
 * Print view of the Transaktionsbuch (F70) – the PDF export. Same mechanism as `ReportPrint`: the component portals a white
 * A4 document into <body>, sets `html.tj-report-printing`, opens the print dialog ("Als PDF sichern") and cleans up on
 * `afterprint`. The head names what the document is (Hilfsrechnung ohne Steuerberatung), the zone, the currency and the matching
 * rule; the foot says what is not in it.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatStamp } from "@/domain/events/zone";
import { dec, FLAG_LABEL, KIND_LABEL, LEDGER_NOTE, LEDGER_SCOPE_NOTE, rowsOfYear, SCOPE_TEXT, type Ledger } from "@/domain/ledger";
import { n2 } from "@/lib/format";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import "../print.css";
import "./ledgerPrint.css";

/** The class `print.css` keys on (the report's print view uses the same one). */
const PRINT_CLASS = "tj-report-printing";

export function LedgerDocument({ ledger, year, now }: { ledger: Ledger; year: number | null; now: number }) {
  const zone = ledger.options.displayZone;
  const rows = rowsOfYear(ledger, year, zone);
  const years = ledger.years.filter((y) => year == null || y.year === year);
  return (
    <article className="rp" data-testid="ledger-print">
      <header className="rp-head">
        <div>
          <div className="rp-brand">Trading Journal · Hilfsrechnung</div>
          <h1 className="rp-title">
            Transaktionsbuch {year ?? "alle Jahre"}
          </h1>
          <div className="rp-mute">
            Währung {ledger.currency} · Zeitzone {zone} · Zuordnung FIFO {SCOPE_TEXT[ledger.options.scope]}
          </div>
        </div>
        <div className="rp-meta">erstellt {formatStamp(now, zone)}</div>
      </header>
      <p className="lp-note" data-testid="ledger-print-note">
        {LEDGER_NOTE}
      </p>
      <section className="rp-section lp-summary">
        <h2>Jahreszusammenfassung</h2>
        <table className="rp-table lp-table">
          <thead>
            <tr>
              {["Jahr", "Schließungen", "Gewinne", "Verluste", "Brutto", "Gebühren", "Funding", "Nach Kosten", "Zeilen mit Hinweis"].map((h, i) => (
                <th key={h} className={i > 0 ? "rp-n" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="rp-n">{y.closes}</td>
                <td className="rp-n">{n2(y.gains)}</td>
                <td className="rp-n">{n2(y.losses)}</td>
                <td className="rp-n">{n2(y.gross)}</td>
                <td className="rp-n">{n2(y.fees)}</td>
                <td className="rp-n">{n2(y.funding)}</td>
                <td className="rp-n">{n2(y.net)}</td>
                <td className="rp-n">{y.flagged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rp-section">
        <h2>Buchungszeilen ({rows.length})</h2>
        <table className="rp-table lp-table">
          <thead>
            <tr>
              {["Datum/Zeit", "Konto · Markt", "Art", "Menge", "Preis", "Gebühr", "Funding", "Ergebnis brutto"].map((h, i) => (
                <th key={h} className={i >= 3 ? "rp-n" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatStamp(r.at, zone)}</td>
                <td>
                  {r.account === "makro" ? "Makro" : "Scalp"} · {r.market}
                  {r.flags.map((f) => (
                    <span key={f.id + f.text} className="lp-flag">
                      {FLAG_LABEL[f.id]}: {f.text}
                    </span>
                  ))}
                </td>
                <td>
                  {KIND_LABEL[r.kind]}
                  {r.action ? ` · ${r.action}` : ""}
                  {r.kind === "open" || r.kind === "close" ? ` · ${r.side === "short" ? "Short" : "Long"}` : ""}
                </td>
                <td className="rp-n">{dec(r.qty, 0)}</td>
                <td className="rp-n">{dec(r.price)}</td>
                <td className="rp-n">{dec(r.fee)}</td>
                <td className="rp-n">{dec(r.funding)}</td>
                <td className="rp-n">{r.realized != null ? dec(r.realized) : r.unmatchedQty > 0 ? "offen" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="rp-foot">
        <p>{LEDGER_SCOPE_NOTE}</p>
        <p>
          {LEDGER_NOTE}. {NO_ADVICE_TEXT}
        </p>
      </footer>
    </article>
  );
}

export function LedgerPrint({ ledger, year, now, onDone }: { ledger: Ledger; year: number | null; now: number; onDone: () => void }) {
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
    const finish = (): void => {
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
      <LedgerDocument ledger={ledger} year={year} now={now} />
    </div>,
    document.body,
  );
}
