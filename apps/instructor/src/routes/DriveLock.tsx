import { useNavigate } from "react-router-dom";
import { useDriveLock } from "../state/DriveLockContext.js";

/**
 * Drive Lock Mode Screen. Bewusst NUR drei Aktionen, keine Texteingabe,
 * keine Animation, keine Sprachaufnahme (Spec). "Notfall"/"Büro" sind
 * `tel:`-Links (klingeln real, keine Formulareingabe), "Stunde beenden"
 * navigiert zum verpflichtenden 8-Schritt-Abschlussfluss – erst dort
 * (siehe routes/StundeBeenden.tsx) wird `unlock()` aufgerufen.
 */
export function DriveLock() {
  const { activeBookingId } = useDriveLock();
  const navigate = useNavigate();

  return (
    <main className="screen drive-lock-screen" aria-label="Fahrmodus aktiv">
      <h1>Fahrmodus aktiv</h1>
      <p>Navigation ist während der Fahrstunde gesperrt.</p>
      <div className="drive-lock-actions">
        <a className="fahrschul-btn fahrschul-btn--danger" href="tel:112" data-testid="notfall-link">
          🚨 Notfall
        </a>
        <a className="fahrschul-btn fahrschul-btn--secondary" href="tel:+490000000000" data-testid="buero-link">
          ☎️ Büro
        </a>
        <button
          type="button"
          className="fahrschul-btn fahrschul-btn--primary"
          data-testid="stunde-beenden-link"
          onClick={() => activeBookingId && navigate(`/dokumentieren/beenden/${activeBookingId}`)}
          disabled={!activeBookingId}
        >
          🏁 Stunde beenden
        </button>
      </div>
    </main>
  );
}
