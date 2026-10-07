/**
 * Top-Trader card freshness: the note says what the numbers are and how fresh they are — Binance's 5-min snapshot
 * with a countdown to the next one, "Binance antwortet nicht … neuer Versuch in m:ss", or "Binance blockiert" — and
 * Long % / Delta come from the newest Binance point (5-min twin) instead of freezing on the hourly one.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills, type FakeMarket } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ current: null as FakeMarket | null }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  fake.current = fakeMarket(actual);
  return { ...actual, ...fake.current.overrides };
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
import { TopTraderCard } from "@/views/overview/TopTraderCard";

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
