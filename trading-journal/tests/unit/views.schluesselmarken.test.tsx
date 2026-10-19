/**
 * Schlüsselmarken cards (F09 / F08 / F22) on the Markt page: the list with the fixed levels, the editor (add, edit,
 * duplicate, delete), status from real candles of a fake provider, timeframes that the feed cannot serve disabled WITH
 * the reason, the day plan, the honest alert note and the Zustellprotokoll.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET } from "@/domain/defaults";
import { KEY_TF_MS, keyLevelsOfSettings } from "@/domain/keylevels";
import type { Candle } from "@/market/types";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ p: null as unknown }));
vi.mock("@/market/marketStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/marketStore")>();
  return { ...actual, getProvider: () => fake.p };
});

const { KeyLevelsCard, PlanCard, AlertsCard } = await import("@/views/schluesselmarken");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { useUi } = await import("@/store/uiStore");
const { __resetKeyLevels } = await import("@/market/keylevels/store");
const { __resetDeliveryLog, recordDelivery } = await import("@/market/keylevels/deliveryLog");

const MS4 = KEY_TF_MS["4h"];
const NOW = Date.UTC(2026, 9, 18, 10, 30);
const T4 = Math.floor(NOW / MS4) * MS4;

const bar = (time: number, ms: number, close: number, closed: boolean): Candle => ({ time, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1, closed, closeTime: time + ms - 1 });
/** 14 closed 4h candles at `base`, then a closed one at `last`, then the forming candle. */
const h4 = (last: number): Candle[] => [...Array.from({ length: 14 }, (_, i) => bar(T4 - (16 - i) * MS4, MS4, 70_000, true)), bar(T4 - MS4, MS4, last, true), bar(T4, MS4, last, false)];

function install(feeds: Record<string, Candle[]>, price: number | null = 70_000): void {
  const stamped = (data: unknown) => ({ data, asOf: NOW, receivedAt: NOW, source: "binance", comparable: true });
  const sf = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, stamped(v)]));
  fake.p = {
    symbolInfo: { binance: "BTCUSDT" },
    serverNow: () => NOW,
    get: (f: string) => sf[f],
    snapshot: () => (price == null ? {} : { aggTrade: stamped({ price }) }),
    getHealth: () => ({ feeds: {} }),
  };
}

function withSettings(patch: Record<string, unknown>): void {
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, ...patch } as typeof s });
}

const ONLY_OWN = { ...DEFAULT_MARKET, longTrigger: 0, longStop: 0, shortTrigger: 0, invalidation: 0, lowerHigh: 0 };

function wrap(ui: React.ReactElement) {
  return render(<MotionRoot>{ui}</MotionRoot>);
}

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fake.p = null;
  localStorage.clear();
  await bootFixtureJournal();
  __resetKeyLevels();
  __resetDeliveryLog();
});
afterEach(() => {
  __resetKeyLevels();
  vi.useRealTimers();
});

