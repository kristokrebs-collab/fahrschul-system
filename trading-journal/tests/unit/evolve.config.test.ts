/**
 * Optimiser – `settings.evolve` (versioned passthrough like `settings.forward`), the trial log (limit and rotation), the
 * throttle, and the weighting of earlier trials by the overlap of the candles.
 */
import { describe, expect, it } from "vitest";
import {
  appendEntries,
  bookToJson,
  effectivePrior,
  EMPTY_EVOLVE,
  EMPTY_LOG,
  evolveCfgOf,
  EvolveMulti,
  KEEP_TOP,
  LOG_MAX,
  nextLineage,
  parseBook,
  proposalOf,
  restAfter,
  throttleFor,
  trimProposals,
  withEvolve,
  MAX_OPEN,
  MAX_PROPOSALS,
  type LogEntry,
  type StoredProposal,
} from "@/domain/evolve";
import { merge3 } from "@/store/merge3";
import { drive, multiInput, path, pathInput, strategy } from "./evolve.helpers";

/** A real proposal from a real (small) run on a synthetic market with an edge. */
function realProposals(): StoredProposal[] {
  const m = new EvolveMulti(pathInput(path(5000, 31, 0.12), 7, 150));
  drive(m);
  return m.result()!.strategies[0]!.proposals.map((d, i) => ({ ...d, id: `ev_${i}`, createdAt: 1_000 + i, decision: "open" as const }));
}

