/**
 * The Aktien page (F67 scanner, watchlist, F68 news part) in jsdom, on the real stock contract with a fake API behind it
 * (the wire format of the four functions, parsed by the real client): the scan with its honest counts, the sentence of every
 * hit, the rank switch, the chart preview, the watchlist writes into `settings.watchlist`, the keyword-rated and merged
 * headlines with "Neu seit dem letzten Besuch", the analyst panels and the Congress tracker (its own tests: `views.aktien.kongress.test.tsx`), the plan link that exists only with a plan page,
 * and the reasons shown when the data cannot be had.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { memoryKV } from "@/market/cache";
import { createStockData } from "@/market/stocks/client";
import { createLimiter } from "@/market/stocks/throttle";
import { storageKey } from "@/store/storage";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const DAY = 86_400_000;
const MIN = 60_000;

const fake = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/market/stocks/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/stocks/client")>();
  return { ...actual, stockData: () => fake.data };
});

const { AktienView } = await import("@/views/aktien/AktienView");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useAktien, resetAktienForTests } = await import("@/views/aktien/aktienStore");
const { resetFeedsForTests } = await import("@/views/aktien/feedStores");
const { planHash, planPageExists } = await import("@/views/aktien/ResultsCard");
const { PAGES } = await import("@/store/uiStore");
const { useJournal } = await import("@/store/journalStore");

/* ------------------------------------------------------------------ data */

const flat = (n: number, v: number): number[] => Array.from({ length: n }, () => v);
/** 24 flat closes, a run from 80 to 90 over ten bars, then a tight flag of five closes: +12.5 % and a 0.8 % range (40 bars) */
const FLAG_CLOSES = [...flat(24, 80), 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 90, 90.5, 89.8, 90.2, 90.1];
/** a fall with small bounces and an up-close at the end: the RSI was under 30 on the bar before */
const OVERSOLD_CLOSES = [...Array.from({ length: 39 }, (_, i) => 100 - i * 1.4 + (i % 4 === 0 ? 2.4 : 0)), 48.4];

const dailyBars = (closes: readonly number[], volume = 2_000_000): [number, number, number, number, number, number][] => {
  const midnight = Math.floor(Date.now() / DAY) * DAY;
  return closes.map((c, i) => [midnight - (closes.length - i + 1) * DAY + 14.5 * 3_600_000, c, c * 1.002, c * 0.998, c, volume]);
};
const meta = (name: string, price: number) => ({ name, currency: "USD", exchange: "NasdaqGS", price, prevClose: price - 1, volume: 5_000_000, marketTime: Date.now() - 3_600_000 });

const DIRECTORY: [string, string, string, string | null][] = [
  ["FLAG", "Flag Corp. - Common Stock", "NASDAQ", "N"],
  ["ALOW", "Oversold Inc. Common Stock", "NYSE", null],
  ["DULL", "Dull Holdings - Common Stock", "NASDAQ", "N"],
  ["CHEAP", "Cheap Co. - Common Stock", "NASDAQ", "N"],
  ["DEFI", "Deficient Ltd. - Common Stock", "NASDAQ", "D"],
  ["NOPE", "Nope Corp. - Common Stock", "NASDAQ", "N"],
];
const CLOSES: Record<string, number[]> = { FLAG: FLAG_CLOSES, ALOW: OVERSOLD_CLOSES, DULL: flat(40, 50), CHEAP: flat(40, 2), DEFI: flat(40, 30) };
const BAD = { ok: false, reason: "bad-symbol", message: "Yahoo Finance kennt dieses Kürzel nicht." };

interface World {
  directory: "ok" | "blocked" | "missing";
  news: (symbol: string) => unknown;
  calls: { path: string; query: Record<string, string> }[];
}
const world: World = { directory: "ok", news: () => ({ ok: true, items: [] }), calls: [] };

