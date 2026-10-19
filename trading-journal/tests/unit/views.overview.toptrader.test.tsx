/**
 * Top-Trader card freshness: the note says what the numbers are and how fresh they are — Binance's 5-min snapshot
 * with a countdown to the next one, "Binance antwortet nicht … neuer Versuch in m:ss", or "Binance blockiert" — and
 * Long % / Delta come from the newest Binance point (5-min twin) instead of freezing on the hourly one.
 * Falling-Knife-Filter (decision 11): three automatic points from the Einstiegs-Check's evaluation (no support-zone
 * point), the dialog with sources, verdict, the check's own state and the manual reading as a note.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills, type FakeMarket } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ current: null as FakeMarket | null }));
const sig = vi.hoisted(() => ({ state: { state: "loading", snapshot: null, updatedAt: null, message: null } as unknown, listeners: new Set<() => void>() }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  const { useSyncExternalStore } = await import("react");
  fake.current = fakeMarket(actual);
  const subscribe = (cb: () => void) => {
    sig.listeners.add(cb);
    return () => void sig.listeners.delete(cb);
  };
  return { ...actual, ...fake.current.overrides, useSignalCheck: () => useSyncExternalStore(subscribe, () => sig.state, () => sig.state) };
});
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => null,
}));

import { reduceHealth, buildFeedSpecs, type FeedHealth, type FeedId, type ProviderHealth, type RatioPoint, type Stamped } from "@/market";
import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { KNIFE_INFO } from "@/domain/signals";
import { knifeLine, TopTraderCard } from "@/views/overview/TopTraderCard";
import { divHit, gradedSnapshot, structureAt, traderReadingOf, v2check } from "./views.overview.signalFixtures";

const MIN = 60_000;
const specs = buildFeedSpecs("1h");

function wrap(node: React.ReactNode) {
  return render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
}

/** Hourly points up to the last full hour, the 5-min twin up to the last 5-min boundary. */
function series(stepMs: number, now: number, n: number, longPct: (i: number) => number): RatioPoint[] {
  const last = Math.floor((now - MIN) / stepMs) * stepMs;
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    const v = longPct(i);
    return { time: last - i * stepMs, longPct: v, shortPct: 100 - v, ratio: v / (100 - v) };
  });
}
const stamped = (data: RatioPoint[], now: number): Stamped<RatioPoint[]> => ({ data, asOf: data.at(-1)!.time, receivedAt: now, source: "binance", comparable: true });

let saved: { health: ProviderHealth; feeds: Record<string, FeedHealth> } | null = null;

/** Puts Binance ratio data (hourly + 5-min twins) into the harness snapshot and marks the feeds live. */
function seedRatios(patch: (h: ProviderHealth) => ProviderHealth = (h) => h): { now: number } {
  const f = fake.current!;
  const now = Date.now();
  const snap = f.snapshot as Record<string, unknown>;
  snap.topAccountRatio = stamped(series(60 * MIN, now, 30, (i) => 55 + (i % 3)), now);
  snap.topPositionRatio = stamped(series(60 * MIN, now, 30, (i) => 54 + (i % 2)), now);
  snap.globalAccountRatio = stamped(series(60 * MIN, now, 30, () => 50), now);
  snap.topAccountRatio5m = stamped(series(5 * MIN, now, 12, (i) => (i === 0 ? 62.4 : 57)), now);
  snap.topPositionRatio5m = stamped(series(5 * MIN, now, 12, () => 58), now);
  snap.globalAccountRatio5m = stamped(series(5 * MIN, now, 12, () => 51), now);
  saved = { health: f.health, feeds: { ...f.health.feeds } };
  let h = f.health;
  for (const id of ["topAccountRatio", "topPositionRatio", "globalAccountRatio", "topAccountRatio5m", "topPositionRatio5m", "globalAccountRatio5m"] as FeedId[]) {
    const v = snap[id] as Stamped<RatioPoint[]>;
    h = reduceHealth(h, { type: "rest_ok", feed: id, source: "binance", asOf: v.asOf, now }, specs);
  }
  h = reduceHealth(h, { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: now + 3 * MIN + 12_000 }, specs);
  h = patch(h);
  // the harness closes over `health`: copy the reduced state into it
  Object.assign(f.health, h);
  return { now };
}

