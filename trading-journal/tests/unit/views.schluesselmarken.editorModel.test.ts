import { describe, expect, it } from "vitest";
import type { KeyLevel, KeyTf } from "@/domain/keylevels";
import { emptyForm, formFromLevel, levelFromForm, parsePriceInput, type BuildCtx, type EditorForm } from "@/views/schluesselmarken/editorModel";

const ALL = new Set<KeyTf>(["30m", "1h", "2h", "3h", "4h", "1D", "1W"]);
const ctx = (over: Partial<BuildCtx> = {}): BuildCtx => ({ id: "k1", symbol: "BTCUSDT", now: 1_000, available: ALL, ref: 84_000, ...over });
const form = (over: Partial<EditorForm> = {}): EditorForm => ({ ...emptyForm(), price: "80.000", ...over });

describe("parsePriceInput", () => {
  it("reads a thousands dot as thousands when it is the closer reading of the live price", () => {
    expect(parsePriceInput("80.000", 84_000)).toBe(80_000);
    expect(parsePriceInput("1.234", 1.2)).toBe(1.234); // a 1.2 coin: the decimal reading is the closer one
    expect(parsePriceInput("1.234", 1_200)).toBe(1_234);
  });
  it("without a reference a dot group of three digits means thousands; everything else is parseNumber", () => {
    expect(parsePriceInput("80.000")).toBe(80_000);
    expect(parsePriceInput("1.234.567")).toBe(1_234_567);
    expect(parsePriceInput("80000")).toBe(80_000);
    expect(parsePriceInput("80.000,5", 84_000)).toBe(80_000.5);
    expect(parsePriceInput("0,0345")).toBe(0.0345);
    expect(parsePriceInput("12.5")).toBe(12.5);
  });
  it("junk is null", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
  });
});

describe("levelFromForm", () => {
  it("builds a level from a plain form: name from the price when empty, since = now, alerts off", () => {
    const r = levelFromForm(form({ direction: "below", tf: "4h" }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.level).toMatchObject({ id: "k1", symbol: "BTCUSDT", price: 80_000, tf: "4h", direction: "below", kind: "close", since: 1_000, enabled: true, name: "Unter 80.000 (4h)" });
    expect(r.level.alerts.on).toBe(false);
  });

  it("validates the price, the invalidation side and the distance", () => {
    expect(levelFromForm(form({ price: "" }), ctx())).toMatchObject({ ok: false, errors: { price: expect.any(String) } });
    expect(levelFromForm(form({ invalidation: "81.000" }), ctx())).toMatchObject({ ok: false, errors: { invalidation: "Die Invalidierung muss unter dem Level liegen." } });
    expect(levelFromForm(form({ direction: "below", invalidation: "79.000" }), ctx())).toMatchObject({ ok: false, errors: { invalidation: "Die Invalidierung muss über dem Level liegen." } });
    expect(levelFromForm(form({ kind: "buffer", distValue: "-1" }), ctx())).toMatchObject({ ok: false, errors: { distance: expect.any(String) } });
    const ok = levelFromForm(form({ kind: "buffer", distMode: "atr", distValue: "1,5", invalidation: "79.000" }), ctx());
    expect(ok.ok && ok.level).toMatchObject({ distance: { mode: "atr", value: 1.5 }, invalidation: 79_000 });
  });

  it("never accepts a timeframe the feed cannot serve – and never replaces it", () => {
    const r = levelFromForm(form({ tf: "3h" }), ctx({ available: new Set<KeyTf>(["4h"]) }));
    expect(r).toMatchObject({ ok: false, errors: { tf: "Diese Zeiteinheit ist gerade nicht verfügbar." } });
  });

  it("closes only for the `closes` rule, clamped to 2 … 10", () => {
    const a = levelFromForm(form({ kind: "closes", closes: "99" }), ctx());
    expect(a.ok && a.level.closes).toBe(10);
    const b = levelFromForm(form({ kind: "closes", closes: "1" }), ctx());
    expect(b.ok && b.level.closes).toBe(2);
  });

  describe("editing keeps `since` while the rule is unchanged and restarts it otherwise", () => {
    const base = (): KeyLevel => {
      const r = levelFromForm(form({ alertsOn: true }), ctx({ now: 500 }));
      if (!r.ok) throw new Error("setup");
      return r.level;
    };
    it("a new name or alert change keeps since", () => {
      const prev = base();
      const r = levelFromForm({ ...formFromLevel(prev), name: "Neuer Name", recurring: true }, ctx({ prev, now: 9_000 }));
      expect(r.ok && r.level.since).toBe(500);
      expect(r.ok && r.level.alerts.recurring).toBe(true);
    });
    it("a changed price, timeframe or rule starts the level over", () => {
      const prev = base();
      for (const patch of [{ price: "81.000" }, { tf: "1h" as const }, { kind: "touch" as const }, { direction: "below" as const }]) {
        const r = levelFromForm({ ...formFromLevel(prev), ...patch }, ctx({ prev, now: 9_000 }));
        expect(r.ok && r.level.since).toBe(9_000);
      }
    });
    it("the level keeps its symbol and its enabled flag when edited; an unchanged timeframe stays editable while the feed is down", () => {
      const prev = { ...base(), symbol: "ETHUSDT", enabled: false };
      const r = levelFromForm({ ...formFromLevel(prev), name: "x" }, ctx({ prev, symbol: "BTCUSDT", available: new Set<KeyTf>() }));
      expect(r.ok && [r.level.symbol, r.level.enabled]).toEqual(["ETHUSDT", false]);
    });
  });
});
