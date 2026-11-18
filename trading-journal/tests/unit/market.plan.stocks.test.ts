/**
 * Aktien-Kerzen des Handelsplans (`src/market/plan/stockCandles.ts`) auf einem nachgebauten Aktien-Datenvertrag: welcher Zeitraum
 * gefragt wird, wann eine Kerze geschlossen zählt (die Quelle muss aufgeholt haben), 30 Minuten aus 15 Minuten, und jeder Ausfall
 * mit Grund – nie ein erfundener Wert. Keine Uhr, kein Netz.
 */
import { describe, expect, it, vi } from "vitest";
import { ok, stale, unavailable, isClosedBar, type StockBars, type StockCandle, type StockDataContract, type StockInterval, type StockResult } from "@/market/stocks";
import { buildCandles, CATCH_UP_MS, loadStockPlanCandles, rangeFor, STOCK_NOTES, STOCK_SOURCE_LABEL, type StockPlanDeps } from "@/market/plan/stockCandles";
import { stockOpen, stockSessionBars } from "../e2e/mocks/planStockCandles";

const DAY = "2026-10-23";
const OPEN = stockOpen(DAY);
const M = 60_000;
const IV5 = 5 * M;

const candlesOf = (interval: StockInterval, fetchedAt: number, rows = stockSessionBars(DAY)): StockCandle[] =>
  rows.map(([t, o, h, l, c, v]) => ({ time: t!, open: o!, high: h!, low: l!, close: c!, volume: v!, closed: isClosedBar(interval, t!, fetchedAt) }));

function bars(candles: StockCandle[], interval: StockInterval, marketTime: number | null = null, currency: string | null = "USD"): StockBars {
  return { symbol: "AAPL", interval, range: "5d", candles, meta: { name: "Apple Inc.", currency, exchange: "NasdaqGS", price: candles.at(-1)?.close ?? null, prevClose: null, volume: null, marketTime } };
}

interface Rig {
  deps: StockPlanDeps;
  calls: Array<{ symbol: string; interval: StockInterval; opts: Record<string, unknown> | undefined }>;
}
function rig(answer: (interval: StockInterval) => StockResult<StockBars>, now: number): Rig {
  const calls: Rig["calls"] = [];
  const data = {
    bars: vi.fn(async (symbol: string, interval: StockInterval, opts?: Record<string, unknown>) => {
      calls.push({ symbol, interval, opts });
      return answer(interval);
    }),
  } as unknown as StockDataContract;
  return { deps: { data: () => data, now: () => now }, calls };
}

const stampAt = (at: number, asOf: number | null = at) => ({ source: "yahoo" as const, asOf, receivedAt: at, fetchedAt: at });
const req = (over: Partial<Parameters<typeof loadStockPlanCandles>[0]> = {}) => ({ symbol: "AAPL", interval: "5m" as const, from: OPEN - 40 * IV5, to: OPEN + 390 * M, ...over });
const AFTER = Date.UTC(2026, 9, 26, 10, 0); // Monday morning: the Friday session is a look back

describe("rangeFor: welcher Zeitraum die Sitzung abdeckt", () => {
  it("heute: 1d · bis vier Kalendertage zurück: 5d · bis 28: 1mo", () => {
    expect(rangeFor("5m", "2026-10-26", "2026-10-26")).toEqual({ range: "1d" });
    expect(rangeFor("5m", "2026-10-23", "2026-10-26")).toEqual({ range: "5d" }); // Freitag, am Montag gesehen
    expect(rangeFor("5m", "2026-10-22", "2026-10-26")).toEqual({ range: "5d" }); // vier Tage
    expect(rangeFor("5m", "2026-10-21", "2026-10-26")).toEqual({ range: "1mo" }); // fünf Tage
    expect(rangeFor("15m", "2026-09-28", "2026-10-26")).toEqual({ range: "1mo" }); // 28 Tage
  });
  it("weiter zurück als einen Monat: kein Abruf, sondern der Grund mit der Zahl", () => {
    const r = rangeFor("5m", "2026-09-27", "2026-10-26");
    expect(r).toEqual({ error: "Yahoo Finance liefert 5-Minuten-Kerzen nur für die letzten rund vier Wochen; der So 27.09. liegt 29 Tage zurück. Wähle einen jüngeren Tag." });
    expect(rangeFor("15m", "2026-01-05", "2026-10-26")).toMatchObject({ error: expect.stringContaining("15-Minuten-Kerzen") });
  });
  it("ein Tag in der Zukunft fragt höchstens den heutigen Tag", () => {
    expect(rangeFor("5m", "2026-10-30", "2026-10-26")).toEqual({ range: "1d" });
  });
});

