// @vitest-environment node
/// <reference types="node" />
/**
 * signal/1 and its adapters (B3): what is accepted, what is refused with which reason, the derived ids (same signal → same id, even on
 * another minute for the Branchen-Trend alert), the limits (data size, keys, no order size anywhere), placeholders TradingView did not fill,
 * the time window, plain text only. Pure: no database, no network.
 */
import { describe, expect, it } from "vitest";
import { MAX_DATA_BYTES, MAX_SIGNAL_BYTES, bareSymbol, clean, isSignalSchemaBody, parseSignalBody, parseTime } from "../../netlify/functions/_lib/signals/schema";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const v1 = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: "signal/1", source: "tradingview", signalId: "abc-1", strategy: "trend-20", symbol: "XLE", direction: "long", time: "2026-11-06T21:00:00Z", ...over });
const bt = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: "branchen-trend/1", strategie: "s-20-40-2.8-0.02-2.0", signal: "KAUF", symbol: "XLE", datum: "2026-11-06T00:00:00Z", kurs: 91.2, modus: "DEMO/PAPIER", ...over });
const ok = (body: string) => {
  const r = parseSignalBody(body, NOW);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.signal;
};
const why = (body: string): string => {
  const r = parseSignalBody(body, NOW);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
};

describe("signal/1", () => {
  it("accepts the full message and normalises it", () => {
    const s = ok(v1({ market: "AMEX", data: { note: "x", kurs: 91.2, aktiv: true, leer: null } }));
    expect(s).toMatchObject({ kind: "signal", schemaId: "signal/1", source: "tradingview", signalId: "abc-1", strategy: "trend-20", market: "AMEX", symbol: "XLE", direction: "long", time: "2026-11-06T21:00:00.000Z", via: "extern" });
    expect(s.data).toEqual({ note: "x", kurs: 91.2, aktiv: true, leer: null });
  });

  it("direction is long or flat – there is no short", () => {
    expect(ok(v1({ direction: "flat" })).direction).toBe("flat");
    expect(why(v1({ direction: "short" }))).toMatch(/long.*flat.*short gibt es nicht/);
    expect(why(v1({ direction: "buy" }))).toMatch(/„direction“/);
  });

  it("has NO order size: a size at the top level or inside data is refused with that reason", () => {
    for (const k of ["qty", "size", "quantity", "contracts", "leverage", "amount", "notional", "positionSize"]) {
      const r = why(v1({ [k]: 5 }));
      expect(r, k).toMatch(/Ordergröße|Unbekanntes Feld/);
    }
    expect(why(v1({ qty: 1 }))).toMatch(/keine Ordergröße/);
    expect(why(v1({ data: { qty: 1 } }))).toMatch(/keine Ordergröße/);
    expect(why(v1({ data: { Size: 1 } }))).toMatch(/keine Ordergröße/);
  });

  it("unknown top-level fields are refused (strict), naming the field plainly", () => {
    expect(why(v1({ extra: 1 }))).toMatch(/Unbekanntes Feld „extra“/);
    expect(why(v1({ "<b>x": 1 }))).not.toMatch(/[<>]/);
  });

  it("every required field is named when it is missing", () => {
    for (const k of ["source", "signalId", "strategy", "symbol"]) {
      const o = JSON.parse(v1()) as Record<string, unknown>;
      delete o[k];
      expect(why(JSON.stringify(o)), k).toContain(`„${k}“`);
    }
    const o = JSON.parse(v1()) as Record<string, unknown>;
    delete o.time;
    expect(why(JSON.stringify(o))).toMatch(/Zeit/);
  });

  it("formats: source is lower-case, ids and symbols have a safe alphabet", () => {
    expect(why(v1({ source: "TradingView" }))).toMatch(/„source“/);
    expect(why(v1({ signalId: "a b" }))).toMatch(/„signalId“/);
    expect(why(v1({ signalId: "x".repeat(81) }))).toMatch(/„signalId“/);
    expect(why(v1({ symbol: "<script>" }))).toMatch(/„symbol“/);
    expect(ok(v1({ symbol: "NASDAQ:AAPL" })).symbol).toBe("NASDAQ:AAPL");
    expect(ok(v1({ symbol: "BTCUSDT.P" })).symbol).toBe("BTCUSDT.P");
    expect(ok(v1({ symbol: "ES1!" })).symbol).toBe("ES1!");
    expect(why(v1({ signalId: 12 }))).toMatch(/muss Text sein/);
  });

  it("a TradingView placeholder that was not filled is named as such", () => {
    expect(why(v1({ symbol: "{{ticker}}" }))).toMatch(/Platzhalter/);
    expect(why(v1({ time: "{{time}}" }))).toMatch(/Platzhalter/);
    expect(why(v1({ strategy: "{{strategy.order.id}}" }))).toMatch(/Platzhalter/);
  });

  it("time: ISO with zone only, not in the future, not older than a year", () => {
    expect(parseTime("2026-11-07T12:00:00+01:00", NOW)).toEqual({ ok: true, iso: "2026-11-07T11:00:00.000Z" });
    expect(parseTime("2026-11-07T12:00:00+0100", NOW)).toEqual({ ok: true, iso: "2026-11-07T11:00:00.000Z" });
    expect(parseTime("2026-11-07T12:00", NOW).ok).toBe(false); // no zone
    expect(parseTime("2026-11-07 12:00:00Z", NOW).ok).toBe(false);
    expect(parseTime(1_700_000_000, NOW).ok).toBe(false);
    expect(parseTime("2026-11-07T12:09:00Z", NOW).ok).toBe(true); // within the clock tolerance
    expect(parseTime("2026-11-07T12:11:00Z", NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/Zukunft/) });
    expect(parseTime("2025-10-01T00:00:00Z", NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/Jahr/) });
    expect(parseTime("2026-13-45T99:00:00Z", NOW).ok).toBe(false);
  });

  it("data: flat, plain values, at most 20 keys and 2 KiB; markup and control characters do not survive", () => {
    expect(why(v1({ data: { a: [1] } }))).toMatch(/keine Listen oder Objekte/);
    expect(why(v1({ data: { a: { b: 1 } } }))).toMatch(/keine Listen oder Objekte/);
    expect(why(v1({ data: [1] }))).toMatch(/Objekt/);
    expect(why(v1({ data: { "a b": 1 } }))).toMatch(/Feldname/);
    expect(why(v1({ data: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])) }))).toMatch(/mehr als 20/);
    // 15 strings of 200 characters > 2 KiB
    expect(why(v1({ data: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, "x".repeat(200)])) }))).toMatch(/2 KiB/);
    expect(MAX_DATA_BYTES).toBe(2048);
    const s = ok(v1({ data: { note: "<img src=x onerror=alert(1)>\u0000\u0007hi" } }));
    expect([...String(s.data!.note)].some((c) => c === "<" || c === ">" || c.charCodeAt(0) < 32)).toBe(false);
    expect(clean("a\n\t b", 10)).toBe("a b");
  });

  it("not JSON, not an object, unknown or missing schema", () => {
    expect(why("hallo")).toMatch(/kein gültiges JSON/);
    expect(why("[1]")).toMatch(/JSON-Objekt/);
    expect(why(JSON.stringify({ schema: "signal/2" }))).toMatch(/Unbekanntes Schema/);
    expect(why(JSON.stringify({ a: 1 }))).toMatch(/Es fehlt das Feld „schema“/);
    expect(why("null")).toMatch(/JSON-Objekt/);
  });

  it("the body limit is 8 KiB", () => {
    expect(MAX_SIGNAL_BYTES).toBe(8192);
  });
});

