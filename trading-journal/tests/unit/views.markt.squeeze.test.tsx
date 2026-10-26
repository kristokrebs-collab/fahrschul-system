/**
 * „Squeeze-Beobachtung“ card (F07): empty/off archive, a seeded archive with the three readings and their thresholds, the
 * box context beside it, the sample statement, a stale archive, thresholds written to `settings.squeeze` at once, and the
 * alert switch that is off until it is turned on. The clock is fixed (Date only), the archive is fake-indexeddb.
 */
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivePoint } from "@/domain/archive";
import type { BoxPhase } from "@/domain/boxes";
import { openArchiveDb } from "@/market/archive/db";
import { __resetArchiveStore, setArchiveCfg } from "@/market/archive/store";
import type { BoxesView } from "@/market/boxes/store";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal } from "./views.overview.harness";
import { SqueezeCard } from "@/views/markt/SqueezeCard";
import { SQUEEZE_STRINGS as S, episodesLine, headline, sampleLine } from "@/views/markt/squeezeModel";
import { findEpisodes, summarize, DEFAULT_SQUEEZE_CFG, evaluateNow } from "@/domain/squeeze";

const openSettings = vi.hoisted(() => vi.fn());
vi.mock("@/views/settings/MoreSettingsCard", () => ({ openSettingsOn: openSettings }));

const MIN = 60_000;
const H = 60 * MIN;
/** 2026-10-26 12:00:00 UTC */
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

/** A box view with only what the card reads. */
function boxView(phase: BoxPhase, dir: 1 | -1 | 0, brk: 0 | 1 | -1 = 0, symbol = "BTCUSDT"): BoxesView {
  const tf = (p: BoxPhase) => ({ analysis: { box: { phase: p, dir, box: { brk } } } });
  return { state: "ok", symbol, tfs: { "4h": tf(phase), "1d": { analysis: null }, "1w": { analysis: null } } } as unknown as BoxesView;
}
const noBox = { state: "idle", symbol: "BTCUSDT", tfs: { "4h": { analysis: null }, "1d": { analysis: null }, "1w": { analysis: null } } } as unknown as BoxesView;

interface Seed {
  symbol?: string;
  /** sample times (ms) */
  times: number[];
  rate: (t: number) => number;
  oi: (t: number) => number;
  long: (t: number) => number;
  mark?: (t: number) => number;
}
async function seed(s: Seed): Promise<void> {
  const db = await openArchiveDb();
  const symbol = s.symbol ?? "BTCUSDT";
  const pts: ArchivePoint[] = [];
  for (const t of s.times) {
    pts.push({ series: "premium", symbol, t, d: { mark: s.mark?.(t) ?? 100, index: 100, rate: s.rate(t), next: t + 8 * H } });
    pts.push({ series: "oi", symbol, t, d: { oi: s.oi(t) } });
    pts.push({ series: "lsAcc", symbol, t, d: { long: s.long(t), short: 100 - s.long(t), ratio: 1 } });
    pts.push({ series: "lsTopPos", symbol, t, d: { long: 45, short: 55, ratio: 0.8 } });
  }
  await db.putPoints(pts);
  await db.putTick({ t: s.times[s.times.length - 1]!, iv: 10, route: "direct", res: { [symbol]: "ok" }, states: false });
  db.close();
}
/** every 10 minutes from 6 h before `end` to `end` */
const grid = (end: number) => Array.from({ length: 37 }, (_, i) => end - 6 * H + i * 10 * MIN);

const hot = {
  // funding +0,07 %, 70 % long; open interest 1 000 until 3 h before the end, then 1 100 (+10 % in 4 h from 2 h before the end on)
  rate: () => 0.0007,
  long: () => 70,
  oi: (t: number) => (t >= NOW - 3 * H ? 1100 : 1000),
  mark: (t: number) => (t <= NOW - 2 * H ? 100 : 99),
};

async function clean() {
  const db = await openArchiveDb();
  await db.deleteAll();
  db.close();
}

beforeEach(async () => {
  await bootFixtureJournal();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetArchiveStore();
  openSettings.mockClear();
  await clean();
});
afterEach(() => vi.useRealTimers());