async function api(path: string, init?: { query?: Record<string, string | number | boolean | null | undefined>; signal?: AbortSignal }): Promise<unknown> {
  const query = Object.fromEntries(Object.entries(init?.query ?? {}).map(([k, v]) => [k, String(v)]));
  world.calls.push({ path, query });
  const symbols = (query["symbols"] ?? "").split(",").filter(Boolean);
  if (path === "/stocks/symbols") {
    if (world.directory === "missing") throw new ApiError(0, "functions_missing", FUNCTIONS_MISSING);
    if (world.directory === "blocked") throw new ApiError(502, "stock_upstream_blocked", "Nasdaq Trader verweigert den Abruf (HTTP 403).");
    return { source: "nasdaqtrader", fileTime: Date.UTC(2026, 9, 24, 1, 31), fetchedAt: Date.now(), counts: { rows: 40, kept: DIRECTORY.length, dropped: { ETFs: 20, Warrants: 10 } }, symbols: DIRECTORY };
  }
  if (path === "/stocks/bars") {
    const results = Object.fromEntries(symbols.map((s) => [s, CLOSES[s] ? { ok: true, bars: dailyBars(CLOSES[s]!), meta: meta(s, CLOSES[s]![CLOSES[s]!.length - 1]!) } : BAD]));
    return { source: "yahoo", interval: query["interval"], range: query["range"], fetchedAt: Date.now(), results };
  }
  if (path === "/stocks/quote") {
    const results = Object.fromEntries(symbols.map((s) => [s, { ok: true, name: `${s} Corp.`, currency: "USD", exchange: "NasdaqGS", price: 123.45, prevClose: 120, change: 3.45, changePct: 2.875, dayHigh: 124, dayLow: 119, volume: 1000, fiftyTwoWeekHigh: 130, fiftyTwoWeekLow: 90, marketTime: Date.now() - 3_600_000 }]));
    return { source: "yahoo", fetchedAt: Date.now(), results };
  }
  if (path === "/stocks/news") return { source: "yahoo-rss", fetchedAt: Date.now(), results: Object.fromEntries(symbols.map((s) => [s, world.news(s)])) };
  throw new ApiError(404, "not_found", path);
}

const wrap = () =>
  render(
    <MotionRoot>
      <AktienView />
    </MotionRoot>,
  );

const figure = (id: string): number => Number(within(screen.getByTestId(id)).getAllByText(/\d/)[0]!.textContent!.replace(/\D/g, ""));

async function scan(): Promise<void> {
  fireEvent.click(screen.getByTestId("aktien-start"));
  await screen.findByTestId("aktien-summary", undefined, { timeout: 15_000 });
}

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  localStorage.clear();
  world.directory = "ok";
  world.news = () => ({ ok: true, items: [] });
  world.calls = [];
  fake.data = createStockData({ api: api as never, kv: memoryKV(), limiter: createLimiter({ capacity: 10_000, concurrency: 4 }), online: () => true });
  Element.prototype.scrollIntoView = vi.fn();
  resetAktienForTests();
  resetFeedsForTests();
  await bootFixtureJournal();
});
afterEach(() => {
  resetAktienForTests();
  resetFeedsForTests();
});

/* ------------------------------------------------------------------ specs */