describe("buildCandles: wann eine Kerze geschlossen zählt", () => {
  const fetchMs = OPEN + 62 * M + 10_000; // 10:32:10 – die Kerze von 10:30 läuft
  const slot = (k: number) => OPEN + k * IV5;
  const opts = { fetchMs, marketTime: null as number | null, stockIvMs: IV5, planIvMs: IV5, from: OPEN - 1000 * IV5, to: fetchMs };
  const live = (n: number): StockCandle[] => candlesOf("5m", fetchMs, stockSessionBars(DAY, n));

  it("alles bis zur laufenden Kerze ist geschlossen, die laufende Kerze nie", () => {
    const out = buildCandles(live(13), opts); // Kerzen 0–12; die von 10:30 (Nr. 12) läuft
    expect(out).toHaveLength(13);
    expect(out.slice(0, 12).every((c) => c.closed)).toBe(true);
    expect(out[12]).toMatchObject({ time: slot(12), closed: false });
    expect(out[12]!.closeTime).toBe(slot(12) + IV5 - 1);
  });

  it("Kerze abgelaufen, aber die Quelle hat noch nicht aufgeholt: erst nach einer Minute oder mit späterem Handel", () => {
    // 10:30:20 – die Kerze 10:25 (Nr. 11) ist nach der Uhr zu, die Daten enden bei ihr, der letzte Handel liegt vor ihrem Ende
    const t = slot(12) + 20_000;
    const data = candlesOf("5m", t, stockSessionBars(DAY, 12));
    expect(data.at(-1)!.closed).toBe(true); // so liefert es der Vertrag: das Ende der Kerze liegt vor dem Abruf
    const early = buildCandles(data, { ...opts, fetchMs: t, marketTime: slot(12) - 10_000 });
    expect(early.at(-1)).toMatchObject({ time: slot(11), closed: false });
    expect(early.slice(0, 11).every((c) => c.closed)).toBe(true);
    // der letzte Handel liegt nach dem Ende der Kerze: aufgeholt
    expect(buildCandles(data, { ...opts, fetchMs: t, marketTime: slot(12) + 5_000 }).at(-1)!.closed).toBe(true);
    // eine Minute später ohne neuen Handel: Yahoo wartet höchstens eine Minute
    const later = slot(12) + CATCH_UP_MS;
    expect(buildCandles(candlesOf("5m", later, stockSessionBars(DAY, 12)), { ...opts, fetchMs: later, marketTime: slot(12) - 10_000 }).at(-1)!.closed).toBe(true);
    // und eine spätere Kerze in den Daten beweist es
    expect(buildCandles(candlesOf("5m", t, stockSessionBars(DAY, 13)), { ...opts, fetchMs: t, marketTime: null }).at(-2)!.closed).toBe(true);
  });

  it("Preise ohne Gleitkomma-Rauschen, sortiert, nur das gefragte Fenster", () => {
    const noisy: StockCandle[] = [
      { time: slot(1), open: 177.4600067138672, high: 177.52999877929688, low: 177.3699951171875, close: 177.4900054931641, volume: 5, closed: true },
      { time: slot(0), open: 177.3, high: 177.5, low: 177.2, close: 177.46, volume: 7, closed: true },
      { time: slot(2), open: 177.5, high: 177.6, low: 177.4, close: 177.55, volume: 9, closed: true },
    ];
    const out = buildCandles(noisy, { ...opts, from: slot(0), to: slot(1) });
    expect(out.map((c) => c.time)).toEqual([slot(0), slot(1)]);
    expect(out[1]).toMatchObject({ open: 177.46, high: 177.53, low: 177.37, close: 177.49 });
  });

  it("30 Minuten aus je zwei 15-Minuten-Kerzen: Eröffnung der ersten, Hoch/Tief, Schluss der zweiten, Summe des Volumens; ein halber Block ist nie geschlossen", () => {
    const fetch30 = OPEN + 3 * 60 * M;
    const q = (k: number, o: number, h: number, l: number, c: number, v: number, closed = true): StockCandle => ({ time: OPEN + k * 15 * M, open: o, high: h, low: l, close: c, volume: v, closed });
    const data = [
      q(0, 100, 101, 99.5, 100.5, 10),
      q(1, 100.5, 102, 100, 101.5, 20), // 9:30 + 9:45 → 9:30–10:00
      q(2, 101.5, 103, 101, 102, 30),
      q(3, 102, 102.5, 101.2, 101.8, 40, false), // der zweite Teil von 10:00 läuft noch
      q(5, 101, 101.5, 100.8, 101.2, 50), // 10:15 allein: seine Hälfte 10:00? nein – 10:30-Block (Nr. 4) fehlt, 5 gehört zu 10:30–11:00
    ];
    const out = buildCandles(data, { fetchMs: fetch30, marketTime: null, stockIvMs: 15 * M, planIvMs: 30 * M, from: OPEN, to: OPEN + 6 * 60 * M });
    expect(out.map((c) => [c.time - OPEN, c.closed])).toEqual([
      [0, true],
      [30 * M, false], // 10:00–10:30: nur eine Hälfte geschlossen, die andere läuft
      [60 * M, false], // 10:30–11:00: nur die zweite Hälfte da
    ]);
    expect(out[0]).toMatchObject({ open: 100, high: 102, low: 99.5, close: 101.5, volume: 30, closeTime: OPEN + 30 * M - 1 });
    expect(out[1]).toMatchObject({ open: 101.5, high: 103, low: 101, close: 101.8, volume: 70 });
  });
});

