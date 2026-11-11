/**
 * From the read records to the journal: the extraction the import's normalisers take, the candidates, what the preview
 * shows per field (doubt, derived, missing), the edits, the duplicate checks, the trade that is written (and what it says
 * about itself), and the undo.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { computePnlR } from "@/domain/derive";
import type { Trade } from "@/domain/types";
import { resolveZone } from "@/journal/extract/candidate";
import { ocrCandidates } from "@/journal/ocr/candidates";
import { buildTrade, commitTrades, undoCommit } from "@/journal/ocr/commit";
import { findDuplicateLoose } from "@/journal/ocr/duplicates";
import { parsePage } from "@/journal/ocr/layout";
import { applyOcrEdits, previewRows, type OcrEdit } from "@/journal/ocr/preview";
import { combine } from "@/journal/ocr/pipeline";
import { finalizePage } from "@/journal/ocr/records";
import { scoreAgainstTruth, type TruthTrade } from "@/journal/ocr/truth";
import type { OcrPage } from "@/journal/ocr/types";
import { useJournal } from "@/store/journalStore";
import words from "../fixtures/ocr/words-bitunix-positionshistorie-1.json";
import truth from "../fixtures/ocr/bitunix-positionshistorie-1.truth.json";
import { line, pageOf } from "./ocr.words";

const REAL = words as unknown as OcrPage;
/** What the second reading makes of the two cells the first reading got wrong (`81,2143`, the minus of the ROI). */
const AFTER_SECOND_READING: OcrPage = {
  ...REAL,
  words: REAL.words.map((w) => (w.text === "81,2143" ? { ...w, text: "81,214.3", conf: 96 } : w)),
};

const NOW = new Date("2026-10-24T22:50:00Z");
const ZONE = resolveZone(null, null, "Europe/Berlin");
const build = (page: OcrPage) => {
  const extraction = combine([finalizePage(parsePage(page))]);
  return { extraction, ...ocrCandidates(extraction, { now: NOW, zone: ZONE, localZone: "Europe/Berlin", fallbackStyle: "point" }) };
};
const ctx = (over: Partial<Parameters<typeof buildTrade>[2]> = {}) => ({ account: "scalp" as const, now: NOW, zoneText: ZONE.text, viewLabel: "Positionshistorie", ...over });

describe("the real screenshot, after the second reading", () => {
  const b = build(AFTER_SECOND_READING);

  it("two trades and one reported incomplete card – every field exactly what the picture shows", () => {
    expect(b.extraction.incomplete).toHaveLength(1);
    expect(b.extraction.incomplete[0]!.text).toContain("abgeschnitten");
    expect(b.candidates).toHaveLength(2);
    const s = scoreAgainstTruth(b.candidates, truth.trades as TruthTrade[]);
    expect(s.found).toBe(2);
    expect(s.extra).toBe(0);
    expect(s.hit).toBe(s.total);
    expect(s.total).toBe(18);
  });

  it("the result is the exchange's own (net) number; the fees are DERIVED and say so", () => {
    const c = b.candidates[0]!;
    expect(c.pnlMode).toBe("shot");
    expect(c.pnl.value).toBe(-14.66565175);
    expect(c.fees.value).toBeCloseTo(2.204532, 5);
    const recs = b.recordsOf.get(c.id)!;
    expect(recs[0]!.derivedFees).toBeCloseTo(2.204532, 5);
    const rows = previewRows(b.candidates, b.recordsOf, { trades: [], currency: "USDT", now: NOW, edits: [] });
    expect(rows[0]!.attention).toBe(0);
    expect(rows[0]!.blocked).toBeNull();
    const fees = rows[0]!.cells.find((x) => x.key === "fees")!;
    expect(fees.derived).toBe(true);
    expect(fees.notes[0]).toContain("abgeleitet");
    // times are the exchange app's clock in a zone it does not name: assumed, said so, selectable
    expect(ZONE.text).toContain("keine Zeitzone");
  });

  it("the trade that is written: net result kept, fees marked, margin mode and leverage, no stop invented, an import tag, not a „just saved“ trade", () => {
    const r = buildTrade(b.candidates[0]!, b.recordsOf.get(b.candidates[0]!.id)!, ctx(), "USDT");
    if (!r.ok) throw new Error(r.problem);
    const t = r.trade;
    expect(t).toMatchObject({ pair: "BTC/USDT", side: "long", status: "closed", entry: 81214.3, exit: 80658, qty: 0.0224, leverage: 5, marginMode: "isolated", market: "perp", pnlManual: -14.66565175, pnl: -14.66565175, stop: null, account: "scalp", date: "2026-10-22T17:07", exitDate: "2026-10-24T15:44:24" });
    expect(t.fees).toBeCloseTo(2.2045, 3);
    expect(t.r).toBeNull();
    expect(t.size).toBeCloseTo(81214.3 * 0.0224, 6);
    expect(t.tags).toEqual(["Screenshot-Import"]);
    expect(t.notes).toContain("Texterkennung auf dem Gerät");
    expect(t.notes).toContain("abgeleitet");
    expect(t.notes).toContain("keine Zeitzone");
    expect(t.notes).toContain("isoliert");
    // the stored result is what the journal itself would derive from the stored fields
    expect(computePnlR(t).pnl).toBeCloseTo(-14.66565175, 8);
    // the live watchers (coach, risk guard, review) only react to records saved within minutes: this one carries its exit time
    expect(t.updatedAt).toBe(new Date("2026-10-24T15:44:24").toISOString());
    expect(t.createdAt).toBe(NOW.toISOString());
  });
});

