/**
 * F43 – Ereigniskalender: zones, the rule-based appointments (Funding grid, Deribit expiry, NYSE hours and holidays), the
 * public Fed list, the trader's own entries, the calendar, the phase analysis, the Labor filter mask and the briefing.
 * Every expected value is HAND-COMPUTED (the comment says how) or comes from a source with a fetch date:
 *   – `fixtures/deribit-btc-futures-2026-10-25.json`: instrument list of the public Deribit API, fetched 25.10.2026,
 *   – `fixtures/nyse-holidays-2025-2027.json`: the NYSE table "Holidays & Trading Hours", fetched 25.10.2026,
 *   – `src/domain/events/data/fomc.json`: the Fed's FOMC calendar, fetched 25.10.2026.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_OWN,
  FOMC_MEETINGS,
  FOMC_SOURCE,
  FOMC_YEARS,
  PHASE_DEFS,
  addDays,
  analyzePhases,
  blockedWindows,
  buildBriefing,
  briefingText,
  dayKeyIn,
  easterSunday,
  eventMask,
  eventsBetween,
  expiryAt,
  expiryEvents,
  formatClock,
  fomcCovered,
  fomcEvents,
  fundingEvents,
  groupByDay,
  isFomcDecisionDay,
  isSoon,
  isUsTradingDay,
  lastFridayOf,
  monthGrid,
  nextEvents,
  normalizeOwnEvent,
  offsetLabel,
  ownEventsOf,
  phaseMembership,
  untilText,
  upsertOwn,
  usEarlyCloseReason,
  usHolidayOn,
  usHolidays,
  usSession,
  wallStringToUtc,
  wallToUtc,
  weekendEvents,
  withOwnEvents,
  type OwnEvent,
  type PhaseTrade,
} from "@/domain/events";
import { PASS, FAIL } from "@/domain/lab/filters/masks";
import { merge3 } from "@/store/merge3";

const Z = (iso: string): number => Date.parse(iso);

describe("zones – wall clock and instant", () => {
  it("reads a Berlin wall time in summer (UTC+2) and winter (UTC+1)", () => {
    // 14:00 CEST = 12:00 UTC; 14:00 CET = 13:00 UTC
    expect(wallToUtc({ y: 2026, m: 7, d: 15, h: 14, min: 0 }, "Europe/Berlin")).toBe(Z("2026-07-15T12:00:00Z"));
    expect(wallToUtc({ y: 2026, m: 1, d: 15, h: 14, min: 0 }, "Europe/Berlin")).toBe(Z("2026-01-15T13:00:00Z"));
    expect(offsetLabel(Z("2026-07-15T12:00:00Z"), "Europe/Berlin")).toBe("UTC+2");
    expect(offsetLabel(Z("2026-01-15T12:00:00Z"), "America/New_York")).toBe("UTC−5");
    expect(offsetLabel(Z("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe("UTC+5:30");
  });

  it("handles the clock changes: a doubled hour is the earlier instant, a skipped hour is read with the old offset", () => {
    // Berlin 2026-10-25: 03:00 CEST -> 02:00 CET, so 02:30 happens twice: 02:30 CEST = 00:30 UTC (taken), 02:30 CET = 01:30 UTC
    expect(wallToUtc({ y: 2026, m: 10, d: 25, h: 2, min: 30 }, "Europe/Berlin")).toBe(Z("2026-10-25T00:30:00Z"));
    // Berlin 2026-03-29: 02:00 CET -> 03:00 CEST, 02:30 does not exist: read with +1 h = 01:30 UTC = 03:30 CEST
    expect(wallToUtc({ y: 2026, m: 3, d: 29, h: 2, min: 30 }, "Europe/Berlin")).toBe(Z("2026-03-29T01:30:00Z"));
    expect(formatClock(Z("2026-03-29T01:30:00Z"), "Europe/Berlin")).toBe("03:30");
  });

  it("converts the journal's wall clock string and gives NaN for garbage", () => {
    expect(wallStringToUtc("2026-10-12T09:30", "UTC")).toBe(Z("2026-10-12T09:30:00Z"));
    expect(wallStringToUtc("2026-10-12T09:30:15", "America/New_York")).toBe(Z("2026-10-12T13:30:15Z"));
    expect(Number.isNaN(wallStringToUtc("gestern", "UTC"))).toBe(true);
    expect(Number.isNaN(wallStringToUtc("2026-13-40T99:00", "UTC"))).toBe(true);
    expect(dayKeyIn(Z("2026-10-12T23:30:00Z"), "Europe/Berlin")).toBe("2026-10-13");
  });

  it("does date arithmetic on keys across the year end", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("Funding grid", () => {
  it("has three settlements a day at 00:00, 08:00 and 16:00 UTC", () => {
    const list = fundingEvents(Z("2026-10-26T00:00:00Z"), Z("2026-10-27T00:00:00Z"));
    expect(list.map((e) => new Date(e.at).toISOString().slice(11, 16))).toEqual(["00:00", "08:00", "16:00"]);
    // 30 days = 90 settlements
    expect(fundingEvents(Z("2026-11-01T00:00:00Z"), Z("2026-12-01T00:00:00Z"))).toHaveLength(90);
  });

  it("starts after `from` and excludes `to`, and names its source and check date", () => {
    const list = fundingEvents(Z("2026-10-25T22:52:00Z"), Z("2026-10-26T08:00:00Z"));
    expect(list.map((e) => e.at)).toEqual([Z("2026-10-26T00:00:00Z")]);
    expect(list[0]!.source.checkedAt).toBe("2026-10-25");
    expect(list[0]!.source.rule).toMatch(/00:00, 08:00 und 16:00 UTC/);
  });
});

describe("Deribit expiry – last Friday 08:00 UTC", () => {
  it("finds the last Friday of a month (hand-computed, also at the year end and in a leap year)", () => {
    // 1 Jan 2026 is a Thursday: 25 Dec 2026 is day 359, 358 mod 7 = 1 -> Friday
    expect(lastFridayOf(2026, 12)).toBe(25);
    // 1 Jan 2027 is a Friday: 31 Dec 2027 is day 365, 364 mod 7 = 0 -> Friday; 29 Jan 2027 = Friday + 28 d
    expect(lastFridayOf(2027, 12)).toBe(31);
    expect(lastFridayOf(2027, 1)).toBe(29);
    // Feb 2026 starts on a Sunday: 27 Feb = Sunday + 26 d, 26 mod 7 = 5 -> Friday
    expect(lastFridayOf(2026, 2)).toBe(27);
    // 29 Feb 2028 is a Tuesday -> the last Friday is 25 Feb
    expect(lastFridayOf(2028, 2)).toBe(25);
  });

  it("gives the quarterly expiry of December 2026 and the monthly one of January 2027 over the turn of the year", () => {
    const list = expiryEvents(Z("2026-12-01T00:00:00Z"), Z("2027-02-01T00:00:00Z"));
    expect(list.map((e) => [new Date(e.at).toISOString(), e.title, e.importance])).toEqual([
      ["2026-12-25T08:00:00.000Z", "Quartalsverfall (Optionen und Futures)", "hoch"],
      ["2027-01-29T08:00:00.000Z", "Monatsverfall (Optionen und Futures)", "mittel"],
    ]);
    // the end is exclusive: a range ending exactly at the expiry does not hold it
    expect(expiryEvents(Z("2026-10-01T00:00:00Z"), Z("2026-10-30T08:00:00Z"))).toHaveLength(0);
    expect(expiryEvents(Z("2026-10-01T00:00:00Z"), Z("2026-10-30T08:00:01Z"))).toHaveLength(1);
  });

  const fixture = JSON.parse(readFileSync("tests/unit/fixtures/deribit-btc-futures-2026-10-25.json", "utf8")) as { instruments: { instrument: string; expiration_timestamp: number; settlement_period: string }[] };

  it("matches every monthly / quarterly future that the Deribit API listed on 25.10.2026", () => {
    const months = fixture.instruments.filter((i) => i.settlement_period === "month");
    expect(months.map((i) => i.instrument)).toEqual(["BTC-30OCT26", "BTC-27NOV26", "BTC-25DEC26", "BTC-26MAR27", "BTC-25JUN27", "BTC-24SEP27"]);
    const ours = new Set(expiryEvents(Z("2026-10-01T00:00:00Z"), Z("2027-12-01T00:00:00Z")).map((e) => e.at));
    for (const i of months) expect(ours.has(i.expiration_timestamp), i.instrument).toBe(true);
    // and no Friday that Deribit lists as a weekly is claimed as a monthly one
    for (const i of fixture.instruments.filter((x) => x.settlement_period === "week")) expect(ours.has(i.expiration_timestamp), i.instrument).toBe(false);
    expect(expiryAt(2026, 10)).toBe(Z("2026-10-30T08:00:00Z"));
  });
});

describe("US market – NYSE hours and holidays", () => {
  const nyse = JSON.parse(readFileSync("tests/unit/fixtures/nyse-holidays-2025-2027.json", "utf8")) as { holidays: string[]; earlyCloses: string[] };

  it("computes Easter Sunday (Gregorian)", () => {
    expect(easterSunday(2024)).toEqual({ m: 3, d: 31 });
    expect(easterSunday(2025)).toEqual({ m: 4, d: 20 });
    expect(easterSunday(2026)).toEqual({ m: 4, d: 5 });
    expect(easterSunday(2027)).toEqual({ m: 3, d: 28 });
  });

  it("reproduces the NYSE table of 2025, 2026 and 2027 exactly (no holiday missing, none too many)", () => {
    for (const y of [2025, 2026, 2027]) {
      const expected = nyse.holidays.filter((k) => k.startsWith(`${y}-`));
      expect(usHolidays(y).map((h) => h.key), String(y)).toEqual(expected);
    }
  });

  it("observes holidays on a weekend the NYSE way (Saturday -> Friday, Sunday -> Monday, New Year's Day on a Saturday: nothing)", () => {
    // 4 July 2026 is a Saturday -> Friday 3 July; 4 July 2027 is a Sunday -> Monday 5 July
    expect(usHolidayOn("2026-07-03")?.observedFor).toBe("04.07.");
    expect(usHolidayOn("2027-07-05")?.name).toBe("Independence Day");
    // 25 Dec 2027 is a Saturday -> Friday 24 Dec
    expect(usHolidayOn("2027-12-24")?.name).toBe("Weihnachten");
    // 1 Jan 2028 is a Saturday: no day off on Friday 31 Dec 2027
    expect(usHolidayOn("2027-12-31")).toBeNull();
    expect(isUsTradingDay("2027-12-31")).toBe(true);
    // Juneteenth is a holiday since 2022 only
    expect(usHolidayOn("2021-06-18")).toBeNull();
    expect(usHolidayOn("2022-06-20")?.name).toBe("Juneteenth");
  });

  it("finds exactly the early closes the NYSE lists for 2025 – 2027", () => {
    const found: string[] = [];
    for (let key = "2025-01-01"; key < "2028-01-01"; key = addDays(key, 1)) if (usEarlyCloseReason(key)) found.push(key);
    expect(found).toEqual(nyse.earlyCloses);
  });

  it("opens at 09:30 New York time, which is 14:30 UTC in winter and 13:30 UTC in summer – also in the weeks the US and Europe switch apart", () => {
    // Friday 6 March 2026 (EST, UTC-5): 14:30Z; the US switched on Sunday 8 March: Monday 9 March (EDT, UTC-4): 13:30Z
    expect(usSession("2026-03-06")!.open).toBe(Z("2026-03-06T14:30:00Z"));
    expect(usSession("2026-03-09")!.open).toBe(Z("2026-03-09T13:30:00Z"));
    expect(usSession("2026-03-09")!.close).toBe(Z("2026-03-09T20:00:00Z"));
    // Europe switches on 29 March: in between Berlin sees the US open at 14:30 (CET, 13:30Z), afterwards at 15:30 (CEST)
    expect(formatClock(usSession("2026-03-09")!.open, "Europe/Berlin")).toBe("14:30");
    expect(formatClock(usSession("2026-04-01")!.open, "Europe/Berlin")).toBe("15:30");
    // autumn: the US switch back is Sunday 1 November 2026 -> Monday 2 November opens at 14:30Z
    expect(usSession("2026-10-30")!.open).toBe(Z("2026-10-30T13:30:00Z"));
    expect(usSession("2026-11-02")!.open).toBe(Z("2026-11-02T14:30:00Z"));
  });

  it("closes at 13:00 on an early-close day and has no session on weekends and holidays", () => {
    // Friday 27 Nov 2026 (EST): 13:00 = 18:00Z
    const s = usSession("2026-11-27")!;
    expect(s.early).toBe(true);
    expect(s.close).toBe(Z("2026-11-27T18:00:00Z"));
    expect(s.earlyReason).toBe("Tag nach Thanksgiving");
    expect(usSession("2026-11-26")).toBeNull(); // Thanksgiving
    expect(usSession("2026-10-31")).toBeNull(); // Saturday
  });
});

describe("FOMC – the Fed's public list", () => {
  it("carries source, fetch date and no clock time", () => {
    expect(FOMC_SOURCE.url).toBe("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
    expect(FOMC_SOURCE.checkedAt).toBe("2026-10-25");
    expect(FOMC_MEETINGS).toHaveLength(56); // 7 years (2021 – 2027) × 8 meetings
    expect(FOMC_YEARS).toEqual({ from: 2021, to: 2027 });
  });

  it("lists the decision days of 2026 as the Fed's page does (second day of each meeting)", () => {
    const days = FOMC_MEETINGS.filter((m) => m.to.startsWith("2026-")).map((m) => m.to);
    expect(days).toEqual(["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]);
    // meetings over a month end: 30 Apr – 1 May 2024, 31 Jan – 1 Feb 2023
    expect(FOMC_MEETINGS.find((m) => m.from === "2024-04-30")!.to).toBe("2024-05-01");
    expect(FOMC_MEETINGS.find((m) => m.from === "2023-01-31")!.to).toBe("2023-02-01");
  });

  it("agrees with a second, independent source: the decision days TradingView's economic calendar lists for 2026 (fetched 25.10.2026)", () => {
    const tv = JSON.parse(readFileSync("tests/unit/fixtures/tv-fed-rate-decisions-2026.json", "utf8")) as { decisions: { date: string; at: string }[] };
    expect(tv.decisions).toHaveLength(7);
    for (const d of tv.decisions) {
      expect(isFomcDecisionDay(d.date), d.date).toBe(true);
      // the instant TradingView gives lies on that New York day (and no time of it is taken over)
      expect(dayKeyIn(Z(d.at), "America/New_York"), d.date).toBe(d.date);
    }
    // and our list has no other decision day in the window the connector covers (Jan – Oct)
    const ours = FOMC_MEETINGS.filter((m) => m.to >= "2026-01-01" && m.to <= "2026-10-30").map((m) => m.to);
    expect(ours).toEqual(tv.decisions.map((d) => d.date));
  });

  it("makes an all-day entry on the New York day: 04:00Z in summer time, 05:00Z in winter time", () => {
    const [oct] = fomcEvents(Z("2026-10-25T00:00:00Z"), Z("2026-11-01T00:00:00Z"));
    expect(oct!.allDay).toBe(true);
    expect(oct!.at).toBe(Z("2026-10-28T04:00:00Z")); // EDT
    expect(oct!.end).toBe(Z("2026-10-29T04:00:00Z"));
    const [dec] = fomcEvents(Z("2026-12-01T00:00:00Z"), Z("2026-12-31T00:00:00Z"));
    expect(dec!.at).toBe(Z("2026-12-09T05:00:00Z")); // EST
    expect(dec!.title).toBe("FOMC-Entscheidung (mit Projektionen)"); // 8-9* has the projections
    expect(dec!.detail).toMatch(/Uhrzeit nicht in der Quelle/);
  });

  it("says 'unknown' outside the covered years instead of 'no meeting'", () => {
    expect(isFomcDecisionDay("2026-10-28")).toBe(true);
    expect(isFomcDecisionDay("2026-10-27")).toBe(false);
    expect(isFomcDecisionDay("2028-03-15")).toBeNull();
    expect(fomcCovered("2020-03-15")).toBe(false);
    expect(fomcEvents(Z("2028-01-01T00:00:00Z"), Z("2028-12-31T00:00:00Z"))).toHaveLength(0);
  });
});

describe("own appointments (settings.events)", () => {
  it("reads strictly: an unreadable entry is kept aside, never repaired", () => {
    const raw = { v: 1, future: "x", items: [{ id: "a", title: "  CPI USA ", at: Z("2026-11-12T13:30:00Z"), importance: "hoch", note: "" }, { id: "b", title: "", at: 1 }, "junk", { id: "a", title: "Doppelt", at: 5 }] };
    const parsed = ownEventsOf(raw);
    expect(parsed.items).toEqual([{ id: "a", title: "CPI USA", at: Z("2026-11-12T13:30:00Z"), importance: "hoch", note: "" }]);
    expect(parsed.rejected).toHaveLength(2);
    expect(ownEventsOf(undefined)).toBe(EMPTY_OWN);
    expect(normalizeOwnEvent({ id: "c", title: "X", at: 10, importance: "weird" })!.importance).toBe("mittel");
  });

  it("writes back unknown keys and rejected entries, and returns the same object when nothing changed", () => {
    const raw = { v: 1, future: "x", items: [{ id: "a", title: "CPI", at: 5, importance: "hoch", note: "" }, "junk"] };
    const parsed = ownEventsOf(raw);
    expect(withOwnEvents(raw, parsed.items)).toBe(raw);
    const next = withOwnEvents(raw, upsertOwn(parsed.items, { id: "z", title: "Unlock", at: 9, importance: "niedrig", note: "" }));
    expect(next.future).toBe("x");
    expect((next.items as unknown[]).includes("junk")).toBe(true);
    expect((next.items as unknown[]).length).toBe(3);
  });

  it("merges two devices per appointment (the three-way merge of the settings keeps an entry each side added)", () => {
    const e = (id: string, title: string): OwnEvent => ({ id, title, at: 1000, importance: "mittel", note: "" });
    const base = { v: 1, items: [e("a", "CPI")] };
    const mine = withOwnEvents(base, [e("a", "CPI"), e("b", "Token-Unlock")]);
    const theirs = withOwnEvents(base, [e("a", "CPI"), e("c", "Gerichtstermin")]);
    const merged = merge3(base, mine, theirs) as { v: number; items: { id: string }[] };
    expect(merged.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
    // a delete on one side drops the entry only when the other side left it untouched
    const deleted = merge3(base, withOwnEvents(base, []), base) as { items: unknown[] };
    expect(deleted.items).toEqual([]);
  });

  it("puts own entries into the calendar with the source 'Eigener Eintrag'", () => {
    const own = [{ id: "a", title: "CPI USA", at: Z("2026-11-12T13:30:00Z"), importance: "hoch" as const, note: "Quelle: BLS" }];
    const list = eventsBetween({ from: Z("2026-11-12T00:00:00Z"), to: Z("2026-11-13T00:00:00Z"), kinds: ["own"], own });
    expect(list).toHaveLength(1);
    expect(list[0]!.source.label).toBe("Eigener Eintrag");
    expect(list[0]!.detail).toBe("Quelle: BLS");
  });
});

describe("the calendar", () => {
  it("lists a Friday with expiry, US session and funding in time order", () => {
    // Friday 30 Oct 2026 (US still on summer time until 1 Nov): expiry 08:00Z, open 13:30Z, close 20:00Z, funding 00/08/16Z
    const list = eventsBetween({ from: Z("2026-10-30T00:00:00Z"), to: Z("2026-10-31T00:00:00Z") });
    expect(list.map((e) => `${new Date(e.at).toISOString().slice(11, 16)} ${e.kind}`)).toEqual(["00:00 funding", "08:00 expiry", "08:00 funding", "13:30 usOpen", "16:00 funding", "20:00 usClose"]);
  });

  it("filters by kind and finds the next appointments after a moment", () => {
    const now = Z("2026-10-25T22:52:00Z"); // Sunday
    const next = nextEvents(now, 3, { kinds: ["expiry", "fomc", "usOpen"] });
    // Monday 26 Oct: US open 13:30Z; Wednesday 28 Oct: FOMC decision (all day, from 04:00Z); Wednesday the US opens again
    expect(next.map((e) => e.id)).toEqual(["usOpen:2026-10-26", "usOpen:2026-10-27", "fomc:2026-10-28"]);
    expect(nextEvents(now, 1)[0]!.kind).toBe("weekend"); // the running weekend comes first when nothing is filtered
  });

  it("marks 'gleich' (within an hour, not yet started) and counts down in words", () => {
    const at = Z("2026-10-26T08:00:00Z");
    expect(isSoon({ at }, at - 59 * 60_000)).toBe(true);
    expect(isSoon({ at }, at - 61 * 60_000)).toBe(false);
    expect(isSoon({ at }, at + 1)).toBe(false);
    expect(isSoon({ at, allDay: true }, at - 60_000)).toBe(false);
    expect(untilText(at, at - 35 * 60_000)).toBe("in 35 min");
    expect(untilText(at, at - 134 * 60_000)).toBe("in 2 h 14 min");
    expect(untilText(at, at - 3 * 86_400_000)).toBe("in 3 Tagen");
    expect(untilText(at, at + 5)).toBe("jetzt");
  });

  it("shows a weekend on both of its days and builds the month grid with Monday first", () => {
    const weekend = weekendEvents(Z("2026-10-30T00:00:00Z"), Z("2026-11-03T00:00:00Z"));
    expect(weekend).toHaveLength(1);
    expect(weekend[0]!.at).toBe(Z("2026-10-31T00:00:00Z"));
    expect(groupByDay(weekend, "UTC").map((g) => g.day)).toEqual(["2026-10-31", "2026-11-01"]);
    // Oct 2026: the 1st is a Thursday -> three days of September in front (28 – 30), 31 days -> 5 weeks, the last cell is 1 Nov
    const grid = monthGrid(2026, 10);
    expect(grid).toHaveLength(5);
    expect(grid[0]![0]).toEqual({ key: "2026-09-28", d: 28, inMonth: false });
    expect(grid[4]![6]).toEqual({ key: "2026-11-01", d: 1, inMonth: false });
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });
});

describe("phases – which appointment a trade's entry lies near", () => {
  it("assigns the Funding phases from the 8-hour grid (pre: the 2 h before, post: the 4 h from the settlement)", () => {
    // 06:30Z: 1,5 h before 08:00 -> pre; 01:00Z: 1 h after 00:00 -> post; 05:00Z: 3 h after 00:00? no, 5 h -> neither; 08:00Z exactly: post
    expect(phaseMembership(Z("2026-10-27T06:30:00Z")).fundingPre).toBe(true);
    expect(phaseMembership(Z("2026-10-27T06:30:00Z")).fundingPost).toBe(false);
    expect(phaseMembership(Z("2026-10-27T01:00:00Z")).fundingPost).toBe(true);
    expect(phaseMembership(Z("2026-10-27T05:00:00Z"))).toMatchObject({ fundingPre: false, fundingPost: false });
    expect(phaseMembership(Z("2026-10-27T08:00:00Z"))).toMatchObject({ fundingPre: false, fundingPost: true });
    expect(phaseMembership(Z("2026-10-27T23:59:00Z")).fundingPre).toBe(true);
  });

  it("assigns the expiry day, FOMC day, US-open hour and weekend – and 'unknown' where the Fed list ends", () => {
    expect(phaseMembership(Z("2026-10-30T10:00:00Z")).expiryDay).toBe(true);
    expect(phaseMembership(Z("2026-10-29T10:00:00Z")).expiryDay).toBe(false);
    // 28 Oct 2026 15:00Z is the New York day 28 Oct: FOMC decision day; 04:00Z that day is still 27 Oct 24:00? no: 04:00Z = 00:00 EDT, so the day has begun
    expect(phaseMembership(Z("2026-10-28T15:00:00Z")).fomcDay).toBe(true);
    expect(phaseMembership(Z("2026-10-28T03:59:00Z")).fomcDay).toBe(false);
    expect(phaseMembership(Z("2028-01-05T15:00:00Z")).fomcDay).toBeNull();
    // US open: Tuesday 27 Oct 2026, 09:30 – 10:30 EDT = 13:30Z – 14:30Z
    expect(phaseMembership(Z("2026-10-27T13:30:00Z")).usOpenHour).toBe(true);
    expect(phaseMembership(Z("2026-10-27T14:29:00Z")).usOpenHour).toBe(true);
    expect(phaseMembership(Z("2026-10-27T14:30:00Z")).usOpenHour).toBe(false);
    // Thanksgiving: the market is closed, no open hour
    expect(phaseMembership(Z("2026-11-26T14:30:00Z")).usOpenHour).toBe(false);
    expect(phaseMembership(Z("2026-10-31T12:00:00Z")).weekend).toBe(true);
    expect(phaseMembership(Z("2026-11-02T00:00:00Z")).weekend).toBe(false);
  });

  const mk = (id: string, at: string, r: number | null, result: PhaseTrade["result"]): PhaseTrade => ({ id, at: Z(at), r, result });

  it("compares inside and outside with n, hit rate and Ø R (hand-computed) and calls a clear difference 'klar'", () => {
    const inside: PhaseTrade[] = [];
    const outside: PhaseTrade[] = [];
    // 30 entries 06:00 – 08:00 UTC (pre-Funding) on weekdays: 15 × +2 R, 15 × +1 R -> all wins, Ø R 1,5
    // 30 entries at 13:00 UTC (5 h after the settlement: no phase): 15 × 0 R (break-even), 15 × −1 R (loss) -> Ø R −0,5
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-26", "2026-10-27"];
    for (let i = 0; i < 30; i++) {
      const day = days[i % days.length]!;
      inside.push(mk(`i${i}`, `${day}T0${6 + (i % 2)}:${i % 2 ? "15" : "05"}:00Z`, i % 2 ? 2 : 1, "win"));
      outside.push(mk(`o${i}`, `${day}T13:00:00Z`, i % 2 ? 0 : -1, i % 2 ? "be" : "loss"));
    }
    const rep = analyzePhases([...inside, ...outside]);
    const row = rep.rows.find((r) => r.def.id === "fundingPre")!;
    expect(row.inside).toMatchObject({ n: 30, wins: 30, nR: 30, hit: 1 });
    expect(row.inside.avgR).toBeCloseTo(1.5, 12); // (15 × 2 + 15 × 1) / 30
    expect(row.outside).toMatchObject({ n: 30, wins: 0, nR: 30 });
    expect(row.outside.avgR).toBeCloseTo(-0.5, 12); // (15 × 0 + 15 × −1) / 30
    expect(row.dR!.diff).toBeCloseTo(2, 12);
    // Welch: both variances 30 × 0,25 / 29 = 0,2586, se = sqrt(2 × 0,2586 / 30) = 0,1313, t = 15,2
    expect(row.dR!.se).toBeCloseTo(0.1313, 3);
    expect(row.dR!.t).toBeCloseTo(15.23, 1);
    expect(row.verdict).toBe("klar");
    expect(rep.total.n).toBe(60);
    // the other phases hold none of these trades inside
    expect(rep.tests).toBe(1);
    expect(rep.rows.filter((r) => r.inside.n === 0)).toHaveLength(PHASE_DEFS.length - 1);
  });

  it("says 'zu wenig' for a small sample and never invents a difference", () => {
    const trades = [mk("a", "2026-10-27T07:00:00Z", 3, "win"), mk("b", "2026-10-27T07:30:00Z", 2, "win"), mk("c", "2026-10-27T13:00:00Z", -1, "loss"), mk("d", "2026-10-26T13:00:00Z", -1, "loss")];
    const row = analyzePhases(trades).rows.find((r) => r.def.id === "fundingPre")!;
    expect(row.inside.n).toBe(2);
    expect(row.verdict).toBe("wenig");
    // a phase nobody traded in has no p-value at all
    const none = analyzePhases(trades).rows.find((r) => r.def.id === "weekend")!;
    expect(none.inside.n).toBe(0);
    expect(none.verdict).toBe("wenig");
    expect(none.p).toBeNull();
  });

  it("keeps trades the phase cannot judge out of both groups", () => {
    const rep = analyzePhases([mk("a", "2028-01-05T15:00:00Z", 1, "win"), mk("b", "2026-10-28T15:00:00Z", -1, "loss"), mk("c", "2026-10-21T15:00:00Z", 1, "win")]);
    const fomc = rep.rows.find((r) => r.def.id === "fomcDay")!;
    expect(fomc.unknown).toBe(1);
    expect(fomc.inside.n).toBe(1);
    expect(fomc.outside.n).toBe(1);
  });
});

describe("Labor filter – no entries X minutes before / after an appointment", () => {
  const T0 = Z("2026-10-26T00:00:00Z") / 1000; // Monday, 24 hourly bars
  const bars = Array.from({ length: 24 }, (_, i) => ({ t: T0 + i * 3600 }));
  const blockedHours = (kinds: Parameters<typeof eventMask>[3], minutes: number): number[] => {
    const m = eventMask(bars, 3600, minutes, kinds);
    // the entry is the next bar's open: hour (i + 1) of the day
    return [...m.long].map((v, i) => (v === FAIL ? (i + 1) % 24 : -1)).filter((h) => h >= 0);
  };

  it("blocks ±60 minutes around the Funding grid (both ends included)", () => {
    // settlements 00:00, 08:00, 16:00; entry hours on the hour inside [t − 1 h, t + 1 h]: 23, 0, 1 | 7, 8, 9 | 15, 16, 17
    expect(blockedHours(["funding"], 60).sort((a, b) => a - b)).toEqual([0, 1, 7, 8, 9, 15, 16, 17, 23]);
    // ±15 minutes: only the settlement hour itself has an entry on the hour
    expect(blockedHours(["funding"], 15).sort((a, b) => a - b)).toEqual([0, 8, 16]);
  });

  it("blocks around the US open (09:30 EDT = 13:30Z on 26 Oct 2026) and the expiry (30 Oct 08:00Z)", () => {
    // ±60 min: [12:30Z, 14:30Z] -> entries at 13:00 and 14:00
    expect(blockedHours(["usOpen"], 60)).toEqual([13, 14]);
    const w = blockedWindows(Z("2026-10-30T00:00:00Z"), Z("2026-10-31T00:00:00Z"), 30, ["expiry"]);
    expect(w).toEqual([[Z("2026-10-30T07:30:00Z"), Z("2026-10-30T08:30:00Z")]]);
  });

  it("lets everything pass without a chosen kind and never answers 'unknown'", () => {
    const m = eventMask(bars, 3600, 60, []);
    expect([...m.long].every((v) => v === PASS)).toBe(true);
    const all = eventMask(bars, 3600, 60, ["funding", "expiry", "usOpen"]);
    expect([...all.long, ...all.short].every((v) => v === PASS || v === FAIL)).toBe(true);
    expect(blockedWindows(0, 1, 60, [])).toEqual([]);
  });
});

describe("Morgenbriefing – every line with its source, missing data as 'keine Daten'", () => {
  // Wednesday 28 Oct 2026 08:30 Berlin time (CET, the EU switched on 25 Oct) = 07:30Z; the FOMC decision day
  const now = Z("2026-10-28T07:30:00Z");
  const own = [{ id: "cpi", title: "CPI USA", at: Z("2026-10-28T12:30:00Z"), importance: "hoch" as const, note: "" }];
  const base = {
    now,
    tz: "Europe/Berlin",
    own,
    markets: [
      { symbol: "BTCUSDT", change: 0.034, basis: "24h" as const, price: 81234.5, asOf: now - 60_000, source: "Binance USDⓈ-M" },
      { symbol: "ETHUSDT", change: -0.004, basis: "tag" as const, price: 2410, asOf: Z("2026-10-27T23:59:59Z"), source: "Binance USDⓈ-M" },
      { symbol: "SOLUSDT", change: null, basis: "tag" as const, price: null, asOf: null, source: null },
    ],
    levels: {
      available: true,
      rows: [{ name: "Long-Trigger", symbol: "BTCUSDT", price: 84500, tf: "4h", status: "provisional" as const, reason: "Kerze läuft über dem Level", asOf: now }],
      planHeadline: "Abwarten – 4h-Schluss steht aus",
    },
    alerts: null,
    checkin: { state: "open" as const, at: null, hasPlan: false },
  };

  it("lists the day's appointments in the trader's zone: FOMC all day, CPI, US open and close, funding in one line", () => {
    const b = buildBriefing(base);
    expect(b.day).toBe("2026-10-28");
    const ev = b.sections.find((s) => s.id === "events")!;
    const texts = ev.lines.map((l) => l.text);
    // FOMC (all day), then in time order: CPI 12:30Z = 13:30 CET, open 13:30Z = 14:30 CET, close 20:00Z = 21:00 CET
    expect(texts[0]).toMatch(/^ganztägig · FOMC-Entscheidung/);
    expect(texts).toContain("13:30 Uhr · CPI USA");
    expect(texts.some((t) => t.startsWith("14:30 Uhr · US-Börsen öffnen (NYSE)"))).toBe(true);
    expect(texts.some((t) => t.startsWith("21:00 Uhr · US-Börsen schließen (NYSE)"))).toBe(true);
    // funding 00:00Z, 08:00Z, 16:00Z = 01:00, 09:00, 17:00 CET
    expect(texts).toContain("Funding-Abrechnungen um 01:00, 09:00, 17:00 Uhr");
  });

  it("counts appointments and highlights in the overview without inventing anything", () => {
    const b = buildBriefing(base);
    const ov = b.sections.find((s) => s.id === "overview")!;
    // FOMC, CPI, open, close = 4 appointments (funding does not count), 2 of high importance (FOMC, CPI)
    expect(ov.lines[0]!.text).toBe("Heute stehen 4 Termine an, davon 2 mit hoher Wichtigkeit.");
    // 2 markets have a value, 1 of them moves ≥ 2 %
    expect(ov.lines[1]!.text).toBe("1 von 2 Märkten mit Daten bewegen sich um mindestens 2 %.");
  });

  it("gives every line a source, marks missing data and sorts movers first", () => {
    const b = buildBriefing(base);
    for (const s of b.sections) for (const l of s.lines) expect(l.source.length, `${s.id}: ${l.text}`).toBeGreaterThan(2);
    const mk = b.sections.find((s) => s.id === "markets")!;
    expect(mk.lines[0]!.text).toBe("BTCUSDT: +3,4 % (24 h) · 81.234,5 · bewegt sich");
    expect(mk.lines[1]!.text).toBe("ETHUSDT: −0,4 % (letzter Tagesschluss) · 2.410");
    expect(mk.lines.at(-1)).toMatchObject({ text: "SOLUSDT: keine Daten", missing: true, at: null });
    expect(b.sections.find((s) => s.id === "alerts")!.lines[0]).toMatchObject({ text: "Zustellprotokoll: keine Daten.", missing: true });
    expect(b.sections.find((s) => s.id === "checkin")!.lines.map((l) => l.text)).toEqual(["Check-in offen: noch nicht beantwortet.", "Plan für den Tag: noch leer (Tagesnotiz)."]);
  });

  it("names a key level that is only provisional under 'Worauf achten' and says 'keine Daten' when the market is not running", () => {
    const b = buildBriefing(base);
    const watch = b.sections.find((s) => s.id === "watch")!.lines.map((l) => l.text);
    expect(watch).toHaveLength(3);
    expect(watch[0]).toMatch(/^FOMC heute: FOMC-Entscheidung\./);
    expect(watch.some((t) => t.startsWith("Long-Trigger 84.500: vorläufig"))).toBe(true);
    const off = buildBriefing({ ...base, markets: [], levels: { available: false, reason: "Der Live-Markt läuft nicht", rows: [], planHeadline: null } });
    expect(off.sections.find((s) => s.id === "markets")!.lines[0]).toMatchObject({ text: "Live-Markt und Watchlist: keine Daten.", missing: true });
    expect(off.sections.find((s) => s.id === "levels")!.lines[0]).toMatchObject({ text: "Marken: keine Daten (Der Live-Markt läuft nicht).", missing: true });
    expect(briefingText(off)).toContain("[Ereigniskalender]");
  });

  it("says when the weekend (Sat 00:00 – Mon 00:00 UTC) begins or ends inside the trader's day instead of calling a whole Monday weekend", () => {
    const weekendLines = (at: string): string[] =>
      buildBriefing({ ...base, now: Z(at) })
        .sections.find((s) => s.id === "events")!
        .lines.map((l) => l.text)
        .filter((t) => t.startsWith("Wochenende"));
    // Saturday 24 Oct 2026 in Berlin (CEST): the day runs from 22:00Z; the weekend begins at 00:00Z = 02:00 CEST
    expect(weekendLines("2026-10-24T10:00:00Z")).toEqual(["Wochenende (UTC) beginnt um 02:00 Uhr: danach sind die US-Börsen geschlossen, Krypto handelt durchgehend"]);
    // Sunday 25 Oct (25 hours long, the clock goes back at 03:00 CEST): the whole day lies inside the weekend
    expect(weekendLines("2026-10-25T10:00:00Z")).toEqual(["Wochenende (UTC): die US-Börsen sind geschlossen, Krypto handelt durchgehend"]);
    // Monday 26 Oct, 00:30 CET (= Sunday 23:30Z): the weekend ends at 00:00Z = 01:00 CET, still 30 minutes ahead
    expect(weekendLines("2026-10-25T23:30:00Z")).toEqual(["Wochenende (UTC) endet um 01:00 Uhr: bis dahin sind die US-Börsen geschlossen"]);
    // later on that Monday the weekend is over: no line
    expect(weekendLines("2026-10-26T07:30:00Z")).toEqual([]);
    // a weekday in the middle of the week never mentions it
    expect(weekendLines("2026-10-28T07:30:00Z")).toEqual([]);
  });

  it("reads the alarms of the day from the protocol and ignores older ones", () => {
    const b = buildBriefing({ ...base, alerts: [{ at: Z("2026-10-28T06:15:00Z"), title: "Long-Trigger: vorbereiten", outcome: "gesendet" }, { at: Z("2026-10-27T10:00:00Z"), title: "alt", outcome: "gesendet" }] });
    expect(b.sections.find((s) => s.id === "alerts")!.lines.map((l) => l.text)).toEqual(["07:15 Uhr · Long-Trigger: vorbereiten (gesendet)"]);
  });
});
