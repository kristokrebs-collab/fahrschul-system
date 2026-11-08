/**
 * Paket F2 · the domain behind the journal card ("Eintrag 06 von 12") and the closing ritual ("Heute abschließen"), against the
 * hand-worked 12-trade journal of `ask.fixtures.ts`: entries / index / paging, the process items of a day, the week of dots, the stored
 * closings. The rule of the ritual is tested as a rule: only PROCESS decides – never a profit, a loss or a number of trades.
 */
import { describe, expect, it } from "vitest";
import { DAY_CLOSES_MAX, dayClosesOf, withDayClosed } from "@/domain/coach/prefs";
import { dayCloseItems, dayCloseReady, openItemsText, prepare, weekDots, weekDotsText, weekKeys, type Prepared } from "@/domain/growth";
import { entryCurve, entryList, entryView, keyStep, pad2, stepIndex, swipeStep } from "@/domain/reports/entries";
import type { DayNotes, Settings } from "@/domain/types";
import { ASK_SETTINGS, askTrades, askWorld, NOW } from "./ask.fixtures";

const { enriched, data } = askWorld();
const list = entryList(enriched);

function world(opts: { trades?: ReturnType<typeof askTrades>; days?: DayNotes; now?: number } = {}): Prepared {
  const w = askWorld(ASK_SETTINGS, opts.trades ?? askTrades());
  return prepare({ list: w.enriched, events: w.data.events, days: opts.days ?? {}, settings: ASK_SETTINGS, now: opts.now ?? NOW });
}

describe("Einträge: die echte Liste, der echte Index", () => {
  it("is the closed trades of the period, oldest first: T0 … T11", () => {
    expect(list.map((t) => t.id)).toEqual(["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11"]);
    // an open trade is no entry
    const open = { ...enriched[1]!, id: "OPEN", result: "open" as const };
    expect(entryList([...enriched, open]).map((t) => t.id)).not.toContain("OPEN");
  });

  it("„Eintrag n von m“ comes from the list: n = position, m = length", () => {
    const e = entryView(list, 1, ASK_SETTINGS)!;
    expect([e.n, e.of, pad2(e.n), pad2(e.of)]).toEqual([2, 12, "02", "12"]);
    expect(entryView(list, 11, ASK_SETTINGS)!.n).toBe(12);
    expect(entryView(list, 12, ASK_SETTINGS)).toBeNull();
    expect(entryView([], 0, ASK_SETTINGS)).toBeNull();
  });

  it("T1 as the card shows it: setup name, R, net, plan numbers, process facts – all from the trade", () => {
    const e = entryView(list, 1, ASK_SETTINGS)!;
    expect(e).toMatchObject({ id: "T1", pair: "BTC/USDT", side: "long", when: "Mo, 04.05.2026 · 10:00", setups: ["Breakout"], tags: [], r: 2, net: 200, tone: "win", excerpt: "Plan" });
    expect(e.plan).toEqual({ entry: 100, stop: 99, target: null, exit: null });
    expect(e.process).toEqual({ hasStop: true, checklist: { checked: 2, total: 2 }, followedPlan: null, reviewed: true });
  });

  it("a loss stays a loss: T7 is red-toned, has no R without a stop and says so – T3 is a plain −1,5 R", () => {
    const t7 = entryView(list, 7, ASK_SETTINGS)!;
    expect(t7).toMatchObject({ id: "T7", net: -300, r: null, tone: "loss" });
    expect(t7.process.hasStop).toBe(false);
    expect(t7.plan.stop).toBeNull();
    const t3 = entryView(list, 3, ASK_SETTINGS)!;
    expect([t3.r, t3.tone]).toEqual([-1.5, "loss"]);
    expect(entryView(list, 0, ASK_SETTINGS)!.r).toBe(-2.5);
  });

  it("chips are the real setups and tags; an unknown setup id is dropped, a trade without any stays empty", () => {
    expect(entryView(list, 4, ASK_SETTINGS)!).toMatchObject({ setups: ["Fade"], tags: ["review"] });
    const ghost = [{ ...enriched[1]!, setups: ["gone", "s_bo"], tags: [" ", "x"] }];
    expect(entryView(ghost, 0, ASK_SETTINGS)).toMatchObject({ setups: ["Breakout"], tags: ["x"] });
    const bare = [{ ...enriched[1]!, setups: [], tags: undefined }];
    expect(entryView(bare, 0, ASK_SETTINGS)).toMatchObject({ setups: [], tags: [] });
  });

  it("flat and unknown results are grey – no colour is ever invented", () => {
    expect(entryView([{ ...enriched[1]!, pnl: 0 }], 0, ASK_SETTINGS)!.tone).toBe("mute");
    expect(entryView([{ ...enriched[1]!, pnl: null }], 0, ASK_SETTINGS)!.tone).toBe("mute");
  });

  it("the curve behind the card is the real cumulative net (one point per entry, from 0)", () => {
    expect(entryCurve(list)).toEqual([0, -500, -300, -400, -550, -630, -510, -570, -870, -820, -720, -760, -360]);
  });

  it("paging stops at both ends (no wrap): „Eintrag 12 von 12“ is the end", () => {
    expect(stepIndex(0, -1, 12)).toBe(0);
    expect(stepIndex(11, 1, 12)).toBe(11);
    expect(stepIndex(5, 1, 12)).toBe(6);
    expect(stepIndex(5, -1, 12)).toBe(4);
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(keyStep("ArrowRight", 3, 12)).toBe(4);
    expect(keyStep("ArrowLeft", 0, 12)).toBe(0);
    expect(keyStep("Home", 7, 12)).toBe(0);
    expect(keyStep("End", 7, 12)).toBe(11);
    expect(keyStep("a", 7, 12)).toBeNull();
    expect(keyStep("Enter", 7, 12)).toBeNull();
  });

  it("a swipe left is the next entry, right the previous; a tap, a short move or a scroll is nothing", () => {
    expect(swipeStep(-80, 4)).toBe(1);
    expect(swipeStep(90, -6)).toBe(-1);
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(0, 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0); // mostly vertical = the page scrolls
  });
});