const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("KeyLevelsCard", () => {
  it("lists the five fixed levels (read-only, from the settings) and offers an empty state for own ones", () => {
    install({ kline_4h: h4(70_000) });
    wrap(<KeyLevelsCard />);
    expect(screen.getByText("Noch keine eigene Schlüsselmarke.")).toBeInTheDocument();
    const fixed = within(screen.getByTestId("keylevel-fixed")).getAllByTestId("keylevel-row");
    expect(fixed.length).toBeGreaterThanOrEqual(1);
    expect(fixed[0]).toHaveAttribute("data-fixed", "1");
    // fixed levels link to the settings instead of an editor
    expect(within(fixed[0]!).getByRole("button", { name: "In Einstellungen ändern" })).toBeInTheDocument();
    expect(within(fixed[0]!).queryByRole("button", { name: "Bearbeiten" })).toBeNull();
  });

  it("adds a level: the price '80.000' is read as eighty thousand, the status comes from the 4h candles, it is stored in settings.keyLevels", async () => {
    withSettings({ market: ONLY_OWN });
    install({ kline_4h: h4(70_000) });
    wrap(<KeyLevelsCard />);
    await act(async () => fireEvent.click(screen.getByTestId("keylevel-add")));
    const editor = await screen.findByTestId("keylevel-editor");
    change(within(editor).getByLabelText("Name"), "BTC unter 80.000");
    change(within(editor).getByLabelText("Preis"), "80.000");
    expect(within(editor).getByText(/Erkannt als: 80\.000/)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(editor).getByRole("radio", { name: "unter dem Level" })));
    await act(async () => fireEvent.click(screen.getByTestId("keylevel-save")));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).levels).toHaveLength(1));
    const stored = keyLevelsOfSettings(useJournal.getState().settings).levels[0]!;
    expect(stored).toMatchObject({ name: "BTC unter 80.000", price: 80_000, tf: "4h", direction: "below", kind: "close", symbol: "BTCUSDT", since: NOW });
    // the closed 4h candle (70.000) is under 80.000, but the level exists only since NOW: no candle has closed after it yet
    const row = await screen.findByTestId("keylevel-row");
    await waitFor(() => expect(row).toHaveAttribute("data-status", "waiting"));
    expect(within(row).getByTestId("keylevel-reason")).toHaveTextContent("Zählt ab der nächsten vollständigen 4h-Kerze nach dem Anlegen.");
  });

  it("disables timeframes the feed cannot serve and names the reason – no silent substitute", async () => {
    install({ kline_4h: h4(70_000), kline_1h: [bar(T4 - 3_600_000, 3_600_000, 70_000, true)] });
    wrap(<KeyLevelsCard />);
    await act(async () => fireEvent.click(screen.getByTestId("keylevel-add")));
    const editor = await screen.findByTestId("keylevel-editor");
    expect(within(editor).getByRole("radio", { name: "4h" })).toBeEnabled();
    for (const tf of ["30m", "2h", "3h", "1D", "1W"]) expect(within(editor).getByRole("radio", { name: tf })).toBeDisabled();
    const reasons = within(editor).getByTestId("keylevel-tf-blocked");
    expect(reasons).toHaveTextContent("30m");
    expect(reasons).toHaveTextContent("15m-Kerzen werden geladen …");
    expect(reasons).toHaveTextContent("1D-Kerzen");
    // 1h has one candle: enough for 1h, not for 2h (two candles) or 3h (three)
    expect(within(editor).getByRole("radio", { name: "1h" })).toBeEnabled();
  });

  it("an invalid price is refused with a message and nothing is stored", async () => {
    withSettings({ market: ONLY_OWN });
    install({ kline_4h: h4(70_000) });
    wrap(<KeyLevelsCard />);
    await act(async () => fireEvent.click(screen.getByTestId("keylevel-add")));
    await act(async () => fireEvent.click(await screen.findByTestId("keylevel-save")));
    expect(await screen.findByText("Bitte einen Preis über 0 eingeben.")).toBeInTheDocument();
    expect(keyLevelsOfSettings(useJournal.getState().settings).levels).toHaveLength(0);
  });

  it("edit, duplicate and delete (with the inline question) work on an own level", async () => {
    withSettings({
      market: ONLY_OWN,
      keyLevels: { v: 1, levels: [{ id: "k_a", name: "Alt", symbol: "BTCUSDT", price: 90_000, tf: "4h", direction: "above", kind: "close" }] },
    });
    install({ kline_4h: h4(70_000) });
    wrap(<KeyLevelsCard />);
    const row = await screen.findByTestId("keylevel-row");
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Bearbeiten" })));
    const editor = await screen.findByTestId("keylevel-editor");
    change(within(editor).getByLabelText("Name"), "Neu");
    await act(async () => fireEvent.click(screen.getByTestId("keylevel-save")));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).levels[0]!.name).toBe("Neu"));

    await act(async () => fireEvent.click(within(await screen.findByTestId("keylevel-row")).getByRole("button", { name: "Duplizieren" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).levels).toHaveLength(2));
    expect(keyLevelsOfSettings(useJournal.getState().settings).levels[1]).toMatchObject({ name: "Neu (Kopie)", price: 90_000 });

    const rows = within(screen.getByTestId("keylevel-list")).getAllByTestId("keylevel-row");
    await act(async () => fireEvent.click(within(rows[0]!).getByRole("button", { name: "Neu löschen" })));
    expect(within(rows[0]!).getByText("Wirklich löschen?")).toBeInTheDocument();
    await act(async () => fireEvent.click(within(rows[0]!).getByTestId("keylevel-remove-yes")));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).levels.map((l) => l.name)).toEqual(["Neu (Kopie)"]));
  });

  it("a fixed level can be duplicated into an own level (values copied, the original untouched)", async () => {
    install({ kline_4h: h4(70_000) });
    const before = JSON.stringify(useJournal.getState().settings.market);
    wrap(<KeyLevelsCard />);
    const first = within(screen.getByTestId("keylevel-fixed")).getAllByTestId("keylevel-row")[0]!;
    await act(async () => fireEvent.click(within(first).getByRole("button", { name: "Duplizieren" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).levels).toHaveLength(1));
    expect(JSON.stringify(useJournal.getState().settings.market)).toBe(before);
  });

  it("the precedence rule is a visible setting and is saved", async () => {
    install({ kline_4h: h4(70_000) });
    wrap(<KeyLevelsCard />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Vorrang bei Widerspruch/ })));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: "Abwarten" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).precedence).toBe("wait"));
  });
});

