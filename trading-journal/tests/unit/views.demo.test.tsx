/**
 * F58 Interaktive Demo (`src/views/demo`): the sheet walks through Import → Regelentwurf → Test → Demokonto → Alarm; EVERY card
 * carries „Beispiel – nicht deine Daten“, the test shows the engine's figures with their meaning, the paper trade is played
 * candle by candle, the alarm replays the key-level functions; and the isolation holds at runtime: the journal, the settings, the
 * browser storage and the network are untouched, and closing the demo throws its session away.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_IDEAS } from "@/domain/demo/ideas";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import DemoHost from "@/views/demo/DemoHost";
import { closeDemo, openDemo, useDemo } from "@/views/demo/demoStore";
import { initialSession, resetSession, useSession } from "@/views/demo/session";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const TAG = "Beispiel – nicht deine Daten";
const tid = (id: string) => screen.getByTestId(id);

function mount() {
  const r = render(
    <MotionRoot>
      <DemoHost />
    </MotionRoot>,
  );
  act(() => openDemo());
  return r;
}
const go = (id: string) => fireEvent.click(tid(`demo-step-${id}`));

describe("Demo mit Beispieldaten", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    resetSession();
    act(() => closeDemo());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("öffnet sich als Blatt mit fünf Schritten, beginnt beim Import und sagt vorab, dass nichts gespeichert wird", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Demo mit Beispieldaten" })).toBeInTheDocument();
    const steps = within(tid("demo-steps")).getAllByRole("button");
    expect(steps.map((b) => b.textContent)).toEqual(["1Import", "2Regeln", "3Test", "4Demokonto", "5Alarm"]);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(tid("demo-lead")).toHaveTextContent("nicht in dein Journal, nicht in die Einstellungen, nicht in die Cloud");
    expect(tid("demo-progress")).toHaveTextContent("Schritt 1 von 5");
    expect(tid("demo-back")).toBeDisabled();
  });

  it("jede Karte trägt „Beispiel – nicht deine Daten“ und endet mit dem Satz zur Finanzberatung", () => {
    mount();
    const seen = new Set<string>();
    for (const id of ["import", "regeln", "test", "konto", "alarm"]) {
      go(id);
      for (const card of screen.getAllByTestId("demo-card")) {
        seen.add(card.getAttribute("data-step")!);
        expect(within(card).getByTestId("demo-tag")).toHaveTextContent(TAG);
        expect(within(card).getByTestId("demo-foot")).toHaveTextContent("Keine professionelle Finanzberatung.");
      }
    }
    // die fünf Schritte und die Schlusskarte
    expect([...seen].sort()).toEqual(["alarm", "ende", "import", "konto", "regeln", "test"]);
  });

  it("Karten mit Kerzen nennen deren Quelle: künstlich, berechnet, keine Börse", () => {
    mount();
    go("test");
    expect(tid("demo-foot")).toHaveTextContent("künstliche Beispiel-Kerzen");
    expect(tid("demo-foot")).toHaveTextContent("keine Börse");
  });

  it("Import: Rohtext auf Wunsch, Vorschau mit erkanntem Format, dann die Trades – und der Hinweis, dass nichts gespeichert ist", async () => {
    mount();
    expect(screen.queryByTestId("demo-import-preview-body")).toBeNull();
    fireEvent.click(tid("demo-raw-toggle"));
    expect(await screen.findByTestId("demo-csv-raw")).toHaveTextContent("DEMOUSDT,Long,5,Isolated");
    fireEvent.click(tid("demo-import-preview"));
    expect(tid("demo-import-preview-body")).toHaveTextContent("Erkannt als: Bitunix Futures – Positionshistorie");
    expect(tid("demo-import-rows")).toHaveTextContent("8 Zeilen gelesen, 0 übersprungen");
    expect(screen.getAllByTestId("demo-import-row")).toHaveLength(8);
    expect(screen.getAllByTestId("demo-import-row")[0]).toHaveTextContent("DEMO/USDT · Long");
    fireEvent.click(tid("demo-import-trades"));
    expect(tid("demo-import-n")).toHaveTextContent("8");
    expect(tid("demo-import-trades-body")).toHaveTextContent("Trefferquote");
    expect(tid("demo-import-trades-body")).toHaveTextContent("80 %-Spanne");
    expect(tid("demo-import-trades-body")).toHaveTextContent("kein Stop");
    expect(tid("demo-nothing-saved")).toHaveTextContent("Nichts davon wurde gespeichert.");
  });

  it("Regelentwurf in Worten: verstanden mit den eigenen Worten, Klartext der Regeln, Beispiel-Chips; Unverständliches wird benannt", async () => {
    mount();
    go("regeln");
    expect(tid("demo-idea")).toHaveValue(DEMO_IDEAS[0]!.text);
    expect(tid("demo-parse")).toHaveAttribute("data-ready", "1");
    expect(screen.getAllByTestId("demo-understood").length).toBeGreaterThanOrEqual(3);
    expect(tid("demo-plain")).toHaveTextContent("Long wenn Schluss über dem Hoch der letzten 20 Kerzen");
    fireEvent.click(tid("demo-example-pullback"));
    expect(tid("demo-idea")).toHaveValue(DEMO_IDEAS[1]!.text);
    expect(tid("demo-plain")).toHaveTextContent("RSI(14)");
    fireEvent.change(tid("demo-idea"), { target: { value: "Kaufe bei Vollmond." } });
    await waitFor(() => expect(tid("demo-rules-state")).toHaveAttribute("data-ready", "0"));
    expect(tid("demo-rules-state")).toHaveTextContent(/Noch nicht lesbar|Schreib eine Idee/);
  });

  it("Regelentwurf per Baukasten: derselbe Klartext aus dem Regelbaum des Labors", () => {
    mount();
    go("regeln");
    fireEvent.click(screen.getByRole("radio", { name: "Baukasten" }));
    expect(tid("demo-kit")).toBeInTheDocument();
    fireEvent.click(within(tid("demo-kit")).getByRole("radio", { name: "RSI fällt unter 30" }));
    fireEvent.click(within(tid("demo-kit")).getByRole("radio", { name: "Kurs über dem EMA 100" }));
    fireEvent.click(within(tid("demo-kit")).getByRole("radio", { name: "2 × ATR" }));
    expect(tid("demo-plain")).toHaveTextContent("RSI(14)");
    expect(tid("demo-plain")).toHaveTextContent("EMA 100");
    expect(tid("demo-plain")).toHaveTextContent("2 × ATR");
  });

  it("Test: rechnet erst auf Klick, zeigt Zahlen mit Spannen, den Trichter und was die Zahlen bedeuten – und markiert veraltete Zahlen", async () => {
    mount();
    go("test");
    expect(screen.queryByTestId("demo-test-result")).toBeNull();
    fireEvent.click(tid("demo-test-run"));
    const result = await screen.findByTestId("demo-test-result", {}, { timeout: 20_000 });
    expect(Number(result.getAttribute("data-n"))).toBeGreaterThan(10);
    expect(tid("demo-fig-n")).toHaveTextContent(String(result.getAttribute("data-n")));
    expect(tid("demo-fig-rate")).toHaveTextContent("80 %-Spanne");
    expect(tid("demo-fig-avgr")).toHaveTextContent("80 %-Spanne");
    expect(tid("demo-meaning")).toHaveTextContent("Ein Test beweist keinen Gewinn");
    expect(tid("demo-meaning")).toHaveTextContent("Eine Spanne, die die 0 einschließt, belegt keinen Vorteil");
    expect(tid("demo-funnel")).toHaveTextContent("neue Signale, daraus");
    expect(tid("demo-curve")).toBeInTheDocument();
    expect(screen.getAllByTestId("demo-test-trades")[0]!.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(tid("demo-test-result")).toHaveAttribute("data-stale", "0");
    // andere Regeln → die Zahlen unten gehören zur vorigen Fassung
    go("regeln");
    fireEvent.click(tid("demo-example-cross"));
    go("test");
    expect(tid("demo-test-result")).toHaveAttribute("data-stale", "1");
    expect(tid("demo-test-stale")).toHaveTextContent("vorigen Fassung");
    fireEvent.click(tid("demo-test-run"));
    await waitFor(() => expect(tid("demo-test-result")).toHaveAttribute("data-stale", "0"), { timeout: 20_000 });
  });

  it("Test ohne lesbare Regeln fällt auf die Baukasten-Idee zurück und sagt es", async () => {
    mount();
    go("regeln");
    fireEvent.change(tid("demo-idea"), { target: { value: "Kaufe bei Vollmond." } });
    go("test");
    expect(tid("demo-test-idea")).toHaveTextContent("Die Baukasten-Idee");
  });

  it("Demokonto: Einstieg wartet, Kerze für Kerze aufgedeckt, am Ende ein Ergebnis in R mit Gebühren – nichts wird gesendet", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();
    go("konto");
    expect(tid("demo-paper-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-paper-result")).toBeNull();
    fireEvent.click(tid("demo-paper-open"));
    expect(tid("demo-paper-result")).toHaveAttribute("data-state", "waiting");
    expect(tid("demo-paper-verdict")).toHaveTextContent("Eröffnung der nächsten Kerze");
    fireEvent.click(tid("demo-paper-next"));
    expect(tid("demo-paper-shown")).toHaveTextContent("1 Kerze aufgedeckt");
    expect(tid("demo-paper-result").getAttribute("data-state")).not.toBe("waiting");
    fireEvent.click(tid("demo-paper-run"));
    expect(tid("demo-paper-result")).toHaveAttribute("data-state", "closed");
    expect(tid("demo-paper-verdict")).toHaveTextContent(/Der Stop wurde erreicht|Das Ziel wurde erreicht/);
    expect(tid("demo-paper-r")).toHaveTextContent(/R$/);
    expect(tid("demo-paper-result")).toHaveTextContent("Gebühren");
    expect(tid("demo-paper-next")).toBeDisabled();
    // Richtung, Stop und Ziel sind nach dem Start gesperrt; „Neu wählen“ gibt sie frei
    expect(within(tid("demo-paper-form")).getByRole("radio", { name: "Short" })).toBeDisabled();
    fireEvent.click(tid("demo-paper-reset"));
    expect(within(tid("demo-paper-form")).getByRole("radio", { name: "Short" })).not.toBeDisabled();
    expect(screen.queryByTestId("demo-paper-result")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Alarm: die Standardmarke meldet vier Stufen; der Abspielregler zeigt nur, was bis dahin gewesen wäre", () => {
    mount();
    go("alarm");
    expect(tid("demo-alarm-events")).toHaveAttribute("data-n", "4");
    const stages = screen.getAllByTestId("demo-alarm-event").map((e) => e.getAttribute("data-stage"));
    expect(stages).toEqual(["prepare", "confirm", "retest", "invalid"]);
    fireEvent.change(tid("demo-alarm-at"), { target: { value: "100" } });
    expect(tid("demo-alarm-events")).toHaveAttribute("data-n", "0");
    expect(tid("demo-alarm-at-text")).toHaveTextContent("Kerze 100 von 240");
    fireEvent.change(tid("demo-alarm-at"), { target: { value: "170" } });
    expect(screen.getAllByTestId("demo-alarm-event").map((e) => e.getAttribute("data-stage"))).toEqual(["prepare", "confirm"]);
    fireEvent.click(screen.getByRole("radio", { name: "Berührung" }));
    expect(tid("demo-alarm-chart")).toBeInTheDocument();
    expect(screen.getByText(/Jede Stufe meldet sich einmal/)).toBeInTheDocument();
    expect(screen.getByText(/Kein Push, keine Order/)).toBeInTheDocument();
  });

  it("Weiter / Zurück führen durch die Schritte; der letzte bietet die echten Wege und beendet die Demo", () => {
    mount();
    for (let i = 1; i < 5; i++) {
      fireEvent.click(tid("demo-next"));
      expect(tid("demo-progress")).toHaveTextContent(`Schritt ${i + 1} von 5`);
    }
    expect(tid("demo-done-links").querySelectorAll("button")).toHaveLength(4);
    expect(screen.queryByTestId("demo-next")).toBeNull();
    fireEvent.click(tid("demo-back"));
    expect(tid("demo-progress")).toHaveTextContent("Schritt 4 von 5");
    fireEvent.click(tid("demo-next"));
    fireEvent.click(tid("demo-finish"));
    expect(useDemo.getState().open).toBe(false);
  });

  it("schreibt nie in das echte Journal, die Einstellungen, den Browser-Speicher oder das Netz – und wirft die Sitzung beim Schließen weg", async () => {
    const before = useJournal.getState();
    const trades = before.trades;
    const settings = before.settings;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const save = vi.fn();
    useJournal.setState({ saveTrade: save, saveSettings: save, saveDay: save, saveHyblock: save, deleteTrade: save });
    mount();
    fireEvent.click(tid("demo-import-preview"));
    fireEvent.click(tid("demo-import-trades"));
    go("regeln");
    fireEvent.click(tid("demo-example-pullback"));
    go("test");
    fireEvent.click(tid("demo-test-run"));
    await screen.findByTestId("demo-test-result", {}, { timeout: 20_000 });
    go("konto");
    fireEvent.click(tid("demo-paper-open"));
    fireEvent.click(tid("demo-paper-run"));
    go("alarm");
    fireEvent.change(tid("demo-alarm-price"), { target: { value: "104" } });
    expect(useSession.getState().step).toBe("alarm");
    expect(useSession.getState().run).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(useJournal.getState().trades).toBe(trades);
    expect(useJournal.getState().settings).toBe(settings);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // schließen: die Sitzung ist weg
    act(() => closeDemo());
    await waitFor(() => expect(useSession.getState()).toMatchObject(initialSession()));
    expect(useSession.getState().run).toBeNull();
    expect(useSession.getState().paperShown).toBeNull();
    // noch einmal öffnen: wieder ganz von vorn
    act(() => openDemo());
    expect(tid("demo-progress")).toHaveTextContent("Schritt 1 von 5");
    expect(screen.queryByTestId("demo-import-preview-body")).toBeNull();
  });
});
