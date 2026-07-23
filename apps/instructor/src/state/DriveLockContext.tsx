import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Drive Lock Mode (Spec: "while a lesson is started, normal navigation is
 * locked, no text input, no animation, no voice recording — only Notfall,
 * Büro, 'Stunde beenden' are reachable"). Dies ist ein ECHTER UI-Modus
 * (Route-Guard + Overlay), keine reine visuelle Andeutung: solange
 * `locked === true` rendert App.tsx AUSSCHLIESSLICH den DriveLockScreen
 * (siehe components/DriveLockScreen.tsx) und die BottomNav gibt `null`
 * zurück – andere Routen existieren in diesem Zustand schlicht nicht im
 * DOM, sind also nicht nur "versteckt", sondern unerreichbar.
 */
interface DriveLockContextValue {
  locked: boolean;
  activeBookingId: string | null;
  lock: (bookingId: string) => void;
  unlock: () => void;
}

const DriveLockContext = createContext<DriveLockContextValue | null>(null);

export function DriveLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);

  const value = useMemo<DriveLockContextValue>(
    () => ({
      locked,
      activeBookingId,
      lock: (bookingId: string) => {
        setActiveBookingId(bookingId);
        setLocked(true);
      },
      unlock: () => {
        setActiveBookingId(null);
        setLocked(false);
      },
    }),
    [locked, activeBookingId],
  );

  return <DriveLockContext.Provider value={value}>{children}</DriveLockContext.Provider>;
}

export function useDriveLock(): DriveLockContextValue {
  const ctx = useContext(DriveLockContext);
  if (!ctx) throw new Error("useDriveLock must be used within DriveLockProvider");
  return ctx;
}
