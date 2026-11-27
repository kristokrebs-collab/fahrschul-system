/**
 * Der Link in den Handelsplan über den Router: `#plan?symbol=AAPL&side=long` füllt Markt und Richtung vor – im Speicher, nichts wird
 * geschrieben –, die Adresse zeigt den Link nur, solange das Formular ihm noch entspricht, und Ungültiges wird übergangen und gesagt.
 * Andere Hash-Routen bleiben, wie sie waren.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORM } from "@/domain/plan";
import { ensureSeam, installRouter, navigate, resetSeamsForTests, useShareRoute } from "@/store/router";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_FILTER, useUi } from "@/store/uiStore";
import { DEFAULT_DIM, useAnalyseUi } from "@/views/analyse/analyseStore";
import { usePlanLink } from "@/views/plan/linkStore";
import { PLAN_FORM_KEY, PLAN_OPEN_KEY, usePlanForm } from "@/views/plan/planStore";

const reset = () => {
  vi.useRealTimers();
  resetSeamsForTests();
  localStorage.clear();
  useShareRoute.setState({ token: null });
  useAnalyseUi.setState({ dim: DEFAULT_DIM });
  usePlanForm.setState({ form: { ...DEFAULT_FORM }, restored: true, planId: null });
  usePlanLink.setState({ notice: null, active: null });
  history.replaceState(null, "", "#overview");
  useUi.setState({ page: "overview", tradeFilter: DEFAULT_TRADE_FILTER });
};

describe("#plan?symbol=…&side=… (Router, Naht der Plan-Seite)", () => {
  let uninstall: (() => void) | null = null;
  beforeEach(reset);
  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("ein Kaltstart mit dem Link: Aktie und Richtung sind vorgefüllt, nichts ist gespeichert, die Adresse zeigt den Link", async () => {
    history.replaceState(null, "", "#plan?symbol=AAPL&side=long");
    const settingsBefore = useJournal.getState().settings;
    uninstall = installRouter();
    expect(useUi.getState().page).toBe("plan");
    // solange die Naht lädt, bleibt der Link in der Adresse
    expect(location.hash).toBe("#plan?symbol=AAPL&side=long");
    await ensureSeam("plan");
    expect(usePlanForm.getState().form).toMatchObject({ symbol: "AAPL", session: "usstocks", sides: "long", manualSide: "long", day: null, manualEntry: null });
    expect(usePlanForm.getState().restored).toBe(true);
    expect(location.hash).toBe("#plan?symbol=AAPL&side=long");
    expect(usePlanLink.getState().notice).toMatchObject({ applied: ["Markt AAPL (US-Aktie)", "Sitzung US-Börse (9:30 New York)", "Richtung Long"], ignored: [] });
    // gespeichert wurde nichts: weder das Formular dieses Geräts noch der Plan-Zeiger noch die Einstellungen
    expect(localStorage.getItem(PLAN_FORM_KEY)).toBeNull();
    expect(localStorage.getItem(PLAN_OPEN_KEY)).toBeNull();
    expect(useJournal.getState().settings).toBe(settingsBefore);
  });

  it("ändert die Person das Kürzel, verschwindet der Link aus der Adresse – ein Neuladen bringt nicht zurück, was sie verlassen hat", async () => {
    history.replaceState(null, "", "#plan?symbol=AAPL&side=long");
    uninstall = installRouter();
    await ensureSeam("plan");
    expect(location.hash).toBe("#plan?symbol=AAPL&side=long");
    usePlanForm.getState().set({ symbol: "MSFT" });
    expect(location.hash).toBe("#plan");
    // jetzt schreibt das Formular des Geräts (eine Änderung der Person, wie jede andere)
    expect(JSON.parse(localStorage.getItem(PLAN_FORM_KEY)!)).toMatchObject({ symbol: "MSFT", session: "usstocks" });
  });

  it("ändert die Person die Richtung, geht der Link ebenfalls", async () => {
    history.replaceState(null, "", "#plan?symbol=AAPL&side=short");
    uninstall = installRouter();
    await ensureSeam("plan");
    expect(usePlanForm.getState().form.sides).toBe("short");
    expect(location.hash).toBe("#plan?symbol=AAPL&side=short");
    usePlanForm.getState().set({ sides: "both" });
    expect(location.hash).toBe("#plan");
  });

  it("von der Seite Aktien aus: der Hash wechselt, die Plan-Seite öffnet vorgefüllt (Krypto-Paar wie Aktie)", async () => {
    history.replaceState(null, "", "#aktien");
    uninstall = installRouter();
    expect(useUi.getState().page).toBe("aktien");
    await ensureSeam("plan");
    history.replaceState(null, "", "#plan?symbol=ETHUSDT&side=short");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(useUi.getState().page).toBe("plan");
    expect(usePlanForm.getState().form).toMatchObject({ symbol: "ETHUSDT", session: "newyork", sides: "short", manualSide: "short" });
    history.replaceState(null, "", "#plan?symbol=BRK.B&side=long");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(usePlanForm.getState().form).toMatchObject({ symbol: "BRK.B", session: "usstocks", sides: "long" });
  });

  it("Ungültiges wird übergangen und gesagt, das Formular bleibt – ein halber Link füllt, was verständlich ist", async () => {
    usePlanForm.getState().set({ symbol: "SOLUSDT" });
    history.replaceState(null, "", "#plan?symbol=%40%40&side=sideways&x=1");
    uninstall = installRouter();
    await ensureSeam("plan");
    expect(usePlanForm.getState().form).toMatchObject({ symbol: "SOLUSDT", sides: "both" });
    const n = usePlanLink.getState().notice!;
    expect(n.applied).toEqual([]);
    expect(n.ignored).toHaveLength(3);
    expect(n.ignored.join(" ")).toContain("Das Kürzel „@@“");
    expect(n.ignored.join(" ")).toContain("Die Richtung „sideways“");
    expect(n.ignored.join(" ")).toContain("„x“ im Link kennt der Handelsplan nicht");
    expect(location.hash).toBe("#plan");

    history.replaceState(null, "", "#plan?symbol=MSFT&side=sideways");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(usePlanForm.getState().form.symbol).toBe("MSFT");
    expect(usePlanLink.getState().notice).toMatchObject({ applied: expect.arrayContaining(["Markt MSFT (US-Aktie)"]), ignored: [expect.stringContaining("sideways")] });
  });

  it("der Weg über das Menü (#plan ohne Anfrage) lässt das Formular, wie es ist, und zeigt keinen Hinweis", async () => {
    usePlanForm.getState().set({ symbol: "SOLUSDT" });
    uninstall = installRouter();
    navigate("plan");
    await ensureSeam("plan");
    expect(location.hash).toBe("#plan");
    expect(usePlanForm.getState().form.symbol).toBe("SOLUSDT");
    expect(usePlanLink.getState().notice).toBeNull();
  });

  it("ein offener, gespeicherter Plan ist nach dem Link nicht mehr 'der offene' – bis die Person etwas ändert, wird nichts geschrieben", async () => {
    localStorage.setItem(PLAN_OPEN_KEY, JSON.stringify("p_alt"));
    usePlanForm.setState({ planId: "p_alt" });
    history.replaceState(null, "", "#plan?symbol=MSFT");
    uninstall = installRouter();
    await ensureSeam("plan");
    expect(usePlanForm.getState().planId).toBeNull();
    expect(localStorage.getItem(PLAN_OPEN_KEY)).toBe(JSON.stringify("p_alt")); // noch nichts geschrieben
    usePlanForm.getState().set({ tf: "15m" });
    expect(localStorage.getItem(PLAN_OPEN_KEY)).toBe("null"); // die erste echte Änderung löst den Zeiger – ein Neuladen koppelt das neue Formular nicht an den alten Plan
  });

  it("andere Hash-Routen bleiben unberührt: #analyse?dim= funktioniert mit geladener Plan-Naht, #aktien?symbol= verliert seine Anfrage wie bisher", async () => {
    uninstall = installRouter();
    await ensureSeam("plan");
    history.replaceState(null, "", "#analyse?dim=weekday");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await ensureSeam("analyse");
    expect(useUi.getState().page).toBe("analyse");
    expect(useAnalyseUi.getState().dim).toBe("weekday");
    expect(usePlanLink.getState().notice).toBeNull();
    history.replaceState(null, "", "#aktien?symbol=AAPL");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(useUi.getState().page).toBe("aktien");
    expect(usePlanForm.getState().form.symbol).toBe(DEFAULT_FORM.symbol);
  });
});
