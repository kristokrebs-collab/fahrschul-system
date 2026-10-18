/**
 * F73 – the rule blocks and the rule tree of "Eigene Idee": sanitising, versioned parsing, tri-state logic (AND / OR /
 * nesting / unknown / not), every block on hand-built bars, and the no-lookahead guarantee on REAL BTCUSDT 4h bars
 * (a block's value at bar i is the same with the history cut after bar i) – including a higher timeframe that only
 * counts after it has CLOSED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregateBars, type Bar } from "@/domain/backtest/index";
import { BLOCKS, BLOCK_ORDER, defaultParams, makeCtx, sanitizeParams, type BlockDef } from "@/domain/lab/rules/blocks";
import { luxZoneSeries } from "@/domain/lab/rules/indicators";
import { CUSTOM_TEMPLATES } from "@/domain/lab/rules/templates";
import {
  blockAvailability,
  combineTree,
  customKey,
  defaultCustom,
  editNode,
  evaluateLeaves,
  leafText,
  mapToExec,
  mirrorGroup,
  newGroup,
  newLeaf,
  nextNum,
  parseCustom,
  sanitizeCustom,
  summarizeCustom,
  tfAvailability,
  validateCustom,
} from "@/domain/lab/rules/tree";
import { CUSTOM_VERSION, FALSE, TRUE, UNKNOWN, type BlockId, type CustomConfig, type Group, type Leaf, type LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG, luxZone, mcbSeries, rsi } from "@/domain/signals";
import { walk } from "./lab.helpers";

const H4: Bar[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));

const series = (def: BlockDef, bars: readonly Bar[], p: LeafParams, ladder = null as never): Uint8Array => {
  const r = def.eval(makeCtx(bars, DEFAULT_SIGNAL_CFG, ladder), p);
  return r instanceof Uint8Array ? r : r.result();
};
const run = (id: BlockId, bars: readonly Bar[], over: LeafParams = {}): Uint8Array => series(BLOCKS[id], bars, sanitizeParams(id, { ...defaultParams(id), ...over }));
const bar = (i: number, o: number, h: number, l: number, c: number, v?: number): Bar => ({ t: 1_700_000_000 + i * 3600, o, h, l, c, ...(v !== undefined ? { v } : {}) });
const closes = (cs: number[]): Bar[] => cs.map((c, i) => bar(i, c, c + 0.5, c - 0.5, c));

describe("Parameter säubern", () => {
  it("klemmt Zahlen, ersetzt Unbrauchbares durch den Standard, verwirft unbekannte Schlüssel", () => {
    const p = sanitizeParams("rsi", { len: 1000, mode: "weird", level: -5, junk: 1, within: "x" });
    expect(p).toEqual({ len: 100, mode: "below", level: 1, within: 1 });
    expect(sanitizeParams("rsi", { len: "21", level: "30,5" })).toMatchObject({ len: 21, level: 30.5 });
    expect(sanitizeParams("rsi", null)).toEqual(defaultParams("rsi"));
  });

  it("MA-Kreuzung und MACD: schnell < langsam wird hergestellt", () => {
    expect(sanitizeParams("maCross", { fast: 80, slow: 20 })).toMatchObject({ fast: 20, slow: 80 });
    expect(sanitizeParams("maCross", { fast: 30, slow: 30 })).toMatchObject({ fast: 30, slow: 31 });
    expect(sanitizeParams("macd", { fast: 50, slow: 10 })).toMatchObject({ fast: 10, slow: 50 });
  });

  it("jeder Baustein hat Standardwerte innerhalb seiner Grenzen und eine Spiegelung, die wieder gültig ist", () => {
    for (const id of BLOCK_ORDER) {
      const d = defaultParams(id);
      expect(sanitizeParams(id, d)).toEqual(d);
      const m = BLOCKS[id].mirror(d);
      expect(sanitizeParams(id, m)).toEqual(m);
      expect(BLOCKS[id].text(d).length).toBeGreaterThan(3);
    }
  });
});

describe("Konfiguration: Version, Säubern, Roundtrip", () => {
  it("die Standardidee ist gültig und übersteht JSON unverändert", () => {
    const c = defaultCustom();
    expect(c.version).toBe(CUSTOM_VERSION);
    expect(validateCustom(c).filter((i) => i.level === "error")).toEqual([]);
    expect(sanitizeCustom(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("verwirft unbekannte Bausteine, klemmt Grenzen, macht doppelte IDs eindeutig", () => {
    const raw = {
      version: 1,
      name: "x".repeat(200),
      interval: "7m",
      sides: "sideways",
      stop: { kind: "atr", atr: 99 },
      target: { kind: "r", r: -3 },
      exits: { maxBars: 99999, partial: { on: true, fracPct: 200 } },
      long: {
        type: "group",
        op: "or",
        children: [
          { type: "leaf", id: "n1", block: "rsi", tf: "exec", params: { level: 500 } },
          { type: "leaf", id: "n1", block: "doesNotExist", tf: "exec", params: {} },
          { type: "leaf", id: "n1", block: "volume", tf: "9d", params: {} },
          { type: "group", id: "g1", op: "and", children: [{ type: "leaf", id: "n2", block: "macd", tf: "1d", params: {} }] },
        ],
      },
    };
    const c = sanitizeCustom(raw);
    expect(c.name.length).toBe(60);
    expect(c.interval).toBe("4h");
    expect(c.sides).toBe("long");
    expect(c.stop.atr).toBe(10);
    expect(c.target.r).toBe(0.25);
    expect(c.exits.maxBars).toBe(2000);
    expect(c.exits.partial.fracPct).toBe(95);
    expect(c.long.op).toBe("or");
    const ids: string[] = [];
    const walkIds = (n: Group | Leaf): void => {
      ids.push(n.id);
      if (n.type === "group") n.children.forEach(walkIds);
    };
    walkIds(c.long);
    expect(new Set(ids).size).toBe(ids.length); // unique
    const first = c.long.children[0] as Leaf;
    expect(first.params.level).toBe(99);
    expect(c.long.children).toHaveLength(3); // the unknown block is gone
    expect((c.long.children[1] as Leaf).tf).toBe("exec"); // unknown timeframe → exec
  });

  it("begrenzt Tiefe, Kinder und Blätter", () => {
    let g: Record<string, unknown> = { type: "leaf", block: "rsi", tf: "exec", params: {} };
    for (let i = 0; i < 12; i++) g = { type: "group", op: "and", children: [g] };
    const c = sanitizeCustom({ version: 1, long: g });
    let depth = 0;
    let cur: Group | Leaf = c.long;
    while (cur.type === "group" && cur.children[0]) {
      depth++;
      cur = cur.children[0];
    }
    expect(depth).toBeLessThanOrEqual(5);
    const many = sanitizeCustom({ version: 1, long: { type: "group", op: "and", children: Array.from({ length: 80 }, () => ({ type: "leaf", block: "rsi", params: {} })) } });
    expect(many.long.children.length).toBeLessThanOrEqual(12);
  });

  it("parseCustom: nur Version 1; ohne oder mit fremder Version eine klare Meldung", () => {
    expect(parseCustom(defaultCustom()).config).toEqual(defaultCustom());
    expect(parseCustom({ ...defaultCustom(), version: 2 }).error).toMatch(/Version 2/);
    expect(parseCustom({ name: "alt" }).error).toMatch(/Versionsangabe/);
    expect(parseCustom("kaputt").config).toBeNull();
  });

  it("customKey ignoriert den Namen, nicht die Regeln", () => {
    const a = defaultCustom();
    expect(customKey({ ...a, name: "anders" })).toBe(customKey(a));
    expect(customKey({ ...a, stop: { ...a.stop, atr: 2 } })).not.toBe(customKey(a));
  });

  it("Bearbeiten ist unveränderlich und Spiegeln dreht die Bausteine um", () => {
    const c = defaultCustom();
    const added = editNode(c.long, c.long.id, (n) => (n.type === "group" ? { ...n, children: [...n.children, newLeaf(`n${nextNum(c)}`, "volume")] } : n));
    expect(added.children).toHaveLength(3);
    expect(c.long.children).toHaveLength(2);
    const removed = editNode(added, "n1", () => null);
    expect(removed.children.map((x) => x.id)).toEqual(["n2", "n5"]); // n3 / n4 belong to the mirrored short side
    const m = mirrorGroup(c.long, "g2", 10);
    const r = m.children[0] as Leaf;
    expect(r.params).toMatchObject({ mode: "above", level: 60 });
    expect((m.children[1] as Leaf).params).toMatchObject({ mode: "below" });
  });
});

describe("Vorlagen", () => {
  it("jede Vorlage ist gültig (keine Fehler), gesäubert und liest sich als Klartext", () => {
    expect(CUSTOM_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of CUSTOM_TEMPLATES) {
      const c = t.build();
      expect(validateCustom(c).filter((i) => i.level === "error"), t.id).toEqual([]);
      expect(sanitizeCustom(c)).toEqual(c);
      expect(summarizeCustom(c)[0]).toMatch(/^(Long|Short) wenn /);
    }
  });
});

describe("Validierung und Verfügbarkeit (mit Begründung)", () => {
  const base = (): CustomConfig => defaultCustom();
  it("Seite ohne Bedingung, leere Gruppe, fehlender Preis, zu enger Stop sind Fehler", () => {
    const c = base();
    expect(validateCustom({ ...c, long: newGroup("g1") }).some((i) => i.level === "error" && /Bedingung/.test(i.text))).toBe(true);
    const withEmpty: CustomConfig = { ...c, long: { ...c.long, children: [...c.long.children, newGroup("g9")] } };
    expect(validateCustom(withEmpty).some((i) => i.node === "g9")).toBe(true);
    const lvl: CustomConfig = { ...c, long: { ...c.long, children: [newLeaf("n9", "keyLevel")] } };
    expect(validateCustom(lvl).some((i) => /Preis fehlt/.test(i.text))).toBe(true);
    expect(validateCustom({ ...c, stop: { ...c.stop, kind: "percent", pct: 0.05 } }).some((i) => /Minimum der Engine/.test(i.text))).toBe(false);
    expect(validateCustom({ ...c, stop: { ...c.stop, kind: "percent", pct: 0.049 } }).some((i) => /Minimum der Engine/.test(i.text))).toBe(true);
  });

  it("niedrigerer Timeframe als die Ausführung: Fehler mit Grund; MCB-Leiter nur auf 1h / 4h", () => {
    const c = base();
    const low: CustomConfig = { ...c, interval: "4h", long: { ...c.long, children: [{ ...newLeaf("n9", "rsi"), tf: "1h" }] } };
    const msg = validateCustom(low).find((i) => i.node === "n9");
    expect(msg?.level).toBe("error");
    expect(msg?.text).toMatch(/niedriger als die Ausführung/);
    expect(tfAvailability("1h", "4h").ok).toBe(false);
    expect(tfAvailability("1d", "4h").ok).toBe(true);
    expect(tfAvailability("1d", "4h", "mcbLadder")).toMatchObject({ ok: false });
    expect(blockAvailability("mcbLadder", "15m").reason).toMatch(/1h oder 4h/);
    expect(blockAvailability("mcbLadder", "4h").ok).toBe(true);
  });

  it("Warnungen: Teil-Ziel hinter dem Ziel, kein Ausstieg außer Stop, Gegensignal ohne zweite Seite", () => {
    const c = base();
    const w = validateCustom({ ...c, target: { kind: "r", r: 1 }, exits: { ...c.exits, partial: { ...c.exits.partial, on: true, atR: 2 } } });
    expect(w.some((i) => i.level === "warn" && /verwirft/.test(i.text))).toBe(true);
    expect(validateCustom({ ...c, target: { kind: "none", r: 2 } }).some((i) => /endet ein Trade nur/.test(i.text))).toBe(true);
    expect(validateCustom({ ...c, exits: { ...c.exits, exitOnOpposite: true } }).some((i) => /Gegensignal/.test(i.text))).toBe(true);
  });

  it("Klartext: „Long wenn … UND (… ODER …)“", () => {
    const c = base();
    const nested: CustomConfig = {
      ...c,
      long: newGroup("g1", "and", [newLeaf("n1", "rsi"), newGroup("g5", "or", [{ ...newLeaf("n2", "maPrice", "1d") }, { ...newLeaf("n3", "volume"), not: true }])]),
    };
    const [line] = summarizeCustom(nested);
    expect(line).toMatch(/^Long wenn RSI\(14\) unter 30 UND \(Schluss über EMA 200 \[1D\] ODER NICHT: Volumen über 2× dem Ø der letzten 20 Kerzen\)\.$/);
    expect(leafText({ ...newLeaf("x", "keyLevel"), params: { ...defaultParams("keyLevel"), level: 65000, mode: "nAbove", n: 3 } })).toBe("3 Schlusskurse in Folge über 65000");
  });
});

describe("Verknüpfung: AND / OR / verschachtelt / unbekannt (Kleene)", () => {
  const S = (...v: number[]): Uint8Array => Uint8Array.from(v);
  const T = TRUE;
  const F = FALSE;
  const U = UNKNOWN;
  const leaves = new Map<string, Uint8Array>([
    ["a", S(T, T, F, U, U, F)],
    ["b", S(T, F, T, T, F, F)],
    ["c", S(F, F, F, F, T, T)],
  ]);
  const L = (id: string): Leaf => newLeaf(id, "rsi");
  const hit = (g: Group, without?: string[]) => [...combineTree(g, leaves, 6, without ? new Set(without) : undefined).hit!];

  it("AND: ein false gewinnt, sonst ein unbekannt, sonst true", () => {
    expect(hit(newGroup("g", "and", [L("a"), L("b")]))).toEqual([T, F, F, U, F, F]);
  });

  it("OR: ein true gewinnt, sonst ein unbekannt, sonst false", () => {
    expect(hit(newGroup("g", "or", [L("a"), L("b")]))).toEqual([T, T, T, T, U, F]);
  });

  it("verschachtelt: a UND (b ODER c)", () => {
    expect(hit(newGroup("g", "and", [L("a"), newGroup("h", "or", [L("b"), L("c")])]))).toEqual([T, F, F, U, U, F]);
  });

  it("unbekannt erfüllt eine geforderte Bedingung nie (nur ein echtes true ist ein Signal)", () => {
    const h = hit(newGroup("g", "and", [L("a")]));
    expect(h[3]).toBe(U);
    expect(h.filter((v) => v === T)).toHaveLength(2);
  });

  it("NICHT kehrt true / false um, unbekannt bleibt unbekannt", () => {
    expect(hit(newGroup("g", "and", [{ ...L("a"), not: true }]))).toEqual([F, F, T, U, U, T]);
  });

  it("ohne ein Blatt: die Gruppe schrumpft, eine leere Gruppe fällt weg, nichts übrig → null", () => {
    expect(hit(newGroup("g", "and", [L("a"), L("b")]), ["b"])).toEqual([T, T, F, U, U, F]);
    expect(combineTree(newGroup("g", "and", [L("a")]), leaves, 6, new Set(["a"])).hit).toBeNull();
    expect(hit(newGroup("g", "and", [L("a"), newGroup("h", "or", [L("b"), L("c")])]), ["b", "c"])).toEqual([T, T, F, U, U, F]);
  });

  it("ein fehlendes Blatt ist unbekannt, nie wahr", () => {
    expect(hit(newGroup("g", "or", [L("zzz")]))).toEqual([U, U, U, U, U, U]);
  });
});

describe("Bausteine auf handgebauten Kerzen", () => {
  it("RSI unter Niveau / Kreuzung nach oben mit Fenster; davor unbekannt", () => {
    // 20 falling closes → RSI 0; then rising
    const cs = [...Array.from({ length: 20 }, (_, i) => 100 - i), ...Array.from({ length: 20 }, (_, i) => 81 + i * 2)];
    const bars = closes(cs);
    const r = rsi(
      cs,
      14,
    );
    const below = run("rsi", bars, { mode: "below", level: 30 });
    expect(below[5]).toBe(UNKNOWN); // not enough bars for RSI(14)
    expect(below[19]).toBe(TRUE);
    const up = run("rsi", bars, { mode: "crossUp", level: 30, within: 1 });
    const at = r.findIndex((v, i) => i > 20 && v > 30);
    expect(r[at - 1]! <= 30).toBe(true);
    expect(up[at]).toBe(TRUE);
    expect(up[at - 1]).toBe(FALSE);
    expect(up[at + 1]).toBe(FALSE);
    const win = run("rsi", bars, { mode: "crossUp", level: 30, within: 3 });
    expect([win[at], win[at + 1], win[at + 2], win[at + 3]]).toEqual([TRUE, TRUE, TRUE, FALSE]);
  });

  it("Kurs gegen SMA: darüber / Kreuzung; vor dem Fenster unbekannt", () => {
    const bars = closes([10, 10, 10, 10, 10, 9, 8, 12, 12, 12]);
    const above = run("maPrice", bars, { type: "sma", len: 3, mode: "above" });
    expect(above[1]).toBe(UNKNOWN);
    expect(above[7]).toBe(TRUE);
    const cross = run("maPrice", bars, { type: "sma", len: 3, mode: "crossUp", within: 1 });
    expect([...cross].slice(3)).toEqual([FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE]);
  });

  it("MA-Kreuzung nach oben genau auf der Kerze der Kreuzung", () => {
    const cs = [...Array.from({ length: 30 }, () => 100), ...Array.from({ length: 15 }, (_, i) => 100 + i * 2)];
    const x = run("maCross", closes(cs), { type: "sma", fast: 3, slow: 8, mode: "up", within: 1 });
    expect([...x].filter((v) => v === TRUE)).toHaveLength(1);
    expect(x[30]).toBe(FALSE);
    expect(x[31]).toBe(TRUE);
  });

  it("Ausbruch über das Hoch der N Kerzen davor – nicht das eigene", () => {
    const bars = [...Array.from({ length: 6 }, (_, i) => bar(i, 10, 11, 9, 10)), bar(6, 10, 12, 10, 11.5), bar(7, 11, 13, 11, 12.5)];
    const b = run("breakout", bars, { mode: "up", n: 5 });
    expect(b[4]).toBe(UNKNOWN); // fewer than 5 bars before
    expect(b[5]).toBe(FALSE);
    expect(b[6]).toBe(TRUE); // 11.5 > 11 (highest high of the 5 before)
    expect(b[7]).toBe(TRUE); // 12.5 > 12
    const dn = run("breakout", bars, { mode: "down", n: 5 });
    expect(dn[6]).toBe(FALSE);
  });

  it("eigenes Preisniveau: Berührung, Schluss darüber, N Schlüsse in Folge, Rücktest", () => {
    const bars = [bar(0, 98, 99, 97, 98), bar(1, 98, 101, 98, 100.5), bar(2, 100.5, 102, 100.2, 101.5), bar(3, 101.5, 103, 101, 102), bar(4, 102, 102.4, 99.9, 101)];
    expect([...run("keyLevel", bars, { level: 100, mode: "touch" })]).toEqual([FALSE, TRUE, FALSE, FALSE, TRUE]);
    expect([...run("keyLevel", bars, { level: 100, mode: "closeAbove" })]).toEqual([FALSE, TRUE, TRUE, TRUE, TRUE]);
    expect([...run("keyLevel", bars, { level: 100, mode: "nAbove", n: 3 })]).toEqual([UNKNOWN, UNKNOWN, FALSE, TRUE, TRUE]);
    expect([...run("keyLevel", bars, { level: 100, mode: "crossAbove", within: 1 })].slice(1)).toEqual([TRUE, FALSE, FALSE, FALSE]);
    // bar 4 dips to 99.9 (≤ 100 × 1.002) and closes above, after closes above within 20 bars → the retest holds
    expect(run("keyLevel", bars, { level: 100, mode: "retestUp", lookback: 20, tol: 0.2 })[4]).toBe(TRUE);
    expect(run("keyLevel", bars, { level: 100, mode: "retestUp" })[3]).toBe(FALSE);
    // without a price the leaf is unknown, never true
    expect(new Set(run("keyLevel", bars, { level: 0, mode: "closeAbove" }))).toEqual(new Set([UNKNOWN]));
  });

  it("Volumen-Spitze: braucht Volumen; ohne Volumen unbekannt; Kerzenfarbe", () => {
    const vols = [10, 10, 10, 10, 10, 35, 10, 10];
    const bars = vols.map((v, i) => bar(i, 100, 101, 99, i === 5 ? 100.8 : 100.1, v));
    const v = run("volume", bars, { len: 5, mult: 3 });
    expect([...v].slice(0, 5)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
    expect(v[5]).toBe(TRUE);
    expect(v[6]).toBe(FALSE);
    expect(run("volume", bars, { len: 5, mult: 3, candle: "bear" })[5]).toBe(FALSE);
    const noVol = closes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(run("volume", noVol, { len: 5 }))).toEqual(new Set([UNKNOWN]));
  });

  it("Bollinger: Berührung des unteren Bands nach einem Einbruch; Squeeze nach ruhiger Phase", () => {
    const quiet = Array.from({ length: 30 }, (_, i) => 100 + (i % 2) * 0.1);
    const bars = [...quiet, 90].map((c, i) => bar(i, c, c + 0.01, c - 0.01, c)); // tight wicks: only the drop touches
    const t = run("bollinger", bars, { len: 20, mult: 2, mode: "touchLower" });
    expect(t[19]).toBe(FALSE);
    expect(t[30]).toBe(TRUE);
    const wild = walk(300, 3600, 3);
    const calm = closes(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 0.05));
    const sq = run("bollinger", [...wild.slice(0, 150), ...calm.map((b, i) => ({ ...b, t: wild[149]!.t + (i + 1) * 3600 }))], { len: 20, mode: "squeeze", pct: 50, lookback: 100 });
    expect(sq[sq.length - 1]).toBe(TRUE);
    expect(sq[10]).toBe(UNKNOWN);
  });

  it("MACD: Kreuzung nach oben nach einer Drehung, Null-Linie; ATR-Perzentil: ruhig vs. aktiv", () => {
    const cs = [...Array.from({ length: 120 }, (_, i) => 200 - i), ...Array.from({ length: 60 }, (_, i) => 80 + i * 1.5)];
    const m = run("macd", closes(cs), { mode: "crossUp", within: 1 });
    const hits = [...m].map((v, i) => (v === TRUE ? i : -1)).filter((i) => i >= 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!).toBeGreaterThan(119); // only after the turn
    const calmThenWild: Bar[] = [...Array.from({ length: 150 }, (_, i) => bar(i, 100, 100.2, 99.8, 100)), ...Array.from({ length: 30 }, (_, i) => bar(150 + i, 100, 103, 97, 100))];
    const hi = run("atrPct", calmThenWild, { len: 14, lookback: 100, mode: "above", pct: 90 });
    expect(hi[179]).toBe(TRUE);
    expect(hi[120]).toBe(FALSE); // a flat ATR ranks 0, not 100
    expect(hi[20]).toBe(UNKNOWN);
  });

  it("MCB-Leiter ohne Fakten bleibt unbekannt; mit Fakten gilt Stärke und gültig", () => {
    const bars = closes([1, 2, 3, 4]);
    expect(new Set(run("mcbLadder", bars))).toEqual(new Set([UNKNOWN]));
    const facts = [null, { long: { strength: 3, valid: true, score: 1 }, short: null }, { long: { strength: 2, valid: true, score: 1 }, short: null }, { long: { strength: 4, valid: false, score: 1 }, short: null }];
    const s = series(BLOCKS.mcbLadder, bars, sanitizeParams("mcbLadder", { mode: "validLong", minStrength: 3 }), facts as never);
    expect([...s]).toEqual([UNKNOWN, TRUE, FALSE, FALSE]);
  });
});

describe("Bausteine der App: gleiche Ergebnisse wie der Einstiegs-Check", () => {
  it("Premium / Discount je Kerze = luxZone auf der bis dahin sichtbaren Historie", () => {
    const pos = luxZoneSeries(H4, 50);
    for (const i of [60, 120, 333, 700, 1100, 1499]) {
      const z = luxZone(H4.slice(0, i + 1), 50);
      if (z) expect(pos[i]).toBeCloseTo(z.pos, 12);
      else expect(Number.isNaN(pos[i]!)).toBe(true);
    }
  });

  it("MCB-Ereignisse = mcbSeries der App (deine Einstellung), erst nach der Einschwingzeit", () => {
    const pts = mcbSeries(H4, DEFAULT_SIGNAL_CFG, { minor: true });
    const idx = new Map(H4.map((b, i) => [b.t, i]));
    for (const kind of ["bottom", "top", "buy", "sell"] as const) {
      const s = run("wtEvent", H4, { kind, within: 1 });
      const want = new Set(pts.filter((p) => p.kind === kind).map((p) => idx.get(p.t)!).filter((i) => i >= 118));
      const got = new Set([...s].map((v, i) => (v === TRUE ? i : -1)).filter((i) => i >= 0));
      expect(got).toEqual(want);
      expect(s[10]).toBe(UNKNOWN);
    }
  });
});

describe("Kein Blick in die Zukunft", () => {
  const CUTS = [260, 520, 900, 1300, 1499];
  const CASES: [BlockId, LeafParams][] = [
    ["rsi", { mode: "crossUp", level: 35, within: 4 }],
    ["rsiMa", { mode: "above" }],
    ["wtEvent", { kind: "anyLong", within: 3 }],
    ["wtState", { mode: "below", level: -40 }],
    ["zone", { mode: "discount" }],
    ["maCross", { type: "ema", fast: 12, slow: 30, mode: "up", within: 3 }],
    ["maPrice", { type: "ema", len: 100, mode: "above" }],
    ["macd", { mode: "crossUp", within: 2 }],
    ["bollinger", { mode: "touchLower", within: 2 }],
    ["bollinger", { mode: "squeeze", lookback: 60, pct: 25 }],
    ["atrPct", { mode: "above", pct: 60, lookback: 80 }],
    ["breakout", { mode: "up", n: 30, within: 2 }],
    ["keyLevel", { level: 80000, mode: "nAbove", n: 3 }],
    ["keyLevel", { level: 80000, mode: "retestUp", lookback: 30 }],
    ["rsiLine", { mode: "breakUp", within: 4 }],
  ];
  for (const [id, p] of CASES) {
    it(`${id} ${String(p.mode ?? p.kind)}: der Wert in Kerze i ist mit der bis i abgeschnittenen Historie derselbe`, () => {
      const full = run(id, H4, p);
      for (const i of CUTS) {
        const cut = run(id, H4.slice(0, i + 1), p);
        expect(cut[i]).toBe(full[i]);
        expect(cut[i - 7]).toBe(full[i - 7]);
        expect(cut[i - 40]).toBe(full[i - 40]);
      }
    }, 60_000);
  }
});

describe("Höherer Timeframe: erst sichtbar, wenn er geschlossen hat", () => {
  const SEC1 = 3600;
  const SEC4 = 14_400;
  it("mapToExec: die laufende 4h-Kerze ist unsichtbar, die geschlossene ab ihrem Schlusskurs", () => {
    const h1 = walk(24, SEC1);
    const h4 = aggregateBars(h1, (t) => Math.floor(t / SEC4) * SEC4, 4);
    expect(h4).toHaveLength(6);
    const src = Uint8Array.from([TRUE, FALSE, TRUE, FALSE, TRUE, FALSE]);
    const out = mapToExec(src, h4, SEC4, h1, SEC1);
    // 1h bars 0-2 close at 01:00-03:00 inside the first 4h bar (closes 04:00): nothing is visible yet
    expect([out[0], out[1], out[2]]).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
    // the 1h bar 3 closes at 04:00 = the 4h bar closes: visible
    expect(out[3]).toBe(TRUE);
    expect([out[4], out[5], out[6]]).toEqual([TRUE, TRUE, TRUE]);
    expect(out[7]).toBe(FALSE); // second 4h bar closes at 08:00 = close of 1h bar 7
    expect(out[23]).toBe(FALSE);
  });

  it("eine Lücke in den höheren Daten macht unbekannt statt eine alte Kerze weiterzureichen", () => {
    const h1 = walk(24, SEC1);
    const h4 = aggregateBars(h1, (t) => Math.floor(t / SEC4) * SEC4, 4);
    const holey = h4.filter((_, i) => i !== 2 && i !== 3); // 4h bars 2 and 3 missing
    const out = mapToExec(Uint8Array.from([TRUE, TRUE, TRUE, TRUE]), holey, SEC4, h1, SEC1);
    expect(out[7]).toBe(TRUE); // 2nd bar present
    expect(out[10]).toBe(TRUE); // 3 h behind the last closed higher bar
    expect(out[11]).toBe(UNKNOWN); // a full higher bar behind = one is missing
    expect(out[18]).toBe(UNKNOWN);
    expect(out[19]).toBe(TRUE); // the 16:00-20:00 bar closes at 20:00 = close of exec bar 19
    expect(out[23]).toBe(TRUE);
  });

  it("Blatt mit höherem Timeframe: Wert in Ausführungskerze i bleibt gleich, wenn alles nach i abgeschnitten wird", () => {
    const h1 = walk(600, SEC1, 11);
    const h4all = aggregateBars(h1, (t) => Math.floor(t / SEC4) * SEC4, 4);
    const leaf: Leaf = { ...newLeaf("n1", "maPrice", "4h"), params: sanitizeParams("maPrice", { type: "sma", len: 5, mode: "above" }) };
    const ev = (e: Bar[], o: Bar[]) => evaluateLeaves([leaf], { exec: { tf: "1h", bars: e }, other: { "4h": o } }).result().get("n1")!;
    const full = ev(h1, h4all);
    for (const i of [120, 121, 122, 123, 300, 301, 302, 303, 599]) {
      const e = h1.slice(0, i + 1);
      const cut = ev(e, aggregateBars(e, (t) => Math.floor(t / SEC4) * SEC4, 4));
      expect(cut[i]).toBe(full[i]);
    }
    // and the running 4h bar is truly not used: altering the future of the 1h data changes nothing before it
    const altered = h1.map((b, i) => (i > 301 ? { ...b, c: b.c * 3, h: b.h * 3 } : b));
    const alt = ev(altered, aggregateBars(altered, (t) => Math.floor(t / SEC4) * SEC4, 4));
    expect([...alt].slice(0, 302)).toEqual([...full].slice(0, 302));
  });

  it("niedrigerer Timeframe oder fehlende Daten: unbekannt, nie wahr", () => {
    const h4 = walk(100, SEC4);
    const low: Leaf = { ...newLeaf("n1", "rsi", "1h"), params: defaultParams("rsi") };
    const missing: Leaf = { ...newLeaf("n2", "rsi", "1d"), params: defaultParams("rsi") };
    const r = evaluateLeaves([low, missing], { exec: { tf: "4h", bars: h4 }, other: { "1h": walk(400, SEC1) } }).result();
    expect(new Set(r.get("n1"))).toEqual(new Set([UNKNOWN]));
    expect(new Set(r.get("n2"))).toEqual(new Set([UNKNOWN]));
  });
});