describe("pure sentences", () => {
  it("headline texts", () => {
    const data = { premium: [{ t: NOW, mark: 100, rate: 0.0007 }], oi: [{ t: NOW - 4 * H, oi: 1000 }, { t: NOW, oi: 1100 }], ls: [{ t: NOW, long: 70 }] };
    const r = evaluateNow(data, DEFAULT_SQUEEZE_CFG, NOW, 10);
    expect(headline(r, 2)).toEqual({ text: "Long-Seite überfüllt · 3 von 3 Messwerten", tone: "warn" });
    expect(headline({ ...r, state: "calm", side: "long", met: 1 }, 2).text).toBe("Ruhig – 1 von 2 nötigen Messwerten (Neigung zur Long-Seite)");
    expect(headline({ ...r, state: "calm", side: null, met: 0 }, 2).text).toBe("Ruhig – keine einseitige Überhitzung nach deinen Schwellen");
    expect(headline({ ...r, state: "nodata", stale: true }, 2).text).toContain("nicht geschrieben");
    expect(headline({ ...r, state: "nodata", stale: false }, 2).text).toBe("Keine Daten");
  });

  it("sample sentences carry the counts, the counter-examples, the spread and the word", () => {
    expect(sampleLine({ hours: 4, n: 0, against: 0, withCrowd: 0, median: null, min: null, max: null, word: "keine" }, "long")).toBe("Nach 4 h: kein früherer Fall mit Preis am Ende im Archiv (Stichprobe: keine).");
    expect(sampleLine({ hours: 24, n: 3, against: 2, withCrowd: 1, median: -0.012, min: -0.031, max: 0.024, word: "zu wenig" }, "long")).toBe(
      "Nach 24 h: von 3 Fällen lief der Preis in 2 gegen die Long-Seite, in 1 mit ihr · Median −1,2 %, Spanne −3,1 % bis +2,4 % (Stichprobe: zu wenig).",
    );
    expect(episodesLine([], 12.5, null)).toBe("Im Archiv (12,5 Stunden) kam dieselbe Beobachtung in 0 früheren Fällen vor.");
  });
});

