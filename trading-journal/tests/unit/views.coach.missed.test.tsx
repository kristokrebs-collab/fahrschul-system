/**
 * F32 „Verpasste Chancen“ card: the honest empty state (what is stored from now on, what is not), the list „regelgerecht,
 * nicht gehandelt“ with the two actions, the sample and the plain statement about what cannot be concluded – and the outcome of
 * each signal, which appears by itself (automatic evaluation, no click) while „Neu berechnen“ stays for reading again.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichTrades } from "@/domain/enrich";
import { __resetSignalArchive, recordSignalEvent, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { MotionRoot } from "@/motion/MotionRoot";
import { MissedCard, MISSED_STRINGS } from "@/views/coach/MissedCard";
import { __resetAuto, __setAutoDeps } from "@/views/coach/signalAuto";
import { __resetOutcomes, OUTCOME_CACHE_KEY } from "@/views/coach/signalOutcomes";
import { at, COACH_SETTINGS, ct } from "./coach.fixtures";
import { installDomPolyfills } from "./views.overview.harness";

const NOW = new Date(2026, 2, 8, 12).getTime();
const M15 = 900_000;
const loadLabData = vi.fn();
vi.mock("@/views/labor/historySource", () => ({
  loadLabData: (req: unknown) => loadLabData(req),
  loadErrorKind: () => "failed",
}));
const when = (day: number, min: number) => new Date(at(day, min)).getTime();

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

const trades = enrichTrades([ct(at(0, 600), { id: "a", p: 100 }), ct(at(1, 600), { id: "b", p: -50, side: "short" })], COACH_SETTINGS);
const signal = (key: string, ms: number, over: Parameters<typeof recordSignalEvent>[0] extends infer T ? Partial<T> : never = {}) =>
  recordSignalEvent({ key, at: ms, source: "entry", kind: "entry", entry: true, symbol: "BTCUSDT", side: "long", tf: "1h", label: `Starker Long-Einstieg ${key}`, detail: "Score 85", strength: 3, score: 85, ref: null, ...over });

describe("MissedCard", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(() => {
    // the archive prunes by age against the clock: pin it next to the events
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    localStorage.removeItem(SIGNAL_ARCHIVE_KEY);
    localStorage.removeItem(OUTCOME_CACHE_KEY);
    __resetSignalArchive();
    __resetOutcomes();
    loadLabData.mockReset();
    loadLabData.mockResolvedValue({ data: { "15m": [] }, funding: null, pages: 0, viaProxy: false });
    // the automatic evaluation without its idle wait (the scheduler itself is tested in views.coach.signalAuto)
    __setAutoDeps({
      later: (cb) => {
        const t = setTimeout(cb, 0);
        return () => clearTimeout(t);
      },
    });
    window.location.hash = "";
  });
  afterEach(() => {
    __resetAuto();
    vi.useRealTimers();
  });

  it("an empty archive says what is stored from now on – and that the past cannot be added", () => {
    render(
      <MotionRoot>
        <MissedCard list={trades} now={NOW} />
      </MotionRoot>,
    );
    const card = screen.getByTestId("missed-card");
    expect(card).toHaveAttribute("data-total", "0");
    expect(card).toHaveTextContent(MISSED_STRINGS.emptyTitle);
    expect(card).toHaveTextContent("lässt sich Vergangenes nicht nachtragen");
    expect(card).toHaveTextContent("nur solange die App offen ist");
    expect(screen.queryByTestId("missed-row")).toBeNull();
    // the limits are stated even when there is nothing yet
    expect(screen.getByTestId("missed-counter")).toHaveTextContent("keine Ursache");
  });

  it("lists the signals without a trade, with sample, actions and no causal claim", async () => {
    signal("traded", when(0, 600) + 20 * 60_000); // a long right after the signal: gehandelt
    signal("missed1", when(2, 600));
    signal("missed2", when(3, 600), { side: "short", source: "box", kind: "setup", symbol: "ETHUSDT", tf: "4h", label: "A+-Setup · Range-Short", detail: "Einstieg 2.400" });
    signal("context", when(3, 700), { entry: false, source: "box", kind: "breakout" });
    signal("open", NOW - 60_000);
    render(
      <MotionRoot>
        <MissedCard list={trades} now={NOW} />
      </MotionRoot>,
    );
    const card = screen.getByTestId("missed-card");
    expect(card).toHaveAttribute("data-missed", "2");
    expect(card).toHaveTextContent("4 (1 gehandelt · 2 nicht gehandelt · 1 offen)");
    const rows = within(card).getAllByTestId("missed-row");
    expect(rows.map((r) => r.getAttribute("data-source"))).toEqual(["box", "entry"]); // newest first
    expect(rows[0]).toHaveTextContent("▼ Short");
    expect(rows[0]).toHaveTextContent("Box-zu-Box");
    expect(rows[0]).toHaveTextContent("ETHUSDT · 4h");
    expect(screen.getByTestId("missed-counter")).toHaveTextContent("Stichprobe: 2 verpasste, 1 gehandelte Signale.");
    expect(screen.getByTestId("missed-limits")).toHaveTextContent("bewusst ausgelassen oder übersehen");
    expect(screen.getByTestId("missed-basis")).toHaveTextContent("Quelle: Signalarchiv dieses Geräts (nur bei offener App gesammelt) · 5 Ereignisse");

    // Beobachten marks and persists the mark; „Testen“ goes to the Labor
    await act(async () => {
      fireEvent.click(within(rows[1]!).getByTestId("missed-watch"));
    });
    expect(within(screen.getAllByTestId("missed-row")[1]!).getByText("beobachtet")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!).items.filter((e: { watch: boolean }) => e.watch)).toHaveLength(1);
    fireEvent.click(within(rows[0]!).getByTestId("missed-test"));
    expect(window.location.hash).toContain("labor");
  });

  it("each missed signal gets its outcome by itself: what is going on before, the result after – and „Neu berechnen“ reads again", async () => {
    const t1 = when(2, 600);
    const t2 = when(3, 600);
    signal("won", t1, { stop: 95, target: 110 });
    signal("lost", t2, { stop: 95, target: 110, symbol: "ETHUSDT" });
    loadLabData.mockImplementation(async (req: { symbol: string }) => ({
      data: { "15m": req.symbol === "ETHUSDT" ? [{ t: (t2 + M15) / 1000, o: 100, h: 101, l: 94, c: 100 }] : [{ t: (t1 + M15) / 1000, o: 100, h: 111, l: 99, c: 100 }] },
      funding: null,
      pages: 1,
      viaProxy: false,
    }));
    render(
      <MotionRoot>
        <MissedCard list={trades} now={NOW} />
      </MotionRoot>,
    );
    // before the first run: no outcome claimed, only what is happening
    const pending = within(screen.getAllByTestId("missed-row")[0]!).getByTestId("outcome-pending");
    expect(pending).toHaveTextContent(/Wird (gleich automatisch )?ausgewertet|Noch nicht ausgewertet/);
    await waitFor(() => expect(screen.getAllByTestId("outcome")).toHaveLength(2));
    const rows = screen.getAllByTestId("missed-row");
    expect(within(rows[0]!).getByTestId("outcome")).toHaveAttribute("data-kind", "stop"); // newest first: the ETH signal hit its stop
    expect(within(rows[1]!).getByTestId("outcome")).toHaveAttribute("data-kind", "target");
    expect(rows[1]).toHaveTextContent("Ziel zuerst · +2,0 R");
    expect(screen.getByTestId("outcome-auto")).toHaveTextContent("Wird automatisch ausgewertet.");
    expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Zuletzt berechnet:");
    expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Quelle: Binance USDⓈ-M");
    expect(screen.getByTestId("outcome-run")).toHaveTextContent("Neu berechnen");
    expect(screen.getByTestId("missed-counter")).not.toHaveTextContent("Ausgänge berechnen");
    expect(loadLabData).toHaveBeenCalledTimes(2);
    // both are final: „Neu berechnen“ has nothing to load, and says so by not asking the exchange
    loadLabData.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("outcome-run"));
    });
    await waitFor(() => expect(screen.getByTestId("outcome-stand")).toHaveTextContent("(von dir gestartet)"));
    expect(loadLabData).not.toHaveBeenCalled();
    expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Zwischenspeicher dieses Browsers");
  });

  it("without any missed signal it says so instead of an empty list", () => {
    signal("traded", when(0, 600) + 20 * 60_000);
    render(
      <MotionRoot>
        <MissedCard list={trades} now={NOW} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("missed-none")).toBeInTheDocument();
    expect(screen.queryByTestId("missed-row")).toBeNull();
  });

  it("without trades there is nothing to compare with", () => {
    signal("s", when(2, 600));
    render(
      <MotionRoot>
        <MissedCard list={[]} now={NOW} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("missed-card")).toHaveTextContent(MISSED_STRINGS.noJournal);
  });
});
