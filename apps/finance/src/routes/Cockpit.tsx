import { useCallback, useEffect, useState } from "react";
import { Card } from "@fahrschul/ui";
import { apiGet, apiMutate, ApiError } from "../api/client.js";

function centToEuro(cent: number | null | undefined): string {
  if (cent === null || cent === undefined) return "–";
  return (Number(cent) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

interface KpiCard {
  id: string;
  titel: string;
  datenqualitaet?: string;
  hinweis?: string;
  [key: string]: unknown;
}

interface KpiResponse {
  periode: { von: string; bis: string };
  cards: KpiCard[];
  stornoRetter: { gesamt: number; gerettet: number; erfolgsrateProzent: number | null; geretteterUmsatzCent: number };
}

interface BankQueueRow {
  id: string;
  amountCent: number;
  bookedAt: string;
  reference: string;
  counterparty: string;
  konfidenz: string;
  grund: string;
  hinweis: string;
}

interface DataQualityIssue {
  typ: string;
  anzahl: number;
  schweregrad: string;
  beschreibung: string;
}

/**
 * Geschäftsführungs-Cockpit: max. 7 Kern-Karten (Leistung/Umsatz,
 * Deckungsbeitrag/Ergebnis, Liquidität, Fahrlehrerauslastung,
 * Fahrzeugauslastung, offene Forderungen, Forecast) + Bankabgleich-
 * Review-Queue + Datenqualitäts-Issues + Export. Alle Zahlen kommen direkt
 * aus /finance/*-Endpunkten (echte Postgres-Aggregate, kein Mock im UI).
 */
export function Cockpit() {
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [queue, setQueue] = useState<BankQueueRow[] | null>(null);
  const [issues, setIssues] = useState<DataQualityIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [kpiRes, queueRes, dqRes] = await Promise.all([
        apiGet<KpiResponse>("/finance/kpis"),
        apiGet<{ queue: BankQueueRow[] }>("/finance/bank/queue"),
        apiGet<{ issues: DataQualityIssue[] }>("/finance/data-quality"),
      ]);
      setKpis(kpiRes);
      setQueue(queueRes.queue);
      setIssues(dqRes.issues);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSync() {
    setSyncing(true);
    try {
      await apiMutate("/finance/bank/sync", "POST", {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "sync_failed");
    } finally {
      setSyncing(false);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const res = await apiMutate<{ downloadUrl: string }>("/finance/exports", "POST", {
        bericht: "gf_cockpit",
        format: "csv",
      });
      window.open(`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${res.downloadUrl}`, "_blank");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "export_failed");
    } finally {
      setExporting(false);
    }
  }

  if (error) return <p className="form-error">Fehler: {error}</p>;
  if (!kpis) return <p className="dim">Lädt…</p>;

  return (
    <>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h1 style={{ margin: 0 }}>Geschäftsführungs-Cockpit</h1>
          <button className="fahrschul-btn fahrschul-btn--secondary" onClick={onExport} disabled={exporting}>
            {exporting ? "Export läuft…" : "Export (CSV)"}
          </button>
        </div>
        <p className="dim">
          Periode: {new Date(kpis.periode.von).toLocaleDateString("de-DE")} –{" "}
          {new Date(kpis.periode.bis).toLocaleDateString("de-DE")}
        </p>
        <div className="kpi-grid">
          {kpis.cards.map((card) => (
            <Card key={card.id} title={card.titel}>
              <KpiCardBody card={card} />
            </Card>
          ))}
        </div>
        <Card title="Storno-Retter-Erfolgsrate">
          <p className="kpi-value">
            {kpis.stornoRetter.erfolgsrateProzent !== null ? `${kpis.stornoRetter.erfolgsrateProzent}%` : "–"}
          </p>
          <p className="kpi-meta">
            {kpis.stornoRetter.gerettet} von {kpis.stornoRetter.gesamt} Ausfällen gerettet · geretteter Umsatz{" "}
            {centToEuro(kpis.stornoRetter.geretteterUmsatzCent)}
          </p>
        </Card>
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Bankabgleich – Review-Queue</h2>
          <button className="fahrschul-btn fahrschul-btn--primary" onClick={onSync} disabled={syncing}>
            {syncing ? "Synchronisiert…" : "Mock-Feed abrufen"}
          </button>
        </div>
        <p className="dim">
          Nur Konfidenz „sicher" wird automatisch gebucht. Alles andere landet hier zur manuellen Bestätigung.
        </p>
        <table>
          <thead>
            <tr>
              <th>Datum</th>
              <th>Betrag</th>
              <th>Zahler</th>
              <th>Referenz</th>
              <th>Konfidenz</th>
              <th>Grund</th>
              <th>Hinweis</th>
            </tr>
          </thead>
          <tbody>
            {(queue ?? []).map((tx) => (
              <tr key={tx.id}>
                <td>{new Date(tx.bookedAt).toLocaleDateString("de-DE")}</td>
                <td>{centToEuro(tx.amountCent)}</td>
                <td>{tx.counterparty}</td>
                <td>{tx.reference}</td>
                <td>
                  <span className={`badge badge--${tx.konfidenz}`}>{tx.konfidenz}</span>
                </td>
                <td>{tx.grund}</td>
                <td className="dim">{tx.hinweis}</td>
              </tr>
            ))}
            {(queue ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="dim">
                  Keine offenen Fälle.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Datenqualität</h2>
        <table>
          <thead>
            <tr>
              <th>Issue</th>
              <th>Anzahl</th>
              <th>Schweregrad</th>
              <th>Beschreibung</th>
            </tr>
          </thead>
          <tbody>
            {(issues ?? []).map((issue) => (
              <tr key={issue.typ}>
                <td>{issue.typ}</td>
                <td>{issue.anzahl}</td>
                <td>{issue.schweregrad}</td>
                <td className="dim">{issue.beschreibung}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function KpiCardBody({ card }: { card: KpiCard }) {
  return (
    <>
      {"fakturiertBruttoCent" in card ? (
        <>
          <p className="kpi-value">{centToEuro(card.fakturiertBruttoCent as number)}</p>
          <p className="kpi-meta">Netto {centToEuro(card.fakturiertNettoCent as number)}</p>
        </>
      ) : null}
      {"deckungsbeitragCent" in card ? <p className="kpi-value">{centToEuro(card.deckungsbeitragCent as number)}</p> : null}
      {"zahlungseingangCent" in card ? (
        <>
          <p className="kpi-value">{centToEuro(card.zahlungseingangCent as number)}</p>
          <p className="kpi-meta">Offene Forderung {centToEuro(card.offeneForderungCent as number)}</p>
        </>
      ) : null}
      {"offenCent" in card ? (
        <>
          <p className="kpi-value">{centToEuro(card.offenCent as number)}</p>
          <p className="kpi-meta">
            {String(card.anzahl)} Rechnungen · {String(card.reviewQueueCount)} in Review
          </p>
        </>
      ) : null}
      {card.hinweis ? <p className="kpi-meta">{card.hinweis}</p> : null}
      {card.datenqualitaet ? (
        <p style={{ marginTop: "0.5rem" }}>
          <span className={`badge badge--${card.datenqualitaet}`}>{card.datenqualitaet}</span>
        </p>
      ) : null}
      {card.drilldown ? <p className="kpi-meta">Drilldown: {String(card.drilldown)}</p> : null}
    </>
  );
}
