import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@fahrschul/ui";
import { apiGet, apiMutate, ApiError, OfflineError } from "../api/client.js";
import type { Termin } from "../api/types.js";
import { useDriveLock } from "../state/DriveLockContext.js";
import { useOnlineStatus } from "../state/useOnlineStatus.js";

/**
 * Heute – nächste Termine live aus apps/api (Büro-Planung/Buchungsdaten),
 * KEIN lokaler Cache als Quelle der Wahrheit. Offline lesbar (letzter
 * bestätigter Stand über apiGet's Cache-Fallback, siehe api/client.ts),
 * aber "Stunde starten" ist eine Mutation und daher NICHT offline möglich.
 */
export function Heute() {
  const [termine, setTermine] = useState<Termin[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const { lock } = useDriveLock();
  const online = useOnlineStatus();
  const navigate = useNavigate();

  async function load() {
    try {
      const res = await apiGet<{ termine: Termin[] }>("/instructor/heute");
      setTermine(res.data.termine);
      setFromCache(res.fromCache);
    } catch {
      setError("Termine konnten nicht geladen werden.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onStart(bookingId: string) {
    setStartingId(bookingId);
    setError(null);
    try {
      await apiMutate(`/instructor/lessons/${bookingId}/start`, "POST");
      lock(bookingId);
      navigate("/drivelock");
    } catch (err) {
      if (err instanceof OfflineError) setError("Keine Verbindung – Stunde starten erfordert eine Live-Verbindung.");
      else if (err instanceof ApiError) setError(err.body && typeof err.body === "object" && "message" in err.body ? String((err.body as { message: unknown }).message) : "Stunde konnte nicht gestartet werden.");
      else setError("Stunde konnte nicht gestartet werden.");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <main className="screen">
      <h1>Heute</h1>
      {fromCache ? <p className="offline-hint">Offline – zeigt den zuletzt geladenen Stand.</p> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {termine === null ? <p>Lädt…</p> : null}
      {termine?.length === 0 ? <p>Heute keine Termine.</p> : null}
      <ul className="termin-list">
        {termine?.map((t) => (
          <li key={t.buchung.id}>
            <Card title={`${t.schueler?.vorname ?? "?"} ${t.schueler?.nachname ?? ""}`}>
              <p>
                {new Date(t.buchung.beginnAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(t.buchung.endeAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p>Stundenart: {t.buchung.art}</p>
              {t.fahrzeug ? <p>Fahrzeug: {t.fahrzeug.kennzeichen} ({t.fahrzeug.status})</p> : null}
              {t.raum ? <p>Raum: {t.raum.name}</p> : null}
              <p>Status: {t.buchung.status}</p>
              {t.buchung.verspaetungMinuten ? <p>Verspätung: {t.buchung.verspaetungMinuten} min</p> : null}
              {t.buchung.status === "bestaetigt" ? (
                <button
                  type="button"
                  className="fahrschul-btn fahrschul-btn--primary"
                  disabled={!online || startingId === t.buchung.id}
                  onClick={() => onStart(t.buchung.id)}
                >
                  {startingId === t.buchung.id ? "Startet…" : "Stunde starten"}
                </button>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
