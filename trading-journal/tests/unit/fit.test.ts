/**
 * F49 – „Passt zu dir?“: the two descriptions (a tested idea, the journal) and their comparison. Hand-computed fixtures
 * (the arithmetic is in the comments); weekday / session buckets are UTC on both sides, the journal's local wall-clock strings
 * are built FROM UTC instants so the tests do not depend on the time zone.
 */
import { describe, expect, it } from "vitest";
import { compareFit, drawdownDepth, journalProfile, strategyFacts, type FitRunInput } from "@/domain/fit";
import type { BehaviorEvent } from "@/domain/coach/events";
import { COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";

const H = 3_600_000;
const D = 24 * H;
const MON = Date.UTC(2026, 0, 5); // Monday 2026-01-05 00:00 UTC

const local = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

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

/** Ten trades of an idea: W L L L W L W L L L with +2 / −1 R; six on Mondays 08:00 UTC (London), four on Saturdays 10:00 UTC. */
function idea(): FitRunInput {
  const signs = [1, -1, -1, -1, 1, -1, 1, -1, -1, -1];
  const entries = [MON + 8 * H, MON + 5 * D + 10 * H, MON + 7 * D + 8 * H, MON + 12 * D + 10 * H, MON + 14 * D + 8 * H, MON + 19 * D + 10 * H, MON + 21 * D + 8 * H, MON + 26 * D + 10 * H, MON + 28 * D + 8 * H, MON + 35 * D + 8 * H];
  return {
    name: "Test-Idee",
    from: MON,
    to: MON + 28 * D,
    riskPct: 2,
    maxDD: 0.06,
    trades: entries.map((t, i) => ({ entryTime: t, exitTime: t + (i + 1) * H, r: signs[i]! > 0 ? 2 : -1, pnl: signs[i]! > 0 ? 200 : -100 })),
  };
}

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

/**
 * 24 closed trades, four weeks, Tuesday / Wednesday / Thursday at 14:00 and 16:00 UTC (New York), W L W L … (+2 R / −1 R),
 * each held 1 h, risk 100 on a 10 000 account (1 %), every trade with a stop; the first 20 marked „Plan befolgt“, 4 not.
 */
function journal(opts: { exits?: boolean; followed?: boolean } = {}) {
  const { exits = true, followed = true } = opts;
  const ts = [];
  let i = 0;
  for (let w = 0; w < 4; w++) {
    for (const day of [1, 2, 3]) {
      for (const hour of [14, 16]) {
        const at = MON + (w * 7 + day) * D + hour * H;
        ts.push(
          ct(local(at), {
            id: `f${i}`,
            p: i % 2 === 0 ? 200 : -100,
            ...(exits ? { exitDate: local(at + H) } : {}),
            followedPlan: followed ? i < 20 : null,
          }),
        );
        i++;
      }
    }
  }
  return enrichC(ts);
}

describe("journalProfile – hand-computed", () => {
  const events: BehaviorEvent[] = [
    { key: "stopMoved", tradeIds: ["f3", "f9"], at: 0, severity: 2 },
    { key: "revenge", tradeIds: ["f4"], at: 0, severity: 2 },
  ];
  const j = journalProfile(journal(), COACH_SETTINGS, events);
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
    const withOpen = [...journal(), ...enrichC([ct(local(MON + 30 * D), { id: "open1", status: "open", p: 0 })])];
    expect(journalProfile(withOpen, COACH_SETTINGS).n).toBe(24);
  });
});

describe("compareFit – hand-computed", () => {
  const s = strategyFacts(idea());
  const events: BehaviorEvent[] = [{ key: "stopMoved", tradeIds: ["f3", "f9"], at: 0, severity: 2 }];
  const j = journalProfile(journal(), COACH_SETTINGS, events);
  const r = compareFit(s, j);
  const by = (id: string) => r.items.find((i) => i.id === id)!;

  it("eight statements in a fixed order, no score anywhere", () => {
    expect(r.status).toBe("ok");
    expect(r.items.map((i) => i.id)).toEqual(["winRate", "hold", "streak", "drawdown", "frequency", "window", "risk", "discipline"]);
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
    const jj = journalProfile(journal(), COACH_SETTINGS);
    const mirror = strategyFacts({
      name: "Spiegel",
      from: jj.from!,
      to: jj.to!,
      riskPct: 1,
      maxDD: 0.02,
      trades: journal().map((t, i) => ({ entryTime: new Date(t.date).getTime(), exitTime: new Date(t.exitDate!).getTime(), r: t.r!, pnl: i % 2 === 0 ? 200 : -100 })),
    });
    const m = compareFit(mirror, jj);
    expect(m.items.map((i) => `${i.id}:${i.kind}`)).toEqual(["winRate:match", "hold:match", "streak:match", "drawdown:match", "frequency:match", "window:match", "risk:match", "discipline:match"]);
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
    const r = compareFit(s, journalProfile(journal().slice(0, 19), COACH_SETTINGS));
    expect(r.status).toBe("journalFew");
    expect(r.reason).toContain("19 Trades");
    expect(r.reason).toContain("Ab 20");
    expect(r.items).toEqual([]);
  });
  it("an idea with fewer than 10 trades is not compared; none at all neither", () => {
    const small = strategyFacts({ ...idea(), trades: idea().trades.slice(0, 9) });
    expect(compareFit(small, journalProfile(journal(), COACH_SETTINGS)).status).toBe("strategyFew");
    expect(compareFit(null, journalProfile(journal(), COACH_SETTINGS)).status).toBe("strategyFew");
  });
  it("a statement without enough journal data is „nicht beurteilbar“ with the reason, never a guess", () => {
    const r = compareFit(s, journalProfile(journal({ exits: false }), COACH_SETTINGS));
    const hold = r.items.find((i) => i.id === "hold")!;
    expect(hold.kind).toBe("unknown");
    expect(hold.text).toContain("0 eine Ausstiegszeit");
    // the other statements are still made
    expect(r.items.filter((i) => i.kind !== "unknown").length).toBe(7);
  });
  it("without „Plan befolgt“ answers that part is left out and said so", () => {
    const r = compareFit(s, journalProfile(journal({ followed: false }), COACH_SETTINGS));
    const d = r.items.find((i) => i.id === "discipline")!;
    expect(d.text).toContain("liegen nur 0 Angaben vor");
    expect(d.evidence.map((e) => e.label)).not.toContain("Plan befolgt (laut dir)");
  });
});
