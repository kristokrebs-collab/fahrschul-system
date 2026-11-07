/**
 * „Squeeze-Beobachtung“ with the loaded Börsenhistorie (F07/F26): the history is a data set of its own – evaluated on its own,
 * shown in its own block with its own source line, never added to the collected archive's sample. A synthetic history worked
 * out by hand: funding +0,07 % and 70 % long all the time (two of three readings hold from the first sample on), the price
 * 100 → 99 four hours later → 95 twenty-four hours later.
 */
import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivePoint } from "@/domain/archive";
import { DEFAULT_SQUEEZE_CFG, findEpisodes, squeezeDataFromHistory, summarize } from "@/domain/squeeze";
import { date, time } from "@/lib/format";
import { ddmmHHmm } from "@/market/format";
import { __resetBackfillLog, rememberBackfillRun } from "@/market/archive/backfillLog";
import { openArchiveDb } from "@/market/archive/db";
import { __resetArchiveStore } from "@/market/archive/store";
import { loadHistoryData } from "@/market/squeeze/read";
import type { BoxesView } from "@/market/boxes/store";
import { SqueezeCard } from "@/views/markt/SqueezeCard";
import { SQUEEZE_STRINGS as S, historyEpisodesLine, missingHistory } from "@/views/markt/squeezeModel";
import { bootFixtureJournal } from "./views.overview.harness";

const openSettings = vi.hoisted(() => vi.fn());
vi.mock("@/views/settings/MoreSettingsCard", () => ({ openSettingsOn: openSettings }));

const MIN = 60_000;
const H = 60 * MIN;
/** 2026-10-26 12:00:00 UTC */
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const T0 = NOW - 30 * H;
const noBox = { state: "idle", symbol: "BTCUSDT", tfs: { "4h": { analysis: null }, "1d": { analysis: null }, "1w": { analysis: null } } } as unknown as BoxesView;

const markAt = (t: number): number => (t >= T0 + 24 * H ? 95 : t >= T0 + 4 * H ? 99 : 100);

/** 30 hours of 5-minute history from T0 (inclusive) to NOW, funding settlements every 8 h from 32 h before NOW. */
function history(over: { oi?: boolean; ls?: boolean; fund?: boolean; symbol?: string } = {}): ArchivePoint[] {
  const symbol = over.symbol ?? "BTCUSDT";
  const out: ArchivePoint[] = [];
  for (let t = T0; t <= NOW; t += 5 * MIN) {
    out.push({ series: "markHist", symbol, t, d: { mark: markAt(t) } });
    if (over.oi !== false) out.push({ series: "oiHist", symbol, t, d: { oi: 1000, value: 8e7 } });
    if (over.ls !== false) out.push({ series: "lsAccHist", symbol, t, d: { long: 70, short: 30, ratio: 2.33 } });
    out.push({ series: "lsTopPosHist", symbol, t, d: { long: 45, short: 55, ratio: 0.82 } });
  }
  if (over.fund !== false) for (let k = 0; k <= 4; k++) out.push({ series: "fundingHist", symbol, t: NOW - 32 * H + 8 * H * k, d: { rate: 0.0007 } });
  return out;
}

async function seed(points: ArchivePoint[]): Promise<void> {
  const db = await openArchiveDb();
  await db.putPoints(points);
  db.close();
}

beforeEach(async () => {
  await bootFixtureJournal();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetArchiveStore();
  __resetBackfillLog();
  localStorage.clear();
  openSettings.mockClear();
  const db = await openArchiveDb();
  await db.deleteAll();
  db.close();
});
afterEach(() => vi.useRealTimers());

