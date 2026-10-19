/**
 * F32 „Verpasste Chancen“ card: the honest empty state (what is stored from now on, what is not), the list „regelgerecht,
 * nicht gehandelt“ with the two actions, the sample and the plain statement about what cannot be concluded.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichTrades } from "@/domain/enrich";
import { __resetSignalArchive, recordSignalEvent, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { MotionRoot } from "@/motion/MotionRoot";
import { MissedCard, MISSED_STRINGS } from "@/views/coach/MissedCard";
import { at, COACH_SETTINGS, ct } from "./coach.fixtures";
import { installDomPolyfills } from "./views.overview.harness";

const NOW = new Date(2026, 2, 8, 12).getTime();
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
    __resetSignalArchive();
    window.location.hash = "";
  });
  afterEach(() => {
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

    // Beobachten marks and persists the mark; „Testen“ goes to the Labor
    await act(async () => {
      fireEvent.click(within(rows[1]!).getByTestId("missed-watch"));
    });
    expect(within(screen.getAllByTestId("missed-row")[1]!).getByText("beobachtet")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!).items.filter((e: { watch: boolean }) => e.watch)).toHaveLength(1);
    fireEvent.click(within(rows[0]!).getByTestId("missed-test"));
    expect(window.location.hash).toContain("labor");
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
