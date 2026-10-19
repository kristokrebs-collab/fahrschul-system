import { describe, expect, it } from "vitest";
import wsKline from "../fixtures/binance-ws-kline.json";
import wsMark from "../fixtures/binance-ws-markPrice.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsBook from "../fixtures/binance-ws-bookTicker.json";
import { parseWsMessage, wsStreamKind } from "@/market/sources/binance";

const frame = (stream: string | undefined, data: unknown) => JSON.stringify(stream === undefined ? data : { stream, data });

describe("binance WS dispatch (hot path, no zod)", () => {
  it("maps stream names to exactly one parser", () => {
    expect(wsStreamKind("btcusdt@kline_1h")).toBe("kline");
    expect(wsStreamKind("btcusdt@markPrice@1s")).toBe("markPrice");
    expect(wsStreamKind("btcusdt@markPrice")).toBe("markPrice");
    expect(wsStreamKind("btcusdt@aggTrade")).toBe("aggTrade");
    expect(wsStreamKind("btcusdt@bookTicker")).toBe("bookTop");
    expect(wsStreamKind("btcusdt@depth5")).toBeNull();
    expect(wsStreamKind("x")).toBeNull();
  });

  it("parses raw payloads (no envelope) by their event type", () => {
    expect(parseWsMessage(JSON.stringify(wsAgg.data))).toEqual({ kind: "aggTrade", value: { price: 84206.1, qty: 0.035, isBuyerMaker: false, time: wsAgg.data.T } });
    expect(parseWsMessage(JSON.stringify(wsMark.data))?.kind).toBe("markPrice");
    expect(parseWsMessage(JSON.stringify(wsKline.data))?.kind).toBe("kline");
    const { e: _e, ...bookWithoutE } = wsBook.data;
    expect(parseWsMessage(JSON.stringify(bookWithoutE))).toEqual({ kind: "bookTop", value: { bid: 84205.9, ask: 84206, time: wsBook.data.T } });
  });

  it("reports a payload that does not match its stream as unknown", () => {
    expect(parseWsMessage(frame("btcusdt@kline_1h", wsAgg.data))).toEqual({ kind: "unknown", stream: "btcusdt@kline_1h" });
    expect(parseWsMessage(frame("btcusdt@aggTrade", wsBook.data))).toEqual({ kind: "unknown", stream: "btcusdt@aggTrade" });
  });

  it("rejects non-finite numbers and missing fields", () => {
    expect(parseWsMessage(frame("btcusdt@aggTrade", { ...wsAgg.data, p: "abc" }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@aggTrade", { ...wsAgg.data, p: "" }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@aggTrade", { ...wsAgg.data, m: "false" }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@markPrice@1s", { ...wsMark.data, r: null }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@kline_1h", { ...wsKline.data, k: { ...wsKline.data.k, c: "NaN" } }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@bookTicker", { ...wsBook.data, u: "1" }))?.kind).toBe("unknown");
    expect(parseWsMessage(frame("btcusdt@aggTrade", [1, 2]))?.kind).toBe("unknown");
  });

  it("ignores kline intervals the app does not subscribe", () => {
    expect(parseWsMessage(frame("btcusdt@kline_5m", { ...wsKline.data, k: { ...wsKline.data.k, i: "5m" } }))).toEqual({ kind: "unknown", stream: "btcusdt@kline_5m" });
  });

  it("accepts numbers as well as numeric strings", () => {
    const ev = parseWsMessage(frame("btcusdt@aggTrade", { ...wsAgg.data, p: 84000.5, q: 1 }));
    expect(ev).toEqual({ kind: "aggTrade", value: { price: 84000.5, qty: 1, isBuyerMaker: false, time: wsAgg.data.T } });
  });
});