describe("PlanCard", () => {
  it("shows range / long / short / wait with trigger, invalidation and what changes the plan", async () => {
    withSettings({
      market: ONLY_OWN,
      keyLevels: {
        v: 1,
        levels: [
          { id: "lo", name: "Unten", symbol: "BTCUSDT", price: 60_000, tf: "4h", direction: "below", kind: "close", since: 0 },
          { id: "hi", name: "Oben", symbol: "BTCUSDT", price: 80_000, tf: "4h", direction: "above", kind: "close", since: 0 },
        ],
      },
    });
    install({ kline_4h: h4(70_000) });
    wrap(<PlanCard />);
    await waitFor(() => expect(screen.getByTestId("plan-card")).toHaveAttribute("data-active", "range"));
    expect(screen.getByTestId("plan-headline")).toHaveTextContent("Range – kein Trigger");
    const scenarios = screen.getAllByTestId("plan-scenario");
    expect(scenarios.map((s) => s.getAttribute("data-key"))).toEqual(["range", "long", "short", "wait"]);
    expect(scenarios[0]).toHaveAttribute("aria-current", "true");
    const long = scenarios[1]!;
    expect(long).toHaveTextContent("4H-Schluss über 80.000");
    expect(long).toHaveTextContent("Was den Plan ändert");
    expect(long).toHaveTextContent("Wird aktiv bei: 4H-Schluss über 80.000.");
  });

  it("the plan-change switch is saved", async () => {
    install({ kline_4h: h4(70_000) });
    wrap(<PlanCard />);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Meldung bei Planwechsel" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).planToast).toBe(true));
  });
});

describe("AlertsCard", () => {
  it("says honestly that alerts only run while the app is open – and promises no server monitoring", () => {
    install({ kline_4h: h4(70_000) });
    wrap(<AlertsCard />);
    const note = screen.getByTestId("alerts-honest");
    expect(note).toHaveTextContent("nur, solange diese App in einem Browser-Tab geöffnet ist");
    expect(note).toHaveTextContent("es gibt keinen Server");
    expect(screen.queryByText(/rund um die Uhr|24\/7/i)).toBeNull();
  });

  it("shows the Zustellprotokoll with sent and held-back lines (with the reason) and clears it", async () => {
    install({ kline_4h: h4(70_000) });
    recordDelivery({ source: "key", levelId: "k1", title: "Bestätigt · A · BTCUSDT 4H", detail: "4h-Schluss über 80.000.", stage: "confirm", basis: "close", channels: ["toast"], outcome: "sent", dedupeKey: "k1|0|confirm" });
    recordDelivery({ source: "key", levelId: "k1", title: "Vorbereitung · A · BTCUSDT 4H", detail: "", stage: "prepare", basis: "intrabar", channels: [], outcome: "hours", dedupeKey: "k1|0|prepare" });
    recordDelivery({ source: "signal", levelId: null, title: "Starker Long-Einstieg", detail: "Score 80", stage: null, basis: null, channels: ["toast"], outcome: "sent", dedupeKey: "s" });
    wrap(<AlertsCard />);
    const rows = screen.getAllByTestId("delivery-row");
    expect(rows.map((r) => r.getAttribute("data-outcome"))).toEqual(["sent", "hours", "sent"]);
    expect(rows[1]).toHaveTextContent("unterdrückt – außerhalb der Aktivzeit");
    expect(rows[1]).toHaveTextContent("kein Kanal");
    expect(rows[0]).toHaveTextContent("Einstiegs-Check");
    expect(rows[2]).toHaveTextContent("Schluss");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Protokoll leeren" })));
    expect(screen.getByTestId("delivery-empty")).toBeInTheDocument();
    expect(useUi.getState().toasts.some((t) => t.title === "Protokoll geleert")).toBe(true);
  });

  it("channel and active-hours settings are written to settings.keyLevels.alerts", async () => {
    install({ kline_4h: h4(70_000) });
    wrap(<AlertsCard />);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Aktive Zeiten" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).alerts.hours.on).toBe(true));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Hinweis in der App (Toast)" })));
    await waitFor(() => expect(keyLevelsOfSettings(useJournal.getState().settings).alerts.channels.toast).toBe(false));
  });
});
