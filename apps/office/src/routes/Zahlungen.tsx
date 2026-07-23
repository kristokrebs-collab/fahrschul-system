import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface KpiResponse {
  kpis: { offeneRechnungen: number };
}

/**
 * Zahlungen: Büro ist READ-MOSTLY (Non-Negotiable – volle
 * Finanz-Mutationsrechte bleiben apps/finance/Rolle "finanzen" vorbehalten,
 * siehe docs/role-permission-matrix.md). apps/api registriert absichtlich
 * KEINE Mutationsroute für Büro auf Rechnungen/Zahlungen; diese Ansicht ist
 * daher ein reiner Überblick über die KPI aus /office/auswertungen plus
 * einen Verweis auf die überfälligen Forderungen in der Heute-Queue.
 */
export function Zahlungen() {
  const { data, loading, error } = useApiGet<KpiResponse>("/office/auswertungen");

  return (
    <div>
      <header className="page-header">
        <h1>Zahlungen</h1>
      </header>
      <p className="dim">
        Büro sieht Rechnungen/Zahlungen lesend. Mahnwesen und Zahlungszuordnung sind Aufgabe von Finanzen
        (apps/finance, Prompt 4).
      </p>
      <DataState loading={loading} error={error} />
      {data ? <p>Offene Rechnungen: {data.kpis.offeneRechnungen}</p> : null}
    </div>
  );
}
