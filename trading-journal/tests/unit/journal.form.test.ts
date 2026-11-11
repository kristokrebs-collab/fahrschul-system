/**
 * Journal-v3 part of the trade form (P06): defaults, round trip of a stored trade, `Speichern & neu`, fills fixing the
 * bundle fields, empty values writing no keys, validation.
 */
import { describe, expect, it } from "vitest";
import type { Fill, Trade, TradePsych } from "@/domain/types";
import {
  JOURNAL_KEYS,
  JOURNAL_MESSAGES,
  dropEmptyJournalKeys,
  fillFix,
  fillsOf,
  journalDefaults,
  journalFromTrade,
  journalKey,
  journalRecord,
  journalReset,
  newFillRow,
  validateJournal,
  type FillRow,
  type JournalForm,
} from "@/journal/editor/form";

const row = (id: string, side: FillRow["side"], price: string, qty: string, fee = "", at = ""): FillRow => ({ id, at, side, price, qty, fee });
const ctx = { date: "2026-10-01T10:00", status: "closed" as const, side: "long" as const };

describe("journal form – defaults and round trip", () => {
  it("an untouched form writes no new key (all undefined → dropped)", () => {
    const rec = journalRecord(journalDefaults(), { status: "closed", side: "long" });
    for (const k of JOURNAL_KEYS) expect(rec[k]).toBeUndefined();
    const legacy = { id: "x", entry: 1, ...rec };
    expect(Object.keys(dropEmptyJournalKeys(legacy))).toEqual(["id", "entry"]);
  });

  it("a stored v3 trade survives form → record unchanged, unknown keys inside fills / psych included", () => {
    const stored: Partial<Trade> = {
      exitDate: "2026-10-01T14:30",
      qty: 0.2,
      fundingFees: -1.2,
      slippage: 0.5,
      margin: 1600,
      marginMode: "isolated",
      liqPrice: 64000,
      market: "perp",
      exchange: "bitunix",
      exchangeAccount: "Haupt",
      fills: [
        { id: "f1", at: "2026-10-01T10:00", side: "open", price: 84000, qty: 0.2, fee: 1, kind: "entry", venueId: "abc" } as Fill,
        { id: "f2", at: "2026-10-01T14:30", side: "close", price: 85000, qty: 0.2, kind: "exit" },
      ],
      targets: [{ price: 86000, pct: 50, hit: true }],
      stopHistory: [{ at: "2026-10-01T12:00", price: 84000, note: "BE" }],
      tags: ["London", "Breakout"],
      rating: 4,
      psych: { stress: 2, confidence: 5, flags: ["tilt"], exitReason: "Ziel erreicht", preNote: "ruhig", mood: "gut" } as TradePsych,
      screenshots: [{ id: "s1", store: "idb", key: "shot_1", w: 10, h: 10, at: "2026-10-01T10:00" }],
    };
    const j = journalFromTrade(stored);
    expect(j.exitDate).toBe("2026-10-01T14:30");
    expect(j.fills.map((f) => f.price)).toEqual(["84000", "85000"]);
    const rec = journalRecord(j, { status: "closed", side: "long" }, stored);
    expect(rec.fills?.[0]).toMatchObject({ id: "f1", venueId: "abc", kind: "entry", fee: 1 });
    expect(rec.psych).toEqual(stored.psych); // `mood` (unknown) kept
    expect(rec).toMatchObject({ qty: 0.2, fundingFees: -1.2, slippage: 0.5, margin: 1600, marginMode: "isolated", liqPrice: 64000, market: "perp", exchange: "bitunix", exchangeAccount: "Haupt", rating: 4 });
    expect(rec.targets).toEqual(stored.targets);
    expect(rec.stopHistory).toEqual(stored.stopHistory);
    expect(rec.tags).toEqual(["London", "Breakout"]);
    expect(rec.screenshots).toEqual(stored.screenshots);
  });

  it("clearing a field removes its key; an open trade stores no exit time", () => {
    const j: JournalForm = { ...journalDefaults(), exitDate: "2026-10-01T12:00", tags: [], rating: null, exitReason: "  " };
    const rec = journalRecord(j, { status: "open", side: "long" }, { psych: { exitReason: "Stop" } });
    expect(rec.exitDate).toBeUndefined();
    expect(rec.psych).toBeUndefined();
  });

  it("`Speichern & neu` keeps the venue (market, margin mode, exchange, account) and clears the trade", () => {
    const j: JournalForm = { ...journalDefaults(), market: "perp", marginMode: "cross", exchange: "bitunix", exchangeAccount: "Sub", tags: ["x"], rating: 3, fills: [newFillRow("open")], exitReason: "Stop" };
    expect(journalReset(j)).toEqual({ ...journalDefaults(), market: "perp", marginMode: "cross", exchange: "bitunix", exchangeAccount: "Sub" });
  });

  it("journalKey ignores tag / flag order", () => {
    const a = { ...journalDefaults(), tags: ["a", "b"], flags: ["tilt", "fomo"] };
    const b = { ...journalDefaults(), tags: ["b", "a"], flags: ["fomo", "tilt"] };
    expect(journalKey(a)).toEqual(journalKey(b));
  });
});