describe("loadHistoryData", () => {
  it("reads the loaded series on their own and counts them; collected series are not read", async () => {
    await seed([...history(), { series: "premium", symbol: "BTCUSDT", t: NOW, d: { mark: 1, index: 1, rate: 0.5, next: 0 } }, { series: "oi", symbol: "BTCUSDT", t: NOW, d: { oi: 5 } }]);
    const db = await openArchiveDb();
    const h = await loadHistoryData(db, "BTCUSDT", NOW);
    db.close();
    expect(h.counts).toEqual({ mark: 361, funding: 5, oi: 361, ls: 361, top: 361 });
    expect(h.first).toBe(T0);
    expect(h.last).toBe(NOW);
    expect(h.hours).toBe(30);
    expect(h.data.premium).toHaveLength(361);
    expect(h.data.premium.every((p) => p.rate === 0.0007)).toBe(true); // no collected premium row mixed in
    expect(h.data.oi.every((p) => p.oi === 1000)).toBe(true);
  });

  it("an episode of the observation, with what the price did 4 h and 24 h later (worked out by hand)", async () => {
    await seed(history());
    const db = await openArchiveDb();
    const h = await loadHistoryData(db, "BTCUSDT", NOW);
    db.close();
    // funding and accounts hold from the first sample on (the open-interest window is unknown for 4 h, then it is 0 % → not met): 2 of 3
    const eps = findEpisodes(h.data, DEFAULT_SQUEEZE_CFG);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ side: "long", start: T0, end: NOW, samples: 361 });
    expect(eps[0]!.edge[4]).toBeCloseTo(-0.01, 9); // 100 → 99 against the crowded longs
    expect(eps[0]!.edge[24]).toBeCloseTo(-0.05, 9); // 100 → 95
    expect(summarize(eps, 4)).toMatchObject({ n: 1, against: 1, withCrowd: 0, word: "zu wenig" });
    expect(historyEpisodesLine(eps, 30, null)).toBe("In der nachgeladenen Historie (30,0 Stunden) kam dieselbe Beobachtung in 1 früheren Fall vor.");
  });

  it("without a funding series the observation cannot hold (accounts alone: 1 of 2 needed) – the missing series is named", async () => {
    await seed(history({ fund: false }));
    const db = await openArchiveDb();
    const h = await loadHistoryData(db, "BTCUSDT", NOW);
    db.close();
    expect(findEpisodes(h.data, DEFAULT_SQUEEZE_CFG)).toEqual([]);
    expect(missingHistory(h.counts)).toEqual(["Funding"]);
    expect(missingHistory({ mark: 0, funding: 0, oi: 0, ls: 0, top: 0 })).toEqual(["Markpreis", "Funding", "Open Interest", "Long/Short aller Konten"]);
  });

  it("squeezeDataFromHistory feeds exactly this: the rate of the settlement before each sample", () => {
    const d = squeezeDataFromHistory({ mark: [{ t: 10 * H, mark: 1 }], funding: [{ t: 4 * H, rate: 0.001 }, { t: 9 * H, rate: -0.001 }], oi: [], ls: [], top: [] });
    expect(d.premium).toEqual([{ t: 10 * H, mark: 1, rate: -0.001 }]);
  });
});

