/**
 * Handelsplan · Aktien auf der Seite: die US-Börse ist wählbar und bringt ihr Kürzel mit, die Kerzen kommen aus der Aktien-Quelle
 * (hier nachgebaut), ganze Stück in Dollar ohne Hebel, der Link `#plan?symbol=…&side=…` füllt vor und sagt, was er übergeht, die
 * Verzögerung der Quelle und jeder Ausfall stehen da, und die Aktionen des Tickets passen zu Aktien (Erinnerung statt Marken-Alarme).
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keyLevelsOfSettings } from "@/domain/keylevels";
import { planOfSettings } from "@/domain/plan";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { applyPlanLink, usePlanLink } from "@/views/plan/linkStore";
import { usePlanForm } from "@/views/plan/planStore";
import { stockOpen } from "../e2e/mocks/planStockCandles";
import { renderPlan, setForm, setupPlanTests, text } from "./views.plan.harness";
import { resetStockState, stockState } from "./views.plan.stock.mock";

vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
vi.mock("@/market/plan/stockCandles", async () => (await import("./views.plan.stock.mock")).stockCandlesMock());
setupPlanTests();

const plans = () => planOfSettings(useJournal.getState().settings).plans;
const levels = () => keyLevelsOfSettings(useJournal.getState().settings).levels;

beforeEach(() => {
  resetStockState();
  usePlanLink.setState({ notice: null, active: null });
});

/** the page on the US session with AAPL, the latest session */
const stockForm = (over: Record<string, unknown> = {}) => setForm({ symbol: "AAPL", session: "usstocks", day: null, ...over });