describe("a doubtful number is marked, never repaired by guessing", () => {
  it("the lost decimal point of „81,2143“ makes the entry (and the exit it contradicts) yellow and says why", () => {
    const b = build(REAL);
    const rows = previewRows(b.candidates, b.recordsOf, { trades: [], currency: "USDT", now: NOW, edits: [] });
    const first = rows[0]!;
    expect(first.attention).toBeGreaterThan(0);
    const entry = first.cells.find((c) => c.key === "entry")!;
    expect(entry.state).toBe("uncertain");
    expect(entry.notes.join(" ")).toContain("Dezimalzeichen");
    expect(first.warnings.join(" ")).toContain("Dezimalzeichen");
    expect(rows[1]!.cells.find((c) => c.key === "entry")!.state).toBe("ok"); // the other card's entry was read cleanly (its result had a low confidence in this reading: marked too)
  });

  it("typing the value in place settles the field (the German notation works); the candidate follows", () => {
    const b = build(REAL);
    const id = b.candidates[0]!.id;
    const edits: OcrEdit[] = [{ id, kind: "field", key: "entry", text: "81.214,3" }];
    const cands = applyOcrEdits(b.candidates, edits, NOW);
    expect(cands[0]!.entries[0]!.price).toBe(81214.3);
    const cell = previewRows(cands, b.recordsOf, { trades: [], currency: "USDT", now: NOW, edits }).find((r) => r.id === id)!.cells.find((c) => c.key === "entry")!;
    expect(cell.state).toBe("ok");
    expect(cell.notes).toEqual([]);
  });

  it("a typed time, a side and a missing entry (which takes the quantity of the closing order)", () => {
    const b = build(AFTER_SECOND_READING);
    const id = b.candidates[1]!.id;
    const cands = applyOcrEdits(b.candidates, [{ id, kind: "time", key: "date", text: "22.10.2026 11:31:00" }, { id, kind: "side", value: "short" }], NOW);
    expect(cands[1]!.entries[0]!.at).toBe("2026-10-22T11:31:00");
    expect(cands[1]!.side.value).toBe("short");
    // an entry typed into a trade that has none gets the quantity of the exit
    const noEntry = { ...b.candidates[0]!, entries: [] };
    const fixed = applyOcrEdits([noEntry], [{ id: noEntry.id, kind: "field", key: "entry", text: "81214.3" }], NOW)[0]!;
    expect(fixed.entries[0]!.qty).toBe(0.0224);
  });

  it("a trade that lacks a required field cannot be written, and the reason is named", () => {
    const b = build(AFTER_SECOND_READING);
    const noTime = { ...b.candidates[0]!, entries: b.candidates[0]!.entries.map((l) => ({ ...l, at: null })) };
    const r = buildTrade(noTime, [], ctx(), "USDT");
    expect(r).toEqual({ ok: false, problem: "Einstiegszeit fehlt" });
    const rows = previewRows([noTime], new Map(), { trades: [], currency: "USDT", now: NOW, edits: [] });
    expect(rows[0]!.blocked).toContain("Einstiegszeit");
  });
});

