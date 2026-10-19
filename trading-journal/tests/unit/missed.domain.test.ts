/**
 * F32 Verpasste Chancen: the signal archive (tolerant read, de-duplication, age and size limits, the „Beobachten“ mark,
 * a stored newer version is never overwritten) and the comparison with the journal (gehandelt / nicht gehandelt / offen,
 * side, market, window, context events, signals from before the journal).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { appendSignalEvent, matchSignals, MISSED_LEAD_MS, MISSED_WINDOW_MS, parseSignalArchive, prune, setSignalWatch, SIGNAL_ARCHIVE_CAP, SIGNAL_ARCHIVE_DAYS, tradeMatchesSignal, type SignalEvent, type SignalEventInput } from "@/domain/missed";
import { __resetSignalArchive, clearSignalArchive, getSignalArchive, recordSignalEvent, setSignalWatched, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { at, ct, enrichC } from "./coach.fixtures";

const H = 3_600_000;
const DAY = 24 * H;
const T = new Date(2026, 2, 4, 10, 0).getTime(); // Wed 10:00
const NOW = T + 2 * DAY;

const input = (over: Partial<SignalEventInput> = {}): SignalEventInput => ({ key: "k1", at: T, source: "entry", kind: "entry", entry: true, symbol: "BTCUSDT", side: "long", tf: "1h", label: "Starker Long-Einstieg", detail: "Score 85", strength: 3, score: 85, ref: null, ...over });
const ev = (over: Partial<SignalEventInput> = {}, id = over.key ?? "k1"): SignalEvent => ({ ...input(over), id, watch: false });

describe("Signalarchiv", () => {
  it("reads garbage as empty and a newer version as foreign", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { v: 1 }, { v: 1, items: "x" }]) expect(parseSignalArchive(bad, NOW)).toEqual({ items: [], foreign: false });
    expect(parseSignalArchive({ v: 2, items: [ev()] }, NOW)).toEqual({ items: [], foreign: true });
  });

  it("drops broken items, de-duplicates by key and sorts newest first", () => {
    const raw = { v: 1, items: [ev({ key: "a", at: T }), ev({ key: "b", at: T + H }), ev({ key: "a", at: T + 2 * H }), { id: "x" }, null, { ...ev({ key: "c" }), source: "magic" }, { ...ev({ key: "d" }), side: "up", strength: "x" }] };
    const p = parseSignalArchive(raw, NOW);
    expect(p.items.map((e) => e.key)).toEqual(["b", "a", "d"]);
    expect(p.items.find((e) => e.key === "d")).toMatchObject({ side: null, strength: null });
  });

  it("appends once per key and keeps a short, honest event", () => {
    const a = appendSignalEvent([], input(), "s1", NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "s1", watch: false, key: "k1" });
    expect(appendSignalEvent(a, input({ at: T + H }), "s2", NOW)).toBe(a);
    const b = appendSignalEvent(a, input({ key: "k2", at: T + H }), "s3", NOW);
    expect(b.map((e) => e.key)).toEqual(["k2", "k1"]);
    expect(appendSignalEvent([], { ...input(), at: Number.NaN }, "s4", NOW)).toEqual([]);
  });

  it("prunes by age and by size; marked events survive both", () => {
    const old = ev({ key: "old", at: NOW - (SIGNAL_ARCHIVE_DAYS + 1) * DAY });
    const pinned: SignalEvent = { ...old, key: "pinned", id: "pinned", watch: true };
    const fresh = ev({ key: "fresh", at: NOW - DAY });
    expect(prune([fresh, old, pinned], NOW).map((e) => e.key)).toEqual(["fresh", "pinned"]);
    const many = Array.from({ length: SIGNAL_ARCHIVE_CAP + 20 }, (_, i) => ev({ key: `m${i}`, at: NOW - i * H }));
    const cut = prune([...many.slice(0, 1), { ...many[SIGNAL_ARCHIVE_CAP + 10]!, watch: true }, ...many.slice(1, SIGNAL_ARCHIVE_CAP + 10)], NOW);
    expect(cut).toHaveLength(SIGNAL_ARCHIVE_CAP);
    expect(cut.some((e) => e.key === `m${SIGNAL_ARCHIVE_CAP + 10}`)).toBe(true);
  });

  it("marks and unmarks one event; nothing changes for an unknown id", () => {
    const list = [ev()];
    const on = setSignalWatch(list, "k1", true);
    expect(on[0]!.watch).toBe(true);
    expect(setSignalWatch(on, "k1", true)).toBe(on);
    expect(setSignalWatch(list, "nope", true)).toBe(list);
    expect(setSignalWatch(on, "k1", false)[0]!.watch).toBe(false);
  });
});

describe("Signalarchiv – Speicher", () => {
  beforeEach(() => {
    localStorage.removeItem(SIGNAL_ARCHIVE_KEY);
    __resetSignalArchive();
  });

  it("persists a versioned wrapper and survives a reload", () => {
    recordSignalEvent(input({ at: Date.now() }));
    recordSignalEvent(input({ at: Date.now() })); // same key: once
    expect(getSignalArchive()).toHaveLength(1);
    const raw = JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!);
    expect(raw.v).toBe(1);
    expect(raw.items).toHaveLength(1);
    const id = getSignalArchive()[0]!.id;
    setSignalWatched(id, true);
    __resetSignalArchive(); // reload
    expect(getSignalArchive()[0]).toMatchObject({ id, watch: true });
    clearSignalArchive();
    expect(JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!)).toEqual({ v: 1, items: [] });
  });

  it("never overwrites an archive of a newer version", () => {
    const newer = JSON.stringify({ v: 2, items: [{ whatever: true }] });
    localStorage.setItem(SIGNAL_ARCHIVE_KEY, newer);
    recordSignalEvent(input({ at: Date.now() }));
    expect(getSignalArchive()).toHaveLength(1); // kept in memory for this session
    expect(localStorage.getItem(SIGNAL_ARCHIVE_KEY)).toBe(newer);
  });
});

describe("Abgleich mit dem Journal", () => {
  const trade = (min: number, over: Parameters<typeof ct>[1] = {}) => ct(at(2, min), { p: 50, ...over });
  const list = (...ts: ReturnType<typeof trade>[]) => enrichC(ts);

  it("a trade of the same side and market inside the window makes it „gehandelt“", () => {
    const e = ev({ at: new Date(at(2, 600)).getTime() });
    const r = matchSignals([e], list(trade(600 + 90, { id: "t1", pair: "BTCUSDT" })), NOW);
    expect(r.rows[0]).toMatchObject({ verdict: "gehandelt" });
    expect(r.rows[0]!.trades.map((t) => t.id)).toEqual(["t1"]);
    expect(r.traded).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
  });

  it("no trade → „nicht gehandelt“; the window not over → „offen“", () => {
    const first = trade(0, { id: "first", side: "long" });
    const ts = list(trade(0, { id: "z", side: "long" }), first);
    const e = ev({ at: new Date(at(3, 600)).getTime() }); // the day after: no trade
    const r = matchSignals([e], ts, NOW);
    expect(r.missed.map((x) => x.event.key)).toEqual(["k1"]);
    const live = matchSignals([e], ts, e.at + MISSED_WINDOW_MS - 1);
    expect(live.open).toHaveLength(1);
    expect(live.missed).toHaveLength(0);
    expect(matchSignals([e], ts, e.at + MISSED_WINDOW_MS + 1).missed).toHaveLength(1);
  });

  it("the other side, the other market, outside the window – all no match; an unreadable pair is the trader's benefit", () => {
    const e = { at: new Date(at(2, 600)).getTime(), side: "long" as const, symbol: "BTCUSDT" };
    const t = (over: Parameters<typeof ct>[1]) => enrichC([trade(600, over)])[0]!;
    expect(tradeMatchesSignal(e, t({ side: "long", pair: "BTCUSDT" }))).toBe(true);
    expect(tradeMatchesSignal(e, t({ side: "short", pair: "BTCUSDT" }))).toBe(false);
    expect(tradeMatchesSignal(e, t({ side: "long", pair: "ETHUSDT" }))).toBe(false);
    expect(tradeMatchesSignal(e, t({ side: "long", pair: "BTC/USDT" }))).toBe(true);
    expect(tradeMatchesSignal(e, t({ side: "long", pair: "" }))).toBe(true);
    expect(tradeMatchesSignal({ ...e, symbol: "" }, t({ side: "long", pair: "ETHUSDT" }))).toBe(true);
    expect(tradeMatchesSignal(e, enrichC([trade(600 + 60 * 7)])[0]!)).toBe(false); // 7 h after
    expect(tradeMatchesSignal(e, enrichC([trade(600 - 31)])[0]!)).toBe(false); // 31 min before
    expect(tradeMatchesSignal(e, enrichC([trade(600 - 29)])[0]!)).toBe(true);
    expect(MISSED_LEAD_MS).toBe(30 * 60_000);
  });

  it("only entry signals with a side can be missed; the rest is context", () => {
    const ts = list(trade(0, { id: "z" }));
    const evs = [ev({ key: "a", at: new Date(at(3, 600)).getTime() }), ev({ key: "b", at: new Date(at(3, 600)).getTime(), entry: false, source: "box", kind: "breakout" }), ev({ key: "c", at: new Date(at(3, 600)).getTime(), side: null, source: "key" })];
    const r = matchSignals(evs, ts, NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.context).toBe(2);
    expect(r.total).toBe(3);
  });

  it("leaves out signals from before the journal began, and says so", () => {
    const ts = list(trade(600, { id: "z" }));
    const early = ev({ key: "early", at: new Date(at(2, 600)).getTime() - 3 * DAY });
    const r = matchSignals([early], ts, NOW);
    expect(r.rows).toEqual([]);
    expect(r.beforeJournal).toBe(1);
    expect(matchSignals([ev()], [], NOW).beforeJournal).toBe(1);
  });

  it("reports the span of the archive and is deterministic", () => {
    const evs = [ev({ key: "a", at: T }), ev({ key: "b", at: T + DAY })];
    const ts = list(trade(0, { id: "z" }));
    const a = matchSignals(evs, ts, NOW);
    expect(a.since).toBe(T);
    expect(a.until).toBe(T + DAY);
    expect(matchSignals([...evs].reverse(), ts, NOW)).toEqual(a);
    expect(matchSignals([], ts, NOW)).toMatchObject({ total: 0, since: null, rows: [] });
  });
});
