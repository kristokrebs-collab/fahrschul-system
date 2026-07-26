import { DegradedBanner, ExternalSyncPending, type DeepHealthView } from "@fahrschul/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WithSync } from "../test/renderWithSync.js";

/**
 * PROMPT -1 §18 (Phase 4) – die ANZEIGE des eingeschränkten Betriebs, gerendert.
 *
 * ## Warum diese Datei in Phase 4 entsteht
 *
 * `docs/failure-modes.md` führte als bekannte Lücke Nr. 5:
 *
 * > „`DegradedBanner` ist nicht in einem Browser getestet. Die Logik
 * > (Sichtbarkeit, Texte, Statusableitung) ist Code und typgeprüft, aber ein
 * > Rendering-Test steht aus – React-Testing-Library-Abdeckung für die vier
 * > Apps ist Phase-4-Terrain (§20)."
 *
 * Diese Lücke wird hier geschlossen, soweit sie ohne Browser schließbar ist:
 * die Komponente wird **tatsächlich gerendert** (jsdom + Testing Library) und
 * über Rollen und Text abgefragt – nicht über CSS-Klassen. Was damit noch NICHT
 * belegt ist und im Bericht offen bleibt: echtes Rendering in echten Browsern,
 * echte Screenreader-Ausgabe, echte Viewports. Das braucht Playwright und einen
 * Screenreader (siehe `docs/chaos-test-report.md`, „Was unausgeführt bleibt").
 *
 * ## Warum die Tests hier und nicht in `packages/ui` liegen
 *
 * `packages/ui` hat kein Test-Setup (kein `test`-Skript, kein jsdom, keine
 * Testing Library). Es dort aufzubauen wären neue Abhängigkeiten und ein neues
 * Paket im Testlauf – für dieselbe Aussage. `apps/student` hat jsdom, Testing
 * Library und eine fertige Sync-Testhülle und importiert `@fahrschul/ui`
 * genauso wie die anderen drei Apps. Derselbe organisatorische Kompromiss, den
 * Phase 1 für `packages/events` dokumentiert hat.
 *
 * ## Was geprüft wird: die vier §18-Regeln
 *
 *  1. Der Kern wird nie als kaputt dargestellt.
 *  2. Kein falscher Erfolg („wartet auf externe Synchronisation", nie „gesendet").
 *  3. Es wird nichts abgeschaltet – das Banner informiert.
 *  4. Der Zeitpunkt der letzten erfolgreichen Synchronisation ist sichtbar.
 */

