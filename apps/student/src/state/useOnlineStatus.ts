import { useEffect, useState } from "react";

/**
 * Zentrale Online/Offline-Erkennung. Steuert, ob Schreibaktionen (Annahme,
 * Stornierung, Upload, Zahlung, Prüfungsaktionen) angeboten werden – bei
 * offline wird IMMER ein klarer "Keine Verbindung"-Zustand gezeigt statt
 * die Aktion stillschweigend zu queuen (Non-Negotiable).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
