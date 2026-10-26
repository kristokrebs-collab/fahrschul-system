/**
 * Trade editor save path (zero data loss): `Speichern` first resolves the Einstiegs-Check for the trade's time (a
 * back-dated trade waits for the history check, up to 3 s) and only then writes. Whatever the user types meanwhile
 * must not vanish when the sheet closes — the write takes the form as it stands at that moment.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_CFG, type SignalSnapshot } from "@/domain/signals";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeEditor, type TradeRecord } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";

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
  tfs: [{ tf: "30m", kind: "bottom", wt: -55.2, rsi: 38.1, ok: true }],
  v: 2,
  mode: "retro",
  ladder: ["30m", "45m", "1h", "4h"],
  required: 2,
  zoneTf: "1h",
};

const checkTradeAt = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("@/market/signals", async (orig) => ({
  ...(await orig<typeof import("@/market/signals")>()),
  useSignalCheck: () => ({ state: "loading", snapshot: null, updatedAt: null, message: "Kerzen werden geladen …" }),
  checkTradeAt,
  retroCheck: vi.fn(async () => ({ status: "no-history", signals: null, symbol: "BTCUSDT", source: null, message: "Keine Kerzen für diesen Zeitpunkt." })),
  getSignalConfig: () => DEFAULT_SIGNAL_CFG,
}));

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

beforeEach(() => {
  saveTrade.mockClear();
  checkTradeAt.mockReset();
  useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade });
  useUi.setState({ acc: "all", editor: { open: true, tradeId: undefined, fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

describe("TradeEditor – input typed while the save waits for the check", () => {
  it("is written with the trade (never dropped when the sheet closes)", async () => {
    let release: (s: SignalSnapshot) => void = () => undefined;
    checkTradeAt.mockImplementation(() => new Promise((res) => (release = res as (s: SignalSnapshot) => void)));
    render(
      <MotionRoot>
        <TradeEditor />
      </MotionRoot>,
    );
    type("Datum & Uhrzeit", "2026-09-02T10:00");
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(checkTradeAt).toHaveBeenCalled());
    // the history check is still loading: the user adds a note
    type("Learnings & Notizen", "Stop zu eng – nächstes Mal unter das Tief");
    await act(async () => release(SNAP));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]![0].notes).toBe("Stop zu eng – nächstes Mal unter das Tief");
    expect(saveTrade.mock.calls[0]![0].signal).toMatchObject({ strength: 2 });
  });

  it("an edit that makes the form invalid meanwhile writes nothing and keeps the sheet open with its message", async () => {
    let release: (s: SignalSnapshot) => void = () => undefined;
    checkTradeAt.mockImplementation(() => new Promise((res) => (release = res as (s: SignalSnapshot) => void)));
    render(
      <MotionRoot>
        <TradeEditor />
      </MotionRoot>,
    );
    type("Datum & Uhrzeit", "2026-09-02T10:00");
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(checkTradeAt).toHaveBeenCalled());
    type("Einstieg", "");
    await act(async () => release(SNAP));
    await waitFor(() => expect(screen.getByRole("button", { name: "Speichern" })).not.toBeDisabled());
    expect(saveTrade).not.toHaveBeenCalled();
    expect(useUi.getState().editor.open).toBe(true);
    expect(field("Learnings & Notizen")).toBeInTheDocument();
  });

  it("a date moved while the check loaded is checked again for the new time", async () => {
    const releases: Array<(s: SignalSnapshot) => void> = [];
    checkTradeAt.mockImplementation(() => new Promise((res) => releases.push(res as (s: SignalSnapshot) => void)));
    render(
      <MotionRoot>
        <TradeEditor />
      </MotionRoot>,
    );
    type("Datum & Uhrzeit", "2026-09-02T10:00");
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(checkTradeAt).toHaveBeenCalledTimes(1));
    type("Datum & Uhrzeit", "2026-09-03T12:00");
    await act(async () => releases[0]!(SNAP));
    await waitFor(() => expect(checkTradeAt).toHaveBeenCalledTimes(2));
    expect((checkTradeAt.mock.calls[1] as unknown[])[0]).toBe(new Date("2026-09-03T12:00").getTime());
    await act(async () => releases[1]!({ ...SNAP, strength: 3 }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]![0].date).toBe("2026-09-03T12:00");
    expect(saveTrade.mock.calls[0]![0].signal).toMatchObject({ strength: 3 });
  });
});
