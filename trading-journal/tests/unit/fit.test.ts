/**
 * F49 – „Passt zu dir?“: the two descriptions (a tested idea, the journal) and their comparison. Hand-computed fixtures
 * (the arithmetic is in the comments); weekday / session buckets are UTC on both sides, the journal's local wall-clock strings
 * are built FROM UTC instants so the tests do not depend on the time zone.
 */
import { describe, expect, it } from "vitest";
import { barLabel, compareFit, drawdownDepth, journalProfile, parseTimeframe, strategyFacts, type FitRunInput } from "@/domain/fit";
import type { DayNotes } from "@/domain/types";
import type { BehaviorEvent } from "@/domain/coach/events";
import { COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";
import { D, H, MON, idea, journalRaw, local } from "./fit.fixtures";

const journalE = (o: { exits?: boolean; followed?: boolean } = {}) => enrichC(journalRaw(o));

describe("drawdownDepth – hand-computed", () => {
  it("cumulative 1, −1, −2, 1, −3 → peak 1, trough −3 → 4", () => {
    expect(drawdownDepth([1, -2, -1, 3, -4])).toBe(4);
  });
  it("the start counts as a peak; no losses → 0", () => {
    expect(drawdownDepth([-1, -1])).toBe(2);
    expect(drawdownDepth([1, 2, 3])).toBe(0);
    expect(drawdownDepth([])).toBe(0);
  });
});

describe("strategyFacts – hand-computed", () => {
  const s = strategyFacts(idea());
  it("counts, win share, longest losing run, drawdown in R, sum", () => {
    expect(s.n).toBe(10);
    expect(s.win.k).toBe(3);
    expect(s.win.share).toBeCloseTo(0.3, 12);
    // losing runs: 3 (trades 2–4) and 3 (trades 8–10)
    expect(s.longestLosing).toBe(3);
    // cumulative R: 2, 1, 0, −1, 1, 0, 2, 1, 0, −1 → peak 2, trough −1 → 3
    expect(s.drawdownR).toBe(3);
    expect(s.sumR).toBe(-1);
    expect(s.drawdownPct).toBeCloseTo(6, 12);
    expect(s.riskPct).toBe(2);
  });
  it("holds 1 … 10 h → median 5,5 h; 28 days → 10 trades are 2,5 per week", () => {
    expect(s.holdMedianMs).toBe(5.5 * H);
    expect(s.days).toBe(28);
    expect(s.perWeek).toBeCloseTo(2.5, 12);
  });
  it("entry shares in UTC: Monday 60 %, Saturday 40 %; London 60 %, weekend 40 %", () => {
    expect(s.weekday[1]).toBeCloseTo(0.6, 12);
    expect(s.weekday[6]).toBeCloseTo(0.4, 12);
    expect(s.session.london).toBeCloseTo(0.6, 12);
    expect(s.session.weekend).toBeCloseTo(0.4, 12);
    expect(s.session.ny).toBe(0);
  });
  it("a run shorter than a week has no weekly frequency", () => {
    expect(strategyFacts({ ...idea(), to: MON + 3 * D }).perWeek).toBeNull();
  });
});

describe("journalProfile – hand-computed", () => {
  const events: BehaviorEvent[] = [
    { key: "stopMoved", tradeIds: ["f3", "f9"], at: 0, severity: 2 },
    { key: "revenge", tradeIds: ["f4"], at: 0, severity: 2 },
  ];
  const j = journalProfile(journalE(), COACH_SETTINGS, events);
  it("12 wins of 24, longest losing run 1, drawdown 1 R", () => {
    expect(j.n).toBe(24);
    expect(j.win.k).toBe(12);
    expect(j.longestLosing).toBe(1);
    // +2 −1 +2 −1 …: the cumulative R never falls more than 1 below its peak
    expect(j.drawdown).toEqual({ n: 24, depthR: 1 });
  });
  it("hold 1 h from 24 trades with an exit time; risk 100 of 10 000 = 1 % each", () => {
    expect(j.hold).toEqual({ n: 24, medianMs: H });
    expect(j.risk.n).toBe(24);
    expect(j.risk.medianPct).toBeCloseTo(1, 12);
  });
  it("first Tue 14:00 UTC … last Thu 16:00 UTC of week 4: 23 days and 2 h → 24 trades are 7,28 per week", () => {
    const span = 23 + 2 / 24;
    expect(j.spanDays).toBeCloseTo(span, 9);
    expect(j.perWeek).toBeCloseTo((24 * 7) / span, 9);
  });
  it("UTC buckets: Tuesday / Wednesday / Thursday a third each, all New York", () => {
    expect(j.weekday.share[2]).toBeCloseTo(1 / 3, 12);
    expect(j.weekday.share[3]).toBeCloseTo(1 / 3, 12);
    expect(j.weekday.share[4]).toBeCloseTo(1 / 3, 12);
    expect(j.weekday.count[1]).toBe(0);
    expect(j.session.share.ny).toBe(1);
    expect(j.session.count.london).toBe(0);
  });
  it("discipline: every trade has a stop; 2 trades with a moved stop (events of other kinds are ignored); plan followed 20 of 24", () => {
    expect(j.discipline.stopSet.k).toBe(24);
    expect(j.discipline.widened).toBe(2);
    expect(j.discipline.followed.k).toBe(20);
    expect(j.discipline.followed.n).toBe(24);
  });
  it("open trades are not part of the profile", () => {
    const withOpen = [...journalE(), ...enrichC([ct(local(MON + 30 * D), { id: "open1", status: "open", p: 0 })])];
    expect(journalProfile(withOpen, COACH_SETTINGS).n).toBe(24);
  });
});

describe("compareFit – hand-computed", () => {
  const s = strategyFacts(idea());
  const events: BehaviorEvent[] = [{ key: "stopMoved", tradeIds: ["f3", "f9"], at: 0, severity: 2 }];
  const j = journalProfile(journalE(), COACH_SETTINGS, events);
  const r = compareFit(s, j);
  const by = (id: string) => r.items.find((i) => i.id === id)!;

  it("eleven statements in a fixed order, no score anywhere", () => {
    expect(r.status).toBe("ok");
    expect(r.items.map((i) => i.id)).toEqual(["winRate", "hold", "streak", "drawdown", "frequency", "window", "risk", "discipline", "cadence", "ruleload", "timebudget"]);
    expect(Object.keys(r)).toEqual(["status", "reason", "strategy", "profile", "items"]);
    expect(JSON.stringify(r)).not.toMatch(/score|Score|Empfehlung|empfehle/);
  });

  it("win rate 30 % (3 of 10) vs 50 % (12 of 24): the 80 % intervals overlap (≈ 16–49 % and ≈ 37–63 %) → no reliable difference", () => {
    expect(by("winRate").kind).toBe("match");
    expect(by("winRate").text).toMatch(/überlappen/);
  });

  it("hold: Median 5 Std 30 Min vs 1 Std → friction with both figures", () => {
    expect(by("hold").kind).toBe("friction");
    expect(by("hold").text).toContain("Haltedauer Median 5 Std 30 Min; du schließt im Median nach 1 Std");
  });

  it("streak: 3 vs 1 → friction in the user's words", () => {
    expect(by("streak").kind).toBe("friction");
    expect(by("streak").text).toBe("Die Idee verlangt im Test bis zu 3 Verlusttrades in Folge auszuhalten; deine längste Serie waren 1.");
    expect(by("streak").evidence.map((e) => e.label)).toContain("Erwartung bei deiner Trefferquote");
  });

  it("drawdown: −3 R vs −1 R (3 > 1,5 × 1 and 2 R more) → friction", () => {
    expect(by("drawdown").kind).toBe("friction");
    expect(by("drawdown").text).toContain("−3,0 R");
    expect(by("drawdown").evidence[0]!.value).toContain("−6,0 % des Kontos bei 2,0 % Risiko");
  });

  it("frequency: 2,5 vs 7,3 per week (ratio 0,34 ≤ 0,5) → friction „wartet länger“", () => {
    expect(by("frequency").kind).toBe("friction");
    expect(by("frequency").text).toMatch(/wartet länger.*2,5 Trades pro Woche gegen 7,3/);
  });

  it("window: Monday, London and the weekend are where the idea enters and you do not", () => {
    const w = by("window");
    expect(w.kind).toBe("friction");
    expect(w.text).toContain("60 % der Einstiege der Idee fallen auf Montag; von deinen Trades liegen 0 % dort (0 von 24)");
    expect(w.text).toContain("die London-Session");
    expect(w.text).toContain("das Wochenende");
    expect(w.text).not.toContain("New-York");
    expect(w.caveat).toMatch(/UTC/);
  });

  it("risk: 2 % vs 1 % (> 1,5 ×) → friction", () => {
    expect(by("risk").kind).toBe("friction");
  });

  it("discipline: 2 of 24 stop-moved trades (8 % ≥ 5 %) → friction, with the stop share and the plan answers as evidence", () => {
    const d = by("discipline");
    expect(d.kind).toBe("friction");
    expect(d.text).toContain("bei 2 von 24 Trades hast du den Stop weiter weg gestellt");
    expect(d.evidence.map((e) => e.label)).toEqual(["Trades mit Stop", "Stop weiter weg gestellt", "Plan befolgt (laut dir)"]);
  });

  it("an idea shaped like the journal matches everywhere (and discipline matches without moved stops)", () => {
    const jj = journalProfile(journalE(), COACH_SETTINGS);
    const mirror = strategyFacts({
      name: "Spiegel",
      from: jj.from!,
      to: jj.to!,
      riskPct: 1,
      maxDD: 0.02,
      trades: journalE().map((t, i) => ({ entryTime: new Date(t.date).getTime(), exitTime: new Date(t.exitDate!).getTime(), r: t.r!, pnl: i % 2 === 0 ? 200 : -100 })),
    });
    const m = compareFit(mirror, jj);
    expect(m.items.map((i) => `${i.id}:${i.kind}`)).toEqual(["winRate:match", "hold:match", "streak:match", "drawdown:match", "frequency:match", "window:match", "risk:match", "discipline:match", "cadence:unknown", "ruleload:unknown", "timebudget:unknown"]);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ effort */

describe("Prüftakt, Regelumfang, Zeitbudget (F49)", () => {
  const withIdea = (extra: Partial<FitRunInput>) => strategyFacts({ ...idea(), ...extra });
  /** the same journal, with a checklist: three global rules + the items of the setup „s_good“ every fixture trade carries */
  const LIST = { ...COACH_SETTINGS, rules: [1, 2, 3].map((n) => ({ id: `r${n}`, text: `Regel ${n}` })) };
  const checklistLen = LIST.rules.length + (LIST.setups.find((x) => x.id === "s_good")?.checklist ?? []).length;
  const j = journalProfile(enrichC(journalRaw(), LIST), LIST);
  const item = (id: string, s = withIdea({ interval: "4h", rules: { conds: 3, exits: 2 } }), prof = j) => compareFit(s, prof).items.find((i) => i.id === id)!;

  describe("candle sizes", () => {
    it("reads the sizes the journal and the lab write", () => {
      expect(parseTimeframe("15m")).toBe(15 * 60_000);
      expect(parseTimeframe("1H")).toBe(H);
      expect(parseTimeframe("4h")).toBe(4 * H);
      expect(parseTimeframe(" 1D ")).toBe(D);
      expect(parseTimeframe("1w")).toBe(7 * D);
      expect(parseTimeframe("90min")).toBe(90 * 60_000);
      for (const bad of ["", "h", "4", "4 stunden", "0h", null, undefined, 4, "4hh"]) expect(parseTimeframe(bad)).toBeNull();
    });
    it("names them in the words of the card", () => {
      expect(barLabel(15 * 60_000)).toBe("15 Min");
      expect(barLabel(4 * H)).toBe("4 Std");
      expect(barLabel(D)).toBe("1 Tag");
      expect(barLabel(2 * D)).toBe("2 Tage");
      expect(barLabel(90 * 60_000)).toBe("90 Min");
    });
  });

  describe("the idea's side", () => {
    it("the candle it decides on and the parts it is made of; the templates have no rule list", () => {
      const s = withIdea({ interval: "15m", rules: { conds: 4, exits: 2 } });
      expect(s.bar).toEqual({ ms: 15 * 60_000, label: "15 Min" });
      expect(s.rules).toEqual({ conds: 4, exits: 2 });
      expect(strategyFacts(idea()).bar).toBeNull(); // no interval given: unknown, never guessed
      expect(strategyFacts(idea()).rules).toBeNull();
      expect(withIdea({ interval: "wöchentlich" }).bar).toBeNull();
    });
  });

  describe("the journal's side", () => {
    it("24 trades on 4h candles; every trade carries the checklist (global rules + the setup's items)", () => {
      expect(j.timeframe).toEqual({ n: 24, medianMs: 4 * H, label: "4 Std" });
      expect(j.checklist).toEqual({ n: 24, median: checklistLen });
      expect(checklistLen).toBeGreaterThanOrEqual(3);
      // without any checklist the statement has nothing to compare: zero items are no checklist
      expect(journalProfile(journalE(), COACH_SETTINGS).checklist).toEqual({ n: 0, median: null });
    });
    it("the usual candle is an actual size, not a mean between two", () => {
      const mixed = enrichC([...Array.from({ length: 6 }, (_, i) => ct(local(MON + i * D), { id: `a${i}`, p: 100, timeframe: "1h" })), ...Array.from({ length: 6 }, (_, i) => ct(local(MON + (10 + i) * D), { id: `b${i}`, p: 100, timeframe: "4h" }))]);
      expect(journalProfile(mixed, COACH_SETTINGS).timeframe).toEqual({ n: 12, medianMs: H, label: "1 Std" }); // the lower middle, not 2,5 h
    });
    it("counts the days that said how much time they have, and only those", () => {
      const checkin = (min: number | undefined, extra: Record<string, unknown> = {}) => ({ note: "", updatedAt: "x", checkin: { energy: 3, ...(min != null ? { availableMin: min } : {}), ...extra } });
      const days = {
        "2026-01-05": checkin(30),
        "2026-01-06": checkin(60),
        "2026-01-07": checkin(60),
        "2026-01-08": checkin(120),
        "2026-01-09": checkin(240),
        "2026-01-10": checkin(undefined), // answered, but not the time
        "2026-01-11": { note: "nur eine Notiz", updatedAt: "x" }, // no check-in at all
      } as unknown as DayNotes;
      expect(journalProfile(journalE(), COACH_SETTINGS, [], days).budget).toEqual({ n: 5, medianMin: 60 });
      expect(j.budget).toEqual({ n: 0, medianMin: null });
    });
  });

  describe("Prüftakt", () => {
    it("friction: the idea looks 16 times as often as the trader's usual candle (96 against 6 a day)", () => {
      const it15 = item("cadence", withIdea({ interval: "15m" }));
      expect(it15.kind).toBe("friction");
      expect(it15.text).toContain("auf jeder 15 Min-Kerze (96-mal am Tag)");
      expect(it15.text).toContain("4 Std-Kerzen (6-mal am Tag)");
      expect(it15.text).toContain("etwa 16-mal so oft hinschauen");
      expect(it15.evidence).toEqual([
        { label: "Idee", value: "15 Min-Kerzen · 96 Prüfpunkte am Tag" },
        { label: "Du (Median)", value: "4 Std-Kerzen · 6 am Tag · 24 Trades mit Kerzengröße" },
      ]);
      expect(it15.caveat).toContain("Wie lange ein Blick dauert, weiß die App nicht");
    });
    it("the same candle, or one up to 3 times as fast: no friction – 4 times as fast is the edge", () => {
      expect(item("cadence", withIdea({ interval: "4h" })).kind).toBe("match");
      expect(item("cadence", withIdea({ interval: "2h" })).kind).toBe("match"); // twice as fast
      expect(item("cadence", withIdea({ interval: "1h" })).kind).toBe("friction"); // 4 times: the factor is inclusive
    });
    it("a slower idea is no burden, and it says so", () => {
      const slow = item("cadence", withIdea({ interval: "1d" }));
      expect(slow.kind).toBe("match");
      expect(slow.text).toContain("Die Idee prüft seltener als du");
    });
    it("unknown without a candle of the idea, or with too few readable candles in the journal – with the reason", () => {
      expect(item("cadence", withIdea({})).kind).toBe("unknown");
      expect(item("cadence", withIdea({})).text).toContain("nennt keine Kerzengröße");
      const few = enrichC(Array.from({ length: 24 }, (_, i) => ct(local(MON + i * D), { id: `n${i}`, p: 100, timeframe: i < 4 ? "4h" : "" })));
      const w = item("cadence", withIdea({ interval: "15m" }), journalProfile(few, LIST));
      expect(w.kind).toBe("unknown");
      expect(w.text).toContain("Bei 4 deiner Trades ist eine Kerzengröße eingetragen; ab 10");
    });
  });

  describe("Regelumfang", () => {
    it("friction from twice the usual checklist and at least three more parts", () => {
      const big = item("ruleload", withIdea({ interval: "4h", rules: { conds: checklistLen * 2, exits: 3 } }));
      expect(big.kind).toBe("friction");
      expect(big.text).toContain(`${checklistLen * 2 + 3} Regelteilen`);
      expect(big.evidence[0]!.value).toContain(`${checklistLen * 2 + 3} Regelteile (${checklistLen * 2} Bedingungen + 3 Ausstiegsregeln)`);
      expect(big.evidence[1]!.value).toContain(`${checklistLen} Punkte je Checkliste · 24 Trades mit Checkliste`);
      expect(big.caveat).toContain("verschiedene Dinge");
    });
    it("a plain idea is within the usual: no friction", () => {
      expect(item("ruleload", withIdea({ interval: "4h", rules: { conds: checklistLen, exits: 1 } })).kind).toBe("match");
    });
    it("needs twice AND three more: a short checklist does not turn two extra parts into friction", () => {
      const short = enrichC(Array.from({ length: 24 }, (_, i) => ct(local(MON + i * D), { id: `s${i}`, p: 100, setups: [] })), LIST);
      const prof = journalProfile(short, LIST);
      expect(prof.checklist).toEqual({ n: 24, median: 3 }); // only the three global rules
      expect(item("ruleload", withIdea({ interval: "4h", rules: { conds: 6, exits: 0 } }), prof).kind).toBe("friction"); // 6 = twice 3 and 3 more
      expect(item("ruleload", withIdea({ interval: "4h", rules: { conds: 5, exits: 0 } }), prof).kind).toBe("match"); // 5 is not twice 3
      const one = { ...LIST, rules: [LIST.rules[0]!] };
      const tiny = journalProfile(enrichC(Array.from({ length: 24 }, (_, i) => ct(local(MON + i * D), { id: `t${i}`, p: 100, setups: [] })), one), one);
      expect(tiny.checklist.median).toBe(1);
      expect(item("ruleload", withIdea({ interval: "4h", rules: { conds: 3, exits: 0 } }), tiny).kind).toBe("match"); // 3 = three times 1, but only 2 more: below the 3-part margin
    });
    it("unknown for the fixed templates and for a journal without checklists – with the reason", () => {
      const tpl = item("ruleload", withIdea({ interval: "4h" }));
      expect(tpl.kind).toBe("unknown");
      expect(tpl.text).toContain("feste Logik");
      const bare = { ...COACH_SETTINGS, rules: [], setups: [] };
      const none = journalProfile(enrichC(Array.from({ length: 24 }, (_, i) => ct(local(MON + i * D), { id: `z${i}`, p: 100, setups: [] })), bare), bare);
      const w = item("ruleload", withIdea({ interval: "4h", rules: { conds: 5, exits: 1 } }), none);
      expect(w.kind).toBe("unknown");
      expect(w.text).toContain("steht eine Checkliste; ab 10");
    });
  });

  describe("Zeitbudget", () => {
    const days = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`2026-01-0${i + 1}`, { note: "", updatedAt: "x", checkin: { energy: 3, availableMin: i < 4 ? 60 : 120 } }])) as unknown as DayNotes;
    const budgeted = journalProfile(journalE(), COACH_SETTINGS, [], days);

    it("sets the two figures side by side and leaves the verdict to the trader", () => {
      const t = item("timebudget", withIdea({ interval: "1h" }), budgeted);
      expect(t.kind).toBe("unknown"); // never a friction or a match: the length of a look is not known
      expect(t.text).toContain("auf jede 1 Std-Kerze (24-mal am Tag)");
      expect(t.text).toContain("im Median 1 Std am Tag");
      expect(t.text).toContain("ob die Zeit reicht, entscheidest du");
      expect(t.evidence).toEqual([
        { label: "Idee", value: "24 Prüfpunkte am Tag (1 Std-Kerzen) · 2,5 Trades pro Woche" },
        { label: "Du (Median)", value: "1 Std am Tag laut Check-in · 6 Tage" },
      ]);
    });
    it("asks for the check-in field when there are not enough answers", () => {
      const t = item("timebudget", withIdea({ interval: "1h" }));
      expect(t.kind).toBe("unknown");
      expect(t.text).toContain("an 0 Tagen angegeben");
      expect(t.text).toContain("Verfügbare Zeit");
    });
  });
});

describe("compareFit – honest empty states and unknowns", () => {
  const s = strategyFacts(idea());
  it("no closed trade: says so, compares nothing", () => {
    const r = compareFit(s, journalProfile([], COACH_SETTINGS));
    expect(r.status).toBe("journalNone");
    expect(r.items).toEqual([]);
    expect(r.reason).toMatch(/noch keinen abgeschlossenen Trade/);
  });
  it("19 trades are too few (the reason names the number and the threshold)", () => {
    const r = compareFit(s, journalProfile(journalE().slice(0, 19), COACH_SETTINGS));
    expect(r.status).toBe("journalFew");
    expect(r.reason).toContain("19 Trades");
    expect(r.reason).toContain("Ab 20");
    expect(r.items).toEqual([]);
  });
  it("an idea with fewer than 10 trades is not compared; none at all neither", () => {
    const small = strategyFacts({ ...idea(), trades: idea().trades.slice(0, 9) });
    expect(compareFit(small, journalProfile(journalE(), COACH_SETTINGS)).status).toBe("strategyFew");
    expect(compareFit(null, journalProfile(journalE(), COACH_SETTINGS)).status).toBe("strategyFew");
  });
  it("a statement without enough journal data is „nicht beurteilbar“ with the reason, never a guess", () => {
    const r = compareFit(s, journalProfile(journalE({ exits: false }), COACH_SETTINGS));
    const hold = r.items.find((i) => i.id === "hold")!;
    expect(hold.kind).toBe("unknown");
    expect(hold.text).toContain("0 eine Ausstiegszeit");
    // the other statements are still made
    expect(r.items.filter((i) => i.kind !== "unknown").length).toBe(7);
  });
  it("without „Plan befolgt“ answers that part is left out and said so", () => {
    const r = compareFit(s, journalProfile(journalE({ followed: false }), COACH_SETTINGS));
    const d = r.items.find((i) => i.id === "discipline")!;
    expect(d.text).toContain("liegen nur 0 Angaben vor");
    expect(d.evidence.map((e) => e.label)).not.toContain("Plan befolgt (laut dir)");
  });
});
