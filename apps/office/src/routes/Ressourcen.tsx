import { useApiGet } from "../state/useApiGet.js";
import { DataState } from "../components/DataState.js";

interface Raum {
  id: string;
  name: string;
  status: string;
}
interface Simulator {
  id: string;
  name: string;
  status: string;
}
interface Mangel {
  id: string;
  grund: string;
  status: string;
}
interface Regel {
  id: string;
  fahrlehrerId: string;
  maxStundenProTag: string;
  maxStundenProWoche: string;
  minPauseMinuten: number;
}

/**
 * Ressourcen: Räume/Simulatoren/Fahrzeugmängel + Arbeitszeitregeln.
 * Arbeitszeitregeln sind bewusst NUR eine Anzeige/Warn-Konfiguration – es
 * gibt hier keine automatische Sperrung/Benachrichtigung (Spec
 * "Arbeitszeit ... NO automatic personnel action").
 */
export function Ressourcen() {
  const raeume = useApiGet<{ raeume: Raum[] }>("/resources/raeume");
  const simulatoren = useApiGet<{ simulatorgeraete: Simulator[] }>("/resources/simulatorgeraete");
  const maengel = useApiGet<{ fahrzeugmaengel: Mangel[] }>("/resources/fahrzeugmaengel");
  const regeln = useApiGet<{ arbeitszeitregeln: Regel[] }>("/resources/arbeitszeitregeln");

  return (
    <div>
      <header className="page-header">
        <h1>Ressourcen</h1>
      </header>
      <div className="detail-grid">
        <section>
          <h2>Räume</h2>
          <DataState loading={raeume.loading} error={raeume.error} />
          <ul className="queue-list">
            {(raeume.data?.raeume ?? []).map((r) => (
              <li key={r.id}>
                {r.name} – {r.status}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Simulatorgeräte</h2>
          <DataState loading={simulatoren.loading} error={simulatoren.error} />
          <ul className="queue-list">
            {(simulatoren.data?.simulatorgeraete ?? []).map((s) => (
              <li key={s.id}>
                {s.name} – {s.status}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Fahrzeugmängel</h2>
          <DataState loading={maengel.loading} error={maengel.error} />
          <ul className="queue-list">
            {(maengel.data?.fahrzeugmaengel ?? []).map((m) => (
              <li key={m.id}>
                {m.grund} – {m.status}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Arbeitszeitregeln (nur Warnung, keine Automatik)</h2>
          <DataState loading={regeln.loading} error={regeln.error} />
          <ul className="queue-list">
            {(regeln.data?.arbeitszeitregeln ?? []).map((r) => (
              <li key={r.id}>
                Fahrlehrer {r.fahrlehrerId.slice(0, 8)}: max. {r.maxStundenProTag}h/Tag, {r.maxStundenProWoche}h/Woche, min.{" "}
                {r.minPauseMinuten} min Pause
              </li>
            ))}
            {regeln.data && regeln.data.arbeitszeitregeln.length === 0 ? <li className="dim">Keine Regeln hinterlegt.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