function health(overrides: Partial<DeepHealthView> = {}): DeepHealthView {
  return {
    status: "eingeschraenkt",
    datenbank: "erreichbar",
    kern: "nutzbar – Termine, Dokumente und Ausbildung funktionieren unabhängig von externen Systemen",
    integrationen: [],
    ausgefallen: [],
    eingeschraenkt: [],
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

function integration(
  name: string,
  status: "gesund" | "eingeschraenkt" | "ausgefallen",
  extra: Partial<DeepHealthView["integrationen"][number]> = {},
) {
  return {
    integration: name,
    modus: "mock" as const,
    status,
    breaker: status === "ausgefallen" ? ("open" as const) : ("closed" as const),
    letzteErfolgreicheSynchronisation: null,
    gepuffert: 0,
    fehlerwarteschlange: 0,
    ...extra,
  };
}

/**
 * `pollIntervalMs: 0` + `initialHealth` = kein `fetch`, kein Zeitgeber.
 *
 * OHNE `SyncProvider`: `useSyncOptional()` ist genau dafür gebaut, und nur so
 * prüfen diese Tests die INTEGRATIONS-Hälfte isoliert. Mit Provider wäre der
 * Realtime-Zustand eines nicht gestarteten Kanals `down` – korrektes Verhalten
 * (ein Client ohne Verbindung HAT keine), aber es würde jeden Test zu einem
 * Realtime-Test machen. Der Realtime-Teil hat unten seine eigenen Fälle.
 */
function renderBanner(initialHealth: DeepHealthView | null) {
  return render(
    <DegradedBanner apiBase="http://localhost:4000" pollIntervalMs={0} initialHealth={initialHealth} />,
  );
}

/** Mit Sync-Kontext: der Realtime-Teil kommt aus dem Client, nicht vom Server. */
function renderMitSync(initialHealth: DeepHealthView | null) {
  return render(
    <WithSync>
      <DegradedBanner apiBase="http://localhost:4000" pollIntervalMs={0} initialHealth={initialHealth} />
    </WithSync>,
  );
}

describe("PROMPT -1 §18 – DegradedBanner, gerendert", () => {
  it("ist im gesunden Zustand GAR NICHT im DOM (kein Dauerbanner)", () => {
    renderBanner(health({ integrationen: [integration("notifications", "gesund")] }));
    // Nicht „versteckt", sondern nicht vorhanden: ein Dauerbanner würde
    // abstumpfen und im Ernstfall überlesen werden.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("nennt bei einem Ausfall den EINGESCHRÄNKTEN Betrieb – nicht eine Störung (Regel 1)", () => {
    renderBanner(
      health({
        ausgefallen: ["notifications"],
        integrationen: [integration("notifications", "ausgefallen")],
      }),
    );
    const banner = screen.getByRole("status");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Eingeschränkter Betrieb");
    expect(banner.textContent).not.toContain("Störung");
    // Und die Zusage, dass der Kern arbeitet, steht im Banner selbst.
    expect(banner.textContent).toContain("Termine, Ausbildung und Dokumente funktionieren normal");
  });

  it("benutzt eine LESBARE Bezeichnung, nicht den technischen Integrationsnamen", () => {
    renderBanner(
      health({ ausgefallen: ["malware-scan"], integrationen: [integration("malware-scan", "ausgefallen")] }),
    );
    // „malware-scan" sagt einem Büro nichts.
    expect(screen.getByText("Virenprüfung für Uploads")).toBeTruthy();
  });

  it("sagt bei Benachrichtigungen ausdrücklich, dass NICHT als versendet behandelt werden darf (Regel 2)", () => {
    renderBanner(
      health({
        ausgefallen: ["notifications"],
        integrationen: [integration("notifications", "ausgefallen", { gepuffert: 3 })],
      }),
    );
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("warten auf externe Synchronisation");
    expect(text).toContain("NICHT als versendet behandeln");
    // Die Zahl der wartenden Vorgänge ist sichtbar – „irgendwas wartet" wäre
    // für das Büro nicht handlungsfähig.
    expect(text).toContain("3 Vorgang/Vorgänge");
    // Und nirgends steht „gesendet".
    expect(text).not.toMatch(/\bgesendet\b/);
  });

  it("sagt beim Bankabgleich, dass Zahlungsdaten VERALTET sind und nichts gesperrt wird (Regel 3)", () => {
    renderBanner(health({ ausgefallen: ["bank"], integrationen: [integration("bank", "ausgefallen")] }));
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("VERALTET");
    expect(text).toContain("keine Mahnungen und keine Sperren");
    expect(text).toContain("Ausbildung und Termine laufen normal weiter");
  });

  it("zeigt den Zeitpunkt der letzten erfolgreichen Synchronisation (Regel 4)", () => {
    const vorZweiStunden = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    renderBanner(
      health({
        ausgefallen: ["bank"],
        integrationen: [
          integration("bank", "ausgefallen", { letzteErfolgreicheSynchronisation: vorZweiStunden }),
        ],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("Letzte erfolgreiche Synchronisation: vor 2 Std.");
  });

  it("benennt „noch keine erfolgreiche Synchronisation\" statt eines leeren Feldes", () => {
    renderBanner(
      health({
        ausgefallen: ["calendar"],
        integrationen: [integration("calendar", "ausgefallen", { letzteErfolgreicheSynchronisation: null })],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("noch keine erfolgreiche Synchronisation");
  });

  it("weist auf die manuelle Wiederaufnahme hin, WENN etwas in der Fehlerwarteschlange liegt", () => {
    renderBanner(
      health({
        ausgefallen: ["notifications"],
        integrationen: [integration("notifications", "ausgefallen", { fehlerwarteschlange: 2 })],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("manuelle Wiederaufnahme durch den Systemdienst");
  });

  it("nennt mehrere betroffene Schnittstellen einzeln, jede mit eigenem Hinweis", () => {
    renderBanner(
      health({
        ausgefallen: ["notifications", "bank"],
        eingeschraenkt: ["storage"],
        integrationen: [
          integration("notifications", "ausgefallen"),
          integration("bank", "ausgefallen"),
          integration("storage", "eingeschraenkt"),
          integration("crm", "gesund"),
        ],
      }),
    );
    expect(screen.getByText("Benachrichtigungen (E-Mail/Push)")).toBeTruthy();
    expect(screen.getByText("Bankabgleich")).toBeTruthy();
    expect(screen.getByText("Dokumentenspeicher")).toBeTruthy();
    // Eine GESUNDE Integration erscheint nicht – das Banner ist eine
    // Ausnahmeliste, keine Statusübersicht.
    expect(screen.queryByText("Website-/Lead-Anbindung")).toBeNull();
  });

  it("unterscheidet `ausgefallen` von `eingeschraenkt` im Text", () => {
    renderBanner(
      health({
        ausgefallen: ["bank"],
        eingeschraenkt: ["calendar"],
        integrationen: [integration("bank", "ausgefallen"), integration("calendar", "eingeschraenkt")],
      }),
    );
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("– ausgefallen.");
    expect(text).toContain("– eingeschränkt.");
  });

  it("ist für Screenreader als Statusmeldung ausgezeichnet (`role=status`, `aria-live=polite`)", () => {
    renderBanner(health({ ausgefallen: ["bank"], integrationen: [integration("bank", "ausgefallen")] }));
    const banner = screen.getByRole("status");
    // `polite` und nicht `assertive`: der eingeschränkte Betrieb ist eine
    // Information, kein Alarm, der eine laufende Eingabe unterbrechen darf.
    expect(banner.getAttribute("aria-live")).toBe("polite");
  });

  it("enthält keine Aktionselemente – das Banner informiert, es schaltet nichts ab (Regel 3)", () => {
    const { container } = renderBanner(
      health({ ausgefallen: ["bank"], integrationen: [integration("bank", "ausgefallen")] }),
    );
    const banner = container.querySelector('[data-degraded="true"]')!;
    expect(banner.querySelectorAll("button").length).toBe(0);
    expect(banner.querySelectorAll("input, select, textarea").length).toBe(0);
    // Und es überdeckt nichts: keine dialog-artige Rolle.
    expect(banner.getAttribute("role")).toBe("status");
  });

  it("`ExternalSyncPending` sagt „wartet auf externe Synchronisation\" und nie „gesendet\"", () => {
    render(<ExternalSyncPending was="Die Terminerinnerung" />);
    const text = screen.getByText(/wartet auf externe Synchronisation/);
    expect(text.textContent).toBe("Die Terminerinnerung wartet auf externe Synchronisation.");
    expect(text.textContent).not.toMatch(/\bgesendet\b/);
  });

  it("zeigt bei fehlendem Gesundheitsstand NICHTS an (keine Beunruhigung ohne Befund)", () => {
    // §18: ein fehlgeschlagener Gesundheitsabruf ist selbst kein Ausfall.
    renderBanner(null);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // =======================================================================
  // Der Realtime-Teil: er kommt aus `RealtimeStatus.mode` des Clients, NICHT
  // vom Server. Ein Client, der auf Polling zurückgefallen ist, weiß das selbst
  // am besten (Phase-2-Übergabe an §18).
  // =======================================================================
  it("meldet einen fehlenden Live-Kanal aus CLIENT-Sicht, auch wenn alle Integrationen gesund sind", () => {
    // Der Kanal im Testkontext ist nicht gestartet -> `mode: "down"`. Genau
    // dieser Zustand muss sichtbar sein, ohne dass der Server etwas meldet.
    renderMitSync(health({ status: "gesund", integrationen: [integration("bank", "gesund")] }));
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-realtime-mode")).toBe("down");
    expect(banner.textContent).toContain("Live-Aktualisierung");
    expect(banner.textContent).toContain("keine Live-Verbindung");
    // Und selbst dann: die Aktionen funktionieren unverändert.
    expect(banner.textContent).toContain("alle Aktionen funktionieren unverändert");
  });

  it("stellt den Realtime-Hinweis NEBEN die betroffenen Integrationen, nicht anstelle", () => {
    renderMitSync(
      health({ ausgefallen: ["bank"], integrationen: [integration("bank", "ausgefallen")] }),
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Live-Aktualisierung");
    expect(banner.textContent).toContain("Bankabgleich");
  });
});
