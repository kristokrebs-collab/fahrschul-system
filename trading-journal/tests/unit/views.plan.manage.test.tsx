/**
 * Handelsplan · Verwaltung nach dem Einstieg (F65): Break-even, Teilziel und Trailing im Schritt „Ausstieg“, die Preise aus dem
 * Plan der Sitzung vom 19.10.2026 (Einstieg 100 380, Stop 100 065, Risiko 315, Ziel 101 010, Menge 0,037) und das Ticket mit den Zeilen.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { keyLevelsOfSettings } from "@/domain/keylevels";
import { planOfSettings } from "@/domain/plan";
import { useJournal } from "@/store/journalStore";
import { usePlanForm } from "@/views/plan/planStore";
import { renderPlan, setupPlanTests, text } from "./views.plan.harness";

vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
setupPlanTests();

const plans = () => planOfSettings(useJournal.getState().settings).plans;
const levels = () => keyLevelsOfSettings(useJournal.getState().settings).levels;
const check = (name: RegExp): HTMLElement => screen.getByRole("checkbox", { name });

describe("Handelsplan · Verwaltung planen", () => {
  it("ohne Regel steht dort, dass keine Verwaltung geplant ist – und das Ticket hat keine Verwaltungszeile", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    const card = screen.getByTestId("hplan-manage");
    expect(card).toHaveAttribute("data-active", "false");
    expect(within(card).getByTestId("hplan-manage-off")).toHaveTextContent("Keine Verwaltung geplant");
    expect(screen.queryByTestId("hplan-manage-result")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("hplan-ticket-rows")).toBeInTheDocument());
    expect(text("hplan-ticket-rows")).not.toContain("Verwaltung");
  });

  it("Break-even + Teilziel: Auslöser 100.695, Stop auf den Einstieg, Teilziel 100.852,5 mit 0,018 BTC – und im Ticket", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(check(/^Break-even/));
    fireEvent.click(check(/^Teilziel/));
    const atR = await screen.findByTestId("hplan-manage-pa-r");
    fireEvent.change(atR, { target: { value: "1,5" } });
    fireEvent.blur(atR);
    const steps = await screen.findByTestId("hplan-manage-steps");
    await waitFor(() => expect(steps.querySelector("[data-step=partial]")!.textContent).toContain("100.852,5"));
    expect(steps.querySelector("[data-step=breakEven]")!.textContent).toContain("100.695,0");
    expect(steps.querySelector("[data-step=breakEven]")!.textContent).toContain("Stop von 100.065,0 auf 100.380,0");
    const partial = steps.querySelector("[data-step=partial]")!.textContent!;
    expect(partial).toContain("100.852,5");
    expect(partial).toContain("0,018 BTC");
    // Beispielrechnungen: Stop zuerst und Ziel – der Verlust am Stop ist der des Schritts 3 (17,21), nicht schöngerechnet
    await waitFor(() => expect(screen.getByTestId("hplan-manage-pnl-stop")).toHaveTextContent("−17,21 USDT"));
    expect(screen.getByTestId("hplan-manage-pnl-target")).toHaveTextContent("+");
    expect(screen.getByTestId("hplan-manage-scenarios").querySelectorAll("li").length).toBeGreaterThanOrEqual(4);
    expect(usePlanForm.getState().form.manage.breakEven.on).toBe(true);
    expect(usePlanForm.getState().form.manage.partial.on).toBe(true);
    // das Ticket trägt die Regeln als Anweisung an dich selbst
    await waitFor(() => expect(text("hplan-ticket-rows")).toContain("Verwaltung · Break-even"));
    expect(text("hplan-ticket-rows")).toContain("Verwaltung · Teilziel");
    expect(text("hplan-ticket-text")).toContain("die App ändert keine Order");
  });

  it("ein Break-even-Auslöser hinter dem Ziel wird als „greift nie“ gesagt, nicht stillschweigend gerechnet", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(check(/^Break-even/));
    const value = await screen.findByTestId("hplan-manage-be-value");
    fireEvent.change(value, { target: { value: "3" } });
    fireEvent.blur(value);
    await waitFor(() => expect(screen.getByTestId("hplan-manage-warnings")).toHaveTextContent("kommt nie zum Einsatz"));
    expect(screen.getByTestId("hplan-manage-steps").querySelector("[data-step=breakEven]")).toHaveAttribute("data-never", "true");
  });

  it("eine ungültige Eingabe wird nicht übernommen und gesagt", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(check(/^Teilziel/));
    const frac = await screen.findByTestId("hplan-manage-pa-frac");
    fireEvent.change(frac, { target: { value: "99" } });
    fireEvent.blur(frac);
    expect(await screen.findByText("Bitte eine Zahl von 5 bis 95.")).toBeInTheDocument();
    expect(usePlanForm.getState().form.manage.partial.fracPct).toBe(50);
  });

  it("Trailing in Prozent rechnet den Start und den ersten Stop; die Annahmen und Grenzen sind aufklappbar da", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(check(/^Trailing-Stop/));
    fireEvent.click(await screen.findByRole("radio", { name: "%" }));
    const steps = await screen.findByTestId("hplan-manage-steps");
    // Start +1R = 100.695; Abstand 3 % = 3.020,85; erster Stop 97.674,15 → auf den Kursschritt 0,1 AB = 97.674,1 – hinter dem bisherigen Stop 100.065
    await waitFor(() => expect(steps.querySelector("[data-step=trail]")!.textContent).toContain("100.695,0"));
    expect(steps.querySelector("[data-step=trail]")!.textContent).toContain("ändert noch nichts");
    const assumed = screen.getByTestId("hplan-manage-assumed");
    expect(assumed).toHaveTextContent("Annahmen und Grenzen");
    expect(assumed.textContent).toContain("Der Stop wird nur nachgezogen, nie gelockert.");
    expect(assumed.textContent).toContain("keine echte Order");
  });

  it("Plan → 4 Alarme: der Auslöser der Verwaltung wird eine dritte Schlüsselmarke – erst nach dem Klick, und mit dem Plan wieder weg", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    // ohne Verwaltung bleibt es bei drei Alarmen
    expect(await screen.findByTestId("hplan-alarms")).toHaveTextContent("Plan → 3 Alarme");
    fireEvent.click(check(/^Break-even/));
    await waitFor(() => expect(screen.getByTestId("hplan-alarms")).toHaveTextContent("Plan → 4 Alarme"));
    expect(screen.getByTestId("hplan-actions")).toHaveTextContent("einen beim Auslöser der Verwaltung (100.695,0)");
    expect(levels()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("hplan-alarms"));
    await waitFor(() => expect(levels()).toHaveLength(3));
    const trigger = levels().find((l) => l.name === "Plan-Verwaltung BTCUSDT")!;
    expect(trigger).toMatchObject({ price: 100_695, direction: "above", kind: "touch", tf: "30m", role: "info" });
    expect(trigger.alerts.on).toBe(true);
    const plan = plans()[0]!;
    expect(plan.manageTrigger).toBe(100_695);
    expect(plan.alarms!.triggerId).toBe(trigger.id);
    expect(plan.form.manage.breakEven.on).toBe(true);
    await waitFor(() => expect(screen.getByTestId("hplan-alarms-state")).toHaveTextContent("4 Alarme: Stop 100.065,0, Auslöser der Verwaltung 100.695,0 und Ziel 101.010,0 als Schlüsselmarken"));
    // Alarme entfernen nimmt alle drei Marken mit, der Plan bleibt
    fireEvent.click(screen.getByTestId("hplan-alarms-remove"));
    await waitFor(() => expect(levels()).toHaveLength(0));
    expect(plans()).toHaveLength(1);
    expect(plans()[0]!.alarms).toBeNull();
  });
});
