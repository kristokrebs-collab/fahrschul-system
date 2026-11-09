/**
 * F28 Signal-Posteingang: the status of an event (neu · angesehen · gehandelt · bewusst ausgelassen · abgelaufen), the written-out
 * relevance order, the filters, the trades one can link by hand, the labels – and the additive archive fields (tolerant read,
 * the marks seen / left out / linked, the stored copy).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendSignalEvent,
  buildInbox,
  DEFAULT_INBOX_FILTER,
  filterInbox,
  linkCandidates,
  linkSignalTrade,
  markSignalSeen,
  MISSED_WINDOW_MS,
  parseSignalArchive,
  setSignalSkip,
  signalKindLabel,
  signalLevelLabel,
  SKIP_REASONS,
} from "@/domain/missed";
import { __resetSignalArchive, getSignalArchive, linkTrade, markSeen, recordSignalEvent, SIGNAL_ARCHIVE_KEY, skipSignal } from "@/market/signalArchive";
import { at, ct, enrichC } from "./coach.fixtures";
import { H, signalEvent, signalInput } from "./missed.fixtures";

const T = new Date(at(0, 600)).getTime(); // Mon 10:00
const NOW = T + 2 * 86_400_000;
const trades = enrichC([ct(at(0, 605), { id: "t1", p: 100, side: "long", pair: "BTC/USDT" }), ct(at(1, 600), { id: "t2", p: -50, side: "short", pair: "ETH/USDT" })]);

describe("buildInbox", () => {
  it("gives every event one status – the first rule that applies", () => {
    const events = [
      signalEvent({ key: "traded", at: T }), // a long BTC trade 5 min later
      signalEvent({ key: "left", at: T + 3 * H, skip: "doubt", skipAt: T + 4 * H }),
      signalEvent({ key: "expired", at: T + 6 * H }),
      signalEvent({ key: "seen", at: NOW - H, seenAt: NOW - 30 * 60_000 }),
      signalEvent({ key: "new", at: NOW - 2 * H }),
      signalEvent({ key: "ctx", at: NOW - 3 * H, entry: false, kind: "breakout" }),
    ];
    const rep = buildInbox(events, trades, NOW);
    const by = Object.fromEntries(rep.rows.map((r) => [r.event.key, r.status]));
    expect(by).toEqual({ traded: "gehandelt", left: "ausgelassen", expired: "abgelaufen", seen: "angesehen", new: "neu", ctx: "neu" });
    expect(rep.counts).toEqual({ neu: 2, angesehen: 1, gehandelt: 1, ausgelassen: 1, abgelaufen: 1 });
    expect(rep.rows.find((r) => r.event.key === "traded")!.trades.map((t) => t.id)).toEqual(["t1"]);
    expect(rep.rows.find((r) => r.event.key === "left")!.skipText).toBe("Zweifel am Signal");
    expect(rep.rows.find((r) => r.event.key === "ctx")!.entry).toBe(false);
  });

  it("a trade linked by hand makes it gehandelt, whatever the window says – a deleted trade does not", () => {
    const e = signalEvent({ key: "far", at: T - 20 * H, tradeId: "t1" });
    expect(buildInbox([e], trades, NOW).rows[0]).toMatchObject({ status: "gehandelt" });
    expect(buildInbox([e], trades, NOW).rows[0]!.trades.map((t) => t.id)).toEqual(["t1"]);
    expect(buildInbox([{ ...e, tradeId: "gone" }], trades, NOW).rows[0]!.status).toBe("abgelaufen");
  });

  it("a signal inside its window is neu even when nothing happened yet; after the window it expires", () => {
    const fresh = signalEvent({ key: "f", at: NOW - H });
    const old = signalEvent({ key: "o", at: NOW - MISSED_WINDOW_MS - H });
    const rep = buildInbox([fresh, old], [], NOW);
    expect(rep.rows.map((r) => `${r.event.key}:${r.status}`).sort()).toEqual(["f:neu", "o:abgelaufen"]);
  });

  it("orders by the written-out relevance: status, entry, own market, strength, recency", () => {
    const events = [
      signalEvent({ key: "old-expired", at: NOW - 40 * H, strength: 4 }),
      signalEvent({ key: "new-other-market", at: NOW - 2 * H, symbol: "SOLUSDT", strength: 4 }),
      signalEvent({ key: "new-my-market", at: NOW - 3 * H, symbol: "BTCUSDT", strength: 2 }),
      signalEvent({ key: "new-context", at: NOW - H, entry: false, kind: "breakout", strength: null }),
      signalEvent({ key: "seen", at: NOW - H, seenAt: NOW - 10 * 60_000, symbol: "BTCUSDT" }),
      signalEvent({ key: "skipped", at: NOW - 5 * H, skip: "time", skipAt: NOW }),
    ];
    const keys = buildInbox(events, [], NOW).rows.map((r) => r.event.key);
    // no trades: "my market" is empty, so the strength decides between the two new entries
    expect(keys).toEqual(["new-other-market", "new-my-market", "new-context", "seen", "old-expired", "skipped"]);
    const withJournal = buildInbox(events, trades, NOW).rows.map((r) => r.event.key);
    expect(withJournal.indexOf("new-my-market")).toBeLessThan(withJournal.indexOf("new-other-market")); // +30 for a market the trader trades beats +10 for strength 4 vs 2
    expect(withJournal.at(-1)).toBe("skipped");
  });

  it("ties go to the newest event; the result does not depend on the input order", () => {
    const a = signalEvent({ key: "a", at: NOW - 3 * H, strength: null });
    const b = signalEvent({ key: "b", at: NOW - H, strength: null });
    expect(buildInbox([a, b], [], NOW).rows.map((r) => r.event.key)).toEqual(buildInbox([b, a], [], NOW).rows.map((r) => r.event.key));
  });
});

describe("filterInbox", () => {
  const events = [signalEvent({ key: "a", at: NOW - H, symbol: "BTCUSDT" }), signalEvent({ key: "b", at: NOW - 2 * H, symbol: "SOLUSDT", entry: false, kind: "breakout" }), signalEvent({ key: "c", at: NOW - 30 * H, symbol: "BTCUSDT" })];
  const rows = buildInbox(events, trades, NOW).rows;
  it("filters by status, by own markets and by entries", () => {
    expect(filterInbox(rows, DEFAULT_INBOX_FILTER)).toHaveLength(3);
    expect(filterInbox(rows, { ...DEFAULT_INBOX_FILTER, status: "neu" }).map((r) => r.event.key).sort()).toEqual(["a", "b"]);
    expect(filterInbox(rows, { ...DEFAULT_INBOX_FILTER, mine: true }).map((r) => r.event.key).sort()).toEqual(["a", "c"]);
    expect(filterInbox(rows, { ...DEFAULT_INBOX_FILTER, entries: true }).map((r) => r.event.key).sort()).toEqual(["a", "c"]);
    expect(filterInbox(rows, { status: "abgelaufen", mine: true, entries: true }).map((r) => r.event.key)).toEqual(["c"]);
  });
});

describe("linkCandidates", () => {
  it("offers trades of the same market within 24 hours, nearest first, never the linked one", () => {
    const list = enrichC([
      ct(at(0, 540), { id: "near", pair: "BTC/USDT" }),
      ct(at(0, 700), { id: "far", pair: "BTC/USDT" }),
      ct(at(0, 601), { id: "other", pair: "ETH/USDT" }),
      ct(at(5, 600), { id: "days", pair: "BTC/USDT" }),
      ct(at(0, 599), { id: "unreadable", pair: "?" }),
    ]);
    const c = linkCandidates({ at: T, symbol: "BTCUSDT", tradeId: null }, list);
    expect(c.map((t) => t.id)).toEqual(["unreadable", "near", "far"]);
    expect(linkCandidates({ at: T, symbol: "BTCUSDT", tradeId: "near" }, list).map((t) => t.id)).not.toContain("near");
    expect(linkCandidates({ at: T, symbol: "BTCUSDT", tradeId: null }, list, 1)).toHaveLength(1);
  });
});

describe("labels", () => {
  it("names the kind and the level of an event", () => {
    expect(signalKindLabel(signalEvent())).toBe("Einstiegs-Check");
    expect(signalKindLabel(signalEvent({ source: "box", kind: "setup" }))).toBe("Box-Setup");
    expect(signalKindLabel(signalEvent({ source: "box", kind: "breakout" }))).toBe("Box · Ausbruch");
    expect(signalKindLabel(signalEvent({ source: "key", kind: "confirm" }))).toBe("Schlüsselmarke · Bestätigung");
    expect(signalLevelLabel(signalEvent({ strength: 3 }))).toBe("Stärke 3");
    expect(signalLevelLabel(signalEvent({ strength: null, grade: "A+" }))).toBe("Note A+");
    expect(signalLevelLabel(signalEvent({ strength: null }))).toBeNull();
  });
});

describe("archive: additive fields and the inbox marks", () => {
  it("reads the new fields tolerantly – a record without them gets null, garbage is dropped", () => {
    const old = { id: "x", key: "old", at: T, source: "entry", kind: "entry", entry: true, symbol: "BTCUSDT", side: "long", tf: "1h", label: "L", detail: "", strength: 2, score: 5, ref: null, watch: false };
    const p = parseSignalArchive({ v: 1, items: [old, { ...old, id: "y", key: "new", price: 100, stop: -5, target: "x", barClose: T - 1000, name: "Ausbruch Long", setupKind: "breakout", grade: "A+", rr: 2, skip: "magic", seenAt: T + 5, tradeId: "t1" }] }, T + H);
    const a = p.items.find((e) => e.key === "old")!;
    expect(a).toMatchObject({ price: null, stop: null, target: null, barClose: null, name: null, skip: null, seenAt: null, tradeId: null });
    const b = p.items.find((e) => e.key === "new")!;
    expect(b).toMatchObject({ price: 100, stop: null, target: null, barClose: T - 1000, name: "Ausbruch Long", setupKind: "breakout", grade: "A+", rr: 2, skip: null, seenAt: T + 5, tradeId: "t1" });
  });

  it("appendSignalEvent stores the marks of the setup and starts without an inbox mark", () => {
    const items = appendSignalEvent([], signalInput({ key: "b", source: "box", kind: "setup", price: 100, stop: 95, target: 110, name: "Ausbruch", setupKind: "breakout", grade: "A", rr: 2 }), "id1", T);
    expect(items[0]).toMatchObject({ price: 100, stop: 95, target: 110, grade: "A", skip: null, seenAt: null, tradeId: null });
  });

  it("markSignalSeen keeps the first look; the skip reason and the link are set and taken back; a no-op returns the same list", () => {
    const items = [signalEvent({ key: "a" }), signalEvent({ key: "b" })];
    const seen = markSignalSeen(items, "a", 100);
    expect(seen[0]!.seenAt).toBe(100);
    expect(markSignalSeen(seen, "a", 200)).toBe(seen);
    const skipped = setSignalSkip(seen, "b", "limit", 300);
    expect(skipped[1]).toMatchObject({ skip: "limit", skipAt: 300, seenAt: 300 });
    expect(setSignalSkip(skipped, "b", "limit", 400)).toBe(skipped);
    expect(setSignalSkip(skipped, "b", null, 500)[1]).toMatchObject({ skip: null, skipAt: null });
    const linked = linkSignalTrade(items, "a", "t9");
    expect(linked[0]!.tradeId).toBe("t9");
    expect(linkSignalTrade(linked, "a", null)[0]!.tradeId).toBeNull();
    expect(linkSignalTrade(items, "nope", "t9")).toBe(items);
    expect(SKIP_REASONS).toHaveLength(5);
  });
});

describe("archive store: marks persist", () => {
  beforeEach(() => {
    localStorage.removeItem(SIGNAL_ARCHIVE_KEY);
    __resetSignalArchive();
  });
  it("seen, skipped and linked are written to the stored archive", () => {
    recordSignalEvent(signalInput({ key: "s1", at: Date.now() - H, price: 100, stop: 95, target: 110, barClose: Date.now() - H - 5000 }));
    const id = getSignalArchive()[0]!.id;
    markSeen(id);
    skipSignal(id, "context");
    linkTrade(id, "t7");
    const stored = JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!);
    expect(stored.v).toBe(1);
    expect(stored.items[0]).toMatchObject({ id, price: 100, stop: 95, target: 110, skip: "context", tradeId: "t7" });
    expect(typeof stored.items[0].seenAt).toBe("number");
    skipSignal(id, null);
    expect(getSignalArchive()[0]!.skip).toBeNull();
  });
});
