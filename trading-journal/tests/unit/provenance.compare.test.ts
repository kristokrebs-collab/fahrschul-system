/**
 * F24 Vergleich Mensch – Regelwerk – KI: Gruppen mit Stichprobenwort, Wilson-Spanne der Trefferquote, t-Spanne des Ø R, paarweise
 * Urteile (korrigiert), der Zustand „zu wenig Daten“ – und die Sätze, die NICHTS behaupten, was die Stichprobe nicht trägt.
 */
import { describe, expect, it } from "vitest";
import { wilsonCI } from "@/domain/analytics/stats";
import { compareDecisions, MIN_GROUP_N, rText, winText } from "@/domain/provenance";
import type { DecisionBy, EnrichedTrade, Trade } from "@/domain/types";
import { at, ct, enrichC } from "./coach.fixtures";

let n = 0;
/** `wins` winners (+2 R) and `losses` losers (−1 R) of one decision, on separate days. */
function group(by: DecisionBy | null, wins: number, losses: number, extra: Partial<Trade> = {}, shift = 0): Trade[] {
  const out: Trade[] = [];
  const mk = (p: number): Trade => {
    n++;
    return ct(at(shift + n, 600), { id: `g${n}`, p, risk: 100, ...(by ? { decision: { by } } : null), ...extra });
  };
  for (let i = 0; i < wins; i++) out.push(mk(200));
  for (let i = 0; i < losses; i++) out.push(mk(-100));
  return out;
}
const closed = (...gs: Trade[][]): EnrichedTrade[] => enrichC(gs.flat()).filter((t) => t.status === "closed");

describe("compareDecisions: Gruppen", () => {
  it("zählt je Herkunft Trades, Treffer und Ø R mit Spanne und Stichprobenwort", () => {
    const rep = compareDecisions(closed(group("own", 12, 12), group("rules", 9, 6), group("ai", 2, 1), group(null, 3, 3)));
    const [own, rules, ai] = rep.groups;
    expect(rep.closed).toBe(12 + 12 + 9 + 6 + 3 + 6);
    expect(rep.assigned).toBe(24 + 15 + 3);
    expect(rep.unassigned).toBe(6);
    expect(own).toMatchObject({ by: "own", label: "Eigene Entscheidung", n: 24, wins: 12, enough: true, level: "tragfähig" });
    expect(rules).toMatchObject({ by: "rules", n: 15, wins: 9, enough: true });
    expect(ai).toMatchObject({ by: "ai", n: 3, enough: false, level: "zu wenig", winRate: null, winCI: null, avgR: null, rCI: null });
    // Wilson 80 % aus derselben Rechnung wie überall
    expect(own!.winRate).toBeCloseTo(0.5, 12);
    expect(own!.winCI).toEqual(wilsonCI(12, 24));
    // Ø R = (12 · 2 − 12 · 1) / 24 = 0,5
    expect(own!.avgR).toBeCloseTo(0.5, 9);
    expect(own!.rN).toBe(24);
    expect(own!.rCI!.lo).toBeLessThan(0.5);
    expect(own!.rCI!.hi).toBeGreaterThan(0.5);
  });

  it("unter 5 Trades zeigt eine Gruppe nur die Anzahl – nie eine kleinere, schönere Zahl", () => {
    const rep = compareDecisions(closed(group("ai", 3, 1)));
    const ai = rep.groups[2]!;
    expect(MIN_GROUP_N).toBe(5);
    expect(ai.n).toBe(4);
    expect(ai.enough).toBe(false);
    expect(winText(ai)).toBe("–");
    expect(rText(ai)).toBe("–");
  });

  it("schreibt die Zahlen so, wie die Karte sie zeigt", () => {
    const g = compareDecisions(closed(group("own", 12, 12))).groups[0]!;
    expect(winText(g)).toMatch(/^50 % \(\d+–\d+ %\)$/);
    expect(rText(g)).toMatch(/^\+0,50 R \(\+0,\d\d bis \+\d,\d\d\)$/);
  });

  it("zählt, woher die Zuordnungen kommen (Marke, Handelsplan, Box-Setup, Posteingang, Bot)", () => {
    const rep = compareDecisions(
      closed(
        group("rules", 2, 0, { decision: { by: "rules", via: "plan" } }),
        group("rules", 1, 0, { decision: { by: "rules", via: "box" } }),
        group(null, 1, 0, { origin: { kind: "bot", botId: "Grid" } }),
        group("own", 2, 0),
      ),
      new Map(),
    );
    expect(rep.groups[1]!.basis).toEqual({ set: 0, plan: 2, box: 1, inbox: 0, source: 1 });
    expect(rep.groups[0]!.basis.set).toBe(2);
  });

  it("ein Trade, der im Posteingang verknüpft ist, zählt als Regelwerk", () => {
    const trades = closed(group(null, 3, 2));
    const links = new Map([[trades[0]!.id, "e1"]]);
    const rep = compareDecisions(trades, links);
    expect(rep.groups[1]!.n).toBe(1);
    expect(rep.groups[1]!.basis.inbox).toBe(1);
    expect(rep.unassigned).toBe(4);
  });
});

