/**
 * Signalprotokoll recorders (F25/F28): a Box setup is stored with its graded reasons and the version of the engine's settings, a
 * phase change without reasons only with the version; the same settings keep their number, a changed setting starts the next; the
 * registry survives a reload and is read leniently; the Einstiegs-Check's rule source changes with the configuration and the Lage gate.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BOXES_CFG } from "@/domain/boxes";
import { fingerprint } from "@/domain/missed";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { RULE_VERSIONS_KEY, __resetRuleVersions, getRuleVersions, ruleRefFor } from "@/market/ruleVersions";
import { __resetSignalArchive, getSignalArchive, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { boxRuleSource, recordBoxSignal } from "@/market/signalRecord";
import { entryRuleSource, entryRulesOf } from "@/market/signalRules";
import { signalInput } from "./missed.fixtures";

const T = Date.UTC(2026, 9, 26, 10, 0, 0);
const box = (key: string) => signalInput({ key, source: "box", kind: "setup", ref: `s:BTCUSDT:b1:A+`, at: T, symbol: "BTCUSDT", tf: "4h" });

beforeEach(() => {
  localStorage.removeItem(SIGNAL_ARCHIVE_KEY);
  localStorage.removeItem(RULE_VERSIONS_KEY);
  __resetSignalArchive();
  __resetRuleVersions();
});

describe("recordBoxSignal", () => {
  it("stores the graded reasons as conditions and the version of the engine's settings", () => {
    recordBoxSignal(box("a"), [{ text: "Preis an der Unterkante", ok: true }, { text: "RSI-Linie gebrochen", ok: false }], DEFAULT_BOXES_CFG);
    const e = getSignalArchive()[0]!;
    expect(e.prereq).toEqual([
      { id: "r0", label: "Preis an der Unterkante", met: true },
      { id: "r1", label: "RSI-Linie gebrochen", met: false },
    ]);
    expect(e.rules).toEqual({ kind: "box", hash: fingerprint(boxRuleSource(DEFAULT_BOXES_CFG)), n: 1, since: expect.any(Number) });
  });

  it("a phase change has no reasons: no conditions, but the version", () => {
    recordBoxSignal({ ...box("p"), kind: "breakout", entry: false }, undefined, DEFAULT_BOXES_CFG);
    expect(getSignalArchive()[0]).toMatchObject({ prereq: [], rules: { kind: "box", n: 1 } });
  });

  it("the same settings keep their number; a changed setting that changes the grading starts the next; the watchlist and the switches do not count", () => {
    recordBoxSignal(box("a"), [], DEFAULT_BOXES_CFG);
    recordBoxSignal(box("b"), [], { ...DEFAULT_BOXES_CFG, watchlist: ["ETHUSDT"], alerts: false, notify: true } as never);
    expect(getSignalArchive().map((e) => e.rules!.n)).toEqual([1, 1]);
    recordBoxSignal(box("c"), [], { ...DEFAULT_BOXES_CFG, minGrade: "A+" });
    expect(getSignalArchive().find((e) => e.key === "c")!.rules!.n).toBe(2);
    recordBoxSignal(box("d"), [], DEFAULT_BOXES_CFG); // back to the first settings
    expect(getSignalArchive().find((e) => e.key === "d")!.rules!.n).toBe(1);
  });
});

describe("the registry", () => {
  it("is stored in the browser and read back after a reload", () => {
    const r = ruleRefFor("entry", "", "settings A", T);
    expect(r).toMatchObject({ kind: "entry", n: 1, since: T });
    expect(JSON.parse(localStorage.getItem(RULE_VERSIONS_KEY)!)).toMatchObject({ v: 1, items: [{ kind: "entry", scope: "", hash: r.hash, n: 1, since: T }] });
    __resetRuleVersions(); // a reload
    expect(ruleRefFor("entry", "", "settings A", T + 5000)).toEqual(r);
    expect(ruleRefFor("entry", "", "settings B", T + 6000).n).toBe(2);
    expect(getRuleVersions().map((v) => v.n)).toEqual([1, 2]);
  });

  it("a broken stored registry is ignored", () => {
    localStorage.setItem(RULE_VERSIONS_KEY, "{not json");
    expect(ruleRefFor("box", "", "x", T).n).toBe(1);
    __resetRuleVersions();
    localStorage.setItem(RULE_VERSIONS_KEY, JSON.stringify({ v: 9, items: [] }));
    expect(ruleRefFor("box", "", "x", T).n).toBe(1);
  });
});

describe("the rule source of the Einstiegs-Check", () => {
  it("changes with the configuration and with the Lage gate, not with anything else", () => {
    const a = entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG });
    expect(entryRuleSource({ cfg: { ...DEFAULT_SIGNAL_CFG } })).toBe(a);
    expect(entryRuleSource({ cfg: { ...DEFAULT_SIGNAL_CFG, required: DEFAULT_SIGNAL_CFG.required + 1 } })).not.toBe(a);
    expect(entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG, lage: { cfg: { on: true, mode: "block" } } })).not.toBe(a);
    expect(entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG, lage: { cfg: { on: true, mode: "warn" } } })).not.toBe(entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG, lage: { cfg: { on: true, mode: "block" } } }));
    // `notify` (the browser notification) does not change how the check evaluates
    expect(entryRuleSource({ cfg: { ...DEFAULT_SIGNAL_CFG, notify: true } })).toBe(a);
    // a gate that is off is the same rule set whatever its mode says – and the same as no gate (a check rebuilt from history)
    expect(entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG, lage: { cfg: { on: false, mode: "block" } } })).toBe(a);
    expect(entryRuleSource({ cfg: DEFAULT_SIGNAL_CFG, lage: { cfg: { on: false, mode: "warn" } } })).toBe(a);
    expect(entryRulesOf({ cfg: DEFAULT_SIGNAL_CFG }, T).n).toBe(1);
    expect(entryRulesOf({ cfg: { ...DEFAULT_SIGNAL_CFG, required: DEFAULT_SIGNAL_CFG.required + 1 } }, T + 1).n).toBe(2);
  });
});
