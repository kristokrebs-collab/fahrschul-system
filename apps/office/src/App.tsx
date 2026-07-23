import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout.js";
import { Login } from "./routes/Login.js";
import { Heute } from "./routes/Heute.js";
import { Planung } from "./routes/Planung.js";
import { Schueler } from "./routes/Schueler.js";
import { Schueler360 } from "./routes/Schueler360.js";
import { Pruefungen } from "./routes/Pruefungen.js";
import { Dokumente } from "./routes/Dokumente.js";
import { Zahlungen } from "./routes/Zahlungen.js";
import { Leads } from "./routes/Leads.js";
import { Kommunikation } from "./routes/Kommunikation.js";
import { Ressourcen } from "./routes/Ressourcen.js";
import { Auswertungen } from "./routes/Auswertungen.js";
import { Audit } from "./routes/Audit.js";
import { SessionProvider, useSession } from "./state/SessionContext.js";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <main className="login-screen">
        <p>Lädt…</p>
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user } = useSession();
  if (user) return <Navigate to="/heute" replace />;
  return <Login />;
}

/**
 * Büro-Zentrale gegen apps/api. Elf geforderte Nav-Punkte (Heute, Planung,
 * Schüler, Prüfungen, Dokumente, Zahlungen, Leads/CRM, Kommunikation,
 * Ressourcen, Auswertungen, Audit) als eigene Routen unter einem
 * gemeinsamen Sidebar-Layout (Layout.tsx). Kein PIN-Gate, keine
 * localStorage-Session (siehe docs/security-risks.md) – Auth läuft über das
 * httpOnly-Session-Cookie wie in apps/student.
 */
export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="heute" replace />} />
            <Route path="heute" element={<Heute />} />
            <Route path="planung" element={<Planung />} />
            <Route path="schueler" element={<Schueler />} />
            <Route path="schueler/:id" element={<Schueler360 />} />
            <Route path="pruefungen" element={<Pruefungen />} />
            <Route path="dokumente" element={<Dokumente />} />
            <Route path="zahlungen" element={<Zahlungen />} />
            <Route path="leads" element={<Leads />} />
            <Route path="kommunikation" element={<Kommunikation />} />
            <Route path="ressourcen" element={<Ressourcen />} />
            <Route path="auswertungen" element={<Auswertungen />} />
            <Route path="audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="heute" replace />} />
          </Route>
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
