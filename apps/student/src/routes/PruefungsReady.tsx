import { Card } from "@fahrschul/ui";
import type { ExamReadiness } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";

/**
 * PrüfungsReady – read-only. Es gibt hier bewusst KEINEN Button/keine
 * Aktion zum Setzen einer Freigabe: die Schüler-App zeigt ausschließlich an,
 * was `GET /me/exam-readiness` liefert (kein Score, siehe
 * apps/api/src/services/exam-readiness.ts). Das Setzen einer Freigabe ist
 * serverseitig über `exam:clearance:set` auf Fahrlehrer/Büro beschränkt –
 * selbst ein manuell gebauter POST von hier aus würde mit 403 abgelehnt
 * (siehe apps/api/src/__tests__/student-app.test.ts).
 */
export function PruefungsReady() {
  const { data, loading, error, offline } = useApiGet<ExamReadiness>("/me/exam-readiness", "pruefung", "dokumente", "termine");

  if (loading) return <main className="screen"><p>Lädt…</p></main>;
  if (offline) return <main className="screen"><p>Keine Verbindung – PrüfungsReady braucht einen aktuellen Stand.</p></main>;
  if (error || !data) return <main className="screen"><p>PrüfungsReady ist gerade nicht verfügbar.</p></main>;

  return (
    <main className="screen">
      <h1>PrüfungsReady</h1>
      <p className="data-as-of">Stand: {new Date(data.dataAsOf).toLocaleString("de-DE")}</p>

      <Card title="Formale Voraussetzungen">
        <ul>
          {data.formalPrerequisites.map((p) => (
            <li key={p.typ}>
              {p.typ}: {p.geprueft ? "geprüft" : p.vorhanden ? "eingereicht, noch nicht geprüft" : "fehlt"}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Theorie">
        <p>{data.theoryStatus.note}</p>
      </Card>

      <Card title="Pflichtfahrten">
        {"done" in data.mandatoryDrives ? (
          <ul>
            {Object.entries(data.mandatoryDrives.done).map(([key, count]) => (
              <li key={key}>
                {key}: {count} / {(data.mandatoryDrives as { required: Record<string, number> }).required[key]}
              </li>
            ))}
          </ul>
        ) : (
          <p>{data.mandatoryDrives.note}</p>
        )}
      </Card>

      <Card title="Kompetenzbereiche (aus Feedback)">
        {data.competencyAreas.items.length > 0 ? (
          <ul>
            {data.competencyAreas.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>Noch keine Rückmeldung erfasst.</p>
        )}
      </Card>

      <Card title="Offene Lernziele">
        {data.openLearningGoals.length > 0 ? (
          <ul>
            {data.openLearningGoals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>Keine offenen Lernziele hinterlegt.</p>
        )}
      </Card>

      <Card title="Fahrlehrerfreigabe">
        <p>Status: {data.instructorClearance.status}</p>
      </Card>

      <Card title="Büro-Prüfung">
        <p>Status: {data.officeReview.status}</p>
      </Card>

      <p className="disclaimer">{data.disclaimer}</p>
    </main>
  );
}
