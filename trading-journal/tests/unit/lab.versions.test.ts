/**
 * F15 – versions of the rule drafts: a version only when something changed, a plain-language diff ("RSI Niveau: 30 → 25"),
 * the side-by-side rows, numbering that survives the limit, a robust reader for the stored map.
 */
import { describe, expect, it } from "vitest";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { addVersion, compareRows, configRows, diffConfigs, MAX_NOTE, MAX_VERSIONS, MAX_VERSIONS_TOTAL, parseVersions, setNote, trimTotal, type DraftVersion } from "@/domain/lab/versions";

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}, tf: Leaf["tf"] = "exec"): Leaf => ({ ...newLeaf(id, block, tf), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (over: Partial<CustomConfig> = {}, level = 30): CustomConfig =>
  sanitizeCustom({ ...defaultCustom(), name: "Idee", interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level }), leaf("n2", "maPrice", { type: "ema", len: 200, mode: "above" }, "1d")]), ...over });

describe("diffConfigs: Klartext statt JSON", () => {
  it("a changed threshold reads like a sentence", () => {
    expect(diffConfigs(idea(), idea({}, 25))).toEqual(["Long · RSI Niveau: 30 → 25"]);
  });

  it("identical rules → no lines; the name alone is a line", () => {
    expect(diffConfigs(idea(), idea())).toEqual([]);
    expect(diffConfigs(idea(), idea({ name: "Neu" }))).toEqual(["Name: „Idee“ → „Neu“"]);
  });

  it("added / removed conditions, interval, side, stop, target, management", () => {
    const a = idea();
    const b = sanitizeCustom({
      ...a,
      interval: "1h",
      sides: "both",
      long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 30 }), leaf("n3", "volume")]),
      short: newGroup("g2", "and", [leaf("n4", "rsi", { mode: "above", level: 70 })]),
      stop: { ...a.stop, kind: "percent", pct: 2 },
      target: { kind: "r", r: 3 },
      exits: { ...a.exits, breakEven: { on: true, trigger: "r", value: 1, to: "entry" }, maxBars: 20 },
    });
    const lines = diffConfigs(a, b);
    expect(lines).toContain("Ausführungs-Kerze: 4h → 1h");
    expect(lines).toContain("Richtung: nur Long → Long und Short");
    expect(lines.some((l) => l.startsWith("Long: Bedingung entfernt:") && l.includes("EMA 200"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Long: Bedingung neu:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Short-Seite eingeschaltet:") && l.includes("RSI(14) über 70"))).toBe(true);
    expect(lines).toContain("Stop: 1,5 × ATR(14) → 2 % vom Schlusskurs");
    expect(lines).toContain("Ziel: 2 R → 3 R");
    expect(lines.some((l) => l.startsWith("Break-even neu:"))).toBe(true);
    expect(lines).toContain("Zeit-Stop neu: nach 20 Kerzen");
  });

  it("a select / timeframe / not change names the old and the new value", () => {
    const a = idea();
    const b = sanitizeCustom({ ...a, long: newGroup("g1", "and", [{ ...leaf("n1", "rsi", { mode: "crossUp", level: 30 }), not: true }, leaf("n2", "maPrice", { type: "ema", len: 200, mode: "above" }, "4h")]) });
    const lines = diffConfigs(a, b);
    expect(lines).toContain("Long · RSI Niveau: Bedingung darunter → kreuzt nach oben");
    expect(lines).toContain("Long · RSI Niveau: „Nicht“ eingeschaltet");
    expect(lines.some((l) => l.includes("Zeitebene 1D → 4h"))).toBe(true);
  });

  it("a switched-off side is not part of the diff", () => {
    const a = idea();
    const b = sanitizeCustom({ ...a, short: newGroup("g2", "and", [leaf("n9", "rsi", { mode: "above", level: 80 })]) });
    expect(diffConfigs(a, b)).toEqual([]);
  });
});

describe("compareRows", () => {
  it("rows for both versions, changed rows marked", () => {
    const rows = compareRows(idea(), idea({ interval: "1h" }, 25));
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel["Ausführungs-Kerze"]).toMatchObject({ a: "4h", b: "1h", changed: true });
    expect(byLabel["Long-Regeln"]!.changed).toBe(true);
    expect(byLabel["Stop"]!.changed).toBe(false);
    expect(configRows(idea()).map((r) => r.label)).toEqual(expect.arrayContaining(["Name", "Stop", "Ziel", "Break-even", "Trailing-Stop"]));
  });
});

describe("addVersion", () => {
  it("v1 on the first save, none for an unchanged save, a new one per change; the note is cut and cleaned", () => {
    const v1 = addVersion([], idea(), 1000);
    expect(v1).toHaveLength(1);
    expect(v1[0]).toMatchObject({ n: 1, at: 1000, note: "" });
    expect(addVersion(v1, idea(), 2000)).toBe(v1);
    const v2 = addVersion(v1, idea({}, 25), 3000, `Schwelle gesenkt\n${"x".repeat(300)}`);
    expect(v2.map((v) => v.n)).toEqual([1, 2]);
    expect(v2[1]!.note.length).toBe(MAX_NOTE);
    expect(v2[1]!.note).not.toContain("\n");
    // a rename counts too
    expect(addVersion(v2, idea({ name: "Andere" }, 25), 4000)).toHaveLength(3);
  });

  it("keeps the newest versions and goes on counting", () => {
    let list: DraftVersion[] = [];
    for (let k = 0; k < MAX_VERSIONS + 5; k++) list = addVersion(list, idea({}, 20 + (k % 60) + Math.floor(k / 60)), k);
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0]!.n).toBe(6);
    expect(list[list.length - 1]!.n).toBe(MAX_VERSIONS + 5);
  });

  it("setNote changes one version only", () => {
    const list = addVersion(addVersion([], idea(), 1), idea({}, 25), 2);
    const next = setNote(list, 2, "  neu  ");
    expect(next.map((v) => v.note)).toEqual(["", "neu"]);
  });
});

describe("parseVersions / trimTotal", () => {
  it("round trip, and everything unreadable is dropped", () => {
    const list = addVersion(addVersion([], idea(), 1), idea({}, 25), 2, "n");
    const back = parseVersions(JSON.parse(JSON.stringify({ v: 1, items: { d1: list } })));
    expect(back.d1!.map((v) => [v.n, v.note, v.key])).toEqual(list.map((v) => [v.n, v.note, v.key]));
    expect(parseVersions(null)).toEqual({});
    expect(parseVersions({ v: 2, items: { d1: list } })).toEqual({});
    expect(parseVersions({ v: 1, items: { "../x": list, d2: "no", d3: [{ n: 1, config: { version: 9 } }, { n: "a" }, null, { n: 1, at: 5, config: list[0]!.config }, { n: 1, at: 6, config: list[0]!.config }] } })).toEqual({ d3: [expect.objectContaining({ n: 1, at: 5 })] });
  });

  it("the total is limited (the fullest draft gives up its oldest versions)", () => {
    const mk = (count: number): DraftVersion[] => Array.from({ length: count }, (_, k) => ({ n: k + 1, at: k, note: "", key: `k${k}`, config: idea() }));
    const map = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`d${i + 1}`, mk(20)]));
    const out = trimTotal(map);
    expect(Object.values(out).reduce((s, l) => s + l.length, 0)).toBeLessThanOrEqual(MAX_VERSIONS_TOTAL);
    expect(out.d1!.at(-1)!.n).toBe(20);
  });
});
