import { useState } from "react";
import { Card } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError } from "../api/client.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";

interface Sprachprotokoll {
  id: string;
  transcriptOriginal: string | null;
  aiVorschlaege: { zusammenfassungsVorschlag?: string };
  transcriptBearbeitet: string | null;
  internZusammenfassung: string | null;
  schuelerseitigZusammenfassung: string | null;
  naechstesZiel: string | null;
  sprachprotokollStatus: string;
}

/**
 * Sprachprotokoll (Voice-Log). Reihenfolge exakt wie gefordert: 1) Aufnahme
 * (sichtbarer Indikator) -> 2) Transkription (Mock-Adapter,
 * packages/integrations/src/transcription) -> 3) Original bleibt sichtbar
 * -> 4) KI-Vorschlag (Mock-Adapter, ai-suggestions) -> 5) Fahrlehrer
 * bearbeitet -> 6) Fahrlehrer bestätigt -> 7) Split-Save (intern/
 * schülerseitig/Kompetenzvorschläge/nächstes Ziel), serverseitig erzwungen
 * (siehe apps/api/src/routes/instructor.ts confirm-Endpunkt) – KEIN
 * automatisches Publizieren vor Schritt 6.
 */
export function Dokumentieren() {
  const [terminbuchungId, setTerminbuchungId] = useState("");
  const [diktat, setDiktat] = useState("");
  const [recording, setRecording] = useState(false);
  const [log, setLog] = useState<Sprachprotokoll | null>(null);
  const [internText, setInternText] = useState("");
  const [schuelerText, setSchuelerText] = useState("");
  const [naechstesZiel, setNaechstesZiel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  async function startRecording() {
    setRecording(true);
    // GAP: kein echtes Mikrofon-/Speech-to-Text in dieser Sandbox – die
    // Fahrlehrer-Eingabe wird als "Diktat" an den Mock-Transkriptions-
    // Adapter gegeben (siehe Modul-Kommentar oben).
  }

  async function submitRecording() {
    setError(null);
    try {
      const res = await apiMutate<{ sprachprotokoll: Sprachprotokoll }>("/instructor/voice-logs", "POST", {
        terminbuchungId,
        audioReferenzOderDiktat: diktat,
      });
      setLog(res.sprachprotokoll);
      setRecording(false);
    } catch (err) {
      if (err instanceof OfflineError) setError("Sprachprotokoll erfassen erfordert eine Live-Verbindung.");
      else setError("Sprachprotokoll konnte nicht erstellt werden.");
    }
  }

  async function saveEdits() {
    if (!log) return;
    const res = await apiMutate<{ sprachprotokoll: Sprachprotokoll }>(`/instructor/voice-logs/${log.id}`, "PATCH", {
      internZusammenfassung: internText,
      schuelerseitigZusammenfassung: schuelerText,
      naechstesZiel,
    });
    setLog(res.sprachprotokoll);
  }

  async function confirm() {
    if (!log) return;
    if (!online) {
      setError("Bestätigen erfordert eine Live-Verbindung (kein Offline-Publish).");
      return;
    }
    try {
      const res = await apiMutate<{ sprachprotokoll: Sprachprotokoll }>(`/instructor/voice-logs/${log.id}/confirm`, "POST");
      setLog(res.sprachprotokoll);
    } catch (err) {
      if (err instanceof ApiError) setError("Bestätigen fehlgeschlagen.");
    }
  }

  return (
    <main className="screen">
      <h1>Dokumentieren</h1>
      {error ? <p role="alert" className="form-error">{error}</p> : null}

      {!log ? (
        <Card title="Sprachprotokoll aufnehmen">
          <label htmlFor="terminbuchungId">Termin-ID</label>
          <input id="terminbuchungId" value={terminbuchungId} onChange={(e) => setTerminbuchungId(e.target.value)} />
          <label htmlFor="diktat">Diktat (Mock-Aufnahme)</label>
          <textarea id="diktat" value={diktat} onChange={(e) => setDiktat(e.target.value)} />
          {recording ? <p data-testid="recording-indicator">🔴 Aufnahme läuft…</p> : null}
          <button type="button" className="fahrschul-btn" onClick={startRecording}>
            Aufnahme starten
          </button>
          <button type="button" className="fahrschul-btn fahrschul-btn--primary" disabled={!diktat} onClick={submitRecording}>
            Transkribieren
          </button>
        </Card>
      ) : (
        <>
          <Card title="Original-Transkript">
            <p data-testid="transcript-original">{log.transcriptOriginal}</p>
          </Card>
          <Card title="KI-Vorschlag (Mock)">
            <p>{log.aiVorschlaege?.zusammenfassungsVorschlag}</p>
          </Card>
          {log.sprachprotokollStatus !== "bestaetigt" ? (
            <Card title="Fahrlehrer bearbeitet">
              <label htmlFor="intern">Intern (Büro/Fahrlehrer)</label>
              <textarea id="intern" value={internText} onChange={(e) => setInternText(e.target.value)} />
              <label htmlFor="schueler">Schülerseitig (sichtbar für Schüler nach Bestätigung)</label>
              <textarea id="schueler" value={schuelerText} onChange={(e) => setSchuelerText(e.target.value)} />
              <label htmlFor="ziel">Nächstes Ziel</label>
              <input id="ziel" value={naechstesZiel} onChange={(e) => setNaechstesZiel(e.target.value)} />
              <button type="button" className="fahrschul-btn" onClick={saveEdits}>
                Entwurf speichern
              </button>
              <button type="button" className="fahrschul-btn fahrschul-btn--primary" disabled={!online} onClick={confirm}>
                Bestätigen (schülerseitig freigeben)
              </button>
            </Card>
          ) : (
            <p data-testid="confirmed-hint">Bestätigt – schülerseitiger Inhalt ist jetzt sichtbar.</p>
          )}
        </>
      )}
    </main>
  );
}