describe("SqueezeCard with the loaded history", () => {
  it("a symbol with only loaded history: the collected readings say 'keine Daten', the history block carries the sample, with its own source line", async () => {
    await seed(history());
    rememberBackfillRun({ t: NOW - 20 * MIN, end: "done", days: 7, from: T0, to: NOW, route: "direct", symbols: ["BTCUSDT"], points: 5, res: { BTCUSDT: { markHist: "ok", oiHist: "ok" } } });
    render(<SqueezeCard view={noBox} />);
    const head = await screen.findByTestId("squeeze-headline");
    expect(head).toHaveAttribute("data-state", "nodata");
    expect(head).toHaveTextContent("Keine Daten");
    expect(screen.getByTestId("squeeze-history-nocollected")).toHaveTextContent(S.historyNoCollected);
    expect(screen.getByTestId("squeeze-history")).toHaveTextContent(S.historyLabel);
    expect(screen.getByTestId("squeeze-history")).toHaveTextContent("Getrennt vom Archiv oben");
    expect(screen.getByTestId("squeeze-history-episodes")).toHaveTextContent("In der nachgeladenen Historie (30,0 Stunden) kam dieselbe Beobachtung in 1 früheren Fall vor.");
    expect(screen.getByTestId("squeeze-history-sample-4")).toHaveTextContent("Nach 4 h: von 1 Fall lief der Preis in 1 gegen die überfüllte Seite");
    expect(screen.getByTestId("squeeze-history-sample-4")).toHaveTextContent("Median −1,0 %");
    expect(screen.getByTestId("squeeze-history-sample-24")).toHaveTextContent("Median −5,0 %");
    expect(screen.getByTestId("squeeze-history-sample-24")).toHaveTextContent("(Stichprobe: zu wenig)");
    const stand = screen.getByTestId("squeeze-history-stand");
    expect(stand).toHaveTextContent("Quelle: Binance USDⓈ-M, öffentliche Historie (nachgeladen)");
    const at = (ms: number): string => `${date(new Date(ms))} ${time(new Date(ms))}`;
    expect(stand).toHaveTextContent(`Historie seit ${at(T0)}`);
    expect(stand).toHaveTextContent(`nachgeladen ${at(NOW - 20 * MIN)}`);
    expect(stand).toHaveTextContent(`letzter Eintrag ${ddmmHHmm(NOW)}`);
    // the collected block is untouched: its sample says there is no earlier case in the archive
    expect(screen.getByTestId("squeeze-sample")).toHaveTextContent("in 0 früheren Fällen");
    expect(screen.queryByTestId("squeeze-history-missing")).not.toBeInTheDocument();
  });

  it("collected and loaded data side by side stay two data sets: each sample counts only its own", async () => {
    const hot = Array.from({ length: 37 }, (_, i) => NOW - 6 * H + i * 10 * MIN);
    const collected: ArchivePoint[] = hot.flatMap((t) => [
      { series: "premium", symbol: "BTCUSDT", t, d: { mark: 100, index: 100, rate: 0.0007, next: t + 8 * H } } as ArchivePoint,
      { series: "oi", symbol: "BTCUSDT", t, d: { oi: t >= NOW - 3 * H ? 1100 : 1000 } } as ArchivePoint,
      { series: "lsAcc", symbol: "BTCUSDT", t, d: { long: 70, short: 30, ratio: 2 } } as ArchivePoint,
    ]);
    const db = await openArchiveDb();
    await db.putPoints([...collected, ...history()]);
    await db.putTick({ t: NOW, iv: 10, route: "direct", res: { BTCUSDT: "ok" }, states: false });
    db.close();
    render(<SqueezeCard view={noBox} />);
    await screen.findByTestId("squeeze-headline");
    expect(screen.getByTestId("squeeze-headline")).toHaveAttribute("data-state", "watch");
    // collected: 6 h, 1 episode, and the mark stayed 100 → with the crowd (0 against)
    expect(screen.getByTestId("squeeze-sample")).toHaveTextContent("Das Archiv deckt 6,0 Stunden ab");
    expect(screen.getByTestId("squeeze-sample-4")).toHaveTextContent("in 0 gegen die Long-Seite, in 1 mit ihr");
    // loaded: 30 h, one episode, the mark went down → against the crowd
    expect(screen.getByTestId("squeeze-history-episodes")).toHaveTextContent("(30,0 Stunden)");
    expect(screen.getByTestId("squeeze-history-sample-4")).toHaveTextContent("in 1 gegen die Long-Seite, in 0 mit ihr");
  });

  it("names a missing series of the loaded history and says that its reading counts as 'keine Daten'", async () => {
    await seed(history({ oi: false }));
    render(<SqueezeCard view={noBox} />);
    const miss = await screen.findByTestId("squeeze-history-missing");
    expect(miss).toHaveTextContent(S.historyMissing(["Open Interest"]));
    expect(miss).toHaveTextContent("keine Daten");
  });

  it("nothing loaded for the symbol: says so and points to the action", async () => {
    await seed([{ series: "premium", symbol: "BTCUSDT", t: NOW, d: { mark: 1, index: 1, rate: 0.0001, next: 0 } }]);
    render(<SqueezeCard view={noBox} />);
    expect(await screen.findByTestId("squeeze-history-none")).toHaveTextContent(S.historyNone);
    fireEvent.click(screen.getByTestId("squeeze-history-btn"));
    expect(openSettings).toHaveBeenCalledWith("settings", "Datenarchiv");
  });

  it("empty store: the empty state also offers the history load", async () => {
    render(<SqueezeCard view={noBox} />);
    await waitFor(() => expect(screen.getByTestId("squeeze-empty")).toBeInTheDocument());
    expect(screen.getByTestId("squeeze-empty-history")).toHaveTextContent(S.historyNoneAny);
    fireEvent.click(screen.getByTestId("squeeze-empty-history-btn"));
    expect(openSettings).toHaveBeenCalledWith("settings", "Datenarchiv");
  });
});
