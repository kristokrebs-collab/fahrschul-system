/**
 * Strategie-Studio · `settings.studio`: several strategies, each with its own immutable versions, a versioned passthrough key
 * (unknown keys and unreadable entries survive), merge-able per strategy and per version by the two-tab / cloud `merge3`.
 */
import { describe, expect, it } from "vitest";
import { merge3 } from "@/store/merge3";
import { normalizeSettings } from "@/domain/normalize";
import {
  addLive,
  attachStats,
  diffVersions,
  MAX_STRATEGIES,
  MAX_VERSIONS,
  newStrategy,
  parseStrategyText,
  saveVersion,
  setVersionNote,
  studioCfgOf,
  studioOfSettings,
  updateDraft,
  withStrategies,
  addError,
  type StoredStats,
  type StoredStrategy,
  type VersionInput,
} from "@/domain/strategytext";

const T1 = "Long wenn RSI unter 30, Stop 1,5 ATR, Ziel 2R";
const T2 = "Long wenn RSI unter 25, Stop 1,5 ATR, Ziel 2R";
const input = (text: string, note?: string, stats?: StoredStats): VersionInput => {
  const p = parseStrategyText(text);
  return { text, answers: {}, setup: p.setup, config: p.rules, ...(note ? { note } : {}), ...(stats ? { stats } : {}) };
};
const stats = (over: Partial<StoredStats> = {}): StoredStats => ({ n: 40, winRate: 0.5, avgR: 0.2, pf: 1.4, maxDD: 0.1, netPct: 0.12, symbol: "BTCUSDT", interval: "4h", period: "1y", at: 5, ...over });
const fresh = (id = "s_1", name = "RSI-Dip"): StoredStrategy => newStrategy({ id, name, text: T1 }, 1000);

describe("strategies and versions", () => {
  it("a new strategy is an unsaved draft with no versions", () => {
    const s = fresh();
    expect(s).toMatchObject({ id: "s_1", name: "RSI-Dip", text: T1, symbol: "BTCUSDT", period: "1y", versions: [], live: [] });
  });

  it("saves a version per CHANGE: v1, v2 … and nothing for an unchanged draft", () => {
    let s = saveVersion(fresh(), input(T1), 2000, "a1");
    expect(s.versions.map((v) => v.n)).toEqual([1]);
    expect(s.versions[0]!.id).toBe("v1-a1");
    expect(saveVersion(s, input(T1), 3000, "a2")).toBe(s);
    s = saveVersion(s, input(T2, "RSI strenger"), 4000, "a3");
    expect(s.versions.map((v) => [v.n, v.note])).toEqual([[1, ""], [2, "RSI strenger"]]);
    expect(s.text).toBe(T2);
    // the same text with a different answer is a different version
    const alt = parseStrategyText(T2, { answers: { interval: "1h" } });
    s = saveVersion(s, { text: T2, answers: { interval: "1h" }, setup: alt.setup, config: alt.rules }, 5000, "a4");
    expect(s.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(s.versions[2]!.config.interval).toBe("1h");
  });

  it("an old version never changes: it keeps its text, answers and the rules as understood then", () => {
    const s = saveVersion(fresh(), input(T1), 2000, "a1");
    const v1 = s.versions[0]!;
    const next = saveVersion(s, input(T2), 3000, "a2");
    expect(next.versions[0]).toEqual(v1);
    expect(next.versions[0]!.text).toBe(T1);
  });

  it("numbers never repeat, the oldest versions drop out past the limit", () => {
    let s = fresh();
    for (let i = 0; i < MAX_VERSIONS + 3; i++) s = saveVersion(s, input(`Long wenn RSI unter ${20 + (i % 70)}, Ziel ${1 + (i % 5)}R, Stop ${1 + i} %`), 1000 + i, `u${i}`);
    expect(s.versions).toHaveLength(MAX_VERSIONS);
    expect(s.versions[0]!.n).toBe(4);
    expect(s.versions[MAX_VERSIONS - 1]!.n).toBe(MAX_VERSIONS + 3);
  });

  it("figures attach to the version they were computed for, and complete a re-save of the same content", () => {
    let s = saveVersion(fresh(), input(T1), 2000, "a1");
    expect(s.versions[0]!.stats).toBeUndefined();
    s = saveVersion(s, input(T1, undefined, stats()), 3000, "a2");
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0]!.stats).toMatchObject({ n: 40, avgR: 0.2 });
    const other = attachStats(s, 1, stats({ n: 10 }));
    expect(other.versions[0]!.stats!.n).toBe(10);
  });

  it("notes, live links and draft edits", () => {
    let s = saveVersion(fresh(), input(T1), 2000, "a1");
    s = setVersionNote(s, 1, "Ausgangsbasis");
    expect(s.versions[0]!.note).toBe("Ausgangsbasis");
    s = addLive(s, { accountId: "f_1", versionNo: 1, at: 9 });
    s = addLive(s, { accountId: "f_1", versionNo: 1, at: 10 });
    expect(s.live).toEqual([{ accountId: "f_1", versionNo: 1, at: 10 }]);
    expect(updateDraft(s, { text: s.text }, 3000)).toBe(s);
    const edited = updateDraft(s, { text: T2, name: "  Neu  ", symbol: "ETHUSDT", period: "6m" }, 3000);
    expect(edited).toMatchObject({ text: T2, name: "Neu", symbol: "ETHUSDT", period: "6m", updatedAt: 3000 });
    expect(updateDraft(s, { symbol: "nicht gültig" }, 3000)).toBe(s);
  });

  it("describes the change between two versions in plain language", () => {
    const s = saveVersion(saveVersion(fresh(), input(T1), 2000, "a1"), input(T2), 3000, "a2");
    expect(diffVersions(s.versions[0]!, s.versions[1]!)).toEqual(["Long · RSI Niveau: 30 → 25"]);
    const textOnly = saveVersion(s, input(`${T2} (Notiz)`), 4000, "a3");
    // an extra word that is unclear changes the text, not the rules: it is still a new version, and the diff says so
    expect(textOnly.versions).toHaveLength(3);
    expect(diffVersions(textOnly.versions[1]!, textOnly.versions[2]!)).toEqual(["Nur der Text ist anders – die Regeln sind gleich."]);
  });

  it("limits the number of strategies", () => {
    expect(addError([])).toBeNull();
    expect(addError(Array.from({ length: MAX_STRATEGIES }, (_, i) => fresh(`s_${i}`)))).toMatch(/Mehr als 30/);
  });
});

