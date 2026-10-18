/**
 * F29 / F30 from the model's text readings to a trade draft: candidates (comma formats, short trades, partial fills,
 * planned orders), merging of screenshots, plausibility, result comparison, duplicate check, rows / edits, draft.
 */
import { describe, expect, it } from "vitest";
import type { ScreenshotRef, Trade } from "@/domain/types";
import { buildCandidates, fillsOf, normalizePair, pairKey, resolveZone, type BuildContext, type Candidate } from "@/journal/extract/candidate";
import { checksOf, comparePnl, resolvedPnlMode } from "@/journal/extract/checks";
import { CONFIDENCE_KEYS, Extraction, type ExtractedTrade } from "@/journal/extract/contract";
import { findDuplicate } from "@/journal/extract/dedupe";
import { IMPORT_TAG, shotsFor, toDraft } from "@/journal/extract/draft";
import { mergeCandidates, sameTrade } from "@/journal/extract/merge";
import { attentionRows, editField, rowsOf, setSide } from "@/journal/extract/rows";
import { parseZone } from "@/journal/extract/time";

const NOW = new Date("2026-10-18T12:00:00Z");
const LOCAL = "Europe/Berlin";
const ctx = (zone = resolveZone(null, null, LOCAL)) => ({ now: NOW, zone, localZone: LOCAL });
const conf = (v: number) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v])) as ExtractedTrade["confidence"];

/** An extracted trade with defaults (what the schema fills in). */
function ext(over: Partial<ExtractedTrade> = {}): ExtractedTrade {
  return Extraction.parse({
    trades: [{ status: "closed", confidence: conf(0.95), ...over }],
    timezone: null,
  }).trades[0]!;
}
/** `extra`: build context overrides; by default a German device (`fallbackStyle: "comma"`) settles unprovable "67.000". */
function one(over: Partial<ExtractedTrade> = {}, zone?: ReturnType<typeof resolveZone>, extra: Partial<BuildContext> = {}): Candidate {
  return buildCandidates({ trades: [ext(over)], timezone: null, notes: [] }, { ...ctx(zone), fallbackStyle: "comma", ...extra })[0]!;
}

const LONG_GERMAN: Partial<ExtractedTrade> = {
  market: "BTCUSDT",
  side: "long",
  entries: [{ price: "67.250,5", qty: "0,05", time: "17.10.2026 14:32:08" }],
  exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 15:10:44" }],
  leverage: "10x",
  fees: "-1,35",
  realizedPnl: "+27,48",
  exchange: "Bitunix",
  productType: "perp",
};
const checkCtx = (trades: Trade[] = []) => ({ trades, now: NOW, currency: "USDT" });
const codes = (c: Candidate, trades: Trade[] = []) => checksOf(c, checkCtx(trades)).map((k) => k.code);

function stored(over: Partial<Trade> = {}): Trade {
  return { id: "t1", side: "long", status: "closed", date: "2026-10-17T14:35", pair: "BTC/USDT", timeframe: "1h", entry: 67250, stop: null, target: null, exit: 67800, size: null, leverage: null, fees: null, pnlManual: null, setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "", ...over };
}

describe("pairs", () => {
  it.each([
    ["BTCUSDT", "BTC/USDT"],
    ["BTC/USDT", "BTC/USDT"],
    ["BTC-USDT-SWAP", "BTC/USDT"],
    ["ETHUSDT.P", "ETH/USDT"],
    ["SOL/USDT:USDT", "SOL/USDT"],
    ["ethusdt perpetual", "ETH/USDT"],
    ["DOGEUSDC", "DOGE/USDC"],
    ["EURUSD", "EUR/USD"],
    ["XAU", "XAU"],
  ])("%s → %s", (raw, out) => expect(normalizePair(raw)).toBe(out));
  it("compares by key", () => {
    expect(pairKey("BTC/USDT")).toBe(pairKey("btcusdt perp"));
    expect(pairKey(null)).toBe("");
  });
});

