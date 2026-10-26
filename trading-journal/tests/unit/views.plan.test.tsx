/**
 * Handelsplan · die Seite als EIN geführter Ablauf, auf den deterministischen BTC-Kerzen der New Yorker Sitzung vom 19.10.2026
 * (`tests/e2e/mocks/planCandles.ts`, die Kerzen kommen über den Lader der Marktschicht – hier ersetzt): Fortschrittsleiste,
 * fünf Schritt-Karten mit „Angenommen“ und dem Satz „Keine professionelle Finanzberatung.“, Ampel, Ticket.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IV, PLAN_OPEN } from "../e2e/mocks/planCandles";
import { mockState, renderPlan, setupPlanTests, text } from "./views.plan.harness";

vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
setupPlanTests();

describe("Handelsplan · der Ablauf", () => {
  it("lädt die Kerzen der Sitzung (Vorlauf bis zum Ende der Sitzung) und zeigt Einstieg, Ausstieg, Größe, Risiko und Ticket in fünf Karten", async () => {
    renderPlan();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Handelsplan");
    await waitFor(() => expect(screen.getByTestId("hplan-entry-headline")).toHaveTextContent("Signal Long: Schluss 100.380,0 um 09:55 Uhr über dem Hoch der Range."), { timeout: 5000 });
    // ein Abruf: 40 Kerzen Vorlauf bis zum Ende der Sitzung
    expect(mockState.loads).toHaveLength(1);
    expect(mockState.loads[0]).toMatchObject({ symbol: "BTCUSDT", interval: "5m", from: PLAN_OPEN - 40 * IV, to: PLAN_OPEN + 390 * 60_000 });

    for (const id of ["entry", "exit", "size", "risk", "ticket"]) {
      const card = screen.getByTestId(`hplan-${id}`);
      expect(card, id).toBeInTheDocument();
      // jede Karte endet mit dem Satz und Quelle + Stand der Kerzen, und sie zeigt, was angenommen wurde
      expect(within(card).getByTestId(`hplan-${id}-note`)).not.toHaveTextContent("Finanzberatung");
      expect(within(card).getByTestId(`hplan-${id}-note`)).toHaveTextContent("Quelle: Binance USDⓈ-M · Kerzen bis ");
      expect(within(card).getByTestId(`hplan-${id}-assumed`)).toBeInTheDocument();
      expect(within(card).getByTestId(`hplan-${id}-state`)).toHaveAttribute("data-status", "done");
    }
    expect(text("hplan-exit-headline")).toBe("Stop 100.065,0, Ziel 101.010,0: 315,0 Risiko (0,31 %) je Einheit, Chance-Risiko 2,00 : 1.");
    expect(text("hplan-size-headline")).toBe("0,037 BTC für 3.714,06 USDT; am Stop gehen höchstens 17,21 USDT verloren.");
    expect(screen.getByTestId("hplan-binding")).toHaveTextContent("Der Deckel für den Positionswert bindet");
    expect(screen.getByTestId("hplan-limit-position")).toHaveAttribute("data-binding", "true");
    expect(screen.getByTestId("hplan-limit-loss")).not.toHaveAttribute("data-binding");
    expect(text("hplan-risk-headline")).toBe("Grün: Der Plan hält alle deine Grenzen ein.");
    expect(screen.getByTestId("hplan-ampel")).toHaveAttribute("data-light", "green");
    expect(text("hplan-ticket-headline")).toContain("Long BTCUSDT: Einstieg 100.380,0, Stop 100.065,0, Ziel 101.010,0");
    // der eine ruhige Satz am Seitenende
    expect(screen.getByTestId("analysis-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
  });

  it("die Fortschrittsleiste oben: fünf von fünf fertig", async () => {
    renderPlan();
    await waitFor(() => expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "5"), { timeout: 5000 });
    expect(text("hplan-progress-text")).toBe("5 von 5 Schritten fertig · der Plan ist vollständig");
    for (const id of ["entry", "exit", "size", "risk", "ticket"]) expect(screen.getByTestId(`hplan-progress-${id}`)).toHaveAttribute("data-status", "done");
  });

  it("die Range und das Signal in Zahlen; die Gründe stehen in Worten", async () => {
    renderPlan();
    await screen.findByTestId("hplan-range");
    const range = screen.getByTestId("hplan-range");
    expect(range).toHaveTextContent("Range-Hoch100.250,0");
    expect(range).toHaveTextContent("Range-Tief99.880,0");
    expect(range).toHaveTextContent("Mitte100.065,0");
    expect(screen.getByTestId("hplan-signal")).toHaveTextContent("Long");
    expect(screen.getByTestId("hplan-signal")).toHaveTextContent("100.380,0");
    expect(screen.getByTestId("hplan-entry-reasons")).toHaveTextContent("Die Kerze 09:50 ist um 09:55 Uhr geschlossen.");
    expect(screen.getByTestId("hplan-entry-reasons")).toHaveTextContent("Die Sitzung ist vorbei: Das ist ein Rückblick");
    expect(screen.getByTestId("hplan-candle-state")).toHaveTextContent("Rückblick: die Sitzung ist vorbei");
  });

  it("das Bild zum Plan zeigt Range, Signal, Einstieg, Stop und Ziel mit denselben Zahlen", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    const chart = await screen.findByTestId("hplan-chart");
    expect(within(chart).getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("Range 99.880,0 bis 100.250,0, Signal Long um 09:55 Uhr zu 100.380,0, Einstieg 100.380,0, Stop 100.065,0, Ziel 101.010,0"));
    for (const k of ["high", "low", "entry", "stop", "target", "signal"]) expect(chart.querySelector(`[data-level="${k}"]`), k).not.toBeNull();
    expect(chart.querySelector('[data-level="stop"]')).toHaveTextContent("Stop 100.065,0");
    expect(within(chart).getByText(/Kerzen \d\d:\d\d bis \d\d:\d\d Uhr \(UTC−4\)/)).toBeInTheDocument();
  });
});
