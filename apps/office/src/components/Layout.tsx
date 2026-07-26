import { NavLink, Outlet } from "react-router-dom";
import { Button, DegradedBanner, PendingOperations, SyncStatusBar } from "@fahrschul/ui";
import { useSession } from "../state/SessionContext.js";
import { API_BASE } from "../api/client.js";

const NAV: Array<{ to: string; label: string }> = [
  { to: "/heute", label: "Heute" },
  { to: "/planung", label: "Planung" },
  { to: "/schueler", label: "Schüler" },
  { to: "/pruefungen", label: "Prüfungen" },
  { to: "/dokumente", label: "Dokumente" },
  { to: "/zahlungen", label: "Zahlungen" },
  { to: "/leads", label: "Leads/CRM" },
  { to: "/kommunikation", label: "Kommunikation" },
  { to: "/ressourcen", label: "Ressourcen" },
  { to: "/auswertungen", label: "Auswertungen" },
  { to: "/audit", label: "Audit" },
];

/**
 * Card/List/Detail-Split-Layout (Design-DNA aus dashboard.html, siehe
 * docs/prototype-audit.md) – hier neu gebaut gegen apps/api, KEIN Code aus
 * dem Prototyp übernommen. Sidebar-Navigation statt Bottom-Nav, weil die
 * Büro-Zentrale primär am Desktop bedient wird.
 */
export function Layout() {
  const { user, logout } = useSession();

  return (
    <div className="office-shell">
      <aside className="office-sidebar">
        <div className="office-sidebar__brand">Büro-Zentrale</div>
        <nav aria-label="Hauptnavigation">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="office-sidebar__user">
          <div>
            <strong>
              {user?.vorname} {user?.nachname}
            </strong>
            <div className="dim">{user?.rolle}</div>
          </div>
          <Button variant="secondary" onClick={() => logout()}>
            Abmelden
          </Button>
        </div>
      </aside>
      <main className="office-main">
        {/*
          PROMPT -1 §1: Datenalter, Synchronisationsstatus, Offline-Status und
          offene lokale Vorgänge – sichtbar über jeder Ansicht. Fürs Büro ist
          das die Absicherung gegen Entscheidungen auf altem Stand.
        */}
        <SyncStatusBar />
        {/*
          PROMPT -1 §18 (Phase 3): das Büro ist die Zielgruppe dieses Banners –
          es muss wissen, ob eine Benachrichtigung tatsächlich raus ist und ob
          Zahlungsdaten veraltet sind, BEVOR es danach handelt.
        */}
        <DegradedBanner apiBase={API_BASE} />
        <Outlet />
        {/* §7: kritische Konflikte werden vorgelegt, nicht automatisch aufgelöst. */}
        <PendingOperations />
      </main>
    </div>
  );
}
