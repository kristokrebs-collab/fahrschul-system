/**
 * Signalprotokoll (F25/F28/F31): the additive fields of an archive event (conditions, rule version, the trader's own log), the
 * conditions built from the three sources (a stored Einstiegs-Check snapshot, the graded reasons of a Box setup, the rule of a key
 * level), the fingerprint and the registry that numbers rule versions, the history of one signal as dated lines, the balance by
 * rule version – and the rule reference stored on a trade's snapshot. Numbers and sentences worked out by hand.
 */
import { describe, expect, it } from "vitest";
import {
  appendSignalEvent,
  boxPrereq,
  buildBalance,
  entryPrereq,
  fingerprint,
  keyPrereq,
  lifecycleKey,
  linkSignalTrade,
  markSignalSeen,
  MISSED_WINDOW_MS,
  parseRuleVersions,
  parseSignalArchive,
  registerRule,
  ruleLabel,
  RULE_VERSIONS_VERSION,
  setSignalSkip,
  setSignalWatch,
  signalHistory,
  LOG_MAX,
  type RuleRef,
  type SignalOutcome,
} from "@/domain/missed";
import { parseSignalSnapshot, toSignalSnapshot, type SignalSnapshot } from "@/domain/signals";
import { at, ct, enrichC } from "./coach.fixtures";
import { H, signalEvent, signalInput } from "./missed.fixtures";

const T = new Date(at(0, 600)).getTime(); // Mon 10:00
const NOW = T + 2 * 86_400_000;

/** A stored Einstiegs-Check snapshot for a long: 3 rungs, two confirm, RSI near, zone not discount, one part, the knife filter. */
const SNAP: SignalSnapshot = {
  at: new Date(T).toISOString(),
  side: "long",
  score: 80,
  strength: 2,
  tiers: 2,
  label: "Starker Long-Einstieg",
  valid: true,
  rsiOk: true,
  zoneOk: false,
  zone: "equilibrium",
  tfs: [
    { tf: "30m", kind: "buy", wt: -45, rsi: 33, ok: true },
    { tf: "1h", kind: "bottom", wt: -50, rsi: 36, ok: true },
    { tf: "4h", kind: null, wt: -10, rsi: 48, ok: false },
  ],
  v: 2,
  ladder: ["30m", "1h", "4h"],
  required: 2,
  zoneTf: "4h",
  state: "confirmed",
  parts: [
    { id: "traders", grade: 1, points: 10, weight: 10, ok: true, data: true, state: "confirmed", items: [] },
    { id: "div", grade: 0, points: 0, weight: 8, ok: false, data: true, state: "none", items: [] },
    { id: "sr", grade: 0, points: 0, weight: 8, ok: false, data: false, state: "none", items: [] },
  ],
  knife: { n: 1, items: [{ id: "structure", met: true }, { id: "whale", met: null }, { id: "lage", met: false }] },
  lage: { state: "amber", signs: [], ema21_1d: 80000, dist: 0.01, counts: false, on: true, mode: "block" } as never,
};