describe("Heute abschließen: nur Prozess zählt", () => {
  it("2026-05-05 (T2: checklist 1/2, no review): both required items open → not ready", () => {
    const items = dayCloseItems(world(), "2026-05-05");
    expect(items.map((i) => [i.id, i.state])).toEqual([["checklist", "open"], ["review", "open"], ["reflection", "open"]]);
    expect(items[0]!.detail).toBe("0 von 1 Trade vollständig.");
    expect(items[1]!.detail).toBe("0 von 1 Trade mit Review.");
    expect(dayCloseReady(items)).toBe(false);
    expect(openItemsText(items)).toBe("Noch offen: Checkliste, Review.");
  });

  it("2026-05-04 (T1: checklist 2/2, review): ready – the note is optional on a day with trades", () => {
    const items = dayCloseItems(world(), "2026-05-04");
    expect(items.map((i) => i.state)).toEqual(["done", "done", "open"]);
    expect(dayCloseReady(items)).toBe(true);
    expect(openItemsText(items)).toBe("");
  });

  it("a trade without a checklist makes that item n/a, not open (T4 Fade: reviewed by its tag)", () => {
    const items = dayCloseItems(world(), "2026-05-12");
    expect(items.map((i) => i.state)).toEqual(["na", "done", "open"]);
    expect(dayCloseReady(items)).toBe(true);
    // T5 Fade (13.05.): no checklist, no review → the review is what is open
    const t5 = dayCloseItems(world(), "2026-05-13");
    expect(t5.map((i) => i.state)).toEqual(["na", "open", "open"]);
    expect(dayCloseReady(t5)).toBe(false);
  });

  it("a day without trades counts only through its text or check-in – an empty day earns nothing, a written one does", () => {
    const empty = dayCloseItems(world(), "2026-05-10");
    expect(empty.map((i) => i.state)).toEqual(["na", "na", "open"]);
    expect(dayCloseReady(empty)).toBe(false);
    const days: DayNotes = { "2026-05-10": { note: "Pause, Wochenende durchgesehen", updatedAt: "2026-05-10T10:00:00Z" } };
    const written = dayCloseItems(world({ days }), "2026-05-10");
    expect(written.map((i) => i.state)).toEqual(["na", "na", "done"]);
    expect(dayCloseReady(written)).toBe(true);
    // a check-in (mood) is as good as text
    const mood: DayNotes = { "2026-05-10": { note: "", mood: 4, updatedAt: "2026-05-10T10:00:00Z" } };
    expect(dayCloseReady(dayCloseItems(world({ days: mood }), "2026-05-10"))).toBe(true);
  });

  it("the P&L never matters: the same process with a huge win or a huge loss gives the same items and the same verdict", () => {
    const base = dayCloseItems(world(), "2026-05-04").map((i) => [i.id, i.state]);
    for (const pnl of [-9_000, 0, 9_000, 123_456]) {
      const trades = askTrades().map((t) => (t.id === "T1" ? { ...t, pnlManual: pnl } : t));
      const items = dayCloseItems(world({ trades }), "2026-05-04");
      expect(items.map((i) => [i.id, i.state]), String(pnl)).toEqual(base);
      expect(dayCloseReady(items), String(pnl)).toBe(true);
    }
  });

  it("the number of trades never matters: one trade or five – ready exactly when every one has its checklist and review", () => {
    const mk = (id: string, ticks: boolean, note: string) => ({ ...askTrades()[1]!, id, date: "2026-06-04T10:00", exitDate: "2026-06-04T10:30", checks: (ticks ? { "s_bo:c1": true, "s_bo:c2": true } : {}) as Record<string, boolean>, notes: note });
    const one = dayCloseItems(world({ trades: [mk("a", true, "ok")] }), "2026-06-04");
    expect(dayCloseReady(one)).toBe(true);
    const five = dayCloseItems(world({ trades: ["a", "b", "c", "d", "e"].map((id) => mk(id, true, "ok")) }), "2026-06-04");
    expect(dayCloseReady(five)).toBe(true);
    const fiveOneOpen = dayCloseItems(world({ trades: ["a", "b", "c", "d", "e"].map((id) => mk(id, id !== "c", id === "e" ? "" : "ok")) }), "2026-06-04");
    expect(dayCloseReady(fiveOneOpen)).toBe(false);
    expect(fiveOneOpen[0]!.detail).toBe("4 von 5 Trades vollständig.");
    expect(fiveOneOpen[1]!.detail).toBe("4 von 5 Trades mit Review.");
  });

  it("the items speak only of process: no money word, no verdict word", () => {
    const text = JSON.stringify(dayCloseItems(world(), "2026-05-05")) + openItemsText(dayCloseItems(world(), "2026-05-05"));
    expect(text).not.toMatch(/USDT|€|\$|Gewinn|Verlust|Netto|Profit|Rekord|Serie|verpass|Win/i);
  });
});

