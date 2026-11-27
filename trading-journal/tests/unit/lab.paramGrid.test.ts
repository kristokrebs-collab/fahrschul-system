/**
 * F11 / F16 – the parameter grid of an idea: the values around a setting, the axes (and the reason when there are none), one
 * changed parameter, and the extra job on a REAL run (BTCUSDT fixtures): the centre cell equals the shown run, the other
 * cells are the same run with one or two rule parameters changed, deterministic, and no cell sees a future bar.
 */
import { describe, expect, it } from "vitest";
import { createLabJob } from "@/domain/backtest/index";
import { createExtraJob } from "@/domain/lab/extras/job";
import { gridAxes, gridValues, withParam } from "@/domain/lab/extras/paramGrid";
import { BLOCKS, defaultParams } from "@/domain/lab/rules/blocks";
import { defaultCustom, leavesOf, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { ParamDef } from "@/domain/lab/rules/types";
import { realInput } from "./lab.extras.helpers";

const def = (id: Parameters<typeof BLOCKS.rsi.params.find>[0] extends never ? never : "rsi", key: string): ParamDef => BLOCKS[id].params.find((p) => p.key === key)!;

describe("Werte um den Standard", () => {
  it("±25 %, gerastert und begrenzt; die gewählte Zahl ist immer dabei", () => {
    expect(gridValues(def("rsi", "len"), 14)).toEqual([11, 14, 18]); // 14 ± 3,5 → 10,5 → 11 / 17,5 → 18
    expect(gridValues(def("rsi", "level"), 30)).toEqual([23, 30, 38]);
    expect(gridValues(def("rsi", "len"), 2)).toEqual([2, 3]); // unten bei 2 begrenzt
    expect(gridValues(def("rsi", "level"), 99)).toEqual([74, 99]); // oben bei 99 begrenzt
    for (const v of [5, 14, 30, 99]) expect(gridValues(def("rsi", "level"), v)).toContain(v);
  });
  it("auch bei negativen Niveaus (CCI) und kleinen Kommazahlen", () => {
    expect(gridValues(BLOCKS.cci.params.find((p) => p.key === "level")!, -100)).toEqual([-120, -100, -70]); // Schritt 10: -125 → -120, -75 → -70
    const mult = BLOCKS.bollinger.params.find((p) => p.key === "mult")!;
    expect(gridValues(mult, 2)).toEqual([1.5, 2, 2.5]);
  });
});

describe("Achsen einer Idee", () => {
  it("jede Zahl der Regeln, die gerade gilt – mit sprechendem Namen", () => {
    const g = gridAxes(defaultCustom());
    expect(g.blocked).toBeNull();
    const ids = g.axes.map((a) => a.id);
    expect(ids).toContain("n1.len");
    expect(ids).toContain("n1.level");
    expect(ids).toContain("n2.len");
    expect(ids).not.toContain("n1.within"); // gilt nur beim Kreuzen
    expect(g.axes.find((a) => a.id === "n1.level")!.label).toBe("RSI Niveau · Niveau");
  });
  it("bei beiden Seiten steht die Seite im Namen; ein Preis-Niveau wird nicht gestreut", () => {
    const c = sanitizeCustom({ ...defaultCustom(), sides: "both", long: newGroup("g1", "and", [newLeaf("n1", "rsi"), { ...newLeaf("n2", "keyLevel"), params: { ...defaultParams("keyLevel"), level: 65_000 } }]) });
    const g = gridAxes(c);
    expect(g.axes.find((a) => a.id === "n1.len")!.label).toMatch(/^Long · /);
    expect(g.axes.some((a) => a.id === "n2.level")).toBe(false);
  });
  it("rechenintensive Bausteine sperren das Raster – mit Grund", () => {
    const c = sanitizeCustom({ ...defaultCustom(), interval: "4h", long: newGroup("g1", "and", [newLeaf("n1", "rsi"), newLeaf("n2", "mcbLadder")]) });
    const g = gridAxes(c);
    expect(g.axes).toEqual([]);
    expect(g.blocked).toMatch(/MCB-Leiter.*rechenintensiv/);
  });
  it("nur Auswahlfelder: keine Achse, Grund genannt", () => {
    const c = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", [newLeaf("n1", "timeWindow")]) });
    expect(gridAxes(c).blocked).toMatch(/keine Zahl/);
  });
});

describe("Ein Parameter ändern", () => {
  it("setzt nur das eine Blatt, säubert abhängige Zahlen und lässt die Idee unverändert", () => {
    const c = defaultCustom();
    const before = JSON.stringify(c);
    const r = withParam(c, "n1", "level", 33);
    expect(leavesOf(r.long).find((l) => l.id === "n1")!.params.level).toBe(33);
    expect(leavesOf(r.long).find((l) => l.id === "n2")!.params).toEqual(leavesOf(c.long).find((l) => l.id === "n2")!.params);
    expect(JSON.stringify(c)).toBe(before);
    // schnell < langsam wird wiederhergestellt (vertauscht)
    const x = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", [{ ...newLeaf("n1", "maCross"), params: { ...defaultParams("maCross"), fast: 10, slow: 20 } }]) });
    const y = withParam(x, "n1", "fast", 30);
    expect(leavesOf(y.long)[0]!.params).toMatchObject({ fast: 20, slow: 30 });
  });
});

describe("Zusatzlauf auf einem echten Lauf", () => {
  const input = realInput();
  const run = createLabJob(input).result();

  it("die Mittelzelle ist der gezeigte Lauf; die Nachbarn sind derselbe Lauf mit geänderter Zahl", () => {
    const out = createExtraJob({ base: input, what: "params", grid: { x: "n1.level", y: "n1.len" } }).result();
    expect(out.what).toBe("params");
    if (out.what !== "params" || !out.grid) throw new Error("no grid");
    const g = out.grid;
    expect(g.x.label).toContain("Niveau");
    expect(g.x.values).toEqual([34, 45, 56]);
    expect(g.y!.values).toEqual([11, 14, 18]);
    expect(g.cells).toHaveLength(9);
    const centre = g.cells.find((c) => c.xi === g.baseXi && c.yi === g.baseYi)!;
    expect(centre.stats!.n).toBe(run.stats.n);
    expect(centre.stats!.sumR).toBeCloseTo(run.trades.reduce((s, t) => s + t.r, 0), 9);
    // another cell really differs: a looser RSI level gives at least as many signals
    const loose = g.cells.find((c) => c.xi === 2 && c.yi === g.baseYi)!.stats!;
    const tight = g.cells.find((c) => c.xi === 0 && c.yi === g.baseYi)!.stats!;
    expect(loose.n).toBeGreaterThanOrEqual(tight.n);
    expect(loose.n).not.toBe(tight.n);
    for (const c of g.cells) expect(c.stats).not.toBeNull();
  }, 60_000);

  it("eine Zelle gleicht einem eigenen Lauf mit denselben geänderten Regeln", () => {
    const out = createExtraJob({ base: input, what: "params", grid: { x: "n1.level", y: null } }).result();
    if (out.what !== "params" || !out.grid) throw new Error("no grid");
    const cfg = input.custom!.config;
    const alt = createLabJob({ ...input, custom: { ...input.custom!, config: withParam(cfg, "n1", "level", out.grid.x.values[2]!) } }).result();
    const cell = out.grid.cells.find((c) => c.xi === 2)!.stats!;
    expect(cell.n).toBe(alt.stats.n);
    expect(cell.sumR).toBeCloseTo(alt.trades.reduce((s, t) => s + t.r, 0), 9);
  }, 60_000);

  it("deterministisch, ohne Achse leer mit Grund, eine unbekannte Achse ebenfalls", () => {
    const a = createExtraJob({ base: input, what: "params", grid: { x: "n1.len", y: null } }).result();
    const b = createExtraJob({ base: input, what: "params", grid: { x: "n1.len", y: null } }).result();
    expect(b).toEqual(a);
    const none = createExtraJob({ base: input, what: "params", grid: { x: "n99.len", y: null } }).result();
    expect(none).toMatchObject({ what: "params", grid: null });
    expect(none.what === "params" && none.note).toMatch(/gibt es in dieser Idee nicht mehr/);
  }, 60_000);
});
