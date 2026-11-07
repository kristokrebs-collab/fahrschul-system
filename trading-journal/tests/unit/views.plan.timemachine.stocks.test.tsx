/**
 * The Zeitmaschine slot of the Handelsplan for a stock: Stunden- or Tageskerzen from the stock data contract (here a fake), only
 * CLOSED candles that existed before the plan, MIN_POOL_BARS respected with the reason, the plan costed with its own fees and no
 * funding, and every failure of the source keeps its reason. Crypto stays on the Labor's loader (see `views.plan.timemachine.test`).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isClosedBar, ok, stale, unavailable, type StockBars, type StockCandle, type StockInterval, type StockResult } from "@/market/stocks";
import { stockHistoryBars, stockOpen, tradingDaysBefore } from "../e2e/mocks/planStockCandles";

const fake = vi.hoisted(() => ({ bars: vi.fn(), loadLab: vi.fn() }));
vi.mock("@/market/stocks/client", () => ({ stockData: () => ({ bars: fake.bars }) }));
vi.mock("@/views/labor/historySource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/views/labor/historySource")>();
  return { ...actual, loadLabData: fake.loadLab };
});
vi.mock("@/views/timemachine/TimeMachineCard", () => ({
  default: (p: Record<string, unknown> & { candles: readonly { time: number }[]; options?: { horizon?: number }; costs?: unknown }) => (
    <div
      data-testid="tm-card-stub"
      data-symbol={String(p.symbol)}
      data-interval={String(p.interval)}
      data-market={String(p.market)}
      data-count={p.candles.length}
      data-last={p.candles.at(-1)?.time}
      data-horizon={p.options?.horizon ?? ""}
      data-start={String(p.startMs)}
      data-source={String(p.source)}
      data-costs={JSON.stringify(p.costs ?? null)}
    >
      {String(p.note)}
    </div>
  ),
}));

const { TimeMachineSlotImpl } = await import("@/views/plan/slotsImpl");

const DAY = "2026-10-23";
const OPEN = stockOpen(DAY);
const NOW = Date.UTC(2026, 9, 26, 10, 0); // the session of the 23rd is over
const H = 3_600_000;

const PLAN = {
  symbol: "AAPL",
  side: "long" as const,
  entry: 185.9,
  stop: 185.05,
  target: 187.6,
  qty: 20,
  candles: [],
  intervalMs: 300_000,
  sessionOpenMs: OPEN,
  sessionCloseMs: OPEN + 390 * 60_000,
  tz: "America/New_York",
  entryAt: OPEN + 25 * 60_000,
  flatByMs: OPEN + 385 * 60_000,
  tick: 0.01,
  currency: "USD",
  market: "stocks" as const,
  feePct: 0.0005,
  slippagePct: 0.0005,
  source: { label: "Yahoo Finance (inoffiziell)", fetchedAt: NOW },
};

const stockBars = (interval: StockInterval, rows: number[][], fetchedAt = NOW): StockBars => ({
  symbol: "AAPL",
  interval,
  range: interval === "1d" ? "5y" : "2y",
  candles: rows.map(([time, open, high, low, close, volume]): StockCandle => ({ time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume!, closed: isClosedBar(interval, time!, fetchedAt) })),
  meta: { name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", price: 186, prevClose: 185, volume: null, marketTime: null },
});
const stamp = { source: "yahoo" as const, asOf: NOW, receivedAt: NOW, fetchedAt: NOW - 120_000 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  fake.bars.mockReset();
  fake.loadLab.mockReset();
});

/** hourly history up to and including Monday the 26th, 62 trading days */
const history = () => stockHistoryBars("1h", "2026-10-27", 62);
const daysBeforePlan = () => 62 - 1 - tradingDaysBefore("2026-10-27", 62).indexOf(DAY); // the days before the 23rd in that list

