import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface AuditEvent {
  id: string;
  type: string;
  aktion: string;
  entitaet: string;
  entitaetId: string | null;
  createdAt: string;
}

export function Audit() {
  const { data, loading, error } = useApiGet<{ events: AuditEvent[] }>("/office/audit?limit=200");

  return (
    <div>
      <header className="page-header">
        <h1>Audit</h1>
      </header>
      <DataState loading={loading} error={error} />
      {data ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Zeitpunkt</th>
              <th>Aktion</th>
              <th>Entität</th>
              <th>Typ</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString("de-DE")}</td>
                <td>{e.aktion}</td>
                <td>
                  {e.entitaet} {e.entitaetId ? `(${e.entitaetId.slice(0, 8)})` : ""}
                </td>
                <td>{e.type}</td>
              </tr>
            ))}
            {data.events.length === 0 ? (
              <tr>
                <td colSpan={4} className="dim">
                  Keine Audit-Ereignisse.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
