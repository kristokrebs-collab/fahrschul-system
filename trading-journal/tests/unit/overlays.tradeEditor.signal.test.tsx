import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MTF_SETUP_ID } from "@/domain/defaults";
import { DEFAULT_SIGNAL_CFG, type SignalSnap, type SignalSnapshot } from "@/domain/signals";
import type { Trade } from "@/domain/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeEditor, isFormDirty, mistakeOptions, timeframeOptions, usedOwnMistakes, withMtfAuto, defaultForm, type TradeRecord } from "@/overlays/TradeEditor";
import { SignalSummary, StrengthBars } from "@/overlays/SignalSummary";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";

/* ------------------------------------------------------------------ market mock */

const SNAP: SignalSnapshot = {
  at: "2026-10-07T10:00:00.000Z",
  side: "long",
  score: 72,
  strength: 2,
  tiers: 2,
  label: "Starker Long-Einstieg",
  valid: true,
  rsiOk: true,
  zoneOk: false,
  zone: "premium",
  deep: false,
  tfs: [
    { tf: "30m", kind: "bottom", wt: -55.2, rsi: 38.1, ok: true },
    { tf: "45m", kind: "buy", wt: -40, rsi: 41.2, ok: true },
    { tf: "1h", kind: null, wt: -10, rsi: 50 },
  ],
  v: 2,
  mode: "live",
  ladder: ["30m", "45m", "1h", "4h"],
  required: 2,
  zoneTf: "1h",
};

const live = vi.hoisted(() => ({ state: { state: "loading", snapshot: null as unknown, updatedAt: null as number | null, message: "Kerzen werden geladen …" as string | null } }));
const checkTradeAt = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const retroCheck = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({ status: "no-history", signals: null, symbol: "BTCUSDT", source: null, message: "Keine Kerzen für diesen Zeitpunkt." })));

vi.mock("@/market/signals", async (orig) => ({
  ...(await orig<typeof import("@/market/signals")>()),
  useSignalCheck: () => live.state,
  toTradeSnapshot: (_l: unknown, side: "long" | "short") => ({ ...SNAP, side }),
  checkTradeAt,
  retroCheck,
  getSignalConfig: () => DEFAULT_SIGNAL_CFG,
}));

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

