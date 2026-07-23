import { Card } from "@fahrschul/ui";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface Kpis {
  kpis: {
    schuelerGesamt: number;
    aktiveTermine: number;
    offeneDokumentpruefungen: number;
    offeneRechnungen: number;
  };
  dataAsOf: string;
}

export function Auswertungen() {
  const { data, loading, error } = useApiGet<Kpis>("/office/auswertungen");

  return (
    <div>
      <header className="page-header">
        <h1>Auswertungen</h1>
      </header>
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          <p className="dim">Stand: {new Date(data.dataAsOf).toLocaleString("de-DE")}</p>
          <div className="kpi-grid">
            <Card title="Schüler gesamt">{data.kpis.schuelerGesamt}</Card>
            <Card title="Aktive Termine">{data.kpis.aktiveTermine}</Card>
            <Card title="Offene Dokumentprüfungen">{data.kpis.offeneDokumentpruefungen}</Card>
            <Card title="Offene Rechnungen">{data.kpis.offeneRechnungen}</Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