describe("Handelsplan · Aktien: die US-Börse wählen", () => {
  it("die Sitzung ist wählbar, nimmt ein Aktienkürzel mit und lädt die Kerzen aus der Aktien-Quelle – die ganze Rechnung in Stück und Dollar", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "US-Börse (9:30 New York)" }));
    await waitFor(() => expect(usePlanForm.getState().form).toMatchObject({ symbol: "AAPL", session: "usstocks", day: null, manualEntry: null }));
    await waitFor(() => expect(stockState.loads.at(-1)).toMatchObject({ symbol: "AAPL", interval: "5m" }));

    // 1 Einstieg
    await waitFor(() => expect(text("hplan-entry-headline")).toBe("Signal Long: Schluss 185,90 um 09:55 Uhr über dem Hoch der Range."));
    expect(screen.getByTestId("hplan-range")).toHaveTextContent("185,60");
    expect(screen.getByTestId("hplan-range")).toHaveTextContent("184,50");
    expect(screen.getByTestId("hplan-stocks-note")).toHaveTextContent("Yahoo Finance (inoffiziell, ohne Garantie, möglicherweise verzögert)");
    expect(screen.getByTestId("hplan-stocks-note")).toHaveTextContent("rund vier Wochen");
    expect(screen.getByTestId("hplan-entry-note")).toHaveTextContent("Quelle: Yahoo Finance (inoffiziell) · Kerzen bis ");
    expect(screen.getByTestId("hplan-entry-assumed")).toHaveTextContent("Die Kerzen kommen von Yahoo Finance über einen Server der App");
    // 2 Ausstieg
    expect(screen.getByTestId("hplan-stop")).toHaveTextContent("185,05");
    expect(screen.getByTestId("hplan-target")).toHaveTextContent("187,60");
    // 3 Größe: 20 Stück, Dollar, keine Nachkommastellen, kein Hebel
    expect(screen.getByTestId("hplan-qty")).toHaveTextContent(/^20$/);
    expect(screen.getByTestId("hplan-size-kpis")).toHaveTextContent("Stück");
    expect(screen.getByTestId("hplan-maxloss")).toHaveTextContent("22,56 USD");
    expect(screen.getByTestId("hplan-binding")).toHaveTextContent("Der Deckel für den Positionswert bindet (3.750,00 USD)");
    expect(screen.getByTestId("hplan-limit-position")).toHaveTextContent("20 Stück");
    expect(screen.getByTestId("hplan-no-leverage")).toHaveTextContent("1× – nur eigenes Geld");
    expect(screen.queryByRole("radiogroup", { name: "Hebel" })).toBeNull();
    expect(screen.getByTestId("hplan-size-more")).toHaveTextContent("Aktien gibt es in ganzen Stück (1)");
    // 4 Risiko, 5 Ticket
    expect(screen.getByTestId("hplan-ampel")).toHaveAttribute("data-light", "green");
    expect(screen.getByTestId("hplan-risk-lines")).not.toHaveTextContent("Liquidation");
    expect(screen.getByTestId("hplan-ticket-rows")).toHaveTextContent("Größe20 Stück (Positionswert 3.718,00 USD)");
    expect(screen.getByTestId("hplan-ticket-text")).toHaveTextContent("Quelle: Yahoo Finance (inoffiziell)");
    expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "5");
    // jede Karte endet mit dem Satz
    expect(screen.getByTestId("hplan-ticket-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
    // der Markt-Abschnitt spricht jetzt von Aktien
    expect(screen.getByRole("radio", { name: "AAPL" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "BTCUSDT" })).toBeNull();
  });

  it("zurück zu einer Krypto-Sitzung: das Krypto-Symbol des Live-Markts kommt zurück", async () => {
    renderPlan();
    stockForm();
    await screen.findByTestId("hplan-stocks-note");
    fireEvent.click(screen.getByRole("radio", { name: "New York (9:30)" }));
    await waitFor(() => expect(usePlanForm.getState().form).toMatchObject({ symbol: "BTCUSDT", session: "newyork" }));
    expect(screen.queryByTestId("hplan-stocks-note")).toBeNull();
  });

  it("die erste Aktie der Watchlist wird das Kürzel beim Wechsel (statt eines Beispiels)", async () => {
    const s = useJournal.getState().settings;
    await useJournal.getState().saveSettings({ ...s, watchlist: { v: 1, items: [{ id: "stock:MSFT", kind: "stock", symbol: "MSFT", name: "Microsoft", addedAt: 1, note: "" }] } });
    renderPlan();
    await screen.findByTestId("hplan-stop");
    fireEvent.click(screen.getByRole("radio", { name: "US-Börse (9:30 New York)" }));
    await waitFor(() => expect(usePlanForm.getState().form.symbol).toBe("MSFT"));
    expect(await screen.findByRole("radio", { name: "MSFT" })).toBeInTheDocument();
  });

  it("ein eigenes Kürzel: US-Form wird übernommen und lädt neu, ein Krypto-Paar wird abgewiesen und gesagt", async () => {
    renderPlan();
    stockForm();
    await screen.findByTestId("hplan-stocks-note");
    const input = screen.getByTestId("hplan-symbol-input");
    fireEvent.change(input, { target: { value: "btcusdt" } });
    fireEvent.click(screen.getByTestId("hplan-symbol-add"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ein US-Kürzel besteht aus ein bis fünf Buchstaben, zum Beispiel AAPL oder BRK.B.");
    fireEvent.change(input, { target: { value: "brk.b" } });
    fireEvent.click(screen.getByTestId("hplan-symbol-add"));
    await waitFor(() => expect(stockState.loads.at(-1)!.symbol).toBe("BRK.B"));
    expect(usePlanForm.getState().form.symbol).toBe("BRK.B");
  });

  it("1-Stunden-Kerzen passen nicht zum Beginn um 9:30 und sind gesperrt, 30 Minuten gehen (aus 15-Minuten-Kerzen)", async () => {
    renderPlan();
    stockForm();
    await screen.findByTestId("hplan-stocks-note");
    expect(screen.getByRole("radio", { name: "1 Stunde" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "30 Minuten" }));
    await waitFor(() => expect(stockState.loads.at(-1)).toMatchObject({ symbol: "AAPL", interval: "30m" }));
  });
});

describe("Handelsplan · Aktien: der Link (#plan?symbol=…&side=…)", () => {
  it("füllt Markt und Richtung vor und sagt es – ohne etwas zu speichern", async () => {
    applyPlanLink("symbol=MSFT&side=short");
    renderPlan();
    expect(usePlanForm.getState().form).toMatchObject({ symbol: "MSFT", session: "usstocks", sides: "short", manualSide: "short" });
    expect(await screen.findByTestId("hplan-link-applied")).toHaveTextContent("Aus dem Link übernommen: Markt MSFT (US-Aktie) · Sitzung US-Börse (9:30 New York) · Richtung Short. Es wurde nichts gespeichert und nichts gesendet.");
    expect(screen.queryByTestId("hplan-link-ignored")).toBeNull();
    await waitFor(() => expect(stockState.loads.at(-1)).toMatchObject({ symbol: "MSFT" }));
    expect(plans()).toHaveLength(0);
    expect(levels()).toHaveLength(0);
    // der Hinweis lässt sich schließen
    fireEvent.click(screen.getByTestId("hplan-link-close"));
    expect(screen.queryByTestId("hplan-link")).toBeNull();
  });

  it("Ungültiges wird übergangen und gesagt; das Gültige gilt", async () => {
    applyPlanLink("symbol=%40%40%40&side=long");
    renderPlan();
    expect(await screen.findByTestId("hplan-link-applied")).toHaveTextContent("Richtung Long");
    expect(screen.getByTestId("hplan-link-ignored")).toHaveTextContent("Das Kürzel „@@@“ aus dem Link ist weder eine US-Aktie");
    expect(usePlanForm.getState().form.symbol).toBe("BTCUSDT"); // der Markt bleibt, wie er war
    expect(usePlanForm.getState().form.sides).toBe("long");
  });

  it("ein Link, der nichts Verständliches enthält: der Hinweis sagt, dass nichts verändert wurde", async () => {
    applyPlanLink("side=up");
    renderPlan();
    expect(await screen.findByTestId("hplan-link-applied")).toHaveTextContent("Der Link enthielt nichts, was der Handelsplan übernehmen konnte. Es wurde nichts verändert.");
    expect(screen.getByTestId("hplan-link-ignored")).toHaveTextContent("Die Richtung „up“");
  });

  it("ohne Link kein Hinweis", async () => {
    renderPlan();
    await screen.findByTestId("hplan-stop");
    expect(screen.queryByTestId("hplan-link")).toBeNull();
  });
});