describe("candidate from a German long close", () => {
  const c = one(LONG_GERMAN);
  it("reads every field with its state", () => {
    expect(c.pair).toMatchObject({ value: "BTC/USDT", state: "ok" });
    expect(c.side).toMatchObject({ value: "long", state: "ok" });
    expect(c.kind.value).toBe("perp");
    expect(c.exchange.value).toBe("Bitunix");
    expect(c.entries[0]).toMatchObject({ price: 67250.5, qty: 0.05, at: "2026-10-17T14:32:08" });
    expect(c.exits[0]).toMatchObject({ price: 67800, qty: 0.05, at: "2026-10-17T15:10:44" });
    expect(c.leverage.value).toBe(10);
    expect(c.fees.value).toBe(1.35); // a cost, whatever the sign shown
    expect(c.pnl.value).toBe(27.48);
    expect(c.stop.state).toBe("missing");
  });
  it("the result matches the prices (gross, before fees) – no warning, computed result", () => {
    const cmp = comparePnl(c);
    expect(cmp.match).toBe("gross");
    expect(codes(c)).toContain("pnl_ok");
    expect(codes(c)).not.toContain("pnl_mismatch");
    expect(resolvedPnlMode(c)).toBe("calc");
    expect(toDraft(c, []).pnlManual).toBeUndefined();
  });
  it("draft: plain entry / exit / size, times, tag – and no stop", () => {
    const shots: ScreenshotRef[] = [{ id: "s1", store: "idb", key: "k1" }];
    const d = toDraft(c, shots);
    expect(d).toMatchObject({ pair: "BTC/USDT", side: "long", status: "closed", entry: 67250.5, exit: 67800, qty: 0.05, leverage: 10, fees: 1.35, market: "perp", exchange: "Bitunix", date: "2026-10-17T14:32", exitDate: "2026-10-17T15:10:44", tags: [IMPORT_TAG], screenshots: shots });
    expect(d.size).toBeCloseTo(3362.525, 6);
    expect(d.stop).toBeUndefined();
    expect(d.fills).toBeUndefined();
    expect(d.notes).toBeUndefined();
  });
});

describe("comma / point", () => {
  it("one screenshot, English style", () => {
    const c = one({ ...LONG_GERMAN, entries: [{ price: "67,250.5", qty: "0.05", time: null }], exits: [{ price: "67,800", qty: "0.05", time: null }], fees: "-1.35", realizedPnl: "+27.48" });
    expect(c.entries[0]).toMatchObject({ price: 67250.5, qty: 0.05 });
    expect(c.exits[0]).toMatchObject({ price: 67800, uncertain: false }); // "67,800" settled by the point style of its neighbours
  });
  it("an ambiguous group is settled by the screenshot's own style, else flagged", () => {
    const settled = one({ ...LONG_GERMAN, entries: [{ price: "67.250,5", qty: "1.234", time: null }], exits: [] });
    expect(settled.entries[0]).toMatchObject({ qty: 1234, uncertain: false });
    const open = one({ market: "XRPUSDT", side: "long", status: "open", entries: [{ price: "1.234", qty: null, time: null }] }, undefined, { style: null, fallbackStyle: undefined });
    expect(open.entries[0]).toMatchObject({ price: 1.234, uncertain: true });
    expect(open.entries[0]!.notes[0]).toMatch(/Zahlenformat unklar/);
    // a German device reads the same text as 1234 – still flagged, with the other reading in the note
    const german = one({ market: "XRPUSDT", side: "long", status: "open", entries: [{ price: "1.234", qty: null, time: null }] }, undefined, { style: null });
    expect(german.entries[0]).toMatchObject({ price: 1234, uncertain: true });
    const stop = one({ ...LONG_GERMAN, stop: "66.800" }, undefined, { style: null }).stop;
    expect(stop).toMatchObject({ value: 66800, state: "uncertain" });
    expect(stop.note).toMatch(/könnte auch 66,8 heißen/);
    expect(rowsOf(open, "USDT").find((r) => r.key === "entry")).toMatchObject({ state: "uncertain" });
  });
  it("an unreadable price is dropped and said so", () => {
    const c = one({ ...LONG_GERMAN, entries: [{ price: "??", qty: null, time: null }, { price: "67.000", qty: null, time: null }] });
    expect(c.entries).toHaveLength(1);
    expect(c.notes.join(" ")).toMatch(/nicht lesbar/);
  });
});

