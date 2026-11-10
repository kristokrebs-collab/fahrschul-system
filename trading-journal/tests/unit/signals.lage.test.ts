/**
 * Lage-Ampel gate of the Einstiegs-Check (decision 23, `domain/signals/lageGate.ts`), the falling-knife Lage layout
 * (`knife.ts`) and the snapshot fields (`snapshot.ts`), on a synthetic market with a confirmed long entry and the
 * real BTC Lage of the lab's examples (red 01.06., green 08.10.).
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import { synthBars, ladderBars } from "./signals.fixtures";
import { computeLage, type Lage, type LageSettings } from "@/domain/lage";
import {
  applyLageGate,
  computeSignals,
  KNIFE_LTF_TITLE,
  LAGE_BLOCK_PREFIX,
  parseSignalSnapshot,
  PROVISIONAL_PREFIX,
  regradeSignals,
  sanitizeSignalCfg,
  signalsAt,
  toSignalSnapshot,
  type Bar,
  type Verdict,
} from "@/domain/signals";

interface Series {
  sec: number;
  t0: number;
  h: number[];
  l: number[];
  c: number[];
}
const bars = (s: Series): Bar[] => s.c.map((c, i) => ({ t: s.t0 + i * s.sec, o: i ? s.c[i - 1]! : c, h: s.h[i]!, l: s.l[i]!, c }));
const FX = fixture as unknown as Record<"1D" | "4h", Series>;
const D = bars(FX["1D"]);
const H4 = bars(FX["4h"]);
const RED: Lage = computeLage(D, H4, 70_000, Date.parse("2026-06-01T12:00:00Z"));
const GREEN: Lage = computeLage(D, H4, 81_356.2, Date.parse("2026-10-08T15:30:00Z"));
const AMBER: Lage = computeLage(D, H4, RED.ema21_1d! + 100, Date.parse("2026-06-01T12:00:00Z"));
const BLOCK: LageSettings = { on: true, mode: "block" };
const WARN: LageSettings = { on: true, mode: "warn" };

const cfg = sanitizeSignalCfg({ whale: { on: false } });
// seed 2, 2950 15m bars: a confirmed "Starker Long-Einstieg" (every candle closed)
const MARKET = ladderBars(synthBars(3200, 2).slice(0, 2950));
const plain = computeSignals(MARKET, cfg)!;

describe("Lage gate", () => {
  it("the market has a confirmed long without the gate (the baseline)", () => {
    expect(plain.long).toMatchObject({ valid: true, state: "strong", label: "Starker Long-Einstieg" });
    expect(plain.long.strength).toBeGreaterThan(0);
    expect(plain.lage).toBeUndefined();
    expect(plain.knife!.long.ltf).toBeUndefined(); // no Lage input → the former three points
    expect(plain.knife!.long.total).toBe(3);
  });

  it("red + Sperre: the long is shown, faded — valid false, strength 0, `Kaufsignal · Lage rot – zählt nicht (fällt noch)`", () => {
    const s = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: BLOCK } })!;
    expect(s.long).toMatchObject({ valid: false, strength: 0, state: "strong", label: "Kaufsignal · Lage rot – zählt nicht (fällt noch)", score: plain.long.score });
    expect(s.long.lage).toMatchObject({ state: "red", counts: false, blocked: true, signsMet: 0, strength: plain.long.strength, from: "Starker Long-Einstieg" });
    expect(s.long.reasons.at(-1)).toEqual({ text: "Lage rot – zählt nicht (fällt noch)", ok: false });
    // shorts are never gated; the evaluation carries its input
    expect(s.short).toEqual(plain.short);
    expect(s.lage).toEqual({ lage: RED, cfg: BLOCK });
  });

  it("amber names the signs; nur Warnung counts with the warning; green, off and no data leave it alone", () => {
    const a = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: AMBER, cfg: BLOCK } })!;
    expect(a.long.label).toBe(`Kaufsignal · Lage gelb – Umkehr bildet sich (${AMBER.signsMet}/4)`);
    const w = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: WARN } })!;
    expect(w.long).toMatchObject({ valid: true, strength: plain.long.strength, label: plain.long.label });
    expect(w.long.lage).toMatchObject({ counts: true, blocked: false, label: "Lage rot – nur Warnung (fällt noch)" });
    for (const lage of [{ lage: GREEN, cfg: BLOCK }, { lage: RED, cfg: { on: false, mode: "block" as const } }, { lage: null, cfg: BLOCK }]) {
      const g = computeSignals(MARKET, cfg, Date.now(), { lage })!;
      expect(g.long).toEqual(plain.long);
    }
  });

  it("a provisional entry keeps its prefix; a long without an entry only carries the Lage", () => {
    const v: Verdict = { ...plain.long, valid: false, strength: 0, state: "provisional", provStrength: 3, label: `${PROVISIONAL_PREFIX}Sehr starker Long-Einstieg` };
    const g = applyLageGate(v, { lage: RED, cfg: BLOCK });
    expect(g.label).toBe(`${PROVISIONAL_PREFIX}${LAGE_BLOCK_PREFIX}Lage rot – zählt nicht (fällt noch)`);
    expect(g.lage?.strength).toBe(3);
    expect(g.provStrength).toBe(3);
    const none: Verdict = { ...plain.long, valid: false, strength: 0, state: "none", label: "Kein Signal", reasons: [] };
    const n = applyLageGate(none, { lage: RED, cfg: BLOCK });
    expect(n.label).toBe("Kein Signal");
    expect(n.reasons).toEqual([]);
    expect(n.lage?.label).toBe("Lage rot – zählt nicht (fällt noch)");
    // the gate's provisional prefix is the verdict's
    expect(PROVISIONAL_PREFIX).toBe("Vorläufig: ");
  });

  it("regrading (retro Top-Trader reading) keeps the gate; signalsAt passes it through", () => {
    const s = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: BLOCK } })!;
    expect(regradeSignals(s, cfg, null).long.valid).toBe(false);
    const last = MARKET["30m"]!.at(-1)!;
    const at = (last.t + 1800) * 1000;
    const r = signalsAt(MARKET, cfg, at, at + 3_600_000, { lage: { lage: RED, cfg: BLOCK } });
    expect(r?.long.lage?.blocked).toBe(true);
  });
});

describe("falling-knife filter, Lage layout", () => {
  it("long: Tagestrend + 4H-Umkehrzeichen count, the Top-Trader delta is info, the 30m/1H signs sit below", () => {
    const k = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: BLOCK } })!.knife!.long;
    expect(k.items.map((i) => [i.id, i.label, i.met, !!i.info])).toEqual([
      ["lage", "Lage: Tagestrend (1D-EMA 21)", false, false],
      ["signs", "4H-Umkehrzeichen 0/4", false, false],
      ["whale", "Top-Trader-Delta (Info)", null, true],
    ]);
    expect(k.items[0]!.detail).toBe("17 Tagesschlüsse unter 1D-EMA 21 (76.213, −8,2 %)");
    expect([k.n, k.total, k.all, k.label]).toEqual([0, 2, false, "0 von 2 erfüllt"]);
    expect(k.ltf?.map((i) => i.id)).toEqual(["structure", "divergence"]);
    expect(KNIFE_LTF_TITLE).toBe("Umkehr-Zeichen 30m/1H – im Abwärtstrend nicht verlässlich");
    const g = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: GREEN, cfg: BLOCK } })!.knife!.long;
    expect(g.items[0]).toMatchObject({ met: true, tfs: ["1D"] });
    expect(g.items[0]!.detail).toMatch(/^Trend wackelt: 1\. Tagesschluss unter EMA 21/);
    expect(g.items[1]!.detail).toBe("keines an · zählen nur im Abwärtstrend");
    // no Lage data: "keine Daten", never a fail; shorts keep the three points
    const n = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: null, cfg: BLOCK } })!;
    expect(n.knife!.long.items.slice(0, 2).map((i) => i.met)).toEqual([null, null]);
    expect(n.knife!.short.items.map((i) => i.id)).toEqual(["structure", "divergence", "whale"]);
    // the Ampel switched off: the former three points
    const off = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: { on: false, mode: "block" } } })!.knife!.long;
    expect([off.items.map((i) => i.id), off.total, off.ltf]).toEqual([["structure", "divergence", "whale"], 3, undefined]);
  });
});

describe("snapshot (trade.signal.lage)", () => {
  it("stores state, met signs, 1D-EMA 21, distance, whether the entry counted and the setting; parses back", () => {
    const s = computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: BLOCK } })!;
    const snap = toSignalSnapshot(s, "long", cfg);
    expect(snap.lage).toEqual({ state: "red", signs: [], ema21_1d: Math.round(RED.ema21_1d! * 10) / 10, dist: Math.round(RED.dist! * 10_000) / 10_000, counts: false, on: true, mode: "block" });
    expect(snap).toMatchObject({ valid: false, strength: 0, label: "Kaufsignal · Lage rot – zählt nicht (fällt noch)" });
    expect(snap.knife).toMatchObject({ n: 0, total: 2, items: [{ id: "lage", met: false }, { id: "signs", met: false }, { id: "whale", met: null }] });
    const back = parseSignalSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(back.lage).toEqual(snap.lage);
    expect(back.knife).toEqual(snap.knife);
    // the short side records the Lage too (it was never gated)
    expect(toSignalSnapshot(s, "short", cfg).lage?.counts).toBe(true);
    // an older snapshot (no Lage) parses unchanged; a broken one drops the field
    const old = toSignalSnapshot(plain, "long", cfg);
    expect(parseSignalSnapshot(JSON.parse(JSON.stringify(old)))!.lage).toBeUndefined();
    expect(parseSignalSnapshot({ ...JSON.parse(JSON.stringify(snap)), lage: { state: "lila" } })!.lage).toBeUndefined();
    expect(parseSignalSnapshot({ ...JSON.parse(JSON.stringify(snap)), lage: { ...snap.lage, mode: "x", counts: "ja" } })!.lage).toEqual({ ...snap.lage, mode: undefined, counts: undefined });
  });
});
