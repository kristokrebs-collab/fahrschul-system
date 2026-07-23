import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useDriveLock } from "../state/DriveLockContext.js";

/**
 * Route-Guard für Drive Lock Mode: jede normale Route wird hiermit
 * umschlossen. Ist der Modus aktiv, wird IMMER auf /drivelock umgeleitet
 * (server-/state-seitige Sperre, kein reines UI-Verstecken eines Buttons) –
 * nur /drivelock selbst (Notfall/Büro/Stunde beenden) bleibt erreichbar.
 */
export function RequireUnlocked({ children }: { children: ReactNode }) {
  const { locked } = useDriveLock();
  if (locked) return <Navigate to="/drivelock" replace />;
  return <>{children}</>;
}