describe("adapter branchen-trend/1 (Grün / Rot)", () => {
  it("KAUF = long = grün, VERKAUF = flat = rot; the payload of the Pine script is accepted as it is", () => {
    const g = ok(bt());
    expect(g).toMatchObject({ schemaId: "branchen-trend/1", source: "tradingview", strategy: "s-20-40-2.8-0.02-2.0", symbol: "XLE", direction: "long", time: "2026-11-06T00:00:00.000Z" });
    expect(g.data).toEqual({ zustand: "gruen", kurs: 91.2, modus: "DEMO/PAPIER" });
    const r = ok(bt({ signal: "VERKAUF" }));
    expect(r.direction).toBe("flat");
    expect(r.data).toMatchObject({ zustand: "rot" });
  });

  it("the id is derived from strategy, symbol, direction and DAY: a re-delivery hours later is the same signal", () => {
    const a = ok(bt({ datum: "2026-11-06T00:00:00Z" })).signalId;
    expect(a).toMatch(/^bt_[0-9a-f]{24}$/);
    expect(ok(bt({ datum: "2026-11-06T17:30:00Z" })).signalId).toBe(a);
    expect(ok(bt({ symbol: "AMEX:XLE" })).signalId).toBe(a); // exchange prefix does not make a new signal
    expect(ok(bt({ symbol: "xle" })).signalId).toBe(a);
    expect(ok(bt({ datum: "2026-11-05T00:00:00Z" })).signalId).not.toBe(a);
    expect(ok(bt({ signal: "VERKAUF" })).signalId).not.toBe(a);
    expect(ok(bt({ symbol: "XLK" })).signalId).not.toBe(a);
    expect(ok(bt({ strategie: "s-10-20-2.0-0.02-2.0" })).signalId).not.toBe(a);
  });

  it("refuses what the JSON schema of the script refuses", () => {
    expect(why(bt({ signal: "HALTEN" }))).toMatch(/KAUF oder VERKAUF/);
    expect(why(bt({ strategie: "meine" }))).toMatch(/„strategie“/);
    expect(why(bt({ modus: "LIVE" }))).toMatch(/DEMO\/PAPIER.*nie eine echte Order/);
    expect(why(bt({ kurs: -3 }))).toMatch(/„kurs“/);
    expect(why(bt({ kurs: "91" }))).toMatch(/„kurs“/);
    expect(why(bt({ extra: 1 }))).toMatch(/Unbekanntes Feld/);
    expect(why(bt({ qty: 1 }))).toMatch(/Unbekanntes Feld/);
    expect(why(bt({ datum: "{{time}}" }))).toMatch(/Platzhalter/);
    expect(why(bt({ datum: "morgen" }))).toMatch(/„datum“/);
  });

  it("kurs and modus are optional", () => {
    const o = JSON.parse(bt()) as Record<string, unknown>;
    delete o.kurs;
    delete o.modus;
    expect(ok(JSON.stringify(o)).data).toEqual({ zustand: "gruen", modus: "DEMO/PAPIER" });
  });
});

