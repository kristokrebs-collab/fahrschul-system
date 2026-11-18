/**
 * Trade groups (Journal v3, P06): positionId / groupId / hedgeOf links, automatic hedge detection, grouped list rows.
 */
import { describe, expect, it } from "vitest";
import { detectHedges, entryMs, exitMs, groupLabel, groupRows, groupTrades, pairKey, type GroupableTrade } from "@/domain/grouping";

const NOW = new Date("2026-10-10T12:00").getTime();

const t = (id: string, p: Partial<GroupableTrade> = {}): GroupableTrade => ({
  id,
  side: "long",
  status: "closed",
  date: "2026-10-01T10:00",
  pair: "BTCUSDT",
  account: "scalp",
  pnl: 10,
  r: 1,
  risk: 10,
  ...p,
});

describe("pairKey / times", () => {
  it("normalises venue prefixes, perp suffixes and separators", () => {
    expect(pairKey("BINANCE:BTCUSDT.P")).toBe("BTCUSDT");
    expect(pairKey("btc/usdt")).toBe("BTCUSDT");
    expect(pairKey("BTC-USDT-SWAP")).toBe("BTCUSDT");
    expect(pairKey("ETHUSDT_PERP")).toBe("ETHUSDT");
    expect(pairKey("")).toBe("");
  });
  it("exit time: exitDate, else now while open, else the entry minute", () => {
    expect(exitMs(t("a", { exitDate: "2026-10-01T12:00" }), NOW)).toBe(new Date("2026-10-01T12:00").getTime());
    expect(exitMs(t("a", { status: "open" }), NOW)).toBe(NOW);
    expect(exitMs(t("a"), NOW)).toBe(entryMs(t("a")) + 60_000);
    // an exit before the entry is ignored
    expect(exitMs(t("a", { exitDate: "2026-09-30T10:00" }), NOW)).toBe(entryMs(t("a")) + 60_000);
  });
});

describe("detectHedges", () => {
  it("opposite sides, same pair, overlapping time", () => {
    const a = t("a", { exitDate: "2026-10-01T14:00" });
    const b = t("b", { side: "short", date: "2026-10-01T12:00", exitDate: "2026-10-01T16:00", pair: "BINANCE:BTCUSDT.P" });
    expect(detectHedges([a, b], NOW)).toEqual([["a", "b"]]);
  });
  it("no hedge: same side, other pair, other account, other venue, no overlap, touching ends", () => {
    const a = t("a", { exitDate: "2026-10-01T14:00" });
    expect(detectHedges([a, t("b", { date: "2026-10-01T12:00" })], NOW)).toEqual([]);
    expect(detectHedges([a, t("b", { side: "short", date: "2026-10-01T12:00", pair: "ETHUSDT" })], NOW)).toEqual([]);
    expect(detectHedges([a, t("b", { side: "short", date: "2026-10-01T12:00", account: "makro" })], NOW)).toEqual([]);
    expect(detectHedges([t("a", { exitDate: "2026-10-01T14:00", exchange: "bitunix" }), t("b", { side: "short", date: "2026-10-01T12:00", exchange: "binance" })], NOW)).toEqual([]);
    expect(detectHedges([a, t("b", { side: "short", date: "2026-10-01T15:00" })], NOW)).toEqual([]);
    expect(detectHedges([a, t("b", { side: "short", date: "2026-10-01T14:00", exitDate: "2026-10-01T15:00" })], NOW)).toEqual([]);
  });
  it("an open trade is held until now – unless it is older than two weeks (a forgotten position)", () => {
    const a = t("a", { status: "open", date: "2026-10-09T10:00" });
    expect(detectHedges([a, t("b", { side: "short", date: "2026-10-10T09:00" })], NOW)).toEqual([["a", "b"]]);
    const stale = t("s", { status: "open", date: "2026-09-01T10:00" });
    expect(detectHedges([stale, t("b", { side: "short", date: "2026-10-10T09:00" })], NOW)).toEqual([]);
  });
});

describe("groupTrades", () => {
  it("positionId: one position split over records, Σ P&L and R", () => {
    const { groups, groupOf } = groupTrades([t("a", { positionId: "p1", pnl: 30, risk: 10 }), t("b", { positionId: "p1", date: "2026-10-01T09:00", pnl: -10, risk: 10 }), t("c")], { now: NOW, hedges: false });
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.id).toBe("pos:p1");
    expect(g.kind).toBe("position");
    expect(g.members.map((m) => m.id)).toEqual(["b", "a"]);
    expect(g.pnl).toBe(20);
    expect(g.risk).toBe(20);
    expect(g.r).toBe(1);
    expect(g.label).toBe("Position · 2 Teile");
    expect(groupOf.get("a")).toBe(g);
    expect(groupOf.has("c")).toBe(false);
  });
  it("groupId and explicit hedgeOf; links are transitive", () => {
    const { groups } = groupTrades([t("a", { groupId: "g" }), t("b", { groupId: "g" }), t("c", { side: "short", hedgeOf: "b", date: "2026-10-05T10:00" })], { now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("hedge");
    expect(groups[0]!.side).toBe("hedge");
    expect(groups[0]!.auto).toBe(false);
    expect(groups[0]!.members).toHaveLength(3);
    expect(groups[0]!.label).toBe("Hedge · 2× Long + Short");
  });
  it("automatic hedge is marked auto; can be switched off", () => {
    const list = [t("a", { exitDate: "2026-10-01T14:00" }), t("b", { side: "short", date: "2026-10-01T11:00", exitDate: "2026-10-01T13:00" })];
    const on = groupTrades(list, { now: NOW });
    expect(on.groups[0]!.auto).toBe(true);
    expect(on.groups[0]!.label).toBe("Hedge · Long + Short");
    expect(groupTrades(list, { now: NOW, hedges: false }).groups).toEqual([]);
  });
  it("risk null unless every member has one; pnl null when none has one; open flag", () => {
    const { groups } = groupTrades([t("a", { positionId: "p", risk: null, pnl: null, status: "open" }), t("b", { positionId: "p", pnl: null })], { now: NOW });
    expect(groups[0]!.risk).toBeNull();
    expect(groups[0]!.pnl).toBeNull();
    expect(groups[0]!.r).toBeNull();
    expect(groups[0]!.open).toBe(true);
  });
  it("labels", () => {
    expect(groupLabel("group", [t("a"), t("b"), t("c")])).toBe("Gruppe · 3 Trades");
  });
});

describe("groupRows", () => {
  it("a group sits where its first member sits in the list order; single members stay trades", () => {
    const rows = [t("x", { date: "2026-10-03T10:00" }), t("a", { positionId: "p" }), t("y"), t("b", { positionId: "p" })];
    const out = groupRows(rows, { now: NOW, hedges: false });
    expect(out.map((r) => (r.kind === "trade" ? r.trade.id : r.group.id))).toEqual(["x", "pos:p", "y"]);
    // filtered down to one member → a plain trade again
    expect(groupRows([t("a", { positionId: "p" })], { now: NOW }).map((r) => r.kind)).toEqual(["trade"]);
  });
});