describe("journal form – fills", () => {
  it("fillsOf skips incomplete rows and labels entry / add / partial / exit", () => {
    const fills = fillsOf([row("a", "open", "100", "1"), row("b", "open", "90", "1"), row("c", "close", "", "1"), row("d", "close", "120", "1"), row("e", "close", "130", "1")]);
    expect(fills.map((f) => [f.id, f.kind])).toEqual([
      ["a", "entry"],
      ["b", "add"],
      ["d", "partial"],
      ["e", "exit"],
    ]);
  });

  it("fillFix: Ø entry, notional size, Ø exit only when flat", () => {
    const open = fillFix([row("a", "open", "84000", "0,1"), row("b", "open", "83600", "0,1"), row("c", "close", "85000", "0,1")], "long");
    expect(open).toMatchObject({ entry: 83800, qty: 0.2, exit: null });
    expect(open!.size).toBeCloseTo(16760, 6);
    expect(open!.remaining).toBeCloseTo(0.1, 9);
    const flat = fillFix([row("a", "open", "84000", "0,1"), row("b", "open", "83600", "0,1"), row("c", "close", "85000", "0,2")], "long");
    expect(flat?.exit).toBe(85000);
    expect(fillFix([], "long")).toBeNull();
  });

  it("qty falls back to the opened quantity of the fills", () => {
    const j = { ...journalDefaults(), fills: [row("a", "open", "100", "2"), row("b", "close", "110", "2")] };
    expect(journalRecord(j, { status: "closed", side: "long" }).qty).toBe(2);
    expect(journalRecord({ ...j, qty: "1,5" }, { status: "closed", side: "long" }).qty).toBe(1.5);
  });
});

describe("journal form – validation", () => {
  it("exit before entry", () => {
    expect(validateJournal({ ...journalDefaults(), exitDate: "2026-10-01T09:00" }, ctx)).toBe(JOURNAL_MESSAGES.exitBeforeEntry);
    expect(validateJournal({ ...journalDefaults(), exitDate: "2026-10-01T09:00" }, { ...ctx, status: "open" })).toBeNull();
  });
  it("incomplete fill, over-closing fills", () => {
    expect(validateJournal({ ...journalDefaults(), fills: [row("a", "open", "100", "")] }, ctx)).toBe(JOURNAL_MESSAGES.fillIncomplete);
    expect(validateJournal({ ...journalDefaults(), fills: [row("a", "open", "", "")] }, ctx)).toBeNull(); // untouched row
    expect(validateJournal({ ...journalDefaults(), fills: [row("a", "open", "100", "1"), row("b", "close", "110", "2")] }, ctx)).toBe(JOURNAL_MESSAGES.overClosed);
  });
  it("TP ladder: price missing, more than 100 %; stop history without price", () => {
    expect(validateJournal({ ...journalDefaults(), targets: [{ id: "t", price: "", pct: "50", hit: false }] }, ctx)).toBe(JOURNAL_MESSAGES.targetIncomplete);
    expect(
      validateJournal(
        {
          ...journalDefaults(),
          targets: [
            { id: "t1", price: "1", pct: "60", hit: false },
            { id: "t2", price: "2", pct: "50", hit: false },
          ],
        },
        ctx,
      ),
    ).toBe(JOURNAL_MESSAGES.targetsOver);
    expect(validateJournal({ ...journalDefaults(), stops: [{ id: "s", at: "", price: "", note: "BE" }] }, ctx)).toBe(JOURNAL_MESSAGES.stopIncomplete);
  });
});