describe("Zeitmaschine im Handelsplan · eine Aktie", () => {
  it("lädt nichts vor dem Klick, sagt was und woher – und bietet Stunden- oder Tageskerzen an", () => {
    render(<TimeMachineSlotImpl {...PLAN} />);
    const el = screen.getByTestId("hplan-timemachine");
    expect(el).toHaveAttribute("data-state", "idle");
    expect(el).toHaveTextContent("Dafür lädt sie Stunden-Kerzen von Yahoo Finance (inoffiziell) (bis zu 2 Jahre), nur bis zum Plan und ohne dessen eigenen Tag; erst nach deinem Klick.");
    expect(screen.getByRole("radio", { name: "Stunden-Kerzen" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tages-Kerzen" })).not.toBeChecked();
    expect(screen.getByTestId("hplan-timemachine-choice")).toHaveTextContent("Reichweite: bis zu 2 Jahre.");
    fireEvent.click(screen.getByRole("radio", { name: "Tages-Kerzen" }));
    expect(screen.getByTestId("hplan-timemachine")).toHaveTextContent("Tages-Kerzen von Yahoo Finance (inoffiziell) (bis zu 5 Jahre)");
    expect(screen.getByTestId("hplan-timemachine-choice")).toHaveTextContent("Reichweite: bis zu 5 Jahre.");
    expect(fake.bars).not.toHaveBeenCalled();
    expect(fake.loadLab).not.toHaveBeenCalled(); // die Börse für Krypto wird nie gefragt
  });

  it("Stunden-Kerzen: nur geschlossene Kerzen VOR dem Plan (nicht dessen eigener Tag, nicht die Tage danach), Zeitstopp bis „flat by“, Kosten des Plans, kein Funding", async () => {
    fake.bars.mockImplementation(async (): Promise<StockResult<StockBars>> => ok(stockBars("1h", history()), stamp));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    // Anfrage: Stunden-Kerzen, so weit wie die Quelle reicht
    expect(fake.bars).toHaveBeenCalledTimes(1);
    expect(fake.bars.mock.calls[0]!.slice(0, 2)).toEqual(["AAPL", "1h"]);
    expect(fake.bars.mock.calls[0]![2]).toMatchObject({ range: "2y" });
    // 62 Tage geliefert, davon die Tage ab dem 23. nicht: 7 Kerzen je Tag davor
    const before = daysBeforePlan();
    expect(card).toHaveAttribute("data-count", String(before * 7));
    // die letzte Kerze ist die letzte des letzten Handelstags VOR dem Plan (Donnerstag 22.10., 15:30 New York)
    const last = stockOpen("2026-10-22") + 6 * H;
    expect(card).toHaveAttribute("data-last", String(last));
    expect(card).toHaveAttribute("data-interval", "1h");
    expect(card).toHaveAttribute("data-market", "stocks");
    // der Plan beginnt mit der Stunde des Einstiegs (9:30) und läuft bis „flat by“ 15:55: 7 Stunden-Kerzen
    expect(card).toHaveAttribute("data-horizon", "7");
    expect(card).toHaveAttribute("data-start", String(OPEN));
    expect(card).toHaveAttribute("data-source", "Yahoo Finance (inoffiziell)");
    expect(JSON.parse(card.getAttribute("data-costs")!)).toEqual({ fees: { exchange: "Risiko-Einstellungen", makerBps: 5, takerBps: 5 }, slippage: { kind: "fixed", bps: 5 }, funding: { kind: "none" } });
    expect(card).toHaveTextContent(`Dein Handelsplan, durchgespielt auf ${before * 7} Stunden-Kerzen (1h).`);
    expect(card).toHaveTextContent("Der Zeitstopp ist das „Flat by“ des Plans: 7 Stunden-Kerzen ab 09:30 Uhr New York");
    expect(card).toHaveTextContent("Handelsfreie Zeiten (Nacht, Wochenende, Feiertage) sind Lücken in den Kerzen");
  });

  it("ein Einstieg am Nachmittag: die Rechnung beginnt mit seiner Stunde und läuft mindestens zwei Kerzen", async () => {
    fake.bars.mockImplementation(async () => ok(stockBars("1h", history()), stamp));
    render(<TimeMachineSlotImpl {...PLAN} entryAt={OPEN + 5 * 60 * 60_000 + 15 * 60_000} flatByMs={OPEN + 385 * 60_000} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    // 14:45 → die Stunde ab 14:30 (5 Stunden nach dem Beginn), bis 15:55: 2 Kerzen
    expect(card).toHaveAttribute("data-start", String(OPEN + 5 * H));
    expect(card).toHaveAttribute("data-horizon", "2");
  });

  it("Tages-Kerzen: bis zu 5 Jahre, ein Zeitstopp von fünf Handelstagen, und der Hinweis, dass nicht innerhalb des Tages gerechnet wird", async () => {
    fake.bars.mockImplementation(async () => ok(stockBars("1d", stockHistoryBars("1d", "2026-10-27", 400)), stamp));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByRole("radio", { name: "Tages-Kerzen" }));
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    expect(fake.bars.mock.calls[0]!.slice(0, 2)).toEqual(["AAPL", "1d"]);
    expect(fake.bars.mock.calls[0]![2]).toMatchObject({ range: "5y" });
    expect(card).toHaveAttribute("data-interval", "1d");
    // 400 Tage geliefert, davon der 23.10. und alles danach nicht
    expect(card).toHaveAttribute("data-count", String(400 - 1 - tradingDaysBefore("2026-10-27", 400).indexOf(DAY)));
    expect(card).toHaveAttribute("data-horizon", "5");
    expect(card).toHaveAttribute("data-start", "null");
    expect(card).toHaveTextContent("Eine Kerze ist ein ganzer Handelstag: die Zeitmaschine kann nicht innerhalb des Tages rechnen");
    expect(card).toHaveTextContent("berühren beide eine Kerze, zählt der Stop");
  });

  it("die laufende Sitzung: alles, was bis jetzt geschlossen ist – der heutige Vormittag zählt", async () => {
    const monday = stockOpen("2026-10-26");
    vi.setSystemTime(monday + 3 * H + 10 * 60_000); // 12:40 New York
    fake.bars.mockImplementation(async () => ok(stockBars("1h", history(), Date.now()), stamp));
    render(<TimeMachineSlotImpl {...PLAN} sessionOpenMs={monday} sessionCloseMs={monday + 390 * 60_000} entryAt={monday + 25 * 60_000} flatByMs={monday + 385 * 60_000} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    // die Stunden 9:30, 10:30 und 11:30 sind geschlossen (die von 12:30 läuft)
    expect(card).toHaveAttribute("data-last", String(monday + 2 * H));
  });

  it("zu wenige Kerzen vor dem Plan: der Grund mit der Zahl, keine Karte", async () => {
    fake.bars.mockImplementation(async () => ok(stockBars("1h", stockHistoryBars("1h", "2026-10-23", 20)), stamp));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("hplan-timemachine-error")).toHaveTextContent("Für AAPL liefert Yahoo Finance (inoffiziell) vor diesem Plan nur 140 geschlossene Stunden-Kerzen – mindestens 200 sind nötig (bei Stunden-Kerzen rund 29 Handelstage). Ein junger Börsengang hat oft zu wenig Verlauf; die Tages-Kerzen reichen weiter zurück.");
    expect(screen.queryByTestId("tm-card-stub")).toBeNull();
  });

  it("gar keine Kerzen: auch das steht da", async () => {
    fake.bars.mockImplementation(async () => ok(stockBars("1d", []), stamp));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByRole("radio", { name: "Tages-Kerzen" }));
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("hplan-timemachine-error")).toHaveTextContent("Für AAPL liefert Yahoo Finance (inoffiziell) keine geschlossenen Tages-Kerzen vor diesem Plan.");
  });

  it("die Quelle ist nicht erreichbar: der Grund der Quelle steht da, nichts wird gerechnet", async () => {
    fake.bars.mockImplementation(async () => unavailable<StockBars>("blocked", NOW));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("hplan-timemachine-error")).toHaveTextContent("Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe dieses Servers. Sie ist inoffiziell und kann ohne Vorwarnung sperren.");
    expect(screen.queryByTestId("tm-card-stub")).toBeNull();
    // und ein neuer Klick versucht es noch einmal
    fake.bars.mockImplementation(async () => ok(stockBars("1h", history()), stamp));
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("tm-card-stub")).toBeInTheDocument();
  });

  it("ein alter Stand aus dem Zwischenspeicher wird als solcher benannt – mit dem Grund", async () => {
    fake.bars.mockImplementation(async () => stale(stockBars("1h", history()), stamp, "rate-limited", "Die Quelle oder der Server begrenzt die Abrufe gerade. Bitte in einigen Minuten erneut versuchen.", NOW));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    expect(card).toHaveAttribute("data-source", "Yahoo Finance (inoffiziell) – Zwischenspeicher dieses Browsers");
    expect(card).toHaveTextContent("Der Abruf bei Yahoo Finance (inoffiziell) ist fehlgeschlagen (Die Quelle oder der Server begrenzt die Abrufe gerade.");
    expect(card).toHaveTextContent("gerechnet wird mit dem früher gespeicherten Stand.");
  });

  it("ohne Netz (kein Server): der Grund steht da", async () => {
    fake.bars.mockImplementation(async () => unavailable<StockBars>("no-server", NOW));
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    await waitFor(() => expect(screen.getByTestId("hplan-timemachine-error")).toHaveTextContent("Die Server-Funktionen für Aktien-Daten sind auf dieser Seite nicht eingerichtet."));
  });

  it("ein abgebrochener Abruf lässt keinen halben Zustand zurück", async () => {
    let signal: AbortSignal | undefined;
    fake.bars.mockImplementation((_s: string, _i: string, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => undefined);
    });
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("hplan-timemachine-loading")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hplan-timemachine-cancel"));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByTestId("hplan-timemachine")).toHaveAttribute("data-state", "idle");
  });
});