describe("Aktien page", () => {
  it("shows the five sections, the empty states, the analyst panels, the Congress tracker and the closing sentence", async () => {
    wrap();
    expect(screen.getByRole("heading", { level: 1, name: "Aktien" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Inhalt dieser Seite" });
    expect(within(nav).getAllByRole("button").map((l) => l.textContent)).toEqual(["Scanner", "Watchlist", "News", "Analyse", "DCF-Rechner", "Kaufthese", "Kongress"]);
    expect(screen.getByTestId("aktien-results-idle")).toBeInTheDocument();
    expect(screen.getByTestId("aktien-watch-empty")).toBeInTheDocument();
    expect(screen.getByTestId("aktien-news-empty")).toBeInTheDocument();
    // the analyst section hosts the three panels (numbers, DCF, thesis); the Congress section hosts the tracker
    const analyse = await screen.findByTestId("aktien-analyse", undefined, { timeout: 15_000 }); // lazy chunks: more than the default second on a busy machine
    expect(await within(analyse).findByTestId("analyst-panel", undefined, { timeout: 15_000 })).toBeInTheDocument();
    expect(await within(analyse).findByTestId("dcf-panel", undefined, { timeout: 15_000 })).toBeInTheDocument();
    expect(await within(analyse).findByTestId("thesis-panel", undefined, { timeout: 15_000 })).toBeInTheDocument();
    const kongress = await screen.findByTestId("aktien-kongress", undefined, { timeout: 15_000 });
    expect(kongress).toHaveTextContent("Kongress-Tracker");
    expect(kongress).not.toHaveTextContent("Kommt gleich");
    // the caveats are on screen from the first paint; the Clerk is asked only once the section has been on screen (no observer fires here)
    expect(within(kongress).getByTestId("kongress-caveats")).toHaveTextContent("bis zu 45 Tage");
    expect(within(kongress).getByTestId("kongress-senate")).toHaveTextContent("Senat: nur von Hand");
    // the standing sentence appears once per page: the analyst panels keep only their own lead line
    expect(screen.getAllByTestId("analysis-note")).toHaveLength(1);
    expect(within(analyse).getAllByTestId("analysis-lead")).toHaveLength(3);
    expect(screen.getByTestId("analysis-note")).toHaveTextContent(/Die App sendet nie Orders/);
    expect(world.calls).toEqual([]); // opening the page asks for nothing: a scan starts only when the trader starts it
  });

  it("shows the thresholds of the rules with their numbers and keeps a changed one for the next visit", async () => {
    wrap();
    fireEvent.click(screen.getByTestId("aktien-rules-toggle"));
    const flag = await screen.findByTestId("aktien-rule-flag");
    expect(within(flag).getByLabelText("mehr als")).toHaveValue("10");
    expect(within(flag).getByLabelText("Spanne unter")).toHaveValue("5");
    expect(within(screen.getByTestId("aktien-rule-rsi")).getByLabelText("überverkauft unter")).toHaveValue("30");
    const gain = within(flag).getByLabelText("mehr als");
    fireEvent.change(gain, { target: { value: "15" } });
    fireEvent.blur(gain);
    expect(useAktien.getState().params["stock:daily"]?.flag.poleMinGain).toBeCloseTo(0.15, 10);
    expect(JSON.parse(localStorage.getItem(storageKey("aktien-scan"))!).params["stock:daily"].flag.poleMinGain).toBeCloseTo(0.15, 10);
  });

  it("scans the directory: counts what was scanned, skipped (with the reason) and failed (with the rate) – and lists the hits ranked, each with its sentence", async () => {
    wrap();
    await scan();
    // 6 charts: FLAG, ALOW, DULL scanned · CHEAP (price) and DEFI (status) skipped · NOPE failed (unknown ticker)
    expect([figure("aktien-n-requested"), figure("aktien-n-scanned"), figure("aktien-n-skipped"), figure("aktien-n-failed"), figure("aktien-n-hits")]).toEqual([6, 3, 2, 1, 2]);
    expect(screen.getByTestId("aktien-n-failed")).toHaveTextContent("Fehlerquote 16,7 %");
    expect(screen.getByTestId("aktien-skipped-by")).toHaveTextContent("Kurs unter dem Mindestpreis");
    expect(screen.getByTestId("aktien-skipped-by")).toHaveTextContent("Nasdaq-Finanzstatus nicht normal");
    expect(screen.getByTestId("aktien-failed-by")).toHaveTextContent("Kürzel unbekannt");
    expect(screen.getByTestId("aktien-sample")).toHaveTextContent("Block 1 von 1 des Verzeichnisses");
    expect(screen.getByTestId("aktien-universe-stand")).toHaveTextContent("Nasdaq Trader Symbolverzeichnis");
    expect(world.calls.filter((c) => c.path === "/stocks/symbols")).toHaveLength(1);
    // only tickers, the interval and the range travel to the functions – nothing of the journal, the settings or the user
    for (const c of world.calls) expect(Object.keys(c.query).filter((k) => !["symbols", "interval", "range"].includes(k))).toEqual([]);
    for (const c of world.calls.filter((x) => x.path === "/stocks/bars")) expect(Object.keys(c.query).sort()).toEqual(["interval", "range", "symbols"]);

    const hits = screen.getAllByTestId("aktien-hit");
    expect(hits.map((h) => h.getAttribute("data-symbol"))).toEqual(["FLAG", "ALOW"]);
    expect(screen.getAllByTestId("aktien-rank").map((r) => r.textContent)).toEqual(["1", "2"]);
    const flag = hits[0]!;
    expect(flag).toHaveAttribute("data-setup", "flag");
    expect(within(flag).getByTestId("aktien-why")).toHaveTextContent("Erst +12,5 % in 10 Tagen (80,00 → 90,00), dann 5 Schlusskurse in einer Spanne von nur 0,8 %.");
    expect(within(flag).getByTestId("aktien-hit-stand")).toHaveTextContent("Quelle: Yahoo Finance (inoffiziell)");
    expect(within(flag).getByTestId("aktien-hit-stand")).toHaveTextContent("letzte Kerze");
    expect(hits[1]).toHaveAttribute("data-setup", "rsi");
    expect(within(hits[1]!).getByTestId("aktien-why")).toHaveTextContent("RSI(14) lag zuvor bei");
    expect(within(screen.getByTestId("aktien-results")).getByTestId("aktien-note")).not.toHaveTextContent("Finanzberatung");
  });

  it("sorts the hits as the trader chooses and says what the rank is", async () => {
    wrap();
    await scan();
    expect(screen.getAllByTestId("aktien-hit").map((h) => h.getAttribute("data-symbol"))).toEqual(["FLAG", "ALOW"]); // by turnover: the dearer chart first
    expect(screen.getByTestId("aktien-results")).toHaveTextContent("nicht, wie gut ein Setup ist");
    fireEvent.click(screen.getByRole("radio", { name: "Kürzel A–Z" }));
    expect(screen.getAllByTestId("aktien-hit").map((h) => h.getAttribute("data-symbol"))).toEqual(["ALOW", "FLAG"]);
    expect(screen.getAllByTestId("aktien-rank").map((r) => r.textContent)).toEqual(["1", "2"]);
    expect(useAktien.getState().prefs.rank).toBe("symbol");
  });

  it("opens the chart preview with the checked conditions and the time the rule matched", async () => {
    wrap();
    await scan();
    const flag = screen.getAllByTestId("aktien-hit")[0]!;
    expect(within(flag).queryByTestId("aktien-hit-detail")).toBeNull();
    fireEvent.click(within(flag).getByTestId("aktien-hit-chart"));
    const detail = within(flag).getByTestId("aktien-hit-detail");
    expect(within(detail).getByTestId("aktien-minichart")).toBeInTheDocument();
    expect(detail).toHaveTextContent("Geprüfte Bedingungen");
    expect(detail).toHaveTextContent("Schwelle: mehr als 10,0 %");
    expect(within(detail).getByTestId("aktien-hit-when")).toHaveTextContent(/^Regel passte auf der Kerze vom \d{2}\.\d{2}\.$/);
  });

  it("changing a threshold changes the result: a stricter pole removes the flag", async () => {
    wrap();
    fireEvent.click(screen.getByTestId("aktien-rules-toggle"));
    const gain = within(await screen.findByTestId("aktien-rule-flag")).getByLabelText("mehr als");
    fireEvent.change(gain, { target: { value: "20" } });
    fireEvent.blur(gain);
    await scan();
    expect(screen.getAllByTestId("aktien-hit").map((h) => h.getAttribute("data-symbol"))).toEqual(["ALOW"]);
  });

  it("the plan link exists only when the plan page does – and then points at the plan with ticker and side", async () => {
    expect(planPageExists(["overview", "markt"])).toBe(false);
    expect(planPageExists(["overview", "plan"])).toBe(true);
    expect(planHash("FLAG", "long")).toBe("#plan?symbol=FLAG&side=long");
    expect(planHash("BRK.B", "short")).toBe("#plan?symbol=BRK.B&side=short");
    wrap();
    await scan();
    const links = screen.queryAllByTestId("aktien-hit-plan");
    // the page `plan` exists (it reads the link: market and direction, nothing else): every hit offers it
    expect((PAGES as readonly string[]).includes("plan")).toBe(true);
    expect(links.length).toBe(screen.getAllByTestId("aktien-hit").length);
    const hit = links[0]!.closest('[data-testid="aktien-hit"]')!;
    fireEvent.click(links[0]!);
    expect(window.location.hash).toBe(planHash(hit.getAttribute("data-symbol")!, hit.getAttribute("data-side") as "long" | "short"));
    expect(window.location.hash).toMatch(/^#plan\?symbol=[A-Z.]+&side=(long|short)$/);
    history.replaceState(null, "", "#aktien");
  });

  it("puts a hit on the watchlist (saved at once into the settings) and takes it off again", async () => {
    wrap();
    await scan();
    const flag = screen.getAllByTestId("aktien-hit")[0]!;
    fireEvent.click(within(flag).getByTestId("aktien-hit-watch"));
    await waitFor(() => expect(within(flag).getByTestId("aktien-hit-watch")).toHaveTextContent("Auf der Watchlist"));
    const wl = useJournal.getState().settings.watchlist as { v: number; items: { id: string; kind: string; symbol: string }[] };
    expect(wl.v).toBe(1);
    expect(wl.items.map((i) => i.id)).toEqual(["stock:FLAG"]);
    const row = await screen.findByTestId("aktien-watch-row");
    expect(row).toHaveAttribute("data-symbol", "FLAG");
    await waitFor(() => expect(within(row).getByTestId("aktien-watch-quote")).toHaveTextContent("123,45"));
    expect(within(row).getByTestId("aktien-watch-quote")).toHaveTextContent("+2,88 %");
    expect(screen.getByTestId("aktien-watch-stand")).toHaveTextContent("Quelle: Yahoo Finance (inoffiziell)");
    // again: off the list
    fireEvent.click(within(flag).getByTestId("aktien-hit-watch"));
    await waitFor(() => expect(screen.getByTestId("aktien-watch-empty")).toBeInTheDocument());
    expect((useJournal.getState().settings.watchlist as { items: unknown[] }).items).toEqual([]);
  });

  it("the watchlist refuses a bad ticker and a duplicate with a reason, keeps unknown keys of the stored list and caps at 50", async () => {
    await act(async () => {
      const { settings, saveSettings } = useJournal.getState();
      await saveSettings({ ...settings, watchlist: { v: 1, items: [{ id: "stock:MSFT", kind: "stock", symbol: "MSFT", name: "Microsoft", addedAt: 1, note: null }], future: { keep: true } } });
    });
    wrap();
    const input = screen.getByTestId("aktien-watch-input");
    fireEvent.change(input, { target: { value: "msft" } });
    fireEvent.click(screen.getByTestId("aktien-watch-add"));
    await waitFor(() => expect(screen.getByTestId("aktien-watch-msg")).toHaveTextContent("Steht schon auf der Watchlist."));
    fireEvent.change(input, { target: { value: "12 34" } });
    fireEvent.click(screen.getByTestId("aktien-watch-add"));
    await waitFor(() => expect(screen.getByTestId("aktien-watch-msg")).toHaveTextContent("Das ist kein gültiges Kürzel."));
    fireEvent.change(input, { target: { value: "nvda" } });
    fireEvent.click(screen.getByTestId("aktien-watch-add"));
    await waitFor(() => expect(screen.getAllByTestId("aktien-watch-row").map((r) => r.getAttribute("data-symbol"))).toEqual(["MSFT", "NVDA"]));
    const saved = useJournal.getState().settings.watchlist as { items: { id: string }[]; future?: unknown };
    expect(saved.items.map((i) => i.id)).toEqual(["stock:MSFT", "stock:NVDA"]);
    expect(saved.future).toEqual({ keep: true });
  });

  it("news: merged across tickers, rated by keyword (a hint, with the words shown), 'Neu' since the last visit, marked read", async () => {
    const now = Date.now();
    const item = (id: string, title: string, ageMin: number, host = "finance.yahoo.com") => ({ id, title, url: `https://${host}/${id}`, publisher: host, publishedAt: now - ageMin * MIN, summary: null });
    localStorage.setItem(storageKey("aktien-news-seen"), JSON.stringify({ lastVisit: now - 120 * MIN }));
    world.news = (s) =>
      s === "TSLA"
        ? { ok: true, items: [item("a", "Tesla files for Chapter 11 bankruptcy protection", 30), item("b", "Analyst upgrades Tesla, raises price target", 90, "marketwatch.com"), item("c", "Tesla opens a new store in Berlin", 200), item("old", "Tesla news from last month", 10 * 24 * 60)] }
        : { ok: true, items: [item("a", "Tesla files for Chapter 11 bankruptcy protection", 30), item("d", "Nvidia earnings: revenue tops forecasts", 60)] };
    await act(async () => {
      const { settings, saveSettings } = useJournal.getState();
      const at = (symbol: string) => ({ id: `stock:${symbol}`, kind: "stock", symbol, name: symbol, addedAt: 1, note: null });
      await saveSettings({ ...settings, watchlist: { v: 1, items: [at("TSLA"), at("NVDA")] } });
    });
    wrap();
    const stories = await screen.findAllByTestId("aktien-story", undefined, { timeout: 10_000 });
    expect(stories).toHaveLength(4); // the 10-day-old one is outside the 3-day window, the shared headline is merged
    const first = stories[0]!;
    expect(first).toHaveAttribute("data-level", "high");
    expect(first).toHaveTextContent("Chapter 11");
    expect(within(first).getByTestId("aktien-story-words")).toHaveTextContent("Stichwörter: Chapter 11");
    expect(first).toHaveTextContent("TSLA");
    expect(first).toHaveTextContent("NVDA");
    expect(within(first).getByTestId("aktien-story-link")).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByTestId("aktien-story").filter((s) => s.getAttribute("data-new") === "1")).toHaveLength(3);
    expect(screen.getByTestId("aktien-news-visit")).toHaveTextContent("3 Meldungen neu seit dem letzten Besuch");
    expect(screen.getByTestId("aktien-news-stand")).toHaveTextContent("Quelle: Yahoo Finance");
    expect(within(screen.getByTestId("aktien-news")).getByTestId("aktien-note")).not.toHaveTextContent("Finanzberatung");
    // only tickers travel to the function
    for (const c of world.calls.filter((x) => x.path === "/stocks/news")) expect(Object.keys(c.query)).toEqual(["symbols"]);
    fireEvent.click(screen.getByTestId("aktien-news-markread"));
    await waitFor(() => expect(screen.getByTestId("aktien-news-visit")).toHaveTextContent("Nichts Neues seit dem letzten Besuch"));
    expect(screen.getAllByTestId("aktien-story").filter((s) => s.getAttribute("data-new") === "1")).toHaveLength(0);
  });
});

describe("Aktien page · when the data cannot be had", () => {
  it("a blocked directory: the reason is shown, nothing is listed, nothing is invented", async () => {
    world.directory = "blocked";
    wrap();
    fireEvent.click(screen.getByTestId("aktien-start"));
    const err = await screen.findByTestId("aktien-error", undefined, { timeout: 15_000 });
    expect(err).toHaveAttribute("data-reason", "blocked");
    expect(err).toHaveTextContent("Symbolverzeichnis");
    expect(screen.queryAllByTestId("aktien-hit")).toHaveLength(0);
    expect(screen.queryByTestId("aktien-summary")).toBeNull();
    expect(screen.getByTestId("aktien-results-idle")).toHaveTextContent("nicht laufen konnte");
    expect(useAktien.getState().run.status).toBe("error");
  });

  it("without server functions (a static host): the reason says so", async () => {
    world.directory = "missing";
    wrap();
    fireEvent.click(screen.getByTestId("aktien-start"));
    const err = await screen.findByTestId("aktien-error", undefined, { timeout: 15_000 });
    expect(err).toHaveAttribute("data-reason", "no-server");
    expect(screen.queryAllByTestId("aktien-hit")).toHaveLength(0);
  });

  it("an empty watchlist as the source says what is missing instead of scanning nothing", async () => {
    wrap();
    useAktien.getState().setPrefs({ stock: { ...useAktien.getState().prefs.stock, source: "watchlist" } });
    fireEvent.click(await screen.findByTestId("aktien-start"));
    const err = await screen.findByTestId("aktien-error", undefined, { timeout: 15_000 });
    expect(err).toHaveTextContent("keine Aktien");
    expect(world.calls.filter((c) => c.path === "/stocks/bars")).toHaveLength(0);
  });

  it("no setup chosen: the start button is off", async () => {
    wrap();
    fireEvent.click(screen.getByTestId("aktien-setup-flag"));
    fireEvent.click(screen.getByTestId("aktien-setup-rsi"));
    expect(screen.getByTestId("aktien-start")).toBeDisabled();
  });
});
