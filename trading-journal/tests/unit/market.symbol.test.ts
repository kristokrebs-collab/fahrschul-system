import { describe, expect, it } from "vitest";
import { tvSymbolToBinance, tvPrefix, isValidBinanceSymbol, resolveSymbol, toBybitSymbol, toOkxSymbol, FALLBACK_ONLY_USDT } from "@/market/symbol";
import { normalizePeriod, toBybitPeriod, toOkxPeriod, cadenceLabel, badPeriodDetail, BINANCE_PERIODS, OKX_KLINE_BAR, BYBIT_KLINE_INTERVAL } from "@/market/period";

describe("symbol", () => {
  it("strips the BINANCE: prefix", () => {
    expect(tvSymbolToBinance("BINANCE:BTCUSDT")).toBe("BTCUSDT");
    expect(tvPrefix("BINANCE:BTCUSDT")).toBe("BINANCE");
  });
  it("adopts other prefixes and normalises case", () => {
    expect(tvSymbolToBinance("bybit:ethusdt")).toBe("ETHUSDT");
    expect(tvSymbolToBinance("  btcusdt ")).toBe("BTCUSDT");
    expect(tvPrefix("btcusdt")).toBeNull();
  });
  it("falls back to BTCUSDT for empty input", () => {
    expect(tvSymbolToBinance("")).toBe("BTCUSDT");
    expect(tvSymbolToBinance(undefined)).toBe("BTCUSDT");
  });
  it("validates syntax", () => {
    expect(isValidBinanceSymbol("BTCUSDT")).toBe(true);
    expect(isValidBinanceSymbol("BTC")).toBe(false);
    expect(isValidBinanceSymbol("btc-usdt")).toBe(false);
  });
  it("maps USDT perps to Bybit and OKX", () => {
    expect(toBybitSymbol("BTCUSDT")).toBe("BTCUSDT");
    expect(toOkxSymbol("BTCUSDT")).toBe("BTC-USDT-SWAP");
    expect(toOkxSymbol("ETHUSDT")).toBe("ETH-USDT-SWAP");
  });
  it("disables fallbacks for non-USDT quote assets", () => {
    const info = resolveSymbol("BINANCE:BTCUSDC");
    expect(info.bybit).toBeNull();
    expect(info.okx).toBeNull();
    expect(info.fallbackDetail).toBe(FALLBACK_ONLY_USDT);
    expect(info.base).toBe("BTC");
    expect(info.quote).toBe("USDC");
  });
  it("resolves the default symbol fully", () => {
    const info = resolveSymbol("BINANCE:BTCUSDT");
    expect(info).toMatchObject({ binance: "BTCUSDT", stream: "btcusdt", bybit: "BTCUSDT", okx: "BTC-USDT-SWAP", valid: true, base: "BTC", quote: "USDT" });
    expect(info.fallbackDetail).toBeUndefined();
  });
});

describe("period", () => {
  it("accepts every Binance period verbatim", () => {
    for (const p of BINANCE_PERIODS) expect(normalizePeriod(p)).toMatchObject({ period: p, ok: true });
  });
  it("maps aliases", () => {
    expect(normalizePeriod("60m").period).toBe("1h");
    expect(normalizePeriod("1D").period).toBe("1d");
    expect(normalizePeriod(" d ").period).toBe("1d");
    expect(normalizePeriod("1day").period).toBe("1d");
    expect(normalizePeriod("4H").period).toBe("4h");
  });
  it("falls back to 1h with reason detail for unsupported input", () => {
    for (const raw of ["1m", "3m", "1w", "1W", "1M", "foo", ""]) {
      const r = normalizePeriod(raw);
      expect(r.period).toBe("1h");
      expect(r.ok).toBe(false);
      expect(r.detail).toBe(badPeriodDetail(raw || "leer"));
    }
    expect(normalizePeriod("1w").detail).toBe("Timeframe 1w wird von Binance nicht unterstützt, Ratios nutzen 1h");
  });
  it("maps to Bybit periods, falling to the next smaller supported one", () => {
    expect(toBybitPeriod("5m")).toEqual({ value: "5min", period: "5m", exact: true });
    expect(toBybitPeriod("1h")).toEqual({ value: "1h", period: "1h", exact: true });
    expect(toBybitPeriod("2h")).toEqual({ value: "1h", period: "1h", exact: false, detail: "Bybit: 2h → 1h" });
    expect(toBybitPeriod("6h")).toMatchObject({ value: "4h", period: "4h", exact: false });
    expect(toBybitPeriod("12h")).toMatchObject({ value: "4h", detail: "Bybit: 12h → 4h" });
    expect(toBybitPeriod("1d")).toMatchObject({ value: "1d", exact: true });
  });
  it("maps to OKX periods and bars", () => {
    expect(toOkxPeriod("1h")).toBe("1H");
    expect(toOkxPeriod("5m")).toBe("5m");
    expect(toOkxPeriod("1d")).toBe("1D");
    expect(OKX_KLINE_BAR["1w"]).toBe("1Wutc");
    expect(BYBIT_KLINE_INTERVAL).toEqual({ "1m": "1", "1h": "60", "4h": "240", "1w": "W" });
  });
  it("produces cadence labels", () => {
    expect(cadenceLabel(250)).toBe("Echtzeit");
    expect(cadenceLabel(1000)).toBe("1 s");
    expect(cadenceLabel(5000)).toBe("alle 5 s");
    expect(cadenceLabel(60_000)).toBe("jede Minute");
    expect(cadenceLabel(300_000)).toBe("alle 5 min");
    expect(cadenceLabel(3_600_000)).toBe("stündlich");
    expect(cadenceLabel(4 * 3_600_000)).toBe("alle 4 h");
    expect(cadenceLabel(86_400_000)).toBe("täglich");
  });
});