describe("adapter legacy {action: open | close}", () => {
  const lg = (over: Record<string, unknown> = {}) => JSON.stringify({ action: "open", symbol: "BTCUSDT", side: "long", price: 61000, qty: 0.5, setup: "Box-Breakout", ...over });

  it("open → long, close → flat; quantity is not read, price is kept", () => {
    const o = ok(lg());
    expect(o).toMatchObject({ schemaId: "legacy-action", direction: "long", symbol: "BTCUSDT", strategy: "Box-Breakout", source: "tradingview" });
    expect(o.data).toEqual({ aktion: "open", kurs: 61000 });
    expect(JSON.stringify(o)).not.toContain("0.5");
    expect(ok(lg({ action: "close" })).direction).toBe("flat");
    expect(ok(lg({ action: "close", price: 0, setup: undefined })).data).toEqual({ aktion: "close" });
  });

  it("ticker works like symbol; short entries cannot be a signal", () => {
    expect(ok(JSON.stringify({ action: "close", ticker: "ETHUSDT" })).symbol).toBe("ETHUSDT");
    expect(why(lg({ side: "short" }))).toMatch(/Short-Signale gibt es nicht/);
    expect(why(lg({ side: "sell" }))).toMatch(/Short/);
    expect(why(JSON.stringify({ action: "open" }))).toMatch(/„symbol“/);
  });

  it("the id is stable within a minute and differs across minutes and ids", () => {
    const a = parseSignalBody(lg(), NOW);
    const b = parseSignalBody(lg(), NOW + 30_000);
    const c = parseSignalBody(lg(), NOW + 120_000);
    const d = parseSignalBody(lg({ id: "Long" }), NOW);
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("parse");
    expect(a.signal.signalId).toMatch(/^lg_[0-9a-f]{24}$/);
    expect(b.signal.signalId).toBe(a.signal.signalId);
    expect(c.signal.signalId).not.toBe(a.signal.signalId);
    expect(d.signal.signalId).not.toBe(a.signal.signalId);
  });
});

describe("test signal and detection", () => {
  it("the assistant's test: no id, no direction; source app is marked", () => {
    const s = ok(JSON.stringify({ action: "test", symbol: "TEST", source: "app" }));
    expect(s).toMatchObject({ kind: "test", signalId: null, direction: null, symbol: "TEST", via: "app" });
    expect(ok(JSON.stringify({ action: "test", symbol: "XLE" })).via).toBe("extern");
  });

  it("isSignalSchemaBody: only signal/1 and branchen-trend/1 belong to the receiver, the older hook keeps the rest", () => {
    expect(isSignalSchemaBody(v1())).toBe(true);
    expect(isSignalSchemaBody(bt())).toBe(true);
    expect(isSignalSchemaBody(JSON.stringify({ action: "open", symbol: "X" }))).toBe(false);
    expect(isSignalSchemaBody(JSON.stringify({ action: "test" }))).toBe(false);
    expect(isSignalSchemaBody("no json")).toBe(false);
  });

  it("bareSymbol drops the exchange prefix and upper-cases", () => {
    expect(bareSymbol("amex:xle")).toBe("XLE");
    expect(bareSymbol("XLE")).toBe("XLE");
  });
});