describe("die Woche: n von 7 Tagen, nichts wird bestraft", () => {
  const week = (monday: string, now = NOW) => weekDots(world({ now }), weekKeys(monday));

  it("a finished week (4.–10.5.): Monday has its review (T1), the other days are neutral – „1 von 7 Tagen mit Rückblick“", () => {
    const w = week("2026-05-04");
    expect(w.dots.map((d) => d.short)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    expect(w.dots.map((d) => d.state)).toEqual(["done", "rest", "rest", "rest", "rest", "rest", "rest"]);
    expect(w.done).toBe(1);
    expect(weekDotsText(w.done, false)).toBe("1 von 7 Tagen mit Rückblick");
  });

  it("the running week (8.–14.6., today Wed 10.6.): Mon done, today open (never a miss), the rest still ahead", () => {
    const w = week("2026-06-08");
    expect(w.dots.map((d) => d.state)).toEqual(["done", "rest", "today", "later", "later", "later", "later"]);
    expect(weekDotsText(w.done, true)).toBe("1 Tag mit Rückblick bisher");
    expect(weekDotsText(0, true)).toBe("Noch kein Tag mit Rückblick in dieser Woche");
  });

  it("no wording of loss anywhere: no „verpasst“, no „Serie“, no „in Gefahr“", () => {
    const all = week("2026-05-04").dots.map((d) => d.label).join(" ") + weekDotsText(3, false) + weekDotsText(3, true);
    expect(all).not.toMatch(/verpass|Serie|Streak|Gefahr|Lücke|fehlt|nur noch/i);
  });

  it("a day closes the week's count by its PROCESS (the shared streak predicate), not by a click: closing alone adds no dot", () => {
    const before = week("2026-05-04").done;
    // T2 (Tue 5.5.) not reviewed: the day stays „rest“ even if the trader pressed „abschließen“ – the closing flag is not read here
    expect(before).toBe(1);
    const reviewedTue = askTrades().map((t) => (t.id === "T2" ? { ...t, notes: "geprüft" } : t));
    const w = weekDots(world({ trades: reviewedTue }), weekKeys("2026-05-04"));
    expect(w.dots[1]!.state).toBe("done");
    expect(w.done).toBe(2);
  });
});

describe("gespeicherte Abschlüsse: settings.coach.dayCloses", () => {
  const base = { coach: { ai: { notes: true }, reviews: { "2026-W45": { closed: true, at: "x", lesson: "y" } } }, other: 1 } as unknown as Settings;
  const T = new Date(2026, 10, 8, 18, 20).getTime();

  it("closing keeps every other key; the stored day carries only closed / at / ready", () => {
    const s = withDayClosed(base, "2026-11-08", { closed: true, ready: true }, T);
    expect(dayClosesOf(s)["2026-11-08"]).toEqual({ closed: true, at: new Date(T).toISOString(), ready: true });
    expect((s as unknown as { coach: { ai: unknown; reviews: unknown } }).coach).toMatchObject({ ai: { notes: true }, reviews: { "2026-W45": { closed: true } } });
    expect((s as unknown as { other: number }).other).toBe(1);
  });

  it("closing with something open is recorded as not ready – the flag is the truth of that moment", () => {
    expect(dayClosesOf(withDayClosed(base, "2026-11-08", { closed: true, ready: false }, T))["2026-11-08"]!.ready).toBe(false);
    expect(dayClosesOf(withDayClosed(base, "2026-11-08", { closed: true }, T))["2026-11-08"]!.ready).toBe(false);
  });

  it("re-opening keeps the key (never deletes) and the time; an invalid key changes nothing", () => {
    const closed = withDayClosed(base, "2026-11-08", { closed: true, ready: true }, T);
    const again = withDayClosed(closed, "2026-11-08", { closed: false }, T + 5000);
    expect(dayClosesOf(again)["2026-11-08"]).toEqual({ closed: false, at: new Date(T).toISOString(), ready: true });
    expect(withDayClosed(base, "2026-W45", { closed: true }, T)).toBe(base);
    expect(withDayClosed(base, "heute", { closed: true }, T)).toBe(base);
  });

  it("keeps the newest 120 days; garbage in the stored value reads as nothing", () => {
    let s = base;
    for (let i = 0; i < DAY_CLOSES_MAX + 10; i++) s = withDayClosed(s, new Date(2026, 0, 1 + i).toISOString().slice(0, 10), { closed: true }, T);
    const keys = Object.keys(dayClosesOf(s));
    expect(keys).toHaveLength(DAY_CLOSES_MAX);
    expect(keys).not.toContain("2026-01-01");
    const junk = { coach: { dayCloses: { "2026-11-08": "x", nope: { closed: true }, "2026-11-09": { closed: "yes", at: 5, ready: 1 } } } } as unknown as Settings;
    expect(dayClosesOf(junk)).toEqual({ "2026-11-08": { closed: false, at: "", ready: false }, "2026-11-09": { closed: false, at: "", ready: false } });
    expect(dayClosesOf({})).toEqual({});
  });
});

describe("die Fixture bleibt, was die Kommentare sagen", () => {
  it("12 trades, the journal behind the card is the journal behind the questions", () => {
    expect(data.closed).toHaveLength(12);
    expect(list).toHaveLength(12);
  });
});