describe("SqueezeCard", () => {
  it("empty and off: says what it reads, points to the archive and shows the standing sentences", async () => {
    render(<SqueezeCard view={noBox} />);
    expect(await screen.findByTestId("squeeze-empty")).toHaveTextContent("Der Squeeze-Monitor liest das Datenarchiv, und das ist aus");
    expect(screen.getByTestId("squeeze-lead")).toHaveTextContent("kein Handelssignal und keine Prognose");
    expect(screen.getByTestId("squeeze-no-advice")).toHaveTextContent("keine Prognose und kein Handelssignal");
    expect(screen.getByTestId("squeeze-no-advice")).not.toHaveTextContent("Finanzberatung");
    fireEvent.click(screen.getByRole("button", { name: S.archiveBtn }));
    expect(openSettings).toHaveBeenCalledWith("settings", "Datenarchiv");
  });

  it("archive on but still empty: says so, no button", async () => {
    setArchiveCfg({ on: true });
    render(<SqueezeCard view={noBox} />);
    expect(await screen.findByTestId("squeeze-empty")).toHaveTextContent(S.archiveOn);
    expect(screen.queryByRole("button", { name: S.archiveBtn })).not.toBeInTheDocument();
  });

  it("a hot archive: crowded long, three readings with values and thresholds, the box context and the sample", async () => {
    await seed({ times: grid(NOW), ...hot });
    render(<SqueezeCard view={boxView("breakout", 1)} />);
    const head = await screen.findByTestId("squeeze-headline");
    expect(head).toHaveAttribute("data-state", "watch");
    expect(head).toHaveAttribute("data-side", "long");
    expect(head).toHaveTextContent("BTCUSDT · Long-Seite überfüllt · 3 von 3 Messwerten");
    const f = screen.getByTestId("squeeze-signal-funding");
    expect(f).toHaveAttribute("data-met", "true");
    expect(f).toHaveTextContent("+0,070 % je Abrechnung");
    expect(f).toHaveTextContent("Schwelle: ≥ 0,050 % oder ≤ −0,050 % je Abrechnung");
    expect(screen.getByTestId("squeeze-signal-oi")).toHaveTextContent("+10,0 % in 4 h");
    expect(screen.getByTestId("squeeze-signal-accounts")).toHaveTextContent("Long 70,0 % · Short 30,0 %");
    expect(screen.getByTestId("markt-squeeze")).toHaveTextContent("Top-Trader-Positionen Long 45,0 %");
    // box context: a breakout up in the direction of the crowded longs
    const sit = screen.getByTestId("squeeze-situation");
    expect(sit).toHaveAttribute("data-timing", "after");
    expect(sit).toHaveAttribute("data-relation", "with");
    expect(sit).toHaveTextContent("Ausbruch nach oben (4h) in Richtung der überfüllten Long-Seite");
    // the sample: one ongoing episode since the first sample; 4 h later the mark was unchanged (100) → with the crowd; no price 24 h later
    expect(screen.getByTestId("squeeze-sample")).toHaveTextContent("kam dieselbe Beobachtung für die Long-Seite in 1 früheren Fall vor");
    expect(screen.getByTestId("squeeze-sample")).toHaveTextContent("Das Archiv deckt 6,0 Stunden ab");
    expect(screen.getByTestId("squeeze-sample-4")).toHaveTextContent("Nach 4 h: von 1 Fall lief der Preis in 0 gegen die Long-Seite, in 1 mit ihr");
    expect(screen.getByTestId("squeeze-sample-4")).toHaveTextContent("(Stichprobe: zu wenig)");
    expect(screen.getByTestId("squeeze-sample-24")).toHaveTextContent("kein früherer Fall mit Preis am Ende");
    expect(screen.getByTestId("squeeze-stand")).toHaveTextContent("Quelle: Datenarchiv dieses Geräts (Binance USDⓈ-M, öffentlich)");
  });

  it("the same numbers with the box still inside: 'before the breakout'; with a failed one: its own sentence", async () => {
    await seed({ times: grid(NOW), ...hot });
    const { unmount } = render(<SqueezeCard view={boxView("inside", 0)} />);
    expect(await screen.findByTestId("squeeze-situation")).toHaveAttribute("data-timing", "before");
    unmount();
    render(<SqueezeCard view={boxView("failed", 0, 1)} />);
    const sit = await screen.findByTestId("squeeze-situation");
    expect(sit).toHaveAttribute("data-timing", "failed");
    expect(sit).toHaveTextContent("Fehlausbruch nach oben (4h) bei überfüllter Long-Seite");
  });

  it("without a box analysis it says so instead of inventing a context", async () => {
    await seed({ times: grid(NOW), ...hot });
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    expect(screen.queryByTestId("squeeze-situation")).not.toBeInTheDocument();
    expect(screen.getByTestId("squeeze-context")).toHaveTextContent(S.boxNone);
  });

  it("a quiet market: calm, with the readings that do not hold", async () => {
    await seed({ times: grid(NOW), rate: () => 0.0001, long: () => 52, oi: () => 1000 });
    render(<SqueezeCard view={noBox} />);
    const head = await screen.findByTestId("squeeze-headline");
    expect(head).toHaveAttribute("data-state", "calm");
    expect(head).toHaveTextContent("Ruhig – keine einseitige Überhitzung nach deinen Schwellen");
    expect(screen.getByTestId("squeeze-signal-funding")).toHaveAttribute("data-met", "false");
    expect(screen.getByTestId("squeeze-situation".replace("situation", "signal-oi"))).toHaveAttribute("data-met", "false");
    expect(screen.queryByTestId("squeeze-situation")).not.toBeInTheDocument();
  });

  it("an archive that is not being written (newest entry 2 h old): no current reading", async () => {
    await seed({ times: grid(NOW - 2 * H), ...hot });
    render(<SqueezeCard view={noBox} />);
    const head = await screen.findByTestId("squeeze-headline");
    expect(head).toHaveAttribute("data-state", "nodata");
    expect(head).toHaveTextContent("nicht geschrieben");
    for (const k of ["funding", "oi", "accounts"]) expect(screen.getByTestId(`squeeze-signal-${k}`)).toHaveAttribute("data-met", "null");
  });

  it("a reading without enough history says how far back the archive reaches", async () => {
    await seed({ times: Array.from({ length: 7 }, (_, i) => NOW - 60 * MIN + i * 10 * MIN), ...hot });
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    const oi = screen.getByTestId("squeeze-signal-oi");
    expect(oi).toHaveAttribute("data-met", "null");
    expect(oi).toHaveTextContent("keine Daten");
    expect(oi).toHaveTextContent("vor 4 h");
    expect(oi).toHaveTextContent("erst 1,0 h");
    // funding and accounts still hold → 2 of 3 → the observation stands, with the missing reading named
    expect(screen.getByTestId("squeeze-headline")).toHaveAttribute("data-state", "watch");
  });

  it("offers a chip per archived symbol and shows the picked one", async () => {
    await seed({ times: grid(NOW), ...hot });
    await seed({ symbol: "ETHUSDT", times: grid(NOW), rate: () => 0.0001, long: () => 50, oi: () => 1000 });
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    const chips = within(screen.getByRole("list", { name: "Symbol" }));
    expect(chips.getByRole("button", { name: "BTCUSDT" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chips.getByRole("button", { name: "ETHUSDT" }));
    await waitFor(() => expect(screen.getByTestId("squeeze-headline")).toHaveTextContent("ETHUSDT · Ruhig"));
  });

  it("thresholds are written to settings.squeeze at once and change the reading", async () => {
    await seed({ times: grid(NOW), ...hot });
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    fireEvent.click(screen.getByTestId("squeeze-tune"));
    // demand all three readings: funding +0,07 %, +10 % OI and 70 % long all hold → still watch; raise the funding bar above 0,07 % → 2 of 3
    const funding = screen.getByLabelText(S.fundingLabel);
    fireEvent.change(funding, { target: { value: "0,08" } });
    fireEvent.blur(funding);
    await waitFor(() => expect((useJournal.getState().settings.squeeze as { fundingPct?: number } | undefined)?.fundingPct).toBe(0.08));
    fireEvent.click(screen.getByRole("radio", { name: "3 von 3" }));
    await waitFor(() => expect((useJournal.getState().settings.squeeze as { minMet?: number }).minMet).toBe(3));
    await waitFor(() => expect(screen.getByTestId("squeeze-headline")).toHaveAttribute("data-state", "calm"));
    expect(screen.getByTestId("squeeze-headline")).toHaveTextContent("Ruhig – 2 von 3 nötigen Messwerten (Neigung zur Long-Seite)");
    expect(screen.getByTestId("squeeze-signal-funding")).toHaveAttribute("data-met", "false");
    // the stored object is versioned and holds the whole configuration
    expect(useJournal.getState().settings.squeeze).toMatchObject({ v: 1, fundingPct: 0.08, oiRisePct: 5, oiHours: 4, longPct: 65, minMet: 3, alerts: false });
    // a value outside the limits is clamped (0,9 → 0,5), not stored as typed
    fireEvent.change(funding, { target: { value: "0,9" } });
    fireEvent.blur(funding);
    await waitFor(() => expect((useJournal.getState().settings.squeeze as { fundingPct: number }).fundingPct).toBe(0.5));
    fireEvent.click(screen.getByRole("button", { name: S.reset }));
    await waitFor(() => expect(useJournal.getState().settings.squeeze).toMatchObject({ fundingPct: 0.05, minMet: 2 }));
  });

  it("the alert is off until it is switched on; switching it on writes alerts: true", async () => {
    setArchiveCfg({ on: true });
    await seed({ times: grid(NOW), ...hot });
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    const sw = screen.getByRole("switch", { name: S.alertLabel });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(useJournal.getState().settings.squeeze).toBeUndefined();
    fireEvent.click(sw);
    await waitFor(() => expect((useJournal.getState().settings.squeeze as { alerts?: boolean }).alerts).toBe(true));
    expect(findEpisodes({ premium: [], oi: [], ls: [] }, DEFAULT_SQUEEZE_CFG)).toEqual([]);
    expect(summarize([], 4).word).toBe("keine");
    await act(async () => undefined);
  });

  it("says so when the browser has no IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    render(<SqueezeCard view={noBox} />);
    expect(await screen.findByTestId("squeeze-unavailable")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
