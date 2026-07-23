import { Card } from "@fahrschul/ui";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";
import { apiMutate, ApiError } from "../api/client.js";
import { useSession } from "../state/SessionContext.js";
import { useState } from "react";

const STATES = [
  "in_vorbereitung",
  "voraussetzungen_fehlen",
  "fahrlehrer_go",
  "bueroprüfung",
  "unterlagen_vollstaendig",
  "termin_angefragt",
  "termin_bestaetigt",
  "durchgefuehrt",
  "ergebnis_dokumentiert",
] as const;

const NEXT: Record<string, string[]> = {
  in_vorbereitung: ["voraussetzungen_fehlen", "fahrlehrer_go"],
  voraussetzungen_fehlen: ["in_vorbereitung", "fahrlehrer_go"],
  fahrlehrer_go: ["bueroprüfung"],
  "bueroprüfung": ["unterlagen_vollstaendig", "voraussetzungen_fehlen"],
  unterlagen_vollstaendig: ["termin_angefragt"],
  termin_angefragt: ["termin_bestaetigt"],
  termin_bestaetigt: ["durchgefuehrt"],
  durchgefuehrt: ["ergebnis_dokumentiert"],
  ergebnis_dokumentiert: [],
};

interface Pruefung {
  id: string;
  schuelerId: string;
  klasse: string;
  status: (typeof STATES)[number];
}

/**
 * Prüfungs-Pipeline als Board (eine Spalte je Zustand). Übergänge rufen
 * POST /pruefungen/:id/transition auf – "fahrlehrer_go" liefert für einen
 * Büro-Akteur serverseitig 403 (siehe packages/domain/pruefungspipeline.ts),
 * das wird hier als Fehlermeldung angezeigt statt den Button zu verstecken,
 * damit die serverseitige Durchsetzung sichtbar bleibt.
 */
export function Pruefungen() {
  const { user } = useSession();
  const { data, loading, error, reload } = useApiGet<{ pruefungen: Pruefung[] }>("/pruefungen");
  const [actionError, setActionError] = useState<string | null>(null);

  async function transition(id: string, to: string) {
    setActionError(null);
    try {
      await apiMutate(`/pruefungen/${id}/transition`, "POST", { to });
      reload();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(`${(err.body as { error?: string })?.error ?? err.message} (${to})`);
      } else {
        setActionError("Aktion fehlgeschlagen.");
      }
    }
  }

  return (
    <div>
      <header className="page-header">
        <h1>Prüfungs-Pipeline</h1>
      </header>
      <p className="dim">Angemeldet als: {user?.rolle}. "Fahrlehrer-Go" darf ausschließlich von Fahrlehrer-Konten gesetzt werden.</p>
      <DataState loading={loading} error={error} />
      {actionError ? (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      ) : null}
      {data ? (
        <div className="pipeline-board">
          {STATES.map((state) => (
            <Card key={state} title={state}>
              <ul className="queue-list">
                {data.pruefungen
                  .filter((p) => p.status === state)
                  .map((p) => (
                    <li key={p.id}>
                      <div>Klasse {p.klasse}</div>
                      <div className="queue-item__meta">
                        {(NEXT[state] ?? []).map((next) => (
                          <button key={next} className="fahrschul-btn fahrschul-btn--secondary" onClick={() => transition(p.id, next)}>
                            → {next}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