describe("Zeitmaschine im Handelsplan · Krypto bleibt, wie es war", () => {
  it("ein Krypto-Plan fragt die Börse des Labors, nie die Aktien-Quelle, und bekommt keine Aktien-Kosten", async () => {
    const end = Math.floor(NOW / 900_000) * 900_000 - 900_000;
    fake.loadLab.mockResolvedValue({ data: { "15m": Array.from({ length: 400 }, (_, i) => ({ t: (end - (399 - i) * 900_000) / 1000, o: 100, h: 101, l: 99, c: 100, v: 1 })) }, pages: 1 });
    render(<TimeMachineSlotImpl {...PLAN} symbol="BTCUSDT" market="crypto" intervalMs={900_000} source={{ label: "Binance USDⓈ-M", fetchedAt: 1 }} />);
    expect(screen.queryByTestId("hplan-timemachine-choice")).toBeNull();
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    const card = await screen.findByTestId("tm-card-stub");
    expect(fake.bars).not.toHaveBeenCalled();
    expect(card).toHaveAttribute("data-count", "400");
    expect(card).toHaveAttribute("data-costs", "null"); // die Standardkosten des Labors (Funding inklusive)
    expect(card).toHaveAttribute("data-horizon", "");
    expect(card).toHaveAttribute("data-start", "null");
  });
});
