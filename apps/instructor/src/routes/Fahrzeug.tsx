import { useState } from "react";
import type { FormEvent } from "react";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import { readDraft, writeDraft, clearDraft } from "../api/cache.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";

/**
 * Fahrzeug: Quick-Check + Mangelmeldung. Deckt Kilometer/Tank-Ladung/
 * Warnleuchten/Schaden/Ausstattung/einsatzbereit-Flag/Schweregrad/Routing
 * ab (Fotoreferenz als reine Textreferenz, kein echter Datei-Upload in
 * dieser Sandbox). Der Mangelentwurf ist offline lesbar/entwerfbar; das
 * finale Absenden (setzt bei einsatzbereit=false fahrzeuge.status=
 * "wartung" und blockiert damit neue Buchungen über die bestehende harte
 * Regel VEHICLE_NOT_READY) erfordert eine Live-Verbindung.
 */
export function Fahrzeug() {
  const draftKey = "mangelentwurf";
  const draft = readDraft<Record<string, unknown>>(draftKey)?.data ?? {};

  const [fahrzeugId, setFahrzeugId] = useState<string>((draft.fahrzeugId as string) ?? "");
  const [grund, setGrund] = useState<string>((draft.grund as string) ?? "");
  const [kilometerstand, setKilometerstand] = useState<string>((draft.kilometerstand as string) ?? "");
  const [tankLadungProzent, setTankLadungProzent] = useState<string>((draft.tankLadungProzent as string) ?? "");
  const [warnleuchten, setWarnleuchten] = useState<string>((draft.warnleuchten as string) ?? "");
  const [schweregrad, setSchweregrad] = useState<"gering" | "mittel" | "kritisch">((draft.schweregrad as "gering" | "mittel" | "kritisch") ?? "mittel");
  const [einsatzbereit, setEinsatzbereit] = useState(draft.einsatzbereit !== false);
  const [geroutetAn, setGeroutetAn] = useState<"buero" | "fuhrpark">((draft.geroutetAn as "buero" | "fuhrpark") ?? "buero");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  function saveDraft() {
    writeDraft(draftKey, { fahrzeugId, grund, kilometerstand, tankLadungProzent, warnleuchten, schweregrad, einsatzbereit, geroutetAn });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!online) {
      setError("Fahrzeugblockierung/Mangelmeldung erfordert eine Live-Verbindung – Entwurf wurde gespeichert.");
      saveDraft();
      return;
    }
    try {
      await apiMutate("/instructor/vehicle-issues", "POST", {
        fahrzeugId,
        grund,
        kilometerstand: kilometerstand ? Number(kilometerstand) : null,
        tankLadungProzent: tankLadungProzent ? Number(tankLadungProzent) : null,
        warnleuchten: warnleuchten ? warnleuchten.split(",").map((s) => s.trim()) : [],
        schweregrad,
        einsatzbereit,
        geroutetAn,
      });
      clearDraft(draftKey);
      setResult("Mangel gemeldet.");
    } catch (err) {
      if (err instanceof ApiError) setError("Meldung fehlgeschlagen.");
    }
  }

  return (
    <main className="screen">
      <h1>Fahrzeug</h1>
      <p>Quick-Check + Mangelmeldung</p>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {result ? <p role="status">{result}</p> : null}
      <form onSubmit={onSubmit} onBlur={saveDraft}>
        <label htmlFor="fahrzeugId">Fahrzeug-ID</label>
        <input id="fahrzeugId" required value={fahrzeugId} onChange={(e) => setFahrzeugId(e.target.value)} />

        <label htmlFor="km">Kilometerstand</label>
        <input id="km" type="number" value={kilometerstand} onChange={(e) => setKilometerstand(e.target.value)} />

        <label htmlFor="tank">Tank/Ladung (%)</label>
        <input id="tank" type="number" min={0} max={100} value={tankLadungProzent} onChange={(e) => setTankLadungProzent(e.target.value)} />

        <label htmlFor="warnleuchten">Warnleuchten (kommagetrennt)</label>
        <input id="warnleuchten" value={warnleuchten} onChange={(e) => setWarnleuchten(e.target.value)} />

        <label htmlFor="grund">Schaden/Grund</label>
        <textarea id="grund" required value={grund} onChange={(e) => setGrund(e.target.value)} />

        <label htmlFor="schweregrad">Schweregrad</label>
        <select id="schweregrad" value={schweregrad} onChange={(e) => setSchweregrad(e.target.value as typeof schweregrad)}>
          <option value="gering">gering</option>
          <option value="mittel">mittel</option>
          <option value="kritisch">kritisch</option>
        </select>

        <label>
          <input type="checkbox" checked={einsatzbereit} onChange={(e) => setEinsatzbereit(e.target.checked)} />
          Fahrzeug ist trotzdem einsatzbereit
        </label>

        <label htmlFor="routing">Routing</label>
        <select id="routing" value={geroutetAn} onChange={(e) => setGeroutetAn(e.target.value as typeof geroutetAn)}>
          <option value="buero">Büro</option>
          <option value="fuhrpark">Fuhrpark</option>
        </select>

        <button type="button" className="fahrschul-btn" onClick={saveDraft}>
          Entwurf speichern
        </button>
        <button type="submit" className="fahrschul-btn fahrschul-btn--danger">
          Mangel melden
        </button>
      </form>
    </main>
  );
}
