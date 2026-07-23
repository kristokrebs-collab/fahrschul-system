import { useState } from "react";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface Termin {
  id: string;
  schuelerId: string;
  fahrlehrerId: string;
  fahrzeugId: string | null;
  raumId: string | null;
  simulatorgeraetId: string | null;
  beginnAt: string;
  endeAt: string;
  art: string;
  status: string;
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function endOfWeekIso() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

/**
 * Planung: exakte Start-/Endzeiten (kein Tagesperioden-Raster wie im
 * Prototyp app.html) über GET /office/planung. Ressourcenfilter
 * (Fahrlehrer/Fahrzeug/Raum/Simulator) sind clientseitig, weil die Menge
 * pro Zeitraum überschaubar bleibt.
 */
export function Planung() {
  const [von, setVon] = useState(startOfTodayIso());
  const [bis, setBis] = useState(endOfWeekIso());
  const { data, loading, error } = useApiGet<{ termine: Termin[]; dataAsOf: string }>(
    `/office/planung?von=${encodeURIComponent(von)}&bis=${encodeURIComponent(bis)}`,
    [von, bis],
  );

  return (
    <div>
      <header className="page-header">
        <h1>Planung</h1>
      </header>
      <div className="filter-row">
        <label>
          Von
          <input type="datetime-local" value={von.slice(0, 16)} onChange={(e) => setVon(new Date(e.target.value).toISOString())} />
        </label>
        <label>
          Bis
          <input type="datetime-local" value={bis.slice(0, 16)} onChange={(e) => setBis(new Date(e.target.value).toISOString())} />
        </label>
      </div>
      <DataState loading={loading} error={error} />
      {data ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Beginn</th>
              <th>Ende</th>
              <th>Art</th>
              <th>Fahrlehrer</th>
              <th>Fahrzeug</th>
              <th>Raum</th>
              <th>Simulator</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.termine
              .sort((a, b) => new Date(a.beginnAt).getTime() - new Date(b.beginnAt).getTime())
              .map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.beginnAt).toLocaleString("de-DE")}</td>
                  <td>{new Date(t.endeAt).toLocaleString("de-DE")}</td>
                  <td>{t.art}</td>
                  <td>{t.fahrlehrerId.slice(0, 8)}</td>
                  <td>{t.fahrzeugId ? t.fahrzeugId.slice(0, 8) : "–"}</td>
                  <td>{t.raumId ? t.raumId.slice(0, 8) : "–"}</td>
                  <td>{t.simulatorgeraetId ? t.simulatorgeraetId.slice(0, 8) : "–"}</td>
                  <td>{t.status}</td>
                </tr>
              ))}
            {data.termine.length === 0 ? (
              <tr>
                <td colSpan={8} className="dim">
                  Keine Termine im gewählten Zeitraum.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
