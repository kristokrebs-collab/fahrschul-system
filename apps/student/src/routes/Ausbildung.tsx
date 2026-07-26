import { Card } from "@fahrschul/ui";
import { Link } from "react-router-dom";
import type { Dokument, ExamReadiness, Lernressource, SchuelerProfil, Terminbuchung } from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";

interface Step {
  key: string;
  label: string;
  status: "erledigt" | "offen" | "nicht_abgebildet";
  note?: string;
}

/**
 * Klassenabhängiger Ausbildungsweg. Reihenfolge-Zwang zwischen den Schritten
 * wird bewusst NICHT erzwungen (docs/fachliche-bestaetigungen.md Punkt 9 ist
 * offen) – dies ist eine Checkliste, kein Wizard mit Sperren. Wo der
 * Prompt-0-Datenmodell die fachliche Differenzierung (Theorieprüfung,
 * Praxisprüfung als eigene Entität) noch nicht abbildet, wird das als
 * "nicht_abgebildet" markiert statt eine Zahl zu erfinden.
 */
export function Ausbildung() {
  const profile = useApiGet<SchuelerProfil>("/me/schueler", "schueler");
  const readiness = useApiGet<ExamReadiness>("/me/exam-readiness", "pruefung", "dokumente", "termine");
  const documents = useApiGet<{ documents: Dokument[] }>("/documents/mine", "dokumente");
  const appointments = useApiGet<{ appointments: Terminbuchung[] }>("/appointments/mine", "termine");
  const learning = useApiGet<{ resources: Lernressource[] }>("/learning/resources");

  if (profile.loading || readiness.loading || documents.loading || appointments.loading || learning.loading) {
    return (
      <main className="screen">
        <p>Lädt…</p>
      </main>
    );
  }

  const ausbildung = profile.data?.ausbildungen[0] ?? null;
  const docs = documents.data?.documents ?? [];
  const bookings = appointments.data?.appointments ?? [];
  const resources = learning.data?.resources ?? [];

  const unterlagenOk = (readiness.data?.formalPrerequisites ?? []).every((p) => p.geprueft);
  const theorieResources = resources.filter((r) => r.typ === "kurs" || r.typ === "hoerbuch" || r.typ === "video");
  const theorieOk = theorieResources.length > 0 && theorieResources.every((r) => r.fortschritt === "besucht");
  const simulatorResources = resources.filter((r) => r.typ === "simulator");
  const simulatorOk = simulatorResources.length > 0 && simulatorResources.every((r) => r.fortschritt === "besucht");
  const uebungsfahrten = bookings.filter((b) => b.art.toLowerCase().includes("übungsstunde") && b.status !== "cancelled");
  const sonderfahrtenOk =
    readiness.data && "done" in readiness.data.mandatoryDrives
      ? Object.entries(readiness.data.mandatoryDrives.done).every(
          ([key, count]) => count >= (readiness.data!.mandatoryDrives as { required: Record<string, number> }).required[key],
        )
      : false;

  const steps: Step[] = [
    { key: "anmeldung", label: "Anmeldung", status: ausbildung ? "erledigt" : "offen" },
    { key: "unterlagen", label: "Unterlagen", status: docs.length === 0 ? "offen" : unterlagenOk ? "erledigt" : "offen" },
    { key: "theorie", label: "Theorie", status: theorieResources.length === 0 ? "nicht_abgebildet" : theorieOk ? "erledigt" : "offen" },
    {
      key: "theoriepruefung",
      label: "Theorieprüfung",
      status: "nicht_abgebildet",
      note: "Kein offizielles API für den Prüfungsstatus verfügbar (siehe docs/integration-gaps.md).",
    },
    { key: "simulator", label: "Simulator", status: simulatorResources.length === 0 ? "nicht_abgebildet" : simulatorOk ? "erledigt" : "offen" },
    {
      key: "uebungsfahrten",
      label: "Übungsfahrten",
      status: uebungsfahrten.length > 0 ? "erledigt" : "offen",
      note: `${uebungsfahrten.length} absolviert`,
    },
    {
      key: "sonderfahrten",
      label: "Sonderfahrten",
      status: readiness.data && "done" in readiness.data.mandatoryDrives ? (sonderfahrtenOk ? "erledigt" : "offen") : "nicht_abgebildet",
    },
    {
      key: "fahrlehrerfreigabe",
      label: "Fahrlehrerfreigabe",
      status: readiness.data?.instructorClearance.status === "freigegeben" ? "erledigt" : "offen",
    },
    {
      key: "praxispruefung",
      label: "Praxisprüfung",
      status: "nicht_abgebildet",
      note: "Prüfungstermin/-ergebnis ist noch keine eigene Entität (siehe docs/architecture-report.md).",
    },
    {
      key: "abschluss",
      label: "Abschluss",
      status:
        readiness.data?.instructorClearance.status === "freigegeben" && readiness.data?.officeReview.status === "freigegeben"
          ? "erledigt"
          : "offen",
    },
  ];

  return (
    <main className="screen">
      <h1>Ausbildung</h1>
      {ausbildung ? (
        <Card title={`Klasse ${ausbildung.klasse}`}>
          <ul>
            <li>Getriebeart: {ausbildung.getriebeart}</li>
            {ausbildung.b197 ? <li>B197 (begleitetes Fahren)</li> : null}
            {ausbildung.istErweiterung && ausbildung.vorbesitzKlasse ? (
              <li>Erweiterung von Klasse {ausbildung.vorbesitzKlasse}</li>
            ) : null}
          </ul>
        </Card>
      ) : (
        <Card title="Keine Ausbildung hinterlegt">
          <p>Für dich ist noch keine Ausbildung angelegt. Wende dich an dein Büro.</p>
        </Card>
      )}

      <ol className="ausbildung-steps">
        {steps.map((step) => (
          <li key={step.key} className={`ausbildung-step ausbildung-step--${step.status}`}>
            <span>{step.label}</span>
            <span aria-label={step.status}>
              {step.status === "erledigt" ? "✅" : step.status === "offen" ? "○" : "—"}
            </span>
            {step.note ? <p className="ausbildung-step__note">{step.note}</p> : null}
          </li>
        ))}
      </ol>

      <Link to="/ausbildung/pruefungsready">PrüfungsReady-Übersicht ansehen</Link>
    </main>
  );
}