describe("compareDecisions: Urteile und Sätze", () => {
  it("ohne Daten: nur der Satz, dass es nichts zu vergleichen gibt", () => {
    const rep = compareDecisions([]);
    expect(rep.headline).toBe("Noch keine geschlossenen Trades.");
    expect(rep.pairs.every((p) => !p.comparable)).toBe(true);
  });

  it("mit nur einer lesbaren Herkunft wird nicht verglichen und der Satz sagt warum", () => {
    const rep = compareDecisions(closed(group("own", 8, 8), group("rules", 2, 1)));
    expect(rep.readable).toBe(1);
    expect(rep.anyClear).toBe(false);
    expect(rep.headline).toContain("mindestens zwei Herkünfte");
    const p = rep.pairs.find((x) => x.a === "own" && x.b === "rules")!;
    expect(p.comparable).toBe(false);
    expect(p.text).toContain("zu wenig Daten");
    expect(p.avgR.verdict).toBe("wenig");
  });

  it("ähnliche Gruppen: kein Unterschied zu erkennen – und weder „besser“ noch „schlechter“ im Text", () => {
    const rep = compareDecisions(closed(group("own", 10, 10), group("rules", 9, 10), group("ai", 5, 5)));
    expect(rep.anyClear).toBe(false);
    for (const p of rep.pairs) expect(p.avgR.verdict === "klar" || p.winRate.verdict === "klar").toBe(false);
    // die Sätze der Paare behaupten keinen Rang; die Überschrift verneint ihn ausdrücklich
    expect(rep.pairs.map((p) => p.text).join(" ")).not.toMatch(/besser|schlechter|überlegen|unterlegen/i);
    expect(rep.headline).toContain("kein Unterschied");
    expect(rep.headline).toContain("weder");
  });

  it("ein großer Unterschied bei genug Trades ist „klar“ – der Satz bleibt eine Beobachtung ohne Ursache", () => {
    const rep = compareDecisions(closed(group("own", 4, 26), group("rules", 24, 6)));
    const p = rep.pairs.find((x) => x.a === "own" && x.b === "rules")!;
    expect(p.comparable).toBe(true);
    expect(p.avgR.verdict).toBe("klar");
    expect(p.winRate.verdict).toBe("klar");
    expect(p.avgR.diff!).toBeLessThan(0);
    expect(rep.anyClear).toBe(true);
    expect(rep.headline).toContain("klarer Unterschied");
    expect(rep.headline).toContain("keine Ursache");
    expect(p.text).toContain("klarer Unterschied");
    expect(p.text).not.toMatch(/besser|schlechter/i);
  });

  it("jeder Test ist korrigiert: das Urteil kommt aus q, nicht aus dem rohen p", () => {
    const rep = compareDecisions(closed(group("own", 10, 10), group("rules", 12, 8), group("ai", 14, 6)));
    for (const p of rep.pairs) {
      expect(p.avgR.q).not.toBeNull();
      expect(p.avgR.q!).toBeGreaterThanOrEqual(p.avgR.p!);
    }
  });

  it("ist deterministisch und verändert die Eingabe nicht", () => {
    const input = closed(group("own", 7, 6), group("rules", 6, 7), group("ai", 5, 5));
    const copy = JSON.stringify(input);
    const a = compareDecisions(input);
    const b = compareDecisions(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(input)).toBe(copy);
  });

  it("nennt Märkte, Zeitraum und Long-Anteil als Kontext der Gruppe", () => {
    const own = compareDecisions(closed(group("own", 3, 3, { pair: "ETH/USDT" }), group("own", 1, 1, { pair: "BTC/USDT", side: "short" }))).groups[0]!;
    expect(own.markets).toBe(2);
    expect(own.longShare).toBeCloseTo(6 / 8, 12);
    expect(own.first).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(own.last! >= own.first!).toBe(true);
  });
});
