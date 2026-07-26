import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SyncProvider, SyncStatusBar } from "@fahrschul/ui";
import { API_BASE } from "./api/client.js";
import { BottomNav } from "./components/BottomNav.js";
import { OfflineBanner } from "./components/OfflineBanner.js";
import { Ausbildung } from "./routes/Ausbildung.js";
import { Dokumente } from "./routes/Dokumente.js";
import { Feedback } from "./routes/Feedback.js";
import { Flex } from "./routes/Flex.js";
import { Heute } from "./routes/Heute.js";
import { Lernen } from "./routes/Lernen.js";
import { Login } from "./routes/Login.js";
import { Mehr } from "./routes/Mehr.js";
import { PruefungsReady } from "./routes/PruefungsReady.js";
import { Rechnungen } from "./routes/Rechnungen.js";
import { Termine } from "./routes/Termine.js";
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
 * Fahrschüler-App gegen apps/api (kein localStorage als Quelle der
 * Wahrheit, kein simuliertes Sync – siehe docs/security-risks.md). Fünf
 * Tabs: Heute, Ausbildung, Termine, Lernen, Mehr (siehe Aufgabenstellung).
 *
 * PROMPT -1 Phase 2: `SyncProvider` (§6/§7/§8) hält den Echtzeitkanal, die
 * verschlüsselte Entwurfsliste und die neun Synchronisationszustände;
 * `SyncStatusBar` (§1) macht Datenalter, Synchronisationsstatus,
 * Offline-Status und offene lokale Entwürfe SICHTBAR – Phase 1 hat die
 * Datenbank zur einzigen Wahrheit gemacht, das hier ist die andere Hälfte
 * derselben Regel.
 */
export function App() {
  const { user } = useSession();

  return (
    <SyncProvider apiBase={API_BASE} benutzerId={user?.id ?? null} storagePrefix="fahrschul:student:sync:">
    <div className="app-shell">
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/heute" replace /> : <Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <>
                <SyncStatusBar />
                <Routes>
                  <Route path="/" element={<Navigate to="/heute" replace />} />
                  <Route path="/heute" element={<Heute />} />
                  <Route path="/ausbildung" element={<Ausbildung />} />
                  <Route path="/ausbildung/pruefungsready" element={<PruefungsReady />} />
                  <Route path="/termine" element={<Termine />} />
                  <Route path="/lernen" element={<Lernen />} />
                  <Route path="/mehr" element={<Mehr />} />
                  <Route path="/mehr/dokumente" element={<Dokumente />} />
                  <Route path="/mehr/rechnungen" element={<Rechnungen />} />
                  <Route path="/mehr/feedback" element={<Feedback />} />
                  <Route path="/mehr/flex" element={<Flex />} />
                  <Route path="*" element={<Navigate to="/heute" replace />} />
                </Routes>
                <BottomNav />
              </>
            </RequireAuth>
          }
        />
      </Routes>
      {!user ? <OfflineBanner /> : null}
    </div>
    </SyncProvider>
  );
}
