import { useState } from "react";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";
import { apiMutate, ApiError } from "../api/client.js";
import { Button } from "@fahrschul/ui";

interface Lead {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  status: string;
  konvertiertZuSchuelerId: string | null;
}

export function Leads() {
  const { data, loading, error, reload } = useApiGet<{ leads: Lead[] }>("/leads");
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function createLead() {
    if (!vorname || !nachname) return;
    try {
      await apiMutate("/leads", "POST", { vorname, nachname });
      setVorname("");
      setNachname("");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Fehler");
    }
  }

  async function convert(id: string) {
    try {
      await apiMutate(`/leads/${id}/convert`, "POST");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Fehler");
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>Leads / CRM</h1>
      </header>
      <div className="filter-row">
        <input placeholder="Vorname" value={vorname} onChange={(e) => setVorname(e.target.value)} />
        <input placeholder="Nachname" value={nachname} onChange={(e) => setNachname(e.target.value)} />
        <Button onClick={createLead}>Lead anlegen</Button>
      </div>
      {actionError ? (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      ) : null}
      <DataState loading={loading} error={error} />
      {data ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.vorname} {l.nachname}
                </td>
                <td>{l.email ?? "–"}</td>
                <td>{l.status}</td>
                <td>
                  {l.status !== "konvertiert" ? (
                    <button className="fahrschul-btn fahrschul-btn--secondary" onClick={() => convert(l.id)}>
                      Zu Schüler konvertieren
                    </button>
                  ) : (
                    "Konvertiert"
                  )}
                </td>
              </tr>
            ))}
            {data.leads.length === 0 ? (
              <tr>
                <td colSpan={4} className="dim">
                  Keine Leads.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