describe("conditions of an Einstiegs-Check signal", () => {
  it("lists rungs, the ladder rule, RSI, zone, candle close, the parts, the filter and the Lage gate – each with its own state", () => {
    const p = entryPrereq(SNAP);
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by["tf:30m"]).toMatchObject({ label: "30m: Long-Signal (WaveTrend) bestätigt die Treppe", met: true });
    expect(by["tf:4h"]!.met).toBe(false);
    expect(by["tiers"]).toMatchObject({ label: "Mindestens 2 Zeiteinheiten in Folge (2 von 3)", met: true });
    expect(by["rsi"]).toMatchObject({ label: "RSI nahe am überverkauften Bereich", met: true });
    expect(by["zone"]).toMatchObject({ label: "Preis im Discount (4h)", met: false });
    expect(by["closed"]!.met).toBe(true);
    expect(by["part:traders"]).toMatchObject({ label: "Top-Trader-Kombi erfüllt", met: true });
    expect(by["part:div"]!.met).toBe(false);
    expect(by["part:sr"]!.met).toBeNull(); // no data for the part: neither fulfilled nor failed
    expect(by["knife:structure"]).toMatchObject({ label: "Filter gegen fallendes Messer: Erstes Higher Low oder BOS auf 1H/4H", met: true });
    expect(by["knife:whale"]!.met).toBeNull();
    expect(by["lage"]).toMatchObject({ label: "Lage-Ampel lässt den Einstieg zu", met: false });
  });

  it("a short mirrors the words; a forming candle is 'nicht erfüllt'; the Lage gate switched off is not listed; the legacy whale condition stands in for the part", () => {
    const short: SignalSnapshot = { ...SNAP, side: "short", state: "provisional", parts: undefined, lage: { ...SNAP.lage!, on: false }, whale: { ok: true, run: 3, need: 3, period: "1h", topChg: 1, retailChg: -1, points: 5, periods: [] } };
    const p = entryPrereq(short);
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by["rsi"]!.label).toBe("RSI nahe am überkauften Bereich");
    expect(by["zone"]!.label).toBe("Preis im Premium (4h)");
    expect(by["closed"]!.met).toBe(false);
    expect(by["whale"]).toMatchObject({ label: "Top-Trader verkaufen · Retail grün", met: true });
    expect(by["lage"]).toBeUndefined();
  });

  it("stays within 24 lines", () => {
    const many = { ...SNAP, ladder: Array.from({ length: 30 }, (_, i) => `${i + 1}m`), tfs: [] };
    expect(entryPrereq(many)).toHaveLength(24);
  });
});

describe("conditions of a Box setup and of a key level", () => {
  it("a Box setup: its graded reasons, as they were", () => {
    expect(boxPrereq([{ text: "Preis an der Unterkante der Box", ok: true }, { text: "RSI-Linie gebrochen", ok: false }])).toEqual([
      { id: "r0", label: "Preis an der Unterkante der Box", met: true },
      { id: "r1", label: "RSI-Linie gebrochen", met: false },
    ]);
  });

  const level = { kind: "closes", direction: "above", closes: 2, distance: { mode: "pct", value: 0.5 }, tf: "4h", invalidation: 78000 } as const;
  it("a key level: the rule in words, the close, the invalidation that was not hit", () => {
    const p = keyPrereq(level, "confirm", { basis: "close", retest: "none", broke: true });
    expect(p.map((x) => x.label)).toEqual(["2 4h-Schlüsse in Folge über der Marke", "Auf dem Kerzenschluss bestätigt (nicht nur im Lauf)", "Ungültigkeitsmarke 78.000 nicht verletzt"]);
    expect(p.every((x) => x.met === true)).toBe(true);
  });

  it("a retest rule: the break and the retest are two conditions; at the confirmation the retest is still open", () => {
    const rule = { ...level, kind: "retest", direction: "below", invalidation: null } as const;
    expect(keyPrereq(rule, "confirm", { basis: "close", retest: "none", broke: true }).slice(0, 2)).toEqual([
      { id: "break", label: "Bruch per Schluss unter der Marke", met: true },
      { id: "retest", label: "Retest der Marke bis auf 0,5 %, danach hält sie", met: false },
    ]);
    expect(keyPrereq(rule, "retest", { basis: "close", retest: "done", broke: true })[1]!.met).toBe(true);
  });

  it("a running break is not a close: the basis line says 'nicht erfüllt'", () => {
    const p = keyPrereq({ ...level, kind: "running", invalidation: null }, "confirm", { basis: "intrabar", retest: "none", broke: false });
    expect(p[0]!.label).toBe("Laufender Bruch über der Marke (die Kerze ist noch offen)");
    expect(p.find((x) => x.id === "basis")!.met).toBe(false);
  });
});