describe("time zones", () => {
  it("a zone named in the picture is converted into the journal's", () => {
    const c = one({ ...LONG_GERMAN, entries: [{ price: "67.250", qty: "0,05", time: "2026-10-17 14:32:08" }], exits: [] }, resolveZone("UTC+8", null, LOCAL));
    expect(c.entries[0]!.at).toBe("2026-10-17T08:32:08");
  });
  it("the trader's choice wins over the picture; with neither, the journal's zone is assumed – and said", () => {
    const user = resolveZone("UTC+8", parseZone("UTC")!, LOCAL);
    expect(user.source).toBe("user");
    expect(one({ entries: [{ price: "1", qty: null, time: "2026-10-17 12:00" }] }, user).entries[0]!.at).toBe("2026-10-17T14:00");
    const assumed = resolveZone(null, null, LOCAL);
    expect(assumed.source).toBe("journal");
    expect(assumed.text).toMatch(/angenommen/);
    expect(one({ entries: [{ price: "1", qty: null, time: "2026-10-17 12:00" }] }, assumed).entries[0]!.at).toBe("2026-10-17T12:00");
  });
  it("a year that was not shown is assumed and flagged; a time of day borrows the other fill's date", () => {
    const c = one({
      ...LONG_GERMAN,
      entries: [{ price: "67.250", qty: "0,05", time: "10-17 14:32:08" }],
      exits: [{ price: "67.800", qty: "0,05", time: "15:10:44" }],
    });
    expect(c.entries[0]).toMatchObject({ at: "2026-10-17T14:32:08", uncertain: true });
    expect(c.entries[0]!.notes.join()).toMatch(/Jahr/);
    expect(c.exits[0]!.at).toBe("2026-10-17T15:10:44");
    expect(rowsOf(c, "USDT").find((r) => r.key === "date")!.state).toBe("uncertain");
  });
  it("time order and the future are flagged", () => {
    const back = one({ ...LONG_GERMAN, exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 13:00" }] });
    expect(codes(back)).toContain("time_order");
    const future = one({ ...LONG_GERMAN, entries: [{ price: "67.250", qty: "0,05", time: "20.10.2026 13:00" }], exits: [] });
    expect(codes(future)).toContain("time_future");
  });
});

describe("short trades", () => {
  const short: Partial<ExtractedTrade> = { market: "ETH/USDT Perp", side: "short", entries: [{ price: "3.450,20", qty: "2", time: "17.10.2026 09:00" }], exits: [{ price: "3.400,00", qty: "2", time: "17.10.2026 10:00" }], realizedPnl: "+100,40" };
  it("a short that went down is a win and matches", () => {
    const c = one(short);
    expect(comparePnl(c)).toMatchObject({ gross: expect.closeTo(100.4, 6), match: "net" });
    expect(codes(c)).toContain("pnl_ok");
  });
  it("stop above / targets below the entry are right for a short, wrong for a long", () => {
    const ok = one({ ...short, stop: "3.480", targets: ["3.400", "3.350"] });
    expect(codes(ok)).not.toContain("stop_side");
    expect(codes(ok)).not.toContain("target_side");
    const bad = one({ ...short, side: "long", stop: "3.480", targets: ["3.400"] });
    expect(codes(bad)).toEqual(expect.arrayContaining(["stop_side", "target_side"]));
  });
  it("long: stop below, targets above", () => {
    const c = one({ ...LONG_GERMAN, stop: "67.400", targets: ["67.100"] });
    expect(codes(c)).toEqual(expect.arrayContaining(["stop_side", "target_side"]));
    expect(codes(one({ ...LONG_GERMAN, stop: "66.900", targets: ["68.500", "69.000"] }))).not.toEqual(expect.arrayContaining(["stop_side", "target_side"]));
  });
  it("a wrong direction shows in the result: the screenshot disagrees with the prices and the flip fits", () => {
    const c = one({ ...short, side: "long" });
    const found = checksOf(c, checkCtx());
    expect(found.map((k) => k.code)).toEqual(expect.arrayContaining(["pnl_mismatch", "side_flip"]));
    expect(found.find((k) => k.code === "side_flip")!.fix).toMatchObject({ kind: "side", value: "short" });
    // until the trader decides, the exchange's own number is what goes into the trade
    expect(resolvedPnlMode(c)).toBe("shot");
    expect(toDraft(c, []).pnlManual).toBe(100.4);
    expect(toDraft(setSide(c, "short"), []).pnlManual).toBeUndefined();
  });
  it("an unreadable direction is offered from prices and result – never applied", () => {
    const c = one({ ...short, side: null });
    expect(c.side.state).toBe("missing");
    const hint = checksOf(c, checkCtx()).find((k) => k.code === "side_hint")!;
    expect(hint.fix).toMatchObject({ kind: "side", value: "short" });
    expect(c.side.value).toBeNull();
  });
});

describe("partial entries and exits", () => {
  const partial: Partial<ExtractedTrade> = {
    market: "BTCUSDT",
    side: "long",
    entries: [
      { price: "67.000", qty: "0,03", time: "17.10.2026 14:00" },
      { price: "67.500", qty: "0,02", time: "17.10.2026 14:20" },
    ],
    exits: [
      { price: "67.800", qty: "0,025", time: "17.10.2026 15:00" },
      { price: "68.000", qty: "0,025", time: "17.10.2026 15:30" },
    ],
    realizedPnl: "+35,00",
  };
  it("become fills with entry / add / partial / exit, Ø entry, summed quantity", () => {
    const c = one(partial);
    const fills = fillsOf(c)!;
    expect(fills.map((f) => f.kind)).toEqual(["entry", "add", "partial", "exit"]);
    const d = toDraft(c, []);
    expect(d.fills).toHaveLength(4);
    expect(d).toMatchObject({ entry: 67200, qty: 0.05, exit: 67900, date: "2026-10-17T14:00", exitDate: "2026-10-17T15:30" });
    expect(d.size).toBeCloseTo(3360, 6);
    expect(comparePnl(c)).toMatchObject({ match: "net", gross: expect.closeTo(35, 6) });
  });
  it("without a quantity there are no fills, only plain values", () => {
    const c = one({ ...partial, exits: [{ price: "67.800", qty: null, time: null }, { price: "68.000", qty: null, time: null }] });
    expect(fillsOf(c)).toBeNull();
    expect(toDraft(c, []).fills).toBeUndefined();
  });
  it("an untimed leg takes the earliest (entry) / latest (exit) known time, so the order holds", () => {
    const c = one({ ...partial, entries: [{ price: "67.000", qty: "0,05", time: null }], exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 15:00" }, { price: "67.900", qty: "0,05", time: "17.10.2026 15:10" }] });
    const f = fillsOf(c)!;
    expect(f[0]!.at).toBe("2026-10-17T15:00");
    expect(f.map((x) => x.side)).toEqual(["open", "close", "close"]);
  });
  it("closes larger than the opening are flagged (a fill read twice)", () => {
    const c = one({ ...partial, exits: [{ price: "67.800", qty: "0,05", time: null }, { price: "68.000", qty: "0,05", time: null }] });
    expect(codes(c)).toContain("qty_over");
  });
});

describe("planned orders", () => {
  const plan: Partial<ExtractedTrade> = { market: "BTCUSDT", side: "long", status: "planned", plannedEntry: "67.000", stop: "66.500", targets: ["68.000", "69.000"], leverage: "5x" };
  it("a planned order is an open draft with the plan, no fills, no exit, no result", () => {
    const c = one(plan);
    expect(c.entries).toHaveLength(0);
    const d = toDraft(c, []);
    expect(d).toMatchObject({ status: "open", entry: 67000, plannedEntry: 67000, stop: 66500, target: 68000, leverage: 5 });
    expect(d.targets).toEqual([{ price: 68000 }, { price: 69000 }]);
    expect(d.fills).toBeUndefined();
    expect(d.exit).toBeUndefined();
    expect(d.pnlManual).toBeUndefined();
    expect(d.date).toBeUndefined();
    expect(d.notes).toMatch(/Geplante Order/);
    expect(codes(c)).toContain("planned");
    expect(codes(c)).not.toContain("no_time");
  });
  it("rows of a plan leave out everything an execution has", () => {
    const keys = rowsOf(one(plan), "USDT").map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["pair", "side", "entry", "stop", "targets", "leverage"]));
    expect(keys).not.toEqual(expect.arrayContaining(["exit", "qty", "fees", "pnl"]));
  });
});

describe("the original stop is never invented", () => {
  it("a stop on an executed position goes into the notes, not into `stop`", () => {
    const c = one({ ...LONG_GERMAN, stop: "66.800" });
    expect(c.stopOriginal).toBe(false);
    const d = toDraft(c, []);
    expect(d.stop).toBeUndefined();
    expect(d.notes).toMatch(/Stop laut Screenshot: 66\.800 /);
    expect(d.notes).toMatch(/ursprünglicher Stop unbekannt/);
    expect(codes(c)).toContain("stop_not_original");
  });
  it("only when the trader says so does it become the stop", () => {
    const c = { ...one({ ...LONG_GERMAN, stop: "66.800" }), stopOriginal: true };
    expect(toDraft(c, []).stop).toBe(66800);
    expect(toDraft(c, []).notes).toBeUndefined();
  });
  it("a planned order's stop is the plan; merging it with its fill keeps that fact", () => {
    const planned = one({ market: "BTCUSDT", side: "long", status: "planned", plannedEntry: "67.250", stop: "66.500", targets: ["68.000"] });
    planned.sources = [0];
    const filled = one({ ...LONG_GERMAN, status: "open", exits: [], realizedPnl: null });
    filled.sources = [1];
    const [m] = mergeCandidates([planned, filled]);
    expect(m!.status).toBe("open");
    expect(m!.stopOriginal).toBe(true);
    expect(toDraft(m!, []).stop).toBe(66500);
  });
});

describe("result: screenshot against prices", () => {
  it("a difference is reported with both numbers and the screenshot's wins until the trader chooses", () => {
    const c = one({ ...LONG_GERMAN, realizedPnl: "+31,00", fees: null });
    const k = checksOf(c, checkCtx()).find((x) => x.code === "pnl_mismatch")!;
    expect(k.text).toMatch(/Screenshot zeigt \+31 USDT/);
    expect(k.text).toMatch(/ergibt sich \+27,48 USDT/);
    expect(k.fix).toMatchObject({ kind: "pnlMode", value: "calc" });
    expect(toDraft(c, []).pnlManual).toBe(31);
    expect(toDraft({ ...c, pnlMode: "calc" }, []).pnlManual).toBeUndefined();
  });
  it("net of fees and funding also counts as a match", () => {
    const c = one({ ...LONG_GERMAN, fees: "1,35", funding: "-0,10", realizedPnl: "+26,03" });
    expect(c.funding.value).toBe(0.1); // shown negative = paid
    expect(comparePnl(c).match).toBe("net");
  });
  it("funding: a sign shown means received / paid, none is a guess", () => {
    expect(one({ ...LONG_GERMAN, funding: "+0,10" }).funding.value).toBe(-0.1);
    const unsigned = one({ ...LONG_GERMAN, funding: "0,10" });
    expect(unsigned.funding).toMatchObject({ value: 0.1, state: "uncertain" });
  });
  it("without exit prices the screenshot's result is all there is", () => {
    const c = one({ market: "BTCUSDT", side: "long", entries: [{ price: "67.000", qty: "0,1", time: null }], realizedPnl: "+50" });
    expect(resolvedPnlMode(c)).toBe("shot");
    expect(toDraft(c, []).pnlManual).toBe(50);
  });
  it("an open trade never takes a result", () => {
    const c = one({ ...LONG_GERMAN, status: "open", exits: [], realizedPnl: "+27,48" });
    expect(toDraft(c, []).pnlManual).toBeUndefined();
  });
  it("closed with neither exit nor result is called out", () => {
    const c = one({ market: "BTCUSDT", side: "long", entries: [{ price: "67.000", qty: "0,1", time: null }] });
    expect(codes(c)).toContain("closed_no_exit");
  });
});

describe("plausibility", () => {
  it("prices of different scale, absurd leverage, a stop far away", () => {
    expect(codes(one({ ...LONG_GERMAN, exits: [{ price: "6.780", qty: "0,05", time: null }] }))).toContain("exit_scale");
    expect(codes(one({ ...LONG_GERMAN, leverage: "500x" }))).toContain("lev_range");
    expect(codes(one({ ...LONG_GERMAN, stop: "20.000" }))).toContain("stop_far");
  });
  it("a price far from the trader's own history of the market", () => {
    const history = [1, 2, 3, 4].map((i) => stored({ id: `h${i}`, entry: 67000 + i, date: `2026-09-0${i}T10:00` }));
    expect(codes(one({ ...LONG_GERMAN, entries: [{ price: "6.725", qty: "0,05", time: "17.10.2026 14:32" }], exits: [] }), history)).toContain("journal_scale");
    expect(codes(one(LONG_GERMAN), history)).not.toContain("journal_scale");
  });
});

describe("duplicates", () => {
  const c = one(LONG_GERMAN);
  it("same market, side, entry within 0.05 %, time within 10 minutes → probably already there", () => {
    const dup = findDuplicate(c, [stored()]);
    expect(Math.round(dup!.minutes)).toBe(3);
    expect(dup!.priceDiff).toBeLessThan(0.0005);
    expect(codes(c, [stored()])).toContain("duplicate");
    expect(checksOf(c, checkCtx([stored()])).find((k) => k.code === "duplicate")!.text).toMatch(/Wahrscheinlich schon vorhanden/);
  });
  it.each([
    ["price 0.07 % off", { entry: 67300 }],
    ["11 minutes apart", { date: "2026-10-17T14:44" }],
    ["other side", { side: "short" as const }],
    ["other market", { pair: "ETH/USDT" }],
  ])("%s → not a duplicate", (_name, over) => {
    expect(findDuplicate(c, [stored(over)])).toBeNull();
  });
  it("the market is compared by key (BTCUSDT = BTC/USDT)", () => {
    expect(findDuplicate(c, [stored({ pair: "BTCUSDT" })])).not.toBeNull();
  });
  it("fills win over the stored entry", () => {
    const t = stored({ entry: 60000, fills: [{ id: "f", at: "2026-10-17T14:32", side: "open", price: 67250, qty: 0.05, kind: "entry" }] });
    expect(findDuplicate(c, [t])).not.toBeNull();
  });
  it("without an entry time (or for a plan) it says it could not check", () => {
    const untimed = one({ ...LONG_GERMAN, entries: [{ price: "67.250,5", qty: "0,05", time: null }] });
    expect(findDuplicate(untimed, [stored()])).toBeNull();
    expect(codes(untimed, [stored()])).toContain("dup_unjudged");
    expect(codes(one({ market: "BTCUSDT", side: "long", status: "planned", plannedEntry: "67.250" }), [stored()])).not.toContain("duplicate");
  });
});

describe("merging screenshots of one trade", () => {
  const position = (): Candidate => ({ ...one({ market: "BTCUSDT", side: "long", status: "open", entries: [{ price: "67.250,5", qty: "0,05", time: "17.10.2026 14:32" }], leverage: "10x" }), sources: [0] });
  const history = (): Candidate => ({ ...one({ market: "BTC/USDT", side: "long", entries: [{ price: "67.250,5", qty: "0,05", time: "17.10.2026 14:35" }], exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 15:10" }], realizedPnl: "+27,48", fees: "-1,35" }), sources: [1] });

  it("same market + side + entry minutes apart → one trade with both sources, the richer fields", () => {
    expect(sameTrade(position(), history())).toBe(true);
    const [m, ...rest] = mergeCandidates([position(), history()]);
    expect(rest).toHaveLength(0);
    expect(m).toMatchObject({ sources: [0, 1], merged: 2, status: "closed" });
    expect(m!.leverage.value).toBe(10);
    expect(m!.exits).toHaveLength(1);
    expect(m!.entries).toHaveLength(1); // the same fill seen twice stays one
    expect(m!.pnl.value).toBe(27.48);
    expect(m!.notes.join()).toMatch(/2 Screenshots zusammengeführt/);
  });
  it("partial fills seen in different screenshots add up", () => {
    const a = { ...one({ market: "BTCUSDT", side: "long", entries: [{ price: "67.000", qty: "0,03", time: "17.10.2026 14:00" }] }), sources: [0] };
    const b = { ...one({ market: "BTCUSDT", side: "long", entries: [{ price: "67.010", qty: "0,02", time: "17.10.2026 14:05" }] }), sources: [1] };
    const [m] = mergeCandidates([a, b]);
    expect(m!.entries).toHaveLength(2);
  });
  it.each([
    ["another market", (c: Candidate) => ({ ...c, pair: { ...c.pair, value: "ETH/USDT" } })],
    ["the other side", (c: Candidate) => ({ ...c, side: { ...c.side, value: "short" as const } })],
    ["20 minutes later", (c: Candidate) => ({ ...c, entries: c.entries.map((l) => ({ ...l, at: "2026-10-17T14:55" })) })],
    ["a different entry price", (c: Candidate) => ({ ...c, entries: c.entries.map((l) => ({ ...l, price: 68000 })) })],
  ])("%s → two trades", (_n, tweak) => {
    expect(mergeCandidates([position(), tweak(history())])).toHaveLength(2);
  });
  it("two trades of the SAME picture are never merged", () => {
    const a = position();
    const b = { ...history(), sources: [0] };
    expect(sameTrade(a, b)).toBe(false);
  });
  it("a disagreement between pictures is marked, not hidden", () => {
    const a = position();
    const b = { ...history(), leverage: { ...history().leverage, value: 20, conf: 0.99 } };
    const [m] = mergeCandidates([a, b]);
    expect(m!.leverage).toMatchObject({ value: 20, state: "uncertain" });
    expect(m!.leverage.note).toMatch(/widersprechen/);
  });
});

describe("rows and edits", () => {
  it("only what needs a look is flagged; optional gaps are quiet", () => {
    const c = one({ ...LONG_GERMAN, side: null, confidence: { ...conf(0.95), entries: 0.5 } });
    const rows = rowsOf(c, "USDT");
    const need = attentionRows(rows).map((r) => r.key);
    expect(need).toEqual(expect.arrayContaining(["side", "entry", "qty"]));
    expect(need).not.toEqual(expect.arrayContaining(["stop", "targets", "funding"]));
    expect(rows.find((r) => r.key === "stop")).toMatchObject({ state: "missing", optional: true, text: "—" });
    expect(rows.find((r) => r.key === "entry")!.text).toBe("67.250,5");
  });
  it("editing a value confirms it, clears the flag and re-feeds the checks", () => {
    let c = one({ ...LONG_GERMAN, side: null, confidence: { ...conf(0.95), entries: 0.5 } });
    c = editField(c, "entry", "67250,5");
    c = setSide(c, "long");
    c = editField(c, "stop", "66.900");
    const need = attentionRows(rowsOf(c, "USDT")).map((r) => r.key);
    expect(need).not.toContain("entry");
    expect(need).not.toContain("side");
    expect(c.stop).toMatchObject({ value: 66.9, edited: true, state: "ok" }); // the app's tolerant parser: "66.900" → 66.9 like in the form
    expect(editField(c, "stop", "").stop.value).toBeNull();
    expect(editField(c, "pair", "ethusdt").pair.value).toBe("ETH/USDT");
    expect(editField(c, "fees", "-2,5").fees.value).toBe(2.5);
    expect(editField(c, "funding", "-0,2").funding.value).toBe(-0.2);
  });
  it("a multi-fill entry is not editable in place", () => {
    const c = one({ ...LONG_GERMAN, entries: [{ price: "67.000", qty: "0,03", time: null }, { price: "67.500", qty: "0,02", time: null }] });
    expect(rowsOf(c, "USDT").find((r) => r.key === "entry")).toMatchObject({ editable: false, label: "Einstieg (Ø aus 2)" });
  });
  it("shotsFor picks the sources, all when none", () => {
    const all: ScreenshotRef[] = [{ id: "a", store: "idb" }, { id: "b", store: "idb" }, { id: "c", store: "idb" }];
    expect(shotsFor({ sources: [2, 0] }, all).map((r) => r.id)).toEqual(["c", "a"]);
    expect(shotsFor({ sources: [] }, all)).toHaveLength(3);
    expect(shotsFor({ sources: [9] }, all)).toHaveLength(3);
  });
});