describe("Handelsplan · Aktien: die Quelle", () => {
  it("fällt die Quelle aus, steht der Grund da, der Schritt ist gesperrt – und „Neu laden“ fragt die Quelle noch einmal (frisch)", async () => {
    stockState.failWith = "Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe dieses Servers. Sie ist inoffiziell und kann ohne Vorwarnung sperren.";
    renderPlan();
    stockForm();
    expect(await screen.findByTestId("hplan-entry-headline")).toHaveTextContent("Keine Kerzen geladen: Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe dieses Servers.");
    expect(screen.getByTestId("hplan-entry-state")).toHaveAttribute("data-status", "blocked");
    expect(screen.getByTestId("hplan-exit-headline")).toHaveTextContent("Wartet auf Schritt 1");
    expect(screen.getByTestId("hplan-candle-state")).toHaveTextContent("Es wird nichts geschätzt.");
    expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "0");

    stockState.failWith = null;
    fireEvent.click(screen.getByTestId("hplan-reload"));
    await waitFor(() => expect(screen.getByTestId("hplan-progress")).toHaveAttribute("data-done", "5"));
    expect(stockState.loads.at(-1)).toMatchObject({ fresh: true });
    expect(stockState.loads[0]!.fresh).toBeUndefined();
  });

  it("ein alter Stand aus dem Zwischenspeicher wird als solcher gesagt (nicht aktuell), mit dem Grund", async () => {
    stockState.override = () => ({
      candles: [],
      source: "yahoo",
      fetchedAt: Date.now() - 3_600_000,
      fromCache: true,
      error: "Yahoo Finance (inoffiziell): Die Quelle oder der Server begrenzt die Abrufe gerade. Bitte in einigen Minuten erneut versuchen.",
      sourceLabel: "Yahoo Finance (inoffiziell)",
      notes: [],
      marketTime: null,
    });
    renderPlan();
    stockForm();
    // keine Kerzen im Stand: der Schritt zeigt den Grund
    expect(await screen.findByTestId("hplan-entry-headline")).toHaveTextContent("begrenzt die Abrufe gerade");
  });

  it("ein Tag außerhalb dessen, was die Quelle liefert: der Grund der Quelle steht im Schritt", async () => {
    stockState.failWith = "Yahoo Finance liefert 5-Minuten-Kerzen nur für die letzten rund vier Wochen; der Fr 02.10. liegt 23 Tage zurück. Wähle einen jüngeren Tag.";
    renderPlan();
    stockForm({ day: "2026-10-02" });
    expect(await screen.findByTestId("hplan-entry-headline")).toHaveTextContent("nur für die letzten rund vier Wochen");
  });

  it("die laufende Sitzung: hängen die Daten hinterher, steht es da – mit der Uhrzeit der neuesten Kerze", async () => {
    const day = "2026-10-26"; // Monday
    const open = stockOpen(day);
    vi.setSystemTime(open + 68 * 60_000); // 10:38 New York
    stockState.count = 12; // Kerzen 0–11: die letzte schloss um 10:30, die von 10:35 fehlt
    stockState.marketTime = open + 66 * 60_000;
    renderPlan();
    stockForm();
    const lag = await screen.findByTestId("hplan-feed-lag");
    expect(lag).toHaveAttribute("data-late", "true");
    expect(lag).toHaveTextContent("Die neueste geschlossene Kerze schloss um 10:30 Uhr (vor 8 Minuten); nach der Uhr wäre die von 10:35 Uhr fällig – die Daten hängen hinterher.");
    expect(screen.getByTestId("hplan-candle-state")).toHaveTextContent("Live: die Kerzen werden alle 30 Sekunden nachgeladen.");
  });

  it("die laufende Sitzung, gesund: nur die Zeit der neuesten Kerze, keine Warnung", async () => {
    const open = stockOpen("2026-10-26");
    vi.setSystemTime(open + 62 * 60_000); // 10:32
    stockState.count = 13; // Kerzen 0–12: die von 10:30 läuft
    renderPlan();
    stockForm();
    const lag = await screen.findByTestId("hplan-feed-lag");
    expect(lag).toHaveAttribute("data-late", "false");
    expect(lag).toHaveTextContent("Die neueste geschlossene Kerze schloss um 10:30 Uhr (vor 2 Minuten).");
  });

  it("ein Rückblick hat keine Verzögerungszeile", async () => {
    renderPlan();
    stockForm();
    await screen.findByTestId("hplan-stop");
    expect(screen.queryByTestId("hplan-feed-lag")).toBeNull();
    expect(screen.getByTestId("hplan-candle-state")).toHaveTextContent("Rückblick: die Sitzung ist vorbei");
  });
});