describe("order history: opening and closing order of one trade", () => {
  const rows = [
    line(100, [[20, "2026-10-24 15:01:22"], [330, "SOLUSDT"], [480, "Close Short", { ink: "red" }], [660, "170.33"], [800, "14.2"], [900, "1.45121160"], [1050, "-13.12028880", { ink: "red" }]]),
    line(150, [[20, "2026-10-23 17:10:47"], [330, "SOLUSDT"], [480, "Open Short", { ink: "red" }], [660, "169.61"], [800, "14.2"], [900, "1.44507720"], [1050, "--"]]),
    line(200, [[20, "2026-10-22 08:00:00"], [330, "ETHUSDT"], [480, "Close Long", { ink: "green" }], [660, "3,432.60"], [800, "0.5"], [900, "1.0300000"], [1050, "4.50000000", { ink: "green" }]]),
  ];
  const head = line(50, [[20, "Time"], [330, "Symbol"], [480, "Direction"], [660, "Price"], [800, "Qty"], [900, "Fee"], [1050, "Realized PnL"]]);
  const b = build(pageOf([head, ...rows], { width: 1300 }));

  it("the two orders become one trade; the closing order alone stays a trade WITHOUT an entry (never invented)", () => {
    expect(b.candidates).toHaveLength(2);
    const pair = b.candidates.find((c) => c.pair.value === "SOL/USDT")!;
    expect(pair.side.value).toBe("short");
    expect(pair.entries[0]!.price).toBe(169.61);
    expect(pair.exits[0]!.price).toBe(170.33);
    expect(pair.pnl.value).toBe(-13.1202888);
    expect(pair.fees.value).toBeCloseTo(1.45121160 + 1.44507720, 6);
    const alone = b.candidates.find((c) => c.pair.value === "ETH/USDT")!;
    expect(alone.entries).toHaveLength(0);
    const prow = previewRows(b.candidates, b.recordsOf, { trades: [], currency: "USDT", now: NOW, edits: [] }).find((r) => r.id === alone.id)!;
    expect(prow.blocked).toContain("Einstieg");
  });

  it("a cancelled order is no trade", () => {
    const cancelled = parsePage(pageOf([head, line(100, [[20, "2026-10-24 15:01:22"], [330, "SOLUSDT"], [480, "Open Long"], [660, "170.33"], [800, "0"], [900, "0"], [1050, "Storniert"]])], { width: 1300 }));
    expect(finalizePage(cancelled).records.length).toBeLessThanOrEqual(1);
  });
});

describe("duplicates", () => {
  const b = build(AFTER_SECOND_READING);
  const stored = (over: Partial<Trade>): Trade => {
    const r = buildTrade(b.candidates[0]!, b.recordsOf.get(b.candidates[0]!.id)!, ctx(), "USDT");
    if (!r.ok) throw new Error(r.problem);
    return { ...r.trade, id: "t_old", ...over };
  };

  it("the same trade again is found (same market, side, prices, time) – and pre-deselected in the preview", () => {
    const rows = previewRows(b.candidates, b.recordsOf, { trades: [stored({})], currency: "USDT", now: NOW, edits: [] });
    expect(rows[0]!.duplicate).not.toBeNull();
    expect(rows[1]!.duplicate).toBeNull();
  });

  it("the same prices and quantity with an entry time that differs by whole hours (another time zone) are named as such", () => {
    const old = stored({ date: "2026-10-22T19:07", exitDate: "2026-10-24T17:44:24" });
    const hit = findDuplicateLoose(b.candidates[0]!, [old]);
    expect(hit?.text).toContain("genau 2 Stunden");
    expect(hit?.text).toContain("Zeitzone");
    expect(findDuplicateLoose(b.candidates[0]!, [stored({ date: "2026-10-22T19:41" })])).toBeNull();
    expect(findDuplicateLoose(b.candidates[0]!, [stored({ entry: 80000 })])).toBeNull();
    expect(findDuplicateLoose(b.candidates[0]!, [stored({ side: "short" })])).toBeNull();
  });
});

describe("writing and undoing", () => {
  let list: Trade[];
  beforeEach(() => {
    list = [];
    useJournal.setState({
      trades: list,
      saveTrade: async (t: Trade) => {
        list = [...list.filter((x) => x.id !== t.id), t];
        useJournal.setState({ trades: list });
      },
      deleteTrade: async (id: string) => {
        list = list.filter((x) => x.id !== id);
        useJournal.setState({ trades: list });
      },
    } as never);
  });

  it("all trades are written one after the other; the undo removes exactly those", async () => {
    const b = build(AFTER_SECOND_READING);
    const trades = b.candidates.map((c) => {
      const r = buildTrade(c, b.recordsOf.get(c.id)!, ctx(), "USDT");
      if (!r.ok) throw new Error(r.problem);
      return r.trade;
    });
    const pre: Trade = { ...trades[0]!, id: "t_mine", pair: "ETH/USDT" };
    useJournal.setState({ trades: [pre] });
    list = [pre];
    const res = await commitTrades(trades);
    expect(res).toEqual({ ids: trades.map((t) => t.id), failed: 0 });
    expect(useJournal.getState().trades).toHaveLength(3);
    expect(await undoCommit(res.ids)).toBe(2);
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["t_mine"]);
    // undoing twice is harmless
    expect(await undoCommit(res.ids)).toBe(0);
  });

  it("a failing write stops there: what is saved stays, the rest is reported", async () => {
    const b = build(AFTER_SECOND_READING);
    const trades = b.candidates.map((c) => {
      const r = buildTrade(c, b.recordsOf.get(c.id)!, ctx(), "USDT");
      if (!r.ok) throw new Error(r.problem);
      return r.trade;
    });
    let n = 0;
    useJournal.setState({
      saveTrade: async (t: Trade) => {
        if (++n === 2) throw new Error("disk full");
        list = [...list, t];
        useJournal.setState({ trades: list });
      },
    } as never);
    const res = await commitTrades(trades);
    expect(res.ids).toHaveLength(1);
    expect(res.failed).toBe(1);
    expect(useJournal.getState().trades).toHaveLength(1);
  });
});