describe("settings.studio as a passthrough key", () => {
  it("reads nothing as nothing", () => {
    expect(studioCfgOf(undefined).strategies).toEqual([]);
    expect(studioCfgOf("x").strategies).toEqual([]);
    expect(studioOfSettings(null).strategies).toEqual([]);
  });

  it("round-trips several strategies with their versions", () => {
    let a = saveVersion(fresh("s_a", "A"), input(T1), 2000, "a1");
    a = saveVersion(a, input(T2), 3000, "a2");
    const b = saveVersion(fresh("s_b", "B"), input(T1), 2500, "b1");
    const stored = withStrategies(undefined, [a, b]);
    const back = studioCfgOf(JSON.parse(JSON.stringify(stored)));
    expect(back.strategies.map((s) => [s.id, s.name, s.versions.map((v) => v.n)])).toEqual([["s_a", "A", [1, 2]], ["s_b", "B", [1]]]);
    expect(back.strategies[0]!.versions[1]!.config.long.children).toHaveLength(1);
    expect(withStrategies(stored, back.strategies)).toBe(stored);
  });

  it("keeps unknown keys of the root, of a strategy, and entries it cannot read", () => {
    const a = saveVersion(fresh("s_a", "A"), input(T1), 2000, "a1");
    const raw = { ...(withStrategies(undefined, [a]) as Record<string, unknown>), futureRoot: { x: 1 } };
    (raw.strategies as Record<string, unknown>[])[0]!.futureField = [1, 2];
    (raw.strategies as unknown[]).push({ id: "s_new", somethingNew: true }, "garbage", { id: "s_bad", text: "x", versions: [{ n: 1, text: "x", config: { version: 99 } }] });
    const cfg = studioCfgOf(raw);
    expect(cfg.strategies).toHaveLength(1);
    expect(cfg.rejected).toHaveLength(3);
    const edited = updateDraft(cfg.strategies[0]!, { name: "A2" }, 5000);
    const written = withStrategies(raw, [edited]) as { futureRoot: unknown; strategies: Record<string, unknown>[] };
    expect(written.futureRoot).toEqual({ x: 1 });
    expect(written.strategies[0]!.futureField).toEqual([1, 2]);
    expect(written.strategies[0]!.name).toBe("A2");
    expect(written.strategies.slice(1)).toEqual((raw.strategies as unknown[]).slice(1));
  });

  it("survives normalizeSettings (the key is a plain passthrough)", () => {
    const a = saveVersion(fresh("s_a", "A"), input(T1), 2000, "a1");
    const settings = normalizeSettings({ studio: withStrategies(undefined, [a]) });
    expect(studioOfSettings(settings).strategies[0]!.name).toBe("A");
  });

  it("clamps what could do harm: text length, names, answer maps, unknown periods", () => {
    const raw = { v: 1, strategies: [{ id: "s_x", name: "x".repeat(200), text: "y".repeat(9999), answers: { a: "b", __proto__: "z", n: 5 }, symbol: "drop table", period: "9y" }] };
    const s = studioCfgOf(raw).strategies[0]!;
    expect(s.name).toHaveLength(60);
    expect(s.text.length).toBeLessThanOrEqual(4000);
    expect(s.answers).toEqual({ a: "b" });
    expect(s.symbol).toBe("BTCUSDT");
    expect(s.period).toBe("1y");
  });

  it("merges two devices per strategy and per version without mixing versions up", () => {
    const base = withStrategies(undefined, [saveVersion(fresh("s_a", "A"), input(T1), 2000, "base")]);
    const cfg = studioCfgOf(base).strategies;
    // device 1 adds a new strategy; device 2 saves a version "2" of A (its own id)
    const mine = withStrategies(base, [...cfg, saveVersion(fresh("s_b", "B"), input(T2), 2100, "m1")]);
    const theirs = withStrategies(base, [saveVersion(cfg[0]!, input(T2), 2200, "t1")]);
    const merged = studioCfgOf(merge3(base, mine, theirs));
    expect(merged.strategies.map((s) => s.id).sort()).toEqual(["s_a", "s_b"]);
    expect(merged.strategies.find((s) => s.id === "s_a")!.versions.map((v) => v.n)).toEqual([1, 2]);
    // both devices saved a different "version 2" of the same strategy: both survive, renumbered 2 and 3
    const both = studioCfgOf(
      merge3(
        base,
        withStrategies(base, [saveVersion(cfg[0]!, input("Long wenn RSI unter 20, Ziel 2R"), 2300, "dev1")]),
        withStrategies(base, [saveVersion(cfg[0]!, input("Long wenn RSI unter 40, Ziel 2R"), 2400, "dev2")]),
      ),
    );
    const vs = both.strategies[0]!.versions;
    expect(vs.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(vs.map((v) => v.text)).toEqual([T1, "Long wenn RSI unter 20, Ziel 2R", "Long wenn RSI unter 40, Ziel 2R"]);
    expect(new Set(vs.map((v) => v.id)).size).toBe(3);
  });
});