describe("loadStockPlanCandles: der Abruf", () => {
  it("fragt den Datenvertrag nach 5-Minuten-Kerzen mit dem Zeitraum des Tags und liefert Kerzen im Format des Plans", async () => {
    const r = rig(() => ok(bars(candlesOf("5m", AFTER), "5m", OPEN + 390 * M), stampAt(AFTER - 2 * M, OPEN + 390 * M)), AFTER);
    const res = await loadStockPlanCandles(req(), r.deps);
    expect(r.calls).toEqual([{ symbol: "AAPL", interval: "5m", opts: { range: "5d" } }]);
    expect(res.candles).toHaveLength(78);
    expect(res.candles[4]).toMatchObject({ time: OPEN + 4 * IV5, open: 185.4, high: 186.1, low: 185.35, close: 185.9, volume: 75_000, closed: true });
    expect(res).toMatchObject({ source: "yahoo", fromCache: false, error: null, sourceLabel: STOCK_SOURCE_LABEL, fetchedAt: AFTER - 2 * M, marketTime: OPEN + 390 * M });
    expect(res.notes).toEqual(STOCK_NOTES);
  });

  it("die Quelle sagt über sich: inoffiziell, möglicherweise verzögert, nur wenige Wochen Intraday", () => {
    const text = STOCK_NOTES.join(" ");
    expect(text).toContain("inoffiziell");
    expect(text).toContain("verzögert");
    expect(text).toContain("rund vier Wochen");
    expect(STOCK_SOURCE_LABEL).toBe("Yahoo Finance (inoffiziell)");
  });

  it("30 Minuten werden aus 15 Minuten geladen", async () => {
    const rows = Array.from({ length: 26 }, (_, k) => [OPEN + k * 15 * M, 100 + k, 101 + k, 99 + k, 100.5 + k, 10]);
    const r = rig(() => ok(bars(candlesOf("15m", AFTER, rows), "15m"), stampAt(AFTER)), AFTER);
    const res = await loadStockPlanCandles(req({ interval: "30m" }), r.deps);
    expect(r.calls[0]).toMatchObject({ interval: "15m", opts: { range: "5d" } });
    expect(res.candles).toHaveLength(13);
    expect(res.candles[0]).toMatchObject({ time: OPEN, open: 100, close: 101.5, closed: true });
  });

  it("'Neu laden' fragt die Quelle noch einmal, auch wenn ihr Zwischenspeicher frisch wäre", async () => {
    const r = rig(() => ok(bars(candlesOf("5m", AFTER), "5m"), stampAt(AFTER)), AFTER);
    await loadStockPlanCandles(req({ fresh: true }), r.deps);
    expect(r.calls[0]!.opts).toMatchObject({ fresh: true });
  });

  it("ein Tag weiter zurück als einen Monat: kein Abruf, der Grund steht da", async () => {
    const r = rig(() => ok(bars([], "5m"), stampAt(AFTER)), AFTER);
    const res = await loadStockPlanCandles(req({ from: Date.UTC(2026, 8, 1, 10), to: Date.UTC(2026, 8, 1, 20) }), r.deps);
    expect(r.calls).toHaveLength(0);
    expect(res.candles).toEqual([]);
    expect(res.error).toContain("nur für die letzten rund vier Wochen");
    expect(res.error).toContain("liegt 55 Tage zurück");
  });

  it("ein Kürzel, das keins ist (ein Krypto-Paar), wird nicht an Yahoo geschickt", async () => {
    const r = rig(() => ok(bars([], "5m"), stampAt(AFTER)), AFTER);
    const res = await loadStockPlanCandles(req({ symbol: "BTCUSDT" }), r.deps);
    expect(r.calls).toHaveLength(0);
    expect(res.error).toContain("„BTCUSDT“ ist kein US-Aktienkürzel");
  });

  it("ein leeres Fenster (der Tag liegt hinter 'jetzt') ist keine Fehlermeldung und kein Abruf", async () => {
    const r = rig(() => ok(bars([], "5m"), stampAt(AFTER)), AFTER);
    const res = await loadStockPlanCandles(req({ from: OPEN, to: OPEN - 1 }), r.deps);
    expect(r.calls).toHaveLength(0);
    expect(res).toMatchObject({ candles: [], error: null });
  });

  it("die Quelle fällt aus: der Grund der Quelle steht da, keine Kerzen, nichts erfunden", async () => {
    const r = rig(() => unavailable<StockBars>("blocked", AFTER), AFTER);
    const res = await loadStockPlanCandles(req(), r.deps);
    expect(res.candles).toEqual([]);
    expect(res.fetchedAt).toBeNull();
    expect(res.error).toBe("Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe dieses Servers. Sie ist inoffiziell und kann ohne Vorwarnung sperren.");
    const down = await loadStockPlanCandles(req(), rig(() => unavailable<StockBars>("no-server", AFTER), AFTER).deps);
    expect(down.error).toContain("Die Server-Funktionen für Aktien-Daten sind auf dieser Seite nicht eingerichtet.");
    const bad = await loadStockPlanCandles(req(), rig(() => unavailable<StockBars>("bad-symbol", AFTER), AFTER).deps);
    expect(bad.error).toContain("Dieses Kürzel kennt die Quelle nicht.");
  });

  it("ein alter Stand wird als solcher gezeigt (Zwischenspeicher, nicht aktuell) – mit dem Grund und dem alten Abrufzeitpunkt", async () => {
    const old = AFTER - 3 * 60 * M;
    const r = rig(() => stale(bars(candlesOf("5m", old), "5m"), stampAt(old), "rate-limited", "Die Quelle oder der Server begrenzt die Abrufe gerade. Bitte in einigen Minuten erneut versuchen.", AFTER), AFTER);
    const res = await loadStockPlanCandles(req(), r.deps);
    expect(res.fromCache).toBe(true);
    expect(res.fetchedAt).toBe(old);
    expect(res.error).toContain("begrenzt die Abrufe");
    expect(res.candles).toHaveLength(78);
  });

  it("eine andere Währung als USD wird gesagt", async () => {
    const r = rig(() => ok(bars(candlesOf("5m", AFTER), "5m", null, "CAD"), stampAt(AFTER)), AFTER);
    const res = await loadStockPlanCandles(req(), r.deps);
    expect(res.notes!.at(-1)).toBe("Yahoo meldet die Währung CAD; die App rechnet in USD und rechnet nicht um.");
  });

  it("ein abgebrochener Abruf wirft wie der Krypto-Lader, er ist kein Fehler zum Anzeigen", async () => {
    const ctl = new AbortController();
    const r = rig(() => unavailable<StockBars>("aborted", AFTER), AFTER);
    ctl.abort();
    await expect(loadStockPlanCandles(req({ signal: ctl.signal }), r.deps)).rejects.toMatchObject({ name: "AbortError" });
    const r2 = rig(() => unavailable<StockBars>("aborted", AFTER), AFTER);
    await expect(loadStockPlanCandles(req(), r2.deps)).rejects.toMatchObject({ name: "AbortError" });
  });
});