describe("TopTraderCard freshness", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });
  afterEach(() => {
    const f = fake.current!;
    const snap = f.snapshot as Record<string, unknown>;
    for (const id of ["topAccountRatio", "topPositionRatio", "globalAccountRatio", "topAccountRatio5m", "topPositionRatio5m", "globalAccountRatio5m"]) delete snap[id];
    if (saved) Object.assign(f.health, saved.health, { feeds: saved.feeds });
    saved = null;
  });

  it("live: the newest 5-min Binance value with `Binance liefert alle 5 min neu · Stand · nächste Daten in m:ss`", () => {
    seedRatios();
    wrap(<TopTraderCard />);
    const note = screen.getByTestId("top-trader-freshness");
    expect(note).toHaveAttribute("data-kind", "live");
    expect(note.textContent).toMatch(/^Binance liefert alle 5 min neu · Stand \d\d:\d\d · nächste Daten in [23]:\d\d$/);
    expect(note.className).toContain("text-faint");
    expect(screen.getByText("Live von Binance · 5-min-Wert")).toBeInTheDocument();
    expect(screen.queryByText("Nur mit Binance")).toBeNull();
  });

  it("retrying: says Binance does not answer, why, and when the next attempt runs", () => {
    seedRatios((h) => {
      const now = Date.now();
      let x = reduceHealth(h, { type: "rest_fail", feed: "topAccountRatio5m", source: "binance", kind: "network", now, detail: "Netzwerk/CORS: Failed to fetch" }, specs);
      x = reduceHealth(x, { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: now + 28_000 }, specs);
      return x;
    });
    wrap(<TopTraderCard />);
    const note = screen.getByTestId("top-trader-freshness");
    expect(note).toHaveAttribute("data-kind", "retrying");
    expect(note.textContent).toMatch(/^Binance antwortet nicht \(Netzwerk\/CORS\) · Stand \d\d:\d\d · neuer Versuch in 0:[23]\d$/);
    expect(note).toHaveAttribute("title", "Netzwerk/CORS: Failed to fetch");
    expect(note.className).toContain("text-warn");
  });

  it("blocked: `Binance blockiert (Region)`, the manual reading and the `Nur mit Binance` badge", () => {
    seedRatios((h) => {
      const now = Date.now();
      let x = reduceHealth(h, { type: "probe", source: "binance", ok: false, blocked: true, now }, specs);
      x = reduceHealth(x, { type: "unsupported", feed: "topAccountRatio", source: "bybit", now }, specs);
      x = reduceHealth(x, { type: "unsupported", feed: "topPositionRatio", source: "bybit", now }, specs);
      return reduceHealth(x, { type: "probe_scheduled", at: now + 4 * MIN, now }, specs);
    });
    wrap(<TopTraderCard />);
    const note = screen.getByTestId("top-trader-freshness");
    expect(note).toHaveAttribute("data-kind", "blocked");
    expect(note.textContent).toMatch(/^Binance blockiert \(Region\) · Stand \d\d:\d\d · neuer Versuch in [34]:\d\d$/);
    expect(screen.getByText("Nur mit Binance")).toBeInTheDocument();
    expect(screen.queryByText(/Live von Binance/)).toBeNull();
  });
});