describe("Handelsplan · Aktien: Aktionen", () => {
  it("statt „Plan → 3 Alarme“ gibt es die Erinnerung „flat by close“ – es entstehen keine Schlüsselmarken", async () => {
    renderPlan();
    stockForm();
    const btn = await screen.findByTestId("hplan-alarms");
    expect(btn).toHaveTextContent("Erinnerung „flat by close“");
    expect(screen.getByTestId("hplan-alarms-stocks")).toHaveTextContent("Preis-Alarme für Stop und Ziel gibt es für Aktien noch nicht");
    expect(screen.getByTestId("hplan-actions")).not.toHaveTextContent("legt an: einen Alarm beim Stop");
    expect(screen.queryByTestId("hplan-alarm-symbol")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(plans()).toHaveLength(1));
    expect(levels()).toHaveLength(0);
    const plan = plans()[0]!;
    expect(plan).toMatchObject({ symbol: "AAPL", qty: 20, tick: 0.01, lot: 1, currency: "USD", sourceLabel: "Yahoo Finance (inoffiziell)", alarms: { stopId: "", targetId: "" } });
    expect(plan.form).toMatchObject({ symbol: "AAPL", session: "usstocks" });
    await waitFor(() => expect(screen.getByTestId("hplan-alarms-state")).toHaveTextContent("Erinnerung: „flat by close“ um 15:55 Uhr – war schon vorbei"));
    expect(screen.getByTestId(`hplan-saved-${plan.id}`)).toHaveTextContent("20 Stück");
    expect(screen.getByTestId(`hplan-saved-${plan.id}`)).toHaveTextContent("Erinnerung flat by 15:55 Uhr");
    expect(screen.getByTestId(`hplan-saved-${plan.id}`)).toHaveTextContent("höchstens 22,56 USD Verlust");
    // entfernen: die Erinnerung geht, der Plan bleibt
    fireEvent.click(screen.getByTestId("hplan-alarms-remove"));
    await waitFor(() => expect(plans()[0]!.alarms).toBeNull());
    expect(levels()).toHaveLength(0);
  });

  it("Plan ins Journal: ein offener Entwurf für AAPL – kein Paar, keine Funding-Perpetual, nichts gespeichert", async () => {
    renderPlan();
    stockForm();
    const before = useJournal.getState().trades.length;
    fireEvent.click(await screen.findByTestId("hplan-journal"));
    const ed = useUi.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.draft).toMatchObject({ account: "scalp", side: "long", status: "open", pair: "AAPL", market: "spot", entry: 185.9, stop: 185.05, target: 187.6, qty: 20, size: 3718, leverage: 1 });
    expect(ed.draft?.notes).toContain("Einstieg und Größe sind geplant, nicht ausgeführt.");
    expect(useJournal.getState().trades).toHaveLength(before);
    expect(plans()).toHaveLength(0);
  });

  it("ein Plan, den ein Wechsel zur Krypto-Sitzung überholt, bleibt gespeichert und öffnet sich mit seinen Annahmen wieder", async () => {
    renderPlan();
    stockForm();
    fireEvent.click(await screen.findByTestId("hplan-save"));
    await waitFor(() => expect(plans()).toHaveLength(1));
    const id = plans()[0]!.id;
    act(() => setForm({ symbol: "BTCUSDT", session: "newyork", day: "2026-10-19" }));
    await waitFor(() => expect(usePlanForm.getState().form.session).toBe("newyork"));
    fireEvent.click(screen.getByTestId(`hplan-open-${id}`));
    await waitFor(() => expect(usePlanForm.getState().form).toMatchObject({ symbol: "AAPL", session: "usstocks" }));
    await waitFor(() => expect(screen.getByTestId("hplan-stocks-note")).toBeInTheDocument());
  });
});
