import { Card } from "@fahrschul/ui";
import { Link } from "react-router-dom";
import { Tacho } from "../components/Tacho.js";
import type {
  Dokument,
  ExamReadiness,
  FlagsResponse,
  Lernressource,
  SchuelerProfil,
  Terminangebot,
  Terminbuchung,
} from "../api/types.js";
import { useApiGet } from "../state/useApiGet.js";
import { computeHeutePriority } from "../state/useHeutePriorities.js";

/**
 * Heute-Tab: zeigt HÖCHSTENS – nächster sinnvoller Schritt, nächster
 * bestätigter Termin, wichtigste Aufgabe, kompakter Fortschritt, EINE
 * Warnung, EINE primäre Aktion (siehe Aufgabenstellung, exakte
 * Priorisierung in useHeutePriorities.ts).
 */
export function Heute() {
  const profile = useApiGet<SchuelerProfil>("/me/schueler");
  const readiness = useApiGet<ExamReadiness>("/me/exam-readiness");
  const documents = useApiGet<{ documents: Dokument[] }>("/documents/mine");
  const offers = useApiGet<{ offers: { offer: Terminangebot | null }[] }>("/appointment-offers");
  const appointments = useApiGet<{ appointments: Terminbuchung[] }>("/appointments/mine");
  const wunschzeiten = useApiGet<{ wunschzeiten: unknown[] }>("/me/wunschzeiten");
  const learning = useApiGet<{ resources: Lernressource[] }>("/learning/resources");

  const loading =
    profile.loading || documents.loading || offers.loading || appointments.loading || wunschzeiten.loading || learning.loading;

  if (loading) {
    return (
      <main className="screen">
        <p>Lädt…</p>
      </main>
    );
  }

  const priority = computeHeutePriority({
    examReadiness: readiness.data,
    documents: documents.data?.documents ?? [],
    offers: offers.data?.offers ?? [],
    appointments: appointments.data?.appointments ?? [],
    hasWunschzeiten: (wunschzeiten.data?.wunschzeiten.length ?? 0) > 0,
    learningResources: learning.data?.resources ?? [],
  });

  const nextAppointment = (appointments.data?.appointments ?? [])
    .filter((a) => a.status !== "cancelled" && new Date(a.beginnAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.beginnAt).getTime() - new Date(b.beginnAt).getTime())[0];

  const mandatoryDrives = readiness.data?.mandatoryDrives;
  const drivesRatio =
    mandatoryDrives && "done" in mandatoryDrives
      ? Object.values(mandatoryDrives.done).reduce((a, b) => a + b, 0) /
        Object.values(mandatoryDrives.required).reduce((a, b) => a + b, 0)
      : null;

  return (
    <main className="screen">
      <h1>Hallo {profile.data?.schueler.vorname ?? ""}</h1>

      {priority ? (
        <Card title={priority.title}>
          <p>{priority.detail}</p>
          <Link to={priority.actionTo}>{priority.actionLabel}</Link>
        </Card>
      ) : (
        <Card title="Alles im grünen Bereich">
          <p>Aktuell gibt es nichts Dringendes für dich zu tun.</p>
        </Card>
      )}

      {nextAppointment ? (
        <Card title="Nächster Termin">
          <p>
            {new Date(nextAppointment.beginnAt).toLocaleString("de-DE")} – {nextAppointment.art}
          </p>
        </Card>
      ) : null}

      {drivesRatio !== null ? (
        <Card title="Fortschritt Pflichtfahrten">
          <Tacho value={drivesRatio} label="Pflichtfahrten" sublabel="absolviert / gefordert (Klasse B)" />
        </Card>
      ) : null}
    </main>
  );
}
