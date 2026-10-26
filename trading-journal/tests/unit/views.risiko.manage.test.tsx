/**
 * Positionsrechner (Risiko-Seite) · Verwaltung planen (F65): unter dem Ergebnis des Rechners steht dieselbe Karte wie im Handelsplan;
 * Einstieg 100, Stop 95, Ziel 110 → Auslöser für +1R bei 105, Stop auf den Einstieg 100, und die Wahl bleibt auf dem Gerät.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMultiDaily } from "@/market/multiDaily";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { RisikoView } from "@/views/risiko";
import { DEFAULT_MANAGE } from "@/domain/plan";
import { useCalcManage, CALC_MANAGE_KEY } from "@/views/plan/manageStore";
import { pinMidday } from "./midday.fixture";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const rest = { klines: vi.fn(async () => ({ data: [], asOf: 0, receivedAt: 0, source: "binance", comparable: true })) } as unknown as BinanceRest;

beforeEach(pinMidday);
afterEach(() => vi.useRealTimers());

describe("Positionsrechner · Verwaltung", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => null });
    await bootFixtureJournal();
    localStorage.clear();
    useCalcManage.setState({ spec: DEFAULT_MANAGE });
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
  });

  it("erst mit einem gültigen Ergebnis erscheint die Karte; Break-even und Teilziel rechnen aus den Zahlen des Rechners", async () => {
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <RisikoView />
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const calc = screen.getByTestId("risk-calc");
    expect(within(calc).queryByTestId("risk-manage")).toBeNull();
    await act(async () => {
      fireEvent.change(within(calc).getByLabelText("Einstieg"), { target: { value: "100" } });
      fireEvent.change(within(calc).getByLabelText("Stop"), { target: { value: "95" } });
      fireEvent.change(within(calc).getByLabelText("Ziel"), { target: { value: "110" } });
    });
    const card = await within(calc).findByTestId("risk-manage", {}, { timeout: 5000 });
    expect(card).toHaveAttribute("data-active", "false");
    fireEvent.click(within(card).getByRole("checkbox", { name: /^Break-even/ }));
    fireEvent.click(within(card).getByRole("checkbox", { name: /^Teilziel/ }));
    const steps = await within(card).findByTestId("risk-manage-steps");
    await waitFor(() => expect(steps.querySelector("[data-step=breakEven]")!.textContent).toContain("105,00"));
    expect(steps.querySelector("[data-step=breakEven]")!.textContent).toContain("Stop von 95,00 auf 100,00");
    // Teilziel bei +1R = 105,00, die Hälfte der Menge (auf 0,001 abgerundet)
    expect(steps.querySelector("[data-step=partial]")!.textContent).toMatch(/105,00 erreicht hat \(\+1 R\)/);
    expect(steps.querySelector("[data-step=partial]")!.textContent).toMatch(/\(50 %\) mit Limit-Order verkaufen/);
    // der Verlust am Stop in den Beispielen ist der Verlust des Rechners (50 USDT bei 1 % von 5 000), ohne Schönfärberei
    expect(within(card).getByTestId("risk-manage-pnl-stop")).toHaveTextContent(/−(49|50),\d\d USDT/);
    expect(within(card).getByText("Keine professionelle Finanzberatung.")).toBeInTheDocument();
    // die Wahl bleibt auf dem Gerät
    expect(useCalcManage.getState().spec.breakEven.on).toBe(true);
    expect(JSON.parse(localStorage.getItem(CALC_MANAGE_KEY)!).partial.on).toBe(true);
  });
});