describe("Falling-Knife-Filter (live from the Einstiegs-Check)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    sig.state = { state: "loading", snapshot: null, updatedAt: null, message: null };
  });
  const publish = (snapshot: unknown) => {
    sig.state = { state: "ok", snapshot, updatedAt: Date.now(), message: null };
    for (const l of [...sig.listeners]) l();
  };
  /** 1h RSI divergence (closed) + top traders long / retail red; no structure break → 2 of 3. */
  const evaluation = () =>
    gradedSnapshot(
      [
        v2check("30m", { long: { kind: "bottom", barsAgo: 1 }, rsi: 28 }),
        v2check("45m", { long: { kind: "bottom", barsAgo: 1 }, rsi: 33 }),
        v2check("1h", { div: [divHit()], structure: structureAt(81_200, { price: 81_000, distAtr: 0.5 }, { price: 84_200 }) }),
        v2check("4h", { structure: structureAt(81_200, null, null) }),
      ],
      traderReadingOf(),
    );

  it("waits for the check, then shows n / 3 with three segments and the line; no support-zone point anywhere", () => {
    wrap(<TopTraderCard />);
    expect(screen.getByTestId("knife-card")).toHaveAttribute("data-tone", "mute");
    expect(screen.getByText("Wartet auf die Live-Daten des Einstiegs-Checks …")).toBeInTheDocument();
    act(() => publish(evaluation()));
    const card = screen.getByTestId("knife-card");
    expect(card).toHaveAttribute("data-n", "2");
    expect(card).toHaveAttribute("data-tone", "warn");
    expect(screen.getByText("2 von 3 erfüllt · Tippen für Details")).toBeInTheDocument();
    expect(screen.queryByText(/Support-\/Liquiditätszone/)).toBeNull();
  });

  it("dialog: the info (filter vs. trigger, same data), three points with source, verdict, the check's state, the reading as a note", () => {
    publish(evaluation());
    wrap(<TopTraderCard />);
    fireEvent.click(screen.getByRole("button", { name: /Falling-Knife-Filter/ }));
    const dialog = screen.getByRole("dialog", { name: "Falling-Knife-Filter" });
    expect(within(dialog).getByText(KNIFE_INFO)).toBeInTheDocument();
    const items = within(dialog).getAllByTestId("knife-item");
    expect(items.map((i) => `${i.getAttribute("data-id")}:${i.getAttribute("data-met")}`)).toEqual(["structure:false", "divergence:true", "whale:true"]);
    expect(items[0]).toHaveTextContent("Erstes Higher Low oder BOS auf 1H/4H");
    expect(items[1]).toHaveTextContent("1h: RSI regulär");
    expect(items[1]).toHaveTextContent("Divergenzen · dieselben wie im Einstiegs-Check");
    expect(items[2]).toHaveTextContent("Top-Trader long · Whale–Retail-Delta rot");
    expect(items[2]).toHaveTextContent("4 von 4 · Positionen 66,0 % Long · Konten 65,2 % Long · Delta −3,5 pp · 1h −2,1");
    expect(items[2]).toHaveTextContent("Top-Trader-Kombi · Whale–Retail-Delta = Top-Trader-Konten minus alle Konten (Long-%) · Binance-5-min-Daten");
    expect(within(dialog).getByTestId("knife-count")).toHaveTextContent("2/3");
    expect(within(dialog).getByText(/noch keine Absicherung für einen Makro-Long/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("knife-trigger")).toHaveTextContent(/Einstiegs-Check · Auslöser.*Long-Einstieg.*Score \d+/);
    // the short mirror
    fireEvent.click(within(dialog).getByRole("radio", { name: "Short" }));
    expect(within(dialog).getAllByTestId("knife-item")[0]).toHaveTextContent("Erstes Lower High oder BOS auf 1H/4H");
  });

  it("card line wording", () => {
    expect(knifeLine(null)).toBe("Wartet auf die Live-Daten des Einstiegs-Checks …");
    const k = evaluation().knife!.long;
    expect(knifeLine({ ...k, n: 3, all: true })).toBe("Kein fallendes Messer: Makro-Long abgesichert.");
    expect(knifeLine({ ...k, n: 0, all: false })).toBe("Fallendes Messer möglich: beobachten statt kaufen.");
  });
});
