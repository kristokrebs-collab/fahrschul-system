import { useOnlineStatus } from "../state/useOnlineStatus.js";

/**
 * Klarer, immer sichtbarer Hinweis statt stillem Queuing (Non-Negotiable).
 * Schreibaktionen bleiben in den jeweiligen Screens zusätzlich deaktiviert/
 * mit Fehlermeldung versehen (siehe apiMutate/apiUpload ohne Offline-Fallback).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" className="offline-banner">
      Keine Verbindung – du siehst den zuletzt geladenen Stand. Buchen, Stornieren, Hochladen und
      Zahlungen sind erst wieder möglich, sobald du online bist.
    </div>
  );
}
