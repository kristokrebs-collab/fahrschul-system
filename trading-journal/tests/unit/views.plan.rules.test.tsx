/**
 * Handelsplan · Regeln wählen: Stop und Ziel, Größe und Risiko, Zeitrahmen, Fehler – jede Änderung rechnet den ganzen Ablauf neu,
 * eine Ablehnung hat einen Grund, und nichts wird zurechtgebogen.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { planOfSettings } from "@/domain/plan";
import { useJournal } from "@/store/journalStore";
import { usePlanForm } from "@/views/plan/planStore";
import { mockState, renderPlan, setupPlanTests, text } from "./views.plan.harness";

vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
setupPlanTests();

describe("Handelsplan · Stop und Ziel", () => {
  it("ein anderer Stop und ein anderes Ziel: Range-Gegenseite + 3R rechnen sofort neu (Stop 99.880, Risiko 500, Ziel 101.880)", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "Range-Tief" }));
    await waitFor(() => expect(text("hplan-stop")).toBe("99.880,0"));
    fireEvent.click(screen.getByRole("radio", { name: "3R" }));
    await waitFor(() => expect(text("hplan-target")).toBe("101.880,0")); // 100.380 + 3 × 500
    expect(text("hplan-rr")).toBe("3,00 : 1");
    expect(usePlanForm.getState().form.stop).toEqual({ kind: "range-far" });
    expect(usePlanForm.getState().form.target).toEqual({ kind: "r", r: 3 });
  });

  it("ein Prozent-Stop mit eigenem Wert; eine ungültige Eingabe wird nicht übernommen und gesagt", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "Prozent" }));
    const input = await screen.findByTestId("hplan-stop-pct");
    fireEvent.change(input, { target: { value: "0,5" } });
    fireEvent.blur(input);
    await waitFor(() => expect(text("hplan-stop")).toBe("99.878,1")); // 100.380 × 0,995 = 99.878,1 (genau)
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte eine Zahl von 0,01 bis 99.");
    expect(text("hplan-stop")).toBe("99.878,1");
  });

  it("zu weit weg für das Risiko: die Größe wird abgelehnt, Risiko und Ticket warten, der Grund steht da", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stop-Regel" })).getByRole("radio", { name: "Eigener Preis" }));
    const price = await screen.findByTestId("hplan-stop-price");
    fireEvent.change(price, { target: { value: "95000" } });
    fireEvent.blur(price);
    // 5 380 Abstand: der Verlust je BTC am Stop ist 6 000+ – schon 0,001 BTC wären 6 USDT, das Risiko von 50 reicht für 0,008 → es bindet der Deckel? nein: der Verlust
    await waitFor(() => expect(screen.getByTestId("hplan-binding")).toBeInTheDocument());
    // Risiko so klein, dass auch die kleinste Menge es sprengt
    const risk = screen.getByTestId("hplan-risk-pct");
    fireEvent.change(risk, { target: { value: "0,05" } });
    fireEvent.blur(risk);
    await waitFor(() => expect(screen.getByTestId("hplan-size-refused")).toHaveAttribute("data-code", "too-far"));
    expect(screen.getByTestId("hplan-size-refused")).toHaveTextContent("Die App macht daraus keine kleinere Position");
    expect(screen.getByTestId("hplan-size-state")).toHaveAttribute("data-status", "blocked");
    expect(screen.getByTestId("hplan-risk-state")).toHaveAttribute("data-status", "todo");
    expect(screen.getByTestId("hplan-ticket-state")).toHaveAttribute("data-status", "todo");
    expect(screen.queryByTestId("hplan-ticket-body")).toBeNull();
    expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "2");
  });

  it("ein Stop auf der falschen Seite wird mit Grund abgelehnt; nichts wird zurechtgebogen", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stop-Regel" })).getByRole("radio", { name: "Eigener Preis" }));
    const price = await screen.findByTestId("hplan-stop-price");
    fireEvent.change(price, { target: { value: "100500" } });
    fireEvent.blur(price);
    const refused = await screen.findByTestId("hplan-exit-refused");
    expect(refused).toHaveAttribute("data-code", "stop-side");
    expect(refused).toHaveTextContent("Der Stop 100.500,0 liegt auf oder über dem Einstieg 100.380,0 – bei Long gehört er darunter.");
    expect(screen.getByTestId("hplan-exit-state")).toHaveAttribute("data-status", "blocked");
    expect(text("hplan-size-headline")).toBe("Wartet auf Schritt 2: ohne Stop und Ziel gibt es keine Größe.");
  });

  it("ein ATR-Stop: Faktor eingeben, die ATR steht dabei; ein Stop über 3 ATR bekommt den Hinweis", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "ATR" }));
    const f = await screen.findByTestId("hplan-stop-atr");
    expect(screen.getByText(/ATR jetzt .* \(14 Kerzen\)\./)).toBeInTheDocument();
    fireEvent.change(f, { target: { value: "6" } });
    fireEvent.blur(f);
    await waitFor(() => expect(screen.getByTestId("hplan-exit-hints")).toHaveTextContent("die Menge wird klein"));
    expect(screen.getByTestId("hplan-exit-hints").querySelector('[data-hint="atr-wide"]')).not.toBeNull();
  });

  it("ohne eigene Schlüsselmarke sagt die Schlüsselmarken-Regel, was fehlt", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "Schlüsselmarke" }));
    expect(await screen.findByTestId("hplan-no-levels")).toHaveTextContent("Keine eigene Schlüsselmarke für BTCUSDT über dem Einstieg.");
  });
});

describe("Handelsplan · Größe und Risiko", () => {
  it("zu viel Risiko: der Check wird rot, das Ticket bleibt gesperrt – mit dem Satz, dass keine Grenze gelockert wird", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    // ein Stop 2 380 weiter unten, 3 % Risiko, Hebel 2× und ein Deckel von 200 %: die Menge ist erlaubt, der Verlust am Stop aber 2,98 %
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stop-Regel" })).getByRole("radio", { name: "Eigener Preis" }));
    const stop = await screen.findByTestId("hplan-stop-price");
    fireEvent.change(stop, { target: { value: "98000" } });
    fireEvent.blur(stop);
    const risk = screen.getByTestId("hplan-risk-pct");
    fireEvent.change(risk, { target: { value: "3" } });
    fireEvent.blur(risk);
    fireEvent.click(screen.getByRole("radio", { name: "2×" }));
    fireEvent.click(screen.getByText("Mehr: Deckel, Cash-Puffer, Mengenschritt und Kursschritt"));
    const cap = screen.getByTestId("hplan-pref-cap");
    fireEvent.change(cap, { target: { value: "200" } });
    fireEvent.blur(cap);
    await waitFor(() => expect(screen.getByTestId("hplan-ampel")).toHaveAttribute("data-light", "red"), { timeout: 5000 });
    expect(screen.getByTestId("hplan-risk-loss")).toHaveAttribute("data-state", "breach");
    expect(screen.getByTestId("hplan-risk-loss")).toHaveTextContent("Verlust am Stop");
    expect(screen.getByTestId("hplan-risk-blocked")).toHaveTextContent("kein Ticket");
    expect(screen.getByTestId("hplan-ticket-headline")).toHaveTextContent("Gesperrt: Der Risiko-Check ist rot");
    expect(screen.queryByTestId("hplan-ticket-body")).toBeNull();
    expect(planOfSettings(useJournal.getState().settings).prefs.maxPositionPct).toBe(2);
  });

  it("das kleinste Chance-Risiko ist eine Plan-Regel: 2,5 macht aus 2,00 : 1 ein Rot", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    const rr = screen.getByTestId("hplan-pref-minrr");
    fireEvent.change(rr, { target: { value: "2,5" } });
    fireEvent.blur(rr);
    await waitFor(() => expect(screen.getByTestId("hplan-risk-rr")).toHaveAttribute("data-state", "breach"));
    expect(screen.getByTestId("hplan-risk-rr")).toHaveTextContent("Chance-Risiko 2,00 : 1 unter deinem Minimum 2,50 : 1");
    expect(planOfSettings(useJournal.getState().settings).prefs.minRewardRisk).toBe(2.5);
  });

  it("das Konto wechseln rechnet mit dem anderen Kapital (Makro 20.000)", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    await waitFor(() => expect(screen.getByTestId("hplan-size-assumed")).toHaveTextContent("Konto Makro mit 20.000,00 USDT"));
  });
});

describe("Handelsplan · Zeitrahmen, Markt, Fehler", () => {
  it("Zeitrahmen, die nicht zum Beginn der Sitzung passen, sind gesperrt – mit Grund", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    const hour = screen.getByRole("radio", { name: "1 Stunde" });
    expect(hour).toBeDisabled();
    expect(hour).toHaveAttribute("title", expect.stringContaining("beginnen nicht zu dieser Uhrzeit"));
    // 30 Minuten passen; die Range (15) rückt auf 30
    fireEvent.click(screen.getByRole("radio", { name: "30 Minuten" }));
    await waitFor(() => expect(usePlanForm.getState().form).toMatchObject({ tf: "30m", orMinutes: 30 }));
    expect(screen.getByRole("radio", { name: "15 Min" })).toBeDisabled();
  });

  it("die US-Börse ist gesperrt, solange es keine Aktien-Kerzen gibt – und sagt es", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    expect(screen.getByRole("radio", { name: "US-Börse (9:30 New York)" })).toBeDisabled();
    expect(screen.getByTestId("hplan-stocks-note")).toHaveTextContent("Aktien-Kerzen sind noch nicht angebunden");
  });

  it("ein anderes Symbol eingeben: gültig wird übernommen und lädt neu, ungültig wird gesagt", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    const input = screen.getByTestId("hplan-symbol-input");
    fireEvent.change(input, { target: { value: "bt c!" } });
    fireEvent.click(screen.getByTestId("hplan-symbol-add"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ein Symbol besteht aus 3 bis 20 Buchstaben oder Ziffern");
    fireEvent.change(input, { target: { value: "ethusdt" } });
    fireEvent.click(screen.getByTestId("hplan-symbol-add"));
    await waitFor(() => expect(mockState.loads.at(-1)!.symbol).toBe("ETHUSDT"));
    expect(usePlanForm.getState().form.symbol).toBe("ETHUSDT");
  });

  it("ein Fehler beim Laden: ehrlicher Grund, nichts geschätzt, kein Plan", async () => {
    mockState.failWith = "Die Börse ist gerade nicht erreichbar.";
    renderPlan();
    await waitFor(() => expect(screen.getByTestId("hplan-candle-state")).toHaveTextContent("Die Börse ist gerade nicht erreichbar. Es wird nichts geschätzt."), { timeout: 5000 });
    expect(screen.getByTestId("hplan-entry-headline")).toHaveTextContent("Keine Kerzen geladen: Die Börse ist gerade nicht erreichbar.");
    expect(screen.getByTestId("hplan-entry-state")).toHaveAttribute("data-status", "blocked");
    expect(screen.getByTestId("hplan-exit-headline")).toHaveTextContent("Wartet auf Schritt 1");
    expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "0");
  });

  it("ein eigener Einstiegspreis ersetzt das Signal", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByText("Mehr: Volumenfilter, letzter Einstieg, eigener Einstiegspreis"));
    const own = screen.getByTestId("hplan-manual-entry");
    fireEvent.change(own, { target: { value: "100300" } });
    fireEvent.blur(own);
    await waitFor(() => expect(text("hplan-entry-headline")).toBe("Einstieg von dir festgelegt: Long bei 100.300,0."));
    await waitFor(() => expect(text("hplan-stop")).toBe("100.065,0"));
  });
});
