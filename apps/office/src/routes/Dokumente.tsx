import { useState } from "react";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";
import { apiMutate, ApiError } from "../api/client.js";

interface Dokument {
  id: string;
  schuelerId: string;
  typ: string;
  dateiname: string;
  status: string;
  scanStatus: string;
}

/**
 * Dokumentprüfung – das Büro-Gegenstück zum Schüler-Upload aus Prompt 1
 * (POST /documents/:id/review, Permission documents:verify).
 */
export function Dokumente() {
  const { data, loading, error, reload } = useApiGet<{ items: { entitaetId: string; entitaet: string }[] }>("/office/heute");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // GET /documents ist nicht als eigener Büro-Endpunkt vorgesehen (siehe
  // apps/api/src/routes/documents.ts) – die Warteschlange kommt daher aus
  // der Heute-Queue (dokumentspezifische Einträge), die Detailinfos werden
  // separat über den Review-Endpunkt bearbeitet. Für eine vollständige
  // eigenständige Dokumentenliste bräuchte apps/api einen GET
  // /documents/any-Endpunkt (siehe docs/office-final-qa.md, offener Punkt).

  async function review(docId: string, entscheidung: "akzeptiert" | "abgelehnt") {
    setBusyId(docId);
    setActionError(null);
    try {
      await apiMutate(`/documents/${docId}/review`, "POST", {
        entscheidung,
        ablehnungsgrund: entscheidung === "abgelehnt" ? "Bitte erneut einreichen" : undefined,
      });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Aktion fehlgeschlagen");
    } finally {
      setBusyId(null);
    }
  }

  const docQueueIds = (data?.items ?? []).filter((i) => i.entitaet === "dokument");

  return (
    <div>
      <header className="page-header">
        <h1>Dokumente</h1>
      </header>
      <DataState loading={loading} error={error} />
      {actionError ? (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      ) : null}
      <p className="dim">Zu prüfende Dokumente aus der Heute-Queue. Öffnen der Dokument-ID in der Schüler-360-Akte zeigt Details.</p>
      <ul className="queue-list">
        {docQueueIds.map((item) => (
          <li key={item.entitaetId}>
            <span>{item.entitaetId}</span>
            <div className="queue-item__meta">
              <button
                className="fahrschul-btn fahrschul-btn--primary"
                disabled={busyId === item.entitaetId}
                onClick={() => review(item.entitaetId, "akzeptiert")}
              >
                Akzeptieren
              </button>
              <button
                className="fahrschul-btn fahrschul-btn--danger"
                disabled={busyId === item.entitaetId}
                onClick={() => review(item.entitaetId, "abgelehnt")}
              >
                Ablehnen
              </button>
            </div>
          </li>
        ))}
        {docQueueIds.length === 0 ? <li className="dim">Keine offenen Dokumente.</li> : null}
      </ul>
    </div>
  );
}