describe("the fingerprint and the registry of rule versions", () => {
  it("FNV-1a: stable, 8 hex digits, a different string gives a different one", () => {
    expect(fingerprint("")).toBe("811c9dc5");
    expect(fingerprint("a")).toBe("e40c292c");
    expect(fingerprint("foobar")).toBe("bf9cf968");
    expect(fingerprint("BTC|1")).not.toBe(fingerprint("BTC|2"));
    expect(fingerprint("x")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("the first sight of a fingerprint gets the next number, the same one again keeps its number, a return to an old one reuses it", () => {
    let items = [] as ReturnType<typeof registerRule>["items"];
    const a = registerRule(items, "entry", "", "aaaaaaaa", 1000);
    expect(a.ref).toEqual({ kind: "entry", hash: "aaaaaaaa", n: 1, since: 1000 });
    expect(a.added).toBe(true);
    items = a.items;
    const again = registerRule(items, "entry", "", "aaaaaaaa", 5000);
    expect(again.ref).toEqual({ kind: "entry", hash: "aaaaaaaa", n: 1, since: 1000 });
    expect(again.added).toBe(false);
    const b = registerRule(items, "entry", "", "bbbbbbbb", 2000);
    expect(b.ref.n).toBe(2);
    items = b.items;
    expect(registerRule(items, "entry", "", "aaaaaaaa", 3000).ref).toMatchObject({ n: 1, since: 1000 }); // back to the first settings
    // other kinds and other levels count on their own
    expect(registerRule(items, "box", "", "aaaaaaaa", 4000).ref.n).toBe(1);
    expect(registerRule(items, "key", "L1", "cccccccc", 4000).ref.n).toBe(1);
    expect(registerRule(registerRule(items, "key", "L1", "cccccccc", 4000).items, "key", "L2", "dddddddd", 4100).ref.n).toBe(1);
  });

  it("the registry keeps 30 per scope; a stored one is read leniently", () => {
    let items = [] as ReturnType<typeof registerRule>["items"];
    for (let i = 0; i < 35; i++) items = registerRule(items, "entry", "", i.toString(16).padStart(8, "0"), 1000 + i).items;
    expect(items.filter((r) => r.kind === "entry")).toHaveLength(30);
    expect(items.find((r) => r.n === 1)).toBeUndefined(); // the oldest went
    expect(parseRuleVersions({ v: 2, items })).toEqual([]);
    expect(parseRuleVersions({ v: RULE_VERSIONS_VERSION, items: [{ kind: "entry", scope: "", hash: "abcdef01", n: 2, since: 5 }, { kind: "x", scope: "", hash: "abcdef01", n: 1, since: 1 }, { kind: "box", scope: "", hash: "zzz", n: 1, since: 1 }, null] })).toEqual([{ kind: "entry", scope: "", hash: "abcdef01", n: 2, since: 5 }]);
  });

  it("the label says the number and the fingerprint, or the fingerprint alone", () => {
    expect(ruleLabel({ kind: "entry", hash: "abcdef01", n: 3, since: 1 })).toBe("Einstiegs-Check · Regelstand 3 (abcdef01)");
    expect(ruleLabel({ kind: "key", hash: "abcdef01", n: null, since: null })).toBe("Schlüsselmarke · Regelstand abcdef01");
  });
});

describe("the archive event keeps the new fields and logs the trader's own changes", () => {
  const rules: RuleRef = { kind: "entry", hash: "abcdef01", n: 2, since: T };
  it("stores conditions and the rule reference, reads a record without them as empty, and drops junk", () => {
    const items = appendSignalEvent([], signalInput({ key: "a", prereq: [{ id: "x", label: "RSI nahe", met: true }, { id: "y", label: "", met: false }], rules }), "id1", T);
    expect(items[0]!.prereq).toEqual([{ id: "x", label: "RSI nahe", met: true }]);
    expect(items[0]!.rules).toEqual(rules);
    expect(items[0]!.log).toEqual([]);
    const stored = parseSignalArchive({ v: 1, items: [{ ...items[0], prereq: undefined, rules: { kind: "entry", hash: "XYZ" }, log: [{ at: 1, what: "seen" }, { at: "x", what: "seen" }, { at: 2, what: "dance" }] }] }, T);
    expect(stored.items[0]).toMatchObject({ prereq: [], rules: null, log: [{ at: 1, what: "seen", note: null }] });
  });

  it("seen, skip, unskip, watch, link and unlink are logged with their time; a repeated look is not", () => {
    let items = appendSignalEvent([], signalInput({ key: "a" }), "id1", T);
    items = markSignalSeen(items, "id1", T + 1000);
    items = markSignalSeen(items, "id1", T + 2000);
    items = setSignalSkip(items, "id1", "doubt", T + 3000);
    items = setSignalSkip(items, "id1", null, T + 4000);
    items = setSignalWatch(items, "id1", true, T + 5000);
    items = linkSignalTrade(items, "id1", "t9", T + 6000);
    items = linkSignalTrade(items, "id1", null, T + 7000);
    expect(items[0]!.log).toEqual([
      { at: T + 1000, what: "seen", note: null },
      { at: T + 3000, what: "skip", note: "doubt" },
      { at: T + 4000, what: "unskip", note: null },
      { at: T + 5000, what: "watch", note: null },
      { at: T + 6000, what: "link", note: "t9" },
      { at: T + 7000, what: "unlink", note: "t9" },
    ]);
  });

  it("keeps the newest 20 entries", () => {
    let items = appendSignalEvent([], signalInput({ key: "a" }), "id1", T);
    for (let i = 0; i < 30; i++) items = setSignalWatch(items, "id1", i % 2 === 0, T + i);
    expect(items[0]!.log).toHaveLength(LOG_MAX);
    expect(items[0]!.log.at(-1)!.at).toBe(T + 29);
  });
});

describe("the history of one signal", () => {
  const trades = enrichC([ct(at(0, 605), { id: "t1", p: 100, side: "long", pair: "BTC/USDT" })]);
  const outcome = (over: Partial<SignalOutcome> = {}): SignalOutcome => ({ kind: "target", basis: "own", sameBar: false, entry: 100, stop: 99, target: 102, rr: 2, r: 2, hitAt: T + 3 * H, bars: 10, coveredUntil: T + 4 * H, horizon: false, reason: null, ...over });

  it("lifecycle id: a key level by its id, a Box by the box id of its phase and setup alerts, the Einstiegs-Check and the scanner by none", () => {
    expect(lifecycleKey({ source: "key", ref: "L1", symbol: "BTCUSDT" })).toBe("key|L1");
    expect(lifecycleKey({ source: "box", ref: "p:BTCUSDT:box7:breakout", symbol: "BTCUSDT" })).toBe("box|BTCUSDT|box7");
    expect(lifecycleKey({ source: "box", ref: "s:BTCUSDT:box7:A+", symbol: "BTCUSDT" })).toBe("box|BTCUSDT|box7");
    expect(lifecycleKey({ source: "box", ref: "x:abc", symbol: "BTCUSDT" })).toBeNull();
    expect(lifecycleKey({ source: "entry", ref: null, symbol: "BTCUSDT" })).toBeNull();
  });

  it("raised → the same box's other events → your marks → the trade → the window → the outcome, oldest first, with the right source times", () => {
    const setup = signalEvent({ key: "s", source: "box", kind: "setup", ref: "s:BTCUSDT:box7:A+", at: T, label: "A+-Setup", log: [{ at: T + 1000, what: "seen", note: null }, { at: T + 2000, what: "skip", note: "context" }] });
    const breakout = signalEvent({ key: "p", source: "box", kind: "breakout", entry: false, ref: "p:BTCUSDT:box7:breakout", at: T + 2 * H, label: "Ausbruch ↑" });
    const other = signalEvent({ key: "o", source: "box", kind: "setup", ref: "s:BTCUSDT:box9:A", at: T + H });
    const lines = signalHistory(setup, [setup, breakout, other], trades, outcome(), MISSED_WINDOW_MS);
    expect(lines.map((l) => [l.at - T, l.kind, l.sibling, l.derived])).toEqual([
      [0, "raised", false, false],
      [1000, "seen", false, false],
      [2000, "skip", false, false],
      [5 * 60_000, "trade", false, true],
      [2 * H, "stage", true, false],
      [3 * H, "outcome", false, true],
      [MISSED_WINDOW_MS, "window", false, true],
    ]);
    expect(lines[0]!.text).toBe("Ausgelöst: A+-Setup");
    expect(lines[2]!.text).toBe("Bewusst ausgelassen – Marktlage passt nicht");
    expect(lines[3]!.text).toBe("Trade im Journal: BTC/USDT Long");
    expect(lines[4]!.text).toBe("Box · Ausbruch: Ausbruch ↑");
    expect(lines[5]!.text).toBe("Ausgang laut Kerzen: Ziel zuerst · +2,0 R · Marken des Signals");
  });

  it("a context event (no entry) has no trade, window or outcome lines; an open or unusable outcome adds none", () => {
    const ctx = signalEvent({ key: "c", entry: false, kind: "breakout", source: "box", ref: "p:BTCUSDT:b:breakout" });
    expect(signalHistory(ctx, [ctx], trades, outcome(), MISSED_WINDOW_MS).map((l) => l.kind)).toEqual(["raised"]);
    const e = signalEvent({ key: "e", at: T + 20 * H });
    expect(signalHistory(e, [e], [], outcome({ kind: "open", hitAt: null, r: null }), MISSED_WINDOW_MS).map((l) => l.kind)).toEqual(["raised", "window"]);
  });

  it("a key level shows its other stages", () => {
    const confirm = signalEvent({ key: "k1", source: "key", kind: "confirm", ref: "L1", at: T, label: "Bestätigt · L1" });
    const retest = signalEvent({ key: "k2", source: "key", kind: "retest", ref: "L1", at: T + 3 * H, label: "Retest · L1" });
    const lines = signalHistory(confirm, [confirm, retest], [], undefined, MISSED_WINDOW_MS);
    expect(lines.filter((l) => l.sibling).map((l) => l.text)).toEqual(["Schlüsselmarke · Retest: Retest · L1"]);
  });
});

describe("the balance by rule version", () => {
  it("groups the signals of the same settings, names the version, and keeps the ones recorded before versions together", () => {
    const r1: RuleRef = { kind: "entry", hash: "aaaaaaaa", n: 1, since: T };
    const r2: RuleRef = { kind: "entry", hash: "bbbbbbbb", n: 2, since: T + H };
    const events = [signalEvent({ key: "a", rules: r1, at: NOW - 5 * H }), signalEvent({ key: "b", rules: r1, at: NOW - 4 * H }), signalEvent({ key: "c", rules: r2, at: NOW - 3 * H }), signalEvent({ key: "d", at: NOW - 2 * H })];
    const bal = buildBalance(events, [], new Map(), NOW, "rules");
    const by = Object.fromEntries(bal.rows.map((r) => [r.label, r.n]));
    expect(by).toEqual({ "Einstiegs-Check · Regelstand 1 (aaaaaaaa)": 2, "Einstiegs-Check · Regelstand 2 (bbbbbbbb)": 1, "Ohne Regelstand (vor der Aufzeichnung der Versionen)": 1 });
  });
});

describe("the rule reference on a trade's snapshot", () => {
  it("is stored by toSignalSnapshot, read back by parseSignalSnapshot, and a malformed one is dropped", () => {
    const rules: RuleRef = { kind: "entry", hash: "abcdef01", n: 4, since: T };
    const sig = { long: { score: 80, strength: 2, tiers: 2, label: "L", valid: true, rsiOk: true, zoneOk: false }, short: { score: 0, strength: 0, tiers: 0, label: "", valid: false, rsiOk: false, zoneOk: false }, checks: [], zone: null, at: T } as never;
    const snap = toSignalSnapshot(sig, "long", { ladder: ["30m"], required: 1, zoneTf: "4h" } as never, { mode: "live", rules });
    expect(snap.rules).toEqual(rules);
    expect(parseSignalSnapshot(JSON.parse(JSON.stringify(snap)))!.rules).toEqual(rules);
    expect(parseSignalSnapshot({ ...snap, rules: { kind: "box", hash: "abcdef01" } })!.rules).toBeUndefined();
    expect(parseSignalSnapshot({ ...snap, rules: { kind: "entry", hash: "XYZ" } })!.rules).toBeUndefined();
    expect(toSignalSnapshot(sig, "long", { ladder: ["30m"], required: 1, zoneTf: "4h" } as never, { mode: "live" }).rules).toBeUndefined();
  });
});