function seed(editor: { open: boolean; tradeId?: string }, trades: Trade[] = SAMPLE) {
  saveTrade.mockClear();
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local", saveTrade });
  useUi.setState({ acc: "all", editor: { open: editor.open, tradeId: editor.tradeId, fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
}

function mount() {
  return render(
    <MotionRoot>
      <TradeEditor />
    </MotionRoot>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const fillValid = () => {
  type("Einstieg", "80000");
  type("Ausstieg", "81000");
  type("Größe (USDT)", "1000");
};

afterEach(() => {
  live.state = { state: "loading", snapshot: null, updatedAt: null, message: "Kerzen werden geladen …" };
  checkTradeAt.mockReset();
  checkTradeAt.mockImplementation(async () => null);
  retroCheck.mockClear();
});

/* ------------------------------------------------------------------ pure helpers */

describe("TradeEditor helpers (mistakes, s_mtf, dirty, timeframes)", () => {
  it("mistake chips: settings list, then own tags used elsewhere, then the trade's own; each once", () => {
    expect(mistakeOptions(["Kein Stop", "FOMO-Einstieg"], ["Zu müde", "Kein Stop"], ["Zu müde", "Überhebelt"])).toEqual(["Kein Stop", "FOMO-Einstieg", "Zu müde", "Überhebelt"]);
    const trades = [
      { date: "2026-01-01T10:00", mistakes: ["Kein Stop", "Alt"] },
      { date: "2026-02-01T10:00", mistakes: ["Neu", " "] },
    ] as Pick<Trade, "mistakes" | "date">[];
    // default tags are never "own" ones (a default removed from the settings stays removed)
    expect(usedOwnMistakes(trades)).toEqual(["Neu", "Alt"]);
  });

  it("s_mtf auto-ticks only while they apply; ids are `s_mtf:<item>`", () => {
    const auto = { mtf_base: true, mtf_next: true, mtf_third: false, mtf_rsi: true, mtf_zone: false };
    const base = { "g:x": true };
    expect(withMtfAuto(base, auto, false)).toBe(base);
    expect(withMtfAuto(base, null, true)).toBe(base);
    expect(withMtfAuto(base, auto, true)).toEqual({ "g:x": true, [`${MTF_SETUP_ID}:mtf_base`]: true, [`${MTF_SETUP_ID}:mtf_next`]: true, [`${MTF_SETUP_ID}:mtf_third`]: false, [`${MTF_SETUP_ID}:mtf_rsi`]: true, [`${MTF_SETUP_ID}:mtf_zone`]: false });
  });

  it("dirty: unchecked boxes and chip order are no change; any edit is", () => {
    const f = defaultForm(settings(), "scalp");
    expect(isFormDirty(f, f)).toBe(false);
    expect(isFormDirty({ d: f.d, t: { ...f.t, checks: { a: false } } }, f)).toBe(false);
    expect(isFormDirty({ d: f.d, t: { ...f.t, setups: ["b", "a"] } }, { d: f.d, t: { ...f.t, setups: ["a", "b"] } })).toBe(false);
    expect(isFormDirty({ d: { ...f.d, entry: "1" }, t: f.t }, f)).toBe(true);
    expect(isFormDirty({ d: f.d, t: { ...f.t, mistakes: ["Kein Stop"] } }, f)).toBe(true);
  });

  it("timeframes: 30m / 45m / 2h are offered; a stored value outside the list stays selectable", () => {
    const values = timeframeOptions("").map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(["30m", "45m", "2h"]));
    expect(timeframeOptions("3h").at(-1)).toEqual({ value: "3h", label: "3h" });
    expect(timeframeOptions("4h")).toBe(timeframeOptions(""));
  });
});

/* ------------------------------------------------------------------ signal views */

describe("SignalSummary / StrengthBars", () => {
  it("renders our snapshot: score, label, strength line, timeframe pills, zone and source", () => {
    render(<SignalSummary snap={SNAP} side="long" />);
    expect(screen.getByRole("img", { name: "Score 72 von 100" })).toBeInTheDocument();
    expect(screen.getByText("Starker Long-Einstieg")).toBeInTheDocument();
    expect(screen.getByText("Stark · 2 von 4 Timeframes")).toBeInTheDocument();
    const pills = within(screen.getByRole("list", { name: "Timeframes" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(pills).toEqual(["30m · Bottom · RSI 38,1", "45m · Kaufsignal · RSI 41,2", "1h · kein Signal · RSI 50,0", "Zone Premium"]);
    expect(screen.getByText(/^live beim Eintragen/)).toBeInTheDocument();
  });

  it("reads the other journal's snapshot shape (no ladder → 4 rungs) and labels a check of the other side", () => {
    const theirs: SignalSnap = { at: "2026-09-01T08:00:00.000Z", side: "short", score: 40, strength: 1, tiers: 2, label: "Short-Einstieg", valid: true, rsiOk: false, zoneOk: true, zone: "premium", tfs: [{ tf: "30m", kind: "top", wt: 60, rsi: 66 }] };
    render(<SignalSummary snap={theirs as SignalSnapshot} side="long" />);
    expect(screen.getByText("Einstieg · 2 von 4 Timeframes")).toBeInTheDocument();
    expect(screen.getByText(/^gespeichert ·/)).toBeInTheDocument();
    expect(screen.getByText("· geprüft für Short")).toBeInTheDocument();
  });

  it("strength bars name the strength; without a check they say so", () => {
    const { rerender } = render(<StrengthBars snap={SNAP} />);
    expect(screen.getByRole("img", { name: "Signal-Stärke 2 von 4 (Stark)" })).toBeInTheDocument();
    rerender(<StrengthBars snap={null} />);
    expect(screen.getByRole("img", { name: "Kein Einstiegs-Check gespeichert" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ editor integration */

describe("TradeEditor – Einstiegs-Check, Fehler, s_mtf, unsaved guard", () => {
  beforeEach(() => seed({ open: true }));

  it("new trade: the live check shows and is stored at save time (checkTradeAt with date + side)", async () => {
    live.state = { state: "ok", snapshot: {}, updatedAt: 1, message: null };
    checkTradeAt.mockImplementation(async () => ({ ...SNAP, side: "short" }));
    mount();
    expect(screen.getByRole("heading", { level: 3, name: /Einstiegs-Check zum Zeitpunkt/ })).toBeInTheDocument();
    expect(screen.getByTestId("signal-summary")).toHaveAttribute("data-strength", "2");
    fireEvent.click(screen.getByRole("radio", { name: "▼ Short" }));
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(checkTradeAt).toHaveBeenCalledWith(expect.any(Number), "short");
    expect(saveTrade.mock.calls[0]?.[0].signal).toMatchObject({ side: "short", strength: 2, mode: "live" });
  });

  it("no data / too little history: saved without a made-up snapshot", async () => {
    mount();
    expect(screen.getByTestId("signal-loading")).toHaveTextContent("Kerzen werden geladen …");
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).not.toHaveProperty("signal");
  });

  it("back-dated: the retro check loads, then says `Zu wenig Kursdaten …`", async () => {
    mount();
    type("Datum & Uhrzeit", "2026-03-02T10:00");
    expect(await screen.findByText("Kerzen für diesen Zeitpunkt werden geladen …")).toBeInTheDocument();
    expect(await screen.findByText("Zu wenig Kursdaten für diesen Zeitpunkt.", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(retroCheck).toHaveBeenCalledWith(new Date("2026-03-02T10:00").getTime());
  });

  it("s_mtf ticks itself from the snapshot (`· automatisch`) until the user touches one of its items", () => {
    live.state = { state: "ok", snapshot: {}, updatedAt: 1, message: null };
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Multi-TF Signal/ }));
    const base = screen.getByRole("checkbox", { name: /MCB-Signal auf der Basis-Timeframe/ });
    const third = screen.getByRole("checkbox", { name: /Dritte Timeframe bestätigt/ });
    expect(base).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Nächst höhere Timeframe bestätigt/ })).toHaveAttribute("aria-checked", "true");
    expect(third).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /RSI nahe überverkauft/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText(/· automatisch$/)).toHaveLength(5);
    fireEvent.click(third);
    expect(third).toHaveAttribute("aria-checked", "true");
    expect(base).toHaveAttribute("aria-checked", "true");
    expect(screen.queryAllByText(/· automatisch$/)).toHaveLength(0);
  });

  it("Fehler: chips from settings.mistakes toggle, an own tag is added and both are saved", async () => {
    mount();
    const group = screen.getByRole("group", { name: "Fehler-Tags" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([...(settings().mistakes ?? []), "+ Eigener Fehler"]);
    fireEvent.click(within(group).getByRole("button", { name: "Kein Stop" }));
    expect(within(group).getByRole("button", { name: "Kein Stop" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "+ Eigener Fehler" }));
    const own = within(group).getByLabelText("Eigener Fehler");
    fireEvent.change(own, { target: { value: "Zu müde" } });
    fireEvent.keyDown(own, { key: "Enter" });
    expect(within(group).getByRole("button", { name: "Zu müde" })).toHaveAttribute("aria-pressed", "true");
    // Escape in the field cancels it only – the sheet stays (and asks nothing)
    fireEvent.click(within(group).getByRole("button", { name: "+ Eigener Fehler" }));
    fireEvent.keyDown(within(group).getByLabelText("Eigener Fehler"), { key: "Escape" });
    expect(useUi.getState().editor.open).toBe(true);
    expect(screen.queryByTestId("discard-confirm")).toBeNull();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0].mistakes).toEqual(["Kein Stop", "Zu müde"]);
  });

  it("unsaved input is never discarded silently: Escape and `Abbrechen` ask, `Weiter bearbeiten` keeps it, `Verwerfen` closes", async () => {
    mount();
    type("Einstieg", "80000");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUi.getState().editor.open).toBe(true);
    expect(await screen.findByText("Änderungen verwerfen?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));
    await waitFor(() => expect(screen.queryByText("Änderungen verwerfen?")).toBeNull());
    expect(input("Einstieg").value).toBe("80000");
    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Verwerfen" }));
    expect(useUi.getState().editor.open).toBe(false);
    expect(saveTrade).not.toHaveBeenCalled();
  });
});

describe("TradeEditor – existing trade with a stored check", () => {
  const stored: SignalSnap = { at: "2026-01-05T09:00:00.000Z", side: "long", score: 55, strength: 1, tiers: 2, label: "Long-Einstieg", valid: true, rsiOk: true, zoneOk: false, zone: "equilibrium", tfs: [{ tf: "30m", kind: "bottom", wt: -50, rsi: 39 }] };
  const withSignal = () => SAMPLE.map((t) => (t.id === "A" ? ({ ...t, signal: stored, mistakes: ["Stop verschoben"], timeframe: "3h", legacy: 1 } as Trade) : t));

  it("shows it, keeps it on save (with mistakes, legacy fields, odd timeframe) and only re-checks on `Neu prüfen`", async () => {
    seed({ open: true, tradeId: "A" }, withSignal());
    mount();
    expect(screen.getByTestId("signal-summary")).toHaveAttribute("data-strength", "1");
    expect(screen.getByText("Long-Einstieg")).toBeInTheDocument();
    expect(screen.getByLabelText("Timeframe")).toHaveTextContent("3h");
    expect(within(screen.getByRole("group", { name: "Fehler-Tags" })).getByRole("button", { name: "Stop verschoben" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const rec = saveTrade.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(rec.signal).toEqual(stored);
    expect(rec).toMatchObject({ mistakes: ["Stop verschoben"], timeframe: "3h", legacy: 1 });
    expect(checkTradeAt).not.toHaveBeenCalled();
  });

  it("`Neu prüfen` replaces the stored check with the one for the trade's time", async () => {
    seed({ open: true, tradeId: "A" }, withSignal());
    checkTradeAt.mockImplementation(async () => ({ ...SNAP, mode: "retro", strength: 3 }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0].signal).toMatchObject({ mode: "retro", strength: 3 });
  });

  it("a trade without a check offers `Prüfen` and is not checked by itself", async () => {
    seed({ open: true, tradeId: "A" });
    mount();
    expect(screen.getByText("Für diesen Trade ist kein Einstiegs-Check gespeichert.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prüfen" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUi.getState().editor.open).toBe(false);
  });
});
