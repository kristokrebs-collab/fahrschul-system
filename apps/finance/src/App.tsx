import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { PendingOperations, SyncProvider, SyncStatusBar } from "@fahrschul/ui";
import "./styles.css";
import { API_BASE } from "./api/client.js";
import { Login } from "./routes/Login.js";
import { Cockpit } from "./routes/Cockpit.js";
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
  // Client-seitiger Hinweis nur für UX – die eigentliche Autorisierung
  // erfolgt ausschließlich serverseitig (finance:cockpit:read etc., siehe
  // packages/permissions matrix.ts + apps/api/src/routes/finance.ts).
  if (user.rolle !== "finanzen" && user.rolle !== "geschaeftsfuehrung") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <h1>Kein Zugriff</h1>
          <p className="dim">Dieses Cockpit ist auf die Rollen Finanzen/Geschäftsführung beschränkt.</p>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

/**
 * PROMPT -1 Phase 2: `SyncProvider` (§6/§7/§8) + `SyncStatusBar` (§1). Im
 * Finanz-Cockpit ist das Datenalter eine fachliche Angabe, nicht Kosmetik:
 * eine Liquiditätszahl von vor zehn Minuten kann eine falsche Entscheidung
 * begründen, und ein Bankabgleich, der als "gebucht" erscheint, ohne dass der
 * Server ihn bestätigt hat, wäre ein Buchungsfehler.
 */
function Shell() {
  const { user, logout } = useSession();
  return (
    <div className="app-shell">
      <aside className="app-nav">
        <h2>Finanz-Cockpit</h2>
        <nav>
          <span className="dim" style={{ padding: "0.5rem 0.75rem" }}>
            {user?.vorname} {user?.nachname} ({user?.rolle})
          </span>
          <button onClick={() => logout()}>Abmelden</button>
        </nav>
      </aside>
      <main className="app-main">
        <SyncStatusBar />
        <Cockpit />
        {/* §7: kritische Konflikte (z. B. bereits zugeordnete Zahlung) werden
            vorgelegt, nicht automatisch aufgelöst. */}
        <PendingOperations />
      </main>
    </div>
  );
}

function AppRoutes() {
  const { user } = useSession();
  if (!user) return <Login />;
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  );
}

/**
 * apps/finance (PROMPT 4) – Finanz-/Flotten-/Geschäftsführer-Cockpit.
 * Bewusst als Ein-Seiten-Cockpit gebaut (kein finanzen-1.html-Referenz-
 * Prototyp existiert, siehe docs/integration-gaps.md) statt vieler Tabs, um
 * die 7 Kern-Karten nicht künstlich zu verstreuen. Fahrlehrer-/Flotten-/
 * Produkt-/Forecast-Detaildaten sind über /finance/* API-Routen bereits
 * ausgebaut; die UI-Drilldowns dafür sind ein dokumentierter Gap (siehe
 * docs/finance-final-qa.md).
 */
function AppInner() {
  const { user } = useSession();
  return (
    <SyncProvider apiBase={API_BASE} benutzerId={user?.id ?? null} storagePrefix="fahrschul:finance:sync:">
      <AppRoutes />
    </SyncProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  );
}
