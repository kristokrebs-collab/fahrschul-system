/**
 * Positionsgrößen-Rechner (Risiko-Seite) · die „Rechnung“: Risiko als Anteil oder Betrag, jede Fehleingabe mit klarer Meldung an ihrem
 * Feld (0, negativ, Stop / Ziel auf der falschen Seite), die Posten mit Handrechnung, die sichtbaren Annahmen, die Rundung als Hinweis,
 * der Hinweis einer Vorbelegung aus dem Scanner. Konto der Festdaten: Scalp 5 000, Risiko 1 %, Gebühr und Slippage je 0,05 %.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMultiDaily } from "@/market/multiDaily";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { RisikoView } from "@/views/risiko";
import { unitOf } from "@/views/risiko/CalcBill";
import { EMPTY_CALC, useRiskUi } from "@/views/risiko/riskStore";
import { RISIKO } from "@/views/risiko/strings";
import { pinMidday } from "./midday.fixture";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const rest = { klines: vi.fn(async () => ({ data: [], asOf: 0, receivedAt: 0, source: "binance", comparable: true })) } as unknown as BinanceRest;
const E = RISIKO.calc.errors;

beforeEach(pinMidday);
afterEach(() => vi.useRealTimers());

function mount(): HTMLElement {
  render(
    <MotionRoot>
      <MorphDialogProvider>
        <RisikoView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
  return screen.getByTestId("risk-calc");
}
async function type(calc: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(within(calc).getByLabelText(label), { target: { value } });
  });
}
const row = (bill: HTMLElement, key: string): string => bill.querySelector(`[data-row=${key}]`)?.textContent ?? "";

describe("Positionsgrößen-Rechner · Rechnung", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => null });
    await bootFixtureJournal();
    localStorage.clear();
    useRiskUi.setState({ calc: EMPTY_CALC, fillSeq: 0, prefillNote: null });
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
  });

  it("erst mit gültigen Eingaben erscheint die Rechnung; ihre Posten stimmen mit der Handrechnung", async () => {
    const calc = mount();
    expect(within(calc).queryByTestId("risk-bill")).toBeNull();
    await type(calc, "Einstieg", "100");
    await type(calc, "Stop", "95");
    await type(calc, "Ziel", "110");
    const bill = await within(calc).findByTestId("risk-bill", {}, { timeout: 5000 });
    // 50 Risiko ÷ (5 + 0,0005 × 195 + 0,0005 × 95) = 50 ÷ 5,145 = 9,7182 Einheiten
    await waitFor(() => expect(within(bill).getByTestId("risk-bill-qty")).toHaveTextContent("9,72"));
    expect(bill).toHaveTextContent("Rechnung · keine Empfehlung");
    expect(bill).toHaveAttribute("data-tone", "ok");
    expect(bill).toHaveAttribute("data-side", "long");
    expect(row(bill, "notional")).toContain("972 USDT");
    expect(row(bill, "dist")).toContain("5,00 · 5,00 %");
    expect(row(bill, "dist")).toContain(RISIKO.bill.noAtr);
    expect(row(bill, "loss")).toContain("−50 USDT");
    expect(row(bill, "loss")).toContain("1,00 %");
    // Kosten: 9,7182 × 0,145 = 1,41 → 1 USDT · 3 %
    expect(row(bill, "cost")).toContain("1 USDT · 3 %");
    // Mindestabstand = 3 × 0,145 = 0,435 = 0,44 %
    expect(row(bill, "min")).toContain("0,44 %");
    expect(row(bill, "min")).toContain(RISIKO.bill.minOk);
    // Betrag am Ziel: 9,7182 × (10 − 0,0005 × 210) = 96,16
    expect(row(bill, "gain")).toContain("+96 USDT");
    expect(row(bill, "gain")).toContain("1:2,0");
    expect(row(bill, "gain")).toContain("1:1,92");
    expect(within(bill).getByTestId("risk-bill-notes")).toHaveTextContent("Rechnerisch im Rahmen deiner Regeln: Stop 5,00 % entfernt, Hebel 0,2×, Risiko 1,00 %.");
    // die Annahmen stehen da, die Rundung ist ein Hinweis mit Beispiel
    expect(within(bill).getByTestId("risk-bill-assume")).toHaveTextContent("Gebühr 0,05 % je Seite, Slippage 0,05 % am Stop");
    expect(within(bill).getByTestId("risk-bill-step")).toHaveTextContent("Beispiel mit Schritt 0,01: abgerundet 9,71");
    expect(within(bill).getByTestId("risk-bill-step")).toHaveTextContent("Den echten Schritt nennt deine Börse.");
    const ladder = within(bill).getByTestId("risk-bill-ladder");
    expect(ladder).toHaveAttribute("aria-hidden", "true");
    expect(ladder).toHaveTextContent("Ziel +2,0 R · 110,00");
    expect(ladder).toHaveTextContent("Einstieg · 100,00");
    expect(ladder).toHaveTextContent("Stop −1 R · 95,00");
    // eine Rechnung: kein Knopf in ihr, keine Beratungs-Floskel in jeder Karte (die steht einmal am Seitenende)
    expect(bill.querySelectorAll("button")).toHaveLength(0);
    expect(bill).not.toHaveTextContent("Finanzberatung");
    expect(bill).toHaveTextContent("keine Empfehlung, keine Prognose, keine Order");
  });

  it("Risiko als Betrag: der Wechsel übernimmt dasselbe Risiko, 100 statt 50 verdoppelt die Größe und sagt den Anteil", async () => {
    const calc = mount();
    await type(calc, "Einstieg", "100");
    await type(calc, "Stop", "95");
    const bill = await within(calc).findByTestId("risk-bill", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(within(calc).getByRole("radio", { name: "Betrag" }));
    });
    const amount = within(calc).getByLabelText("Risiko-Betrag") as HTMLInputElement;
    expect(amount.value).toBe("50");
    expect(within(calc).queryByTestId("risk-chip-1")).toBeNull();
    await waitFor(() => expect(within(bill).getByTestId("risk-bill-qty")).toHaveTextContent("9,72"));
    await type(calc, "Risiko-Betrag", "100");
    await waitFor(() => expect(within(bill).getByTestId("risk-bill-qty")).toHaveTextContent("19,44"));
    expect(within(calc).getByTestId("risk-amount-pct")).toHaveTextContent("Das sind 2,00 % deines Kapitals.");
    // 2 % gegen die eigene Regel von 1 %: über der Regel, nicht über dem Doppelten
    const note = within(bill).getByTestId("risk-bill-notes").querySelector("[data-code=overRisk]")!;
    expect(note).toHaveAttribute("data-tone", "warn");
    expect(note).toHaveTextContent("Über deinem Risiko je Trade (1,00 %): Hier sind es 2,00 % – ein Verlust am Stop kostet 100 USDT.");
    // zurück auf Prozent: derselbe Wert steht als 2 %
    await act(async () => {
      fireEvent.click(within(calc).getByRole("radio", { name: "%" }));
    });
    expect((within(calc).getByLabelText("Risiko") as HTMLInputElement).value).toBe("2");
  });

  it("Fehleingaben: 0, negativ, zu viel, Stop und Ziel auf der falschen Seite – jede mit ihrer Meldung, nie mit einer Größe", async () => {
    const calc = mount();
    const alerts = (): string[] => within(calc).queryAllByRole("alert").map((a) => a.textContent ?? "");
    const noBill = (): void => expect(within(calc).queryByTestId("risk-bill")).toBeNull();
    await type(calc, "Einstieg", "100");
    // Stop fehlt noch
    expect(alerts()).toEqual([E.stop]);
    await type(calc, "Stop", "105");
    expect(alerts()).toEqual([E.side]);
    expect(within(calc).getByLabelText("Stop")).toHaveAttribute("aria-invalid", "true");
    noBill();
    await type(calc, "Stop", "100");
    expect(alerts()).toEqual([E.stop]);
    await type(calc, "Stop", "0");
    expect(alerts()).toEqual([E.stop]);
    await type(calc, "Stop", "-95");
    expect(alerts()).toEqual([E.stop]);
    await type(calc, "Stop", "95");
    expect(alerts()).toEqual([]);
    await type(calc, "Einstieg", "-100");
    expect(alerts()).toEqual([E.entry]);
    await type(calc, "Einstieg", "0");
    expect(alerts()).toEqual([E.entry]);
    await type(calc, "Einstieg", "100");
    // Kapital
    await type(calc, "Kapital", "0");
    expect(alerts()).toEqual([E.capital]);
    await type(calc, "Kapital", "-5000");
    expect(alerts()).toEqual([E.capital]);
    noBill();
    await type(calc, "Kapital", "");
    // Risiko in Prozent
    await type(calc, "Risiko", "0");
    expect(alerts()).toEqual([E.risk]);
    await type(calc, "Risiko", "-1");
    expect(alerts()).toEqual([E.risk]);
    await type(calc, "Risiko", "150");
    expect(alerts()).toEqual([E.risk]);
    await type(calc, "Risiko", "abc");
    expect(alerts()).toEqual([E.risk]);
    await type(calc, "Risiko", "");
    expect(alerts()).toEqual([]);
    // Risiko als Betrag
    await act(async () => {
      fireEvent.click(within(calc).getByRole("radio", { name: "Betrag" }));
    });
    await type(calc, "Risiko-Betrag", "0");
    expect(alerts()).toEqual([E.riskAmount]);
    await type(calc, "Risiko-Betrag", "-20");
    expect(alerts()).toEqual([E.riskAmount]);
    await type(calc, "Risiko-Betrag", "5001");
    expect(alerts()).toEqual([E.riskAmount]);
    noBill();
    await type(calc, "Risiko-Betrag", "50");
    expect(alerts()).toEqual([]);
    // Ziel auf der falschen Seite: die Größe steht, das Ziel wird gesagt und nicht gerechnet
    await type(calc, "Ziel", "90");
    expect(alerts()).toEqual([E.target]);
    const bill = await within(calc).findByTestId("risk-bill", {}, { timeout: 5000 });
    expect(row(bill, "gain")).toContain(RISIKO.bill.targetWrong);
    expect(within(bill).getByTestId("risk-bill-notes").querySelector("[data-code=targetSide]")).toHaveTextContent(E.target);
  });

  it("enger Stop: „teuer“ mit Kostenanteil und Mindestabstand; über der Hebel-Regel steht zuerst", async () => {
    const calc = mount();
    await type(calc, "Einstieg", "100");
    await type(calc, "Stop", "99,7");
    const bill = await within(calc).findByTestId("risk-bill", {}, { timeout: 5000 });
    // Kosten je Einheit 0,1497 bei 0,3 Abstand → 33 % des Risikos; Mindestabstand 0,4491 = 0,45 %
    expect(row(bill, "cost")).toContain("· 33 %");
    expect(row(bill, "min")).toContain(RISIKO.bill.minBelow);
    const notes = within(bill).getByTestId("risk-bill-notes");
    expect(notes.querySelector("[data-code=cost]")).toHaveTextContent("Teuer: Gebühren und Slippage sind 33 % des Risikos. Erst ab 0,45 % Abstand sinken sie unter ein Viertel.");
    // 50 ÷ 0,4497 × 100 = 11 118 Positionswert = Hebel 2,2× auf 5 000
    expect(within(bill).getByTestId("risk-bill-lev")).toHaveTextContent("2,2×");
    await type(calc, "Risiko", "20");
    await waitFor(() => expect(bill).toHaveAttribute("data-tone", "bad"));
    expect(notes.firstElementChild).toHaveAttribute("data-code", "overRule");
    expect(within(bill).getByTestId("risk-bill-lev")).toHaveAttribute("data-tone", "bad");
  });

  it("eine Vorbelegung aus dem Scanner wird als solche benannt und verschwindet, sobald der Trader den Wert selbst setzt", async () => {
    const calc = mount();
    await act(async () => {
      useRiskUi.getState().setCalc({ pair: "LTCUSDT", side: "short", entry: "51,65", stop: "51,98", target: "" }, true);
      useRiskUi.getState().setPrefillNote("Aus dem Ausbruch-Scanner vorbelegt – nur eine Vorbelegung, kein Trade: LTCUSDT · Short.");
    });
    expect(within(calc).getByTestId("risk-prefill-note")).toHaveTextContent("nur eine Vorbelegung, kein Trade");
    const bill = await within(calc).findByTestId("risk-bill", {}, { timeout: 5000 });
    expect(bill).toHaveAttribute("data-side", "short");
    expect(within(bill).getByTestId("risk-bill-qty")).toHaveTextContent("LTC");
    // Risiko (Betrag / Anteil) zu ändern lässt den Hinweis stehen – Einstieg oder Stop zu tippen nimmt ihn weg
    await type(calc, "Risiko", "0,5");
    expect(within(calc).getByTestId("risk-prefill-note")).toBeInTheDocument();
    await type(calc, "Stop", "52,10");
    expect(within(calc).queryByTestId("risk-prefill-note")).toBeNull();
  });

  it("die Einheit der Menge kommt aus dem Paar", () => {
    expect(unitOf("BTC/USDT")).toBe("BTC");
    expect(unitOf("LTCUSDT")).toBe("LTC");
    expect(unitOf(" ethusdc ")).toBe("ETH");
    expect(unitOf("AAPL")).toBe("AAPL");
  });
});
