import { useParams } from "react-router-dom";
import { Card } from "@fahrschul/ui";
import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface Schueler360Response {
  header: {
    naechstesZiel: string;
    blocker: string[];
    naechsterTermin: { beginnAt: string; art: string } | null;
    empfohleneAktion: string;
  };
  schueler: { vorname: string; nachname: string };
  ausbildungen: Array<{ id: string; klasse: string; status: string }>;
  dokumente: Array<{ id: string; typ: string; status: string }>;
  rechnungen: Array<{ id: string; betragCent: number; status: string }>;
  termine: Array<{ id: string; beginnAt: string; art: string; status: string }>;
  pruefungen: Array<{ id: string; status: string; klasse: string }>;
}

/**
 * Schüler-360: der Kopfbereich zeigt AUSSCHLIESSLICH nächstes Ziel/Blocker/
 * nächster Termin/empfohlene Aktion (Spec-Vorgabe) – der Rest der Seite
 * enthält die vollständige Akte in Abschnitten.
 */
export function Schueler360() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApiGet<Schueler360Response>(id ? `/office/schueler/${id}` : null, [id]);

  return (
    <div>
      <DataState loading={loading} error={error} />
      {data ? (
        <>
          <header className="page-header">
            <h1>
              {data.schueler.vorname} {data.schueler.nachname}
            </h1>
          </header>
          <div className="header-360">
            <Card title="Nächstes Ziel">{data.header.naechstesZiel}</Card>
            <Card title="Blocker">
              {data.header.blocker.length === 0 ? "Keine" : <ul>{data.header.blocker.map((b) => <li key={b}>{b}</li>)}</ul>}
            </Card>
            <Card title="Nächster Termin">
              {data.header.naechsterTermin
                ? `${data.header.naechsterTermin.art} – ${new Date(data.header.naechsterTermin.beginnAt).toLocaleString("de-DE")}`
                : "Kein Termin"}
            </Card>
            <Card title="Empfohlene Aktion">{data.header.empfohleneAktion}</Card>
          </div>

          <div className="detail-grid">
            <Card title="Ausbildung">
              <ul>
                {data.ausbildungen.map((a) => (
                  <li key={a.id}>
                    Klasse {a.klasse} – {a.status}
                  </li>
                ))}
                {data.ausbildungen.length === 0 ? <li className="dim">Keine Ausbildung hinterlegt.</li> : null}
              </ul>
            </Card>
            <Card title="Termine">
              <ul>
                {data.termine.map((t) => (
                  <li key={t.id}>
                    {t.art} – {new Date(t.beginnAt).toLocaleString("de-DE")} ({t.status})
                  </li>
                ))}
                {data.termine.length === 0 ? <li className="dim">Keine Termine.</li> : null}
              </ul>
            </Card>
            <Card title="Dokumente">
              <ul>
                {data.dokumente.map((d) => (
                  <li key={d.id}>
                    {d.typ} – {d.status}
                  </li>
                ))}
                {data.dokumente.length === 0 ? <li className="dim">Keine Dokumente.</li> : null}
              </ul>
            </Card>
            <Card title="Rechnungen">
              <ul>
                {data.rechnungen.map((r) => (
                  <li key={r.id}>
                    {(r.betragCent / 100).toFixed(2)} € – {r.status}
                  </li>
                ))}
                {data.rechnungen.length === 0 ? <li className="dim">Keine Rechnungen.</li> : null}
              </ul>
            </Card>
            <Card title="Prüfungen">
              <ul>
                {data.pruefungen.map((p) => (
                  <li key={p.id}>
                    Klasse {p.klasse} – {p.status}
                  </li>
                ))}
                {data.pruefungen.length === 0 ? <li className="dim">Keine Prüfung angelegt.</li> : null}
              </ul>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
