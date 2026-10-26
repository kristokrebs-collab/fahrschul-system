/**
 * Handelsplan · Ticket und Aktionen: kopieren (nichts wird gesendet), Plan speichern / öffnen / verwerfen (`settings.plan`),
 * „Plan → 3 Alarme“ (zwei Schlüsselmarken + die Erinnerung, erst nach dem Klick), „Plan ins Journal“ (ein Entwurf im Editor,
 * nichts wird gespeichert).
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { keyLevelsOfSettings } from "@/domain/keylevels";
import { planOfSettings } from "@/domain/plan";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { PLAN_OPEN_KEY, usePlanForm } from "@/views/plan/planStore";
import { PLAN_DAY } from "../e2e/mocks/planCandles";
import { mockState, renderPlan, setForm, setupPlanTests } from "./views.plan.harness";

vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
setupPlanTests();

const plans = () => planOfSettings(useJournal.getState().settings).plans;
const levels = () => keyLevelsOfSettings(useJournal.getState().settings).levels;

describe("Handelsplan · Ticket", () => {
  it("die Zeilen, der Text und die CSV; Kopieren sendet nichts und sagt das", async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    renderPlan();
    await screen.findByTestId("hplan-ticket-rows");
    expect(screen.getByTestId("hplan-ticket-rows")).toHaveTextContent("Richtung");
    expect(screen.getByTestId("hplan-ticket-rows")).toHaveTextContent("Größe0,037 BTC (Positionswert 3.714,06 USDT)");
    fireEvent.click(screen.getByTestId("hplan-copy-text"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const first = (write.mock.calls[0] as unknown as [string])[0];
    expect(first).toContain("HANDELSPLAN – Ticket zum Kopieren");
    expect(first).toContain("die App sendet nichts an eine Börse und platziert keine Order");
    fireEvent.click(screen.getByTestId("hplan-copy-csv"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect((write.mock.calls[1] as unknown as [string])[0]).toMatch(/^Symbol,Richtung,Einstieg,Stop,Ziel,Menge,/);
    expect(screen.getByTestId("hplan-ticket-text")).toHaveTextContent("Quelle: Binance USDⓈ-M · Kerzen bis ");
    // nirgends ein Weg, etwas zu senden
    expect(screen.queryByRole("button", { name: /senden|order|kaufen|verkaufen/i })).toBeNull();
  });
});

describe("Handelsplan · Plan speichern und verwerfen", () => {
  it("speichern → in settings.plan; „Öffnen“ holt die Annahmen zurück; Verwerfen entfernt ihn", async () => {
    renderPlan();
    fireEvent.click(await screen.findByTestId("hplan-save"));
    await waitFor(() => expect(plans()).toHaveLength(1));
    const p = plans()[0]!;
    expect(p).toMatchObject({ symbol: "BTCUSDT", side: "long", entry: 100380, stop: 100065, target: 101010, qty: 0.037, light: "green", tick: 0.1, lot: 0.001, sourceLabel: "Binance USDⓈ-M", alarms: null });
    expect(p.form).toMatchObject({ symbol: "BTCUSDT", day: PLAN_DAY });
    expect(p.candlesUntil).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("hplan-save")).toHaveTextContent("Plan gespeichert"));
    expect(screen.getByTestId("hplan-saved-state")).toHaveTextContent("Gespeichert am ");
    expect(screen.getByTestId(`hplan-saved-${p.id}`)).toHaveTextContent("Long BTCUSDT");
    expect(screen.getByTestId(`hplan-saved-${p.id}`)).toHaveTextContent("0,037 BTC");
    expect(screen.getByTestId(`hplan-saved-${p.id}`)).toHaveTextContent("Ampel Grün");
    expect(screen.getByTestId("hplan-saved-note")).toHaveTextContent("Quelle und Stand der Kerzen stehen bei jedem Plan.");

    // ein anderes Formular, dann „Öffnen“ holt die Annahmen des Plans zurück
    setForm({ symbol: "ETHUSDT" });
    usePlanForm.getState().setPlanId(null);
    await waitFor(() => expect(mockState.loads.at(-1)!.symbol).toBe("ETHUSDT"));
    fireEvent.click(screen.getByTestId(`hplan-open-${p.id}`));
    await waitFor(() => expect(usePlanForm.getState().form.symbol).toBe("BTCUSDT"));
    expect(usePlanForm.getState().planId).toBe(p.id);

    fireEvent.click(await screen.findByTestId("hplan-discard"));
    await waitFor(() => expect(plans()).toHaveLength(0));
    expect(screen.getByTestId("hplan-saved-empty")).toBeInTheDocument();
  });

  it("der geöffnete Plan wird pro Gerät gemerkt: nach dem Neuladen heißt der Knopf weiter „aktualisieren“, und ein gelöschter Plan gilt als keiner", async () => {
    renderPlan();
    fireEvent.click(await screen.findByTestId("hplan-save"));
    await waitFor(() => expect(plans()).toHaveLength(1));
    const id = plans()[0]!.id;
    expect(JSON.parse(localStorage.getItem(PLAN_OPEN_KEY) ?? "null")).toBe(id);
    // a new page load reads the id back
    usePlanForm.getState().setPlanId(null);
    expect(JSON.parse(localStorage.getItem(PLAN_OPEN_KEY) ?? "null")).toBeNull();
    usePlanForm.getState().setPlanId(id);
    await waitFor(() => expect(screen.getByTestId("hplan-save")).toHaveTextContent("Plan gespeichert"));
    // the plan is removed elsewhere: the page treats the id as "no saved plan" and offers to save again
    await useJournal.getState().saveSettings({ ...useJournal.getState().settings, plan: undefined });
    await waitFor(() => expect(screen.getByTestId("hplan-save")).toHaveTextContent("Plan speichern"));
  });

  it("ein geänderter Plan: „Plan aktualisieren“ übernimmt ihn, der Eintrag bleibt einer", async () => {
    renderPlan();
    fireEvent.click(await screen.findByTestId("hplan-save"));
    await waitFor(() => expect(plans()).toHaveLength(1));
    fireEvent.click(screen.getByRole("radio", { name: "3R" }));
    await waitFor(() => expect(screen.getByTestId("hplan-save")).toHaveTextContent("Plan aktualisieren"));
    expect(screen.getByTestId("hplan-saved-state")).toHaveTextContent("weicht davon ab");
    fireEvent.click(screen.getByTestId("hplan-save"));
    await waitFor(() => expect(plans()[0]!.target).toBe(101325)); // 100.380 + 3 × 315
    expect(plans()).toHaveLength(1);
  });

  it("Formular zurücksetzen (ohne gespeicherten Plan) behält Markt, Konto und Tag", async () => {
    renderPlan();
    setForm({ symbol: "ETHUSDT", account: "makro", leverage: 2 });
    fireEvent.click(await screen.findByTestId("hplan-discard"));
    await waitFor(() => expect(usePlanForm.getState().form).toMatchObject({ symbol: "ETHUSDT", account: "makro", leverage: 1, day: PLAN_DAY }));
  });
});

describe("Handelsplan · Plan → 3 Alarme und Plan ins Journal", () => {
  it("erst nach dem Klick: zwei Schlüsselmarken, „flat by“ als Erinnerung; Verwerfen nimmt die Marken wieder mit", async () => {
    renderPlan();
    const btn = await screen.findByTestId("hplan-alarms");
    // vor dem Klick ist nichts angelegt
    expect(levels()).toHaveLength(0);
    expect(screen.getByTestId("hplan-actions")).toHaveTextContent("legt an: einen Alarm beim Stop (100.065,0), einen beim Ziel (101.010,0) und die Erinnerung „flat by close“ um 15:55 Uhr");
    fireEvent.click(btn);
    await waitFor(() => expect(levels()).toHaveLength(2));
    const [stop, target] = levels();
    expect(stop).toMatchObject({ name: "Plan-Stop BTCUSDT", price: 100065, direction: "below", kind: "touch", tf: "30m", role: "info" });
    expect(stop!.alerts.on).toBe(true);
    expect(target).toMatchObject({ name: "Plan-Ziel BTCUSDT", price: 101010, direction: "above" });
    const plan = plans()[0]!;
    expect(plan.alarms).toMatchObject({ stopId: stop!.id, targetId: target!.id });
    // die Sitzung vom 19.10. ist vorbei: die Erinnerung war schon fällig und meldet sich nicht nachträglich
    expect(plan.alarms!.flatBy).toMatchObject({ at: plan.flatByMs, state: "missed" });
    await waitFor(() => expect(screen.getByTestId("hplan-alarms-state")).toHaveTextContent("3 Alarme: Stop 100.065,0 und Ziel 101.010,0 als Schlüsselmarken"));
    expect(screen.getByTestId("hplan-alarms-state")).toHaveTextContent("war schon vorbei");
    expect(screen.getByTestId("hplan-past-note")).toHaveTextContent("Rückblick");
    expect(screen.getByTestId("hplan-alarms-remove")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("hplan-discard"));
    await waitFor(() => expect(plans()).toHaveLength(0));
    expect(levels()).toHaveLength(0);
  });

  it("Alarme wieder entfernen: der Plan bleibt, die Marken gehen", async () => {
    renderPlan();
    fireEvent.click(await screen.findByTestId("hplan-alarms"));
    fireEvent.click(await screen.findByTestId("hplan-alarms-remove"));
    await waitFor(() => expect(levels()).toHaveLength(0));
    expect(plans()).toHaveLength(1);
    expect(plans()[0]!.alarms).toBeNull();
  });

  it("die Marken-Alarme gelten nur für das Symbol des Live-Markts – und die Seite sagt es", async () => {
    renderPlan();
    setForm({ symbol: "ETHUSDT" });
    expect(await screen.findByTestId("hplan-alarm-symbol")).toHaveTextContent("Dein Live-Markt zeigt BTCUSDT. Die Marken-Alarme für ETHUSDT werden erst bewertet");
  });

  it("Plan ins Journal: der Trade-Editor öffnet mit einem Entwurf – gespeichert wird nichts", async () => {
    renderPlan();
    const before = useJournal.getState().trades.length;
    fireEvent.click(await screen.findByTestId("hplan-journal"));
    const ed = useUi.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.draft).toMatchObject({ account: "scalp", side: "long", status: "open", pair: "BTC/USDT", entry: 100380, stop: 100065, target: 101010, qty: 0.037, size: 3714.06, leverage: 1 });
    expect(ed.draft?.notes).toContain("Einstieg und Größe sind geplant, nicht ausgeführt.");
    expect(useJournal.getState().trades).toHaveLength(before);
    expect(plans()).toHaveLength(0); // ein Entwurf speichert auch den Plan nicht
  });
});
