import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface Template {
  id: string;
  name: string;
  kanal: string;
}
interface LogEntry {
  id: string;
  kanal: string;
  status: string;
  betreff: string | null;
  gesendetAt: string | null;
}

export function Kommunikation() {
  const templates = useApiGet<{ templates: Template[] }>("/communication/templates");
  const log = useApiGet<{ nachrichten: LogEntry[] }>("/communication/log");

  return (
    <div>
      <header className="page-header">
        <h1>Kommunikation</h1>
      </header>
      <div className="detail-grid">
        <section>
          <h2>Vorlagen</h2>
          <DataState loading={templates.loading} error={templates.error} />
          <ul className="queue-list">
            {(templates.data?.templates ?? []).map((t) => (
              <li key={t.id}>
                {t.name} ({t.kanal})
              </li>
            ))}
            {templates.data && templates.data.templates.length === 0 ? <li className="dim">Keine Vorlagen.</li> : null}
          </ul>
        </section>
        <section>
          <h2>Sende-Log</h2>
          <DataState loading={log.loading} error={log.error} />
          <table className="data-table">
            <thead>
              <tr>
                <th>Kanal</th>
                <th>Betreff</th>
                <th>Status</th>
                <th>Gesendet</th>
              </tr>
            </thead>
            <tbody>
              {(log.data?.nachrichten ?? []).map((n) => (
                <tr key={n.id}>
                  <td>{n.kanal}</td>
                  <td>{n.betreff ?? "–"}</td>
                  <td>{n.status}</td>
                  <td>{n.gesendetAt ? new Date(n.gesendetAt).toLocaleString("de-DE") : "–"}</td>
                </tr>
              ))}
              {log.data && log.data.nachrichten.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dim">
                    Keine gesendeten Nachrichten.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
