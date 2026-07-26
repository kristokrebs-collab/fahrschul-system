import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SyncProvider, SyncStatusBar } from "@fahrschul/ui";
import { API_BASE } from "./api/client.js";
import { BottomNav } from "./components/BottomNav.js";
import { RequireUnlocked } from "./components/RequireUnlocked.js";
import { Dokumentieren } from "./routes/Dokumentieren.js";
import { DriveLock } from "./routes/DriveLock.js";
import { Fahrzeug } from "./routes/Fahrzeug.js";
import { Heute } from "./routes/Heute.js";
import { Login } from "./routes/Login.js";
import { Mehr } from "./routes/Mehr.js";
import { Schueler } from "./routes/Schueler.js";
import { SchuelerBriefing } from "./routes/SchuelerBriefing.js";
import { StundeBeenden } from "./routes/StundeBeenden.js";
import { useSession } from "./state/SessionContext.js";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <main className="screen">
        <p>Lädt…</p>
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Fahrlehrer-App gegen apps/api. Fünf Tabs: Heute, Schüler, Dokumentieren,
 * Fahrzeug, Mehr. /drivelock und /dokumentieren/beenden/:id bleiben
 * IMMER erreichbar (auch im Drive Lock Mode) – jede andere Route ist mit
 * `RequireUnlocked` umschlossen und leitet bei aktivem Fahrmodus dorthin um
 * (siehe components/RequireUnlocked.tsx + state/DriveLockContext.tsx).
 *
 * PROMPT -1 Phase 2: `SyncProvider` (§6/§7/§8) hält Echtzeitkanal,
 * verschlüsselte Entwurfsliste und Synchronisationszustände;
 * `SyncStatusBar` (§1) zeigt Datenalter, Status, Offline-Zustand und offene
 * Entwürfe. Für den Fahrlehrer im Funkloch ist das die wichtigste Anzeige
 * der App: er muss sehen, ob sein Bericht angekommen ist.
 */
export function App() {
  const { user } = useSession();

  return (
    <SyncProvider apiBase={API_BASE} benutzerId={user?.id ?? null} storagePrefix="fahrschul:instructor:sync:">
    <div className="app-shell">
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/heute" replace /> : <Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <>
                <SyncStatusBar compact />
                <Routes>
                  <Route path="/" element={<Navigate to="/heute" replace />} />
                  <Route path="/drivelock" element={<DriveLock />} />
                  <Route path="/dokumentieren/beenden/:id" element={<StundeBeenden />} />
                  <Route
                    path="/heute"
                    element={
                      <RequireUnlocked>
                        <Heute />
                      </RequireUnlocked>
                    }
                  />
                  <Route
                    path="/schueler"
                    element={
                      <RequireUnlocked>
                        <Schueler />
                      </RequireUnlocked>
                    }
                  />
                  <Route
                    path="/schueler/:id/briefing"
                    element={
                      <RequireUnlocked>
                        <SchuelerBriefing />
                      </RequireUnlocked>
                    }
                  />
                  <Route
                    path="/dokumentieren"
                    element={
                      <RequireUnlocked>
                        <Dokumentieren />
                      </RequireUnlocked>
                    }
                  />
                  <Route
                    path="/fahrzeug"
                    element={
                      <RequireUnlocked>
                        <Fahrzeug />
                      </RequireUnlocked>
                    }
                  />
                  <Route
                    path="/mehr"
                    element={
                      <RequireUnlocked>
                        <Mehr />
                      </RequireUnlocked>
                    }
                  />
                  <Route path="*" element={<Navigate to="/heute" replace />} />
                </Routes>
                <BottomNav />
              </>
            </RequireAuth>
          }
        />
      </Routes>
    </div>
    </SyncProvider>
  );
}
