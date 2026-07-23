import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@fahrschul/ui";
import { apiGet } from "../api/client.js";
import type { Briefing } from "../api/types.js";

/**
 * Schülerbriefing – muss in ~15s lesbar sein. Fünf Blöcke exakt wie
 * gefordert: "Heute üben wir", "Darauf achten", letzter Fortschritt, offene
 * Lernziele, Fahrzeugbedarf + nächster formaler Schritt. Liest ausschließlich
 * bereits bestehende Trainings-Fortschrittsdaten über
 * GET /instructor/schueler/:id/briefing (apps/api, siehe dort für die
 * Wiederverwendung von fahrstunden_feedback/ausbildungen/pruefungsfreigaben –
 * dieselben Tabellen, die apps/student und apps/office nutzen).
 */
export function SchuelerBriefing() {
  const { id } = useParams<{ id: string }>();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet<Briefing>(`/instructor/schueler/${id}/briefing`)
      .then((res) => {
        setBriefing(res.data);
        setFromCache(res.fromCache);
      })
      .catch(() => setError("Briefing konnte nicht geladen werden."));
  }, [id]);

  if (error) return <main className="screen"><p role="alert">{error}</p></main>;
  if (!briefing) return <main className="screen"><p>Lädt…</p></main>;

  return (
    <main className="screen" data-testid="briefing-screen">
      <h1>Schülerbriefing</h1>
      {fromCache ? <p className="offline-hint">Offline – letzter geladener Stand.</p> : null}
      <Card title="Heute üben wir">
        <p data-testid="heute-ueben">{briefing.heuteUeben}</p>
      </Card>
      <Card title="Darauf achten">
        <p data-testid="darauf-achten">{briefing.daraufAchten ?? "Keine besonderen Hinweise."}</p>
      </Card>
      <Card title="Letzter Fortschritt">
        <p>{briefing.letzterFortschritt?.wentWell ?? "Noch keine Rückmeldung erfasst."}</p>
      </Card>
      <Card title="Offene Lernziele">
        <ul>
          {briefing.offeneLernziele.filter(Boolean).length === 0 ? <li>Keine offenen Lernziele.</li> : null}
          {briefing.offeneLernziele.filter(Boolean).map((z, i) => (
            <li key={i}>{z}</li>
          ))}
        </ul>
      </Card>
      <Card title="Fahrzeugbedarf">
        <p>
          {briefing.fahrzeugBedarf
            ? `${briefing.fahrzeugBedarf.getriebeart}${briefing.fahrzeugBedarf.handicapBedarf.length ? " · " + briefing.fahrzeugBedarf.handicapBedarf.join(", ") : ""}`
            : "Kein besonderer Bedarf hinterlegt."}
        </p>
      </Card>
      <Card title="Nächster formaler Schritt">
        <p data-testid="naechster-schritt">{briefing.naechsterFormalerSchritt}</p>
      </Card>
    </main>
  );
}