describe("settings.evolve", { timeout: 60_000 }, () => {
  const props = realProposals();

  it("gibt es nichts oder Unlesbares: leere Voreinstellung, nichts wird erfunden", () => {
    expect(evolveCfgOf(undefined)).toBe(EMPTY_EVOLVE);
    expect(evolveCfgOf("kaputt")).toBe(EMPTY_EVOLVE);
    expect(evolveCfgOf({ v: 1, proposals: "x", learn: 3, stats: [], lineages: 7 })).toMatchObject({ proposals: [], learn: {}, lineages: {} });
  });

  it("ein echter Vorschlag übersteht den Weg durch JSON (Speicher, Backup, Cloud) unverändert lesbar", () => {
    expect(props.length).toBeGreaterThan(0);
    const raw = withEvolve(undefined, { proposals: props });
    const through = JSON.parse(JSON.stringify(raw)) as unknown;
    const back = evolveCfgOf(through);
    expect(back.proposals).toHaveLength(props.length);
    expect(back.rejected).toEqual([]);
    const a = props[0]!;
    const b = back.proposals[0]!;
    expect(b.key).toBe(a.key);
    expect(b.changes).toEqual(a.changes);
    expect(b.overfit.p).toBeCloseTo(a.overfit.p, 12);
    expect(b.test.cand.avgR).toBeCloseTo(a.test.cand.avgR!, 12);
    expect(b.holdout?.cand.n).toBe(a.holdout?.cand.n);
    expect(b.config.version).toBe(1);
    expect(b.expected.pctPer30d).toBeCloseTo(a.expected.pctPer30d!, 12);
  });

  it("Unbekanntes bleibt: fremde Schlüssel der Wurzel und unlesbare Vorschläge werden unberührt zurückgeschrieben", () => {
    const junk = { id: "ev_x", decision: "irgendwas", from: "einer neueren Version" };
    const raw = { v: 1, newer: { a: 1 }, proposals: [...props.map((p) => JSON.parse(JSON.stringify(p))), junk] };
    const cur = evolveCfgOf(raw);
    expect(cur.rejected).toEqual([junk]);
    const next = withEvolve(raw, { prefs: { power: "gentle" } });
    expect(next.newer).toEqual({ a: 1 });
    expect((next.proposals as unknown[]).at(-1)).toEqual(junk);
    expect(evolveCfgOf(next).prefs.power).toBe("gentle");
  });

  it("ohne Änderung kommt dasselbe Objekt zurück (kein überflüssiges Speichern)", () => {
    const raw = withEvolve(undefined, { proposals: props });
    expect(withEvolve(raw, {})).toBe(raw);
    expect(withEvolve(raw, { prefs: { power: "normal" } })).toBe(raw);
    expect(withEvolve(raw, { prefs: { power: "full" } })).not.toBe(raw);
  });

  it("ein Vorschlag mit kaputter Regel-Version oder fehlenden Zahlen wird abgelehnt, nicht repariert", () => {
    const good = JSON.parse(JSON.stringify(props[0])) as Record<string, unknown>;
    expect(proposalOf(good)).not.toBeNull();
    expect(proposalOf({ ...good, config: { version: 9 } })).toBeNull();
    expect(proposalOf({ ...good, decision: "weiß nicht" })).toBeNull();
    expect(proposalOf({ ...good, test: {} })).toBeNull();
    expect(proposalOf({ ...good, id: "mit leerzeichen!" })).toBeNull();
    expect(proposalOf(null)).toBeNull();
  });

  it("Begrenzung: höchstens 9 offene und 30 insgesamt; die neuesten bleiben, entschiedene nach Entscheidungszeit", () => {
    const mk = (i: number, decision: StoredProposal["decision"]): StoredProposal => ({ ...props[0]!, id: `ev_${i}`, createdAt: i, decision, decidedAt: decision === "open" ? undefined : i });
    const list = [...Array.from({ length: 14 }, (_, i) => mk(i, "open")), ...Array.from({ length: 40 }, (_, i) => mk(100 + i, "saved"))];
    const kept = trimProposals(list);
    expect(kept.filter((p) => p.decision === "open")).toHaveLength(MAX_OPEN);
    expect(kept).toHaveLength(MAX_PROPOSALS);
    // die ältesten offenen (0…4) sind weg, die neuesten (5…13) bleiben
    expect(kept.filter((p) => p.decision === "open").map((p) => p.createdAt).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(kept.some((p) => p.id === "ev_139")).toBe(true);
    expect(kept.some((p) => p.id === "ev_100")).toBe(false);
  });

  it("Cloud-/Zwei-Tab-Merge je Vorschlag: auf zwei Geräten angelegte Vorschläge bleiben beide erhalten", () => {
    const [a, b] = [props[0]!, { ...props[0]!, id: "ev_other", createdAt: 5_000 }];
    const base = withEvolve(undefined, { proposals: [] });
    const mineSide = withEvolve(base, { proposals: [a] });
    const theirs = withEvolve(base, { proposals: [b] });
    const merged = merge3(base, mineSide, theirs) as { proposals: { id: string }[] };
    expect(merged.proposals.map((p) => p.id).sort()).toEqual([a.id, "ev_other"].sort());
    // dieselbe Entscheidung am selben Vorschlag auf einem Gerät → bleibt
    const decided = withEvolve(mineSide, { proposals: [{ ...a, decision: "rejected", decidedAt: 9, reason: "zu viele Änderungen" }] });
    const m2 = merge3(mineSide, decided, mineSide) as { proposals: { id: string; decision: string }[] };
    expect(m2.proposals[0]!.decision).toBe("rejected");
  });
});

describe("frühere Versuche, gewichtet nach der Überlappung der Kerzen", () => {
  const SPAN = 100 * 86_400_000; // Testspanne 100 Tage
  it("von Hand: 400 frühere Versuche; 25 neue Tage → 75 %, 100 neue Tage → 0, keine neuen → alle", () => {
    const l = { trials: 400, to: 1_000_000_000_000, runs: 2 };
    expect(effectivePrior(l, l.to, SPAN)).toBe(400);
    expect(effectivePrior(l, l.to + 25 * 86_400_000, SPAN)).toBeCloseTo(300, 9);
    expect(effectivePrior(l, l.to + 100 * 86_400_000, SPAN)).toBe(0);
    expect(effectivePrior(l, l.to + 400 * 86_400_000, SPAN)).toBe(0);
    expect(effectivePrior(undefined, l.to, SPAN)).toBe(0);
    expect(effectivePrior(l, l.to, 0)).toBe(0);
  });
  it("nach einem Lauf zählt der Stand: gewichtete frühere + neue Versuche", () => {
    expect(nextLineage(300, 150, 77, 2)).toEqual({ trials: 450, to: 77, runs: 3 });
    expect(nextLineage(0.4, 10, 5, 0)).toEqual({ trials: 10, to: 5, runs: 1 });
  });
});

describe("Versuchsprotokoll: Obergrenze und Rotation", () => {
  const e = (i: number, score: number | null, via: LogEntry["via"] = "mutation"): LogEntry => ({ sid: "s", seed: 1, i, at: i, key: `k${i}`, parent: null, via, kinds: [], text: `Versuch ${i}`, score, n: 20, avgR: 0.1 });

  it("unter der Grenze bleibt alles; der Zähler zählt Versuche (nicht den Ausgangspunkt)", () => {
    const log = appendEntries(EMPTY_LOG, [e(0, 1, "baseline"), e(1, 0.5), e(2, null), e(3, -1, "neighbor")]);
    expect(log.entries).toHaveLength(4);
    expect(log.total).toBe(3);
    expect(log.dropped).toBe(0);
  });

  it("über der Grenze fallen die ÄLTESTEN zuerst weg – die besten Scores und der Ausgangspunkt bleiben", () => {
    let log = appendEntries(EMPTY_LOG, [e(0, 0.1, "baseline")]);
    // ein früher, sehr guter Versuch
    log = appendEntries(log, [e(1, 9.9)]);
    for (let i = 2; i < LOG_MAX + 150; i++) log = appendEntries(log, [e(i, i % 7 === 0 ? 0.5 : -0.5)]);
    expect(log.entries.length).toBe(LOG_MAX);
    expect(log.dropped).toBe(LOG_MAX + 150 - LOG_MAX);
    expect(log.total).toBe(LOG_MAX + 150 - 1); // Versuche 1 … 549, der Ausgangspunkt zählt nicht
    expect(log.entries.some((x) => x.via === "baseline")).toBe(true);
    expect(log.entries.some((x) => x.i === 1 && x.score === 9.9)).toBe(true);
    // chronologisch geblieben
    const idx = log.entries.map((x) => x.i);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // der älteste NICHT geschützte Eintrag ist weg, ein junger noch da
    expect(log.entries.some((x) => x.i === 2)).toBe(false);
    expect(log.entries.some((x) => x.i === LOG_MAX + 149)).toBe(true);
    expect(KEEP_TOP).toBeLessThan(LOG_MAX);
  });

  it("Lesen: kaputte Einträge fallen weg, der Zähler schrumpft nicht unter die Zahl der Einträge", () => {
    const log = appendEntries(EMPTY_LOG, [e(0, 1, "baseline"), e(1, 0.2)]);
    const raw = JSON.parse(JSON.stringify(bookToJson({ s: log }))) as { logs: { s: { entries: unknown[]; total: number } } };
    raw.logs.s.entries.push({ nonsense: true }, null);
    raw.logs.s.total = 0;
    const back = parseBook(raw);
    expect(back.s!.entries).toHaveLength(2);
    expect(back.s!.total).toBeGreaterThanOrEqual(2);
    expect(parseBook({ v: 9 })).toEqual({});
    expect(parseBook(null)).toEqual({});
  });
});

describe("Drosselung", () => {
  const env = { hidden: false, saveData: false, batteryLow: false, coarse: false, power: "normal" as const };
  it("Desktop normal 60 %, Handy 30 %, schonend 20 %, volle Leistung 85 %", () => {
    expect(throttleFor(env).duty).toBe(0.6);
    expect(throttleFor({ ...env, coarse: true }).duty).toBe(0.3);
    expect(throttleFor({ ...env, power: "gentle" }).duty).toBe(0.2);
    expect(throttleFor({ ...env, power: "full" }).duty).toBe(0.85);
    expect(throttleFor(env).reason).toBeNull();
  });
  it("Tab im Hintergrund, Akku schwach, Datensparmodus: höchstens 10 % – auch bei voller Leistung – und der Grund steht da", () => {
    const hidden = throttleFor({ ...env, hidden: true, power: "full" });
    expect(hidden.duty).toBe(0.1);
    expect(hidden.reason).toMatch(/Hintergrund/);
    expect(throttleFor({ ...env, batteryLow: true, power: "full" })).toMatchObject({ duty: 0.1, reason: expect.stringMatching(/Akku/) });
    expect(throttleFor({ ...env, saveData: true })).toMatchObject({ duty: 0.1, reason: expect.stringMatching(/Datensparmodus/) });
    expect(throttleFor({ ...env, coarse: true }).sliceMs).toBeLessThan(throttleFor(env).sliceMs);
  });
  it("Ruhepause: 10 ms Arbeit bei 20 % → 40 ms Pause; bei 50 % → 10 ms", () => {
    expect(restAfter(10, 0.2)).toBe(40);
    expect(restAfter(10, 0.5)).toBe(10);
    expect(restAfter(0, 0.5)).toBe(1);
    expect(restAfter(10, 0)).toBeGreaterThan(100); // nie durch 0 teilen
  });
});

describe("nur zum Prüfen, dass multiInput gültig ist", () => {
  it("der Lauf auf den BTC-Kerzen liefert ein Ergebnis", () => {
    const m = new EvolveMulti(multiInput({}, [strategy("x", { maxTrials: 10 })]));
    drive(m);
    expect(m.result()!.strategies[0]!.trials).toBe(10);
  });
});
