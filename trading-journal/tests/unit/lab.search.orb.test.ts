/**
 * Eröffnungs-Range-Familie IN der Strategiesuche: das Muster (Volumen-Ausbruch nach der 60-Minuten-Range in New York) wird gefunden, Rauschen
 * wird verworfen, beide Familien teilen sich die 1.000 Varianten (alle 540 ORB-Varianten voll enthalten), der Kandidat zeigt die Gründe einzeln.
 */
import { describe, expect, it } from "vitest";
import { assembleVariants, candidateOf, createSearchJob, orbVariants, runSearchSync, SearchDataError, type OrbVariant } from "@/domain/lab/search";
import { market, orbInput, orbMarket, searchInput } from "./search.helpers";

describe("Eröffnungs-Range in der Suche: Muster gefunden, Rauschen verworfen", () => {
  const edge = [1, 2, 3, 4, 5, 6].map((s) => runSearchSync(orbInput(orbMarket(130, s, { pattern: true }), 7)));

  it("findet New York mit Volumen-Schwelle ≤ 3 und bestehende Endtests (Wahrheit: NY, Range 60, Volumen 3×)", () => {
    for (const r of edge) {
      const v = r.winner!.variant as OrbVariant;
      expect(r.winnerFamily).toBe("orb");
      expect(v.session).toBe("ny");
      expect(v.volThr).toBeLessThanOrEqual(2);
      expect(r.winner!.is.avgR).toBeGreaterThan(1);
      // wer nicht besteht, scheitert allein an den zu wenigen Endtest-Tagen mit Signal (18 Tage Endtest), nicht an der Statistik
      const failed = r.verdict.checks.filter((c) => !c.ok).map((c) => c.id);
      expect(failed.length === 0 || (failed.length === 1 && failed[0] === "oosTrades")).toBe(true);
    }
    expect(edge.filter((r) => r.verdict.passed).length).toBeGreaterThanOrEqual(5);
    // die Familie ist voll enthalten: 540 Varianten, jede mit eigener Zeile und Kurve
    expect(edge[0]!.counts.byFamily).toEqual({ orb: 540, trend: 0 });
    expect(edge[0]!.counts).toMatchObject({ variants: 540, candidates: 1620, isRuns: 1620, oosRuns: 542, winnerOosRuns: 1, compareRuns: 2 });
    expect(edge[0]!.curves.is).toHaveLength(540);
    expect(edge[0]!.datasets[0]).toMatchObject({ family: "orb", unit: "Tage", interval: "5m" });
  });

  it("reines Rauschen: höchstens 10 % Fehlalarme (30 Pfade, gemessen 0) – meist fehlt schon im Training die Mindestzahl Trades (8)", { timeout: 180_000 }, () => {
    const runs = Array.from({ length: 30 }, (_, i) => runSearchSync(orbInput(orbMarket(130, 800 + i), 7)));
    expect(runs.filter((r) => r.verdict.passed).length / 30).toBeLessThanOrEqual(0.1);
    // wo es einen Sieger gibt, hat er im Training mindestens 8 Trades
    for (const r of runs) if (r.winner) expect(r.winner.is.n).toBeGreaterThanOrEqual(8);
  });

  it("deterministisch; das Training bekommt die Endtest-Tage nicht (andere Endtest-Tage ändern Sieger und Training nicht)", () => {
    const bars = orbMarket(130, 11, { pattern: true });
    const a = runSearchSync(orbInput(bars, 7));
    expect(JSON.stringify(runSearchSync(orbInput(bars, 7)))).toBe(JSON.stringify(a));
    const cut = a.datasets[0]!.cutT / 1000;
    const wild = bars.map((b) => (b.t >= cut ? { ...b, o: b.o * 0.6, h: b.h * 0.7, l: b.l * 0.5, c: b.c * 0.6 } : b));
    const b = runSearchSync(orbInput(wild, 7));
    expect(b.winner!.variant.id).toBe(a.winner!.variant.id);
    expect(b.rows.map((r) => [r.isN, r.isAvgR, r.isScore])).toEqual(a.rows.map((r) => [r.isN, r.isAvgR, r.isScore]));
    expect(b.winner!.oos).not.toEqual(a.winner!.oos);
  });

  it("zu wenige Tage → klarer Fehler", () => {
    expect(() => createSearchJob(orbInput(orbMarket(20, 1), 7))).toThrow(SearchDataError);
  });
});

describe("beide Familien teilen sich die 1.000", () => {
  it("540 ORB (alle) + 460 Trend-Ausbruch, gemischt, ids 0…999; mit einer Familie bleibt es bei ihrer Reihenfolge", () => {
    const both = assembleVariants({ seed: 7, trend: { interval: "4h" }, orb: {} });
    expect(both).toHaveLength(1000);
    expect(both.filter((v) => v.family === "orb")).toHaveLength(540);
    expect(both.filter((v) => v.family === "trend")).toHaveLength(460);
    expect(both.map((v) => v.id)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    // alle 540 verschieden
    const orb = both.filter((v): v is OrbVariant => v.family === "orb").map((v) => JSON.stringify({ ...v, id: 0 }));
    expect(new Set(orb).size).toBe(540);
    expect(new Set(orbVariants().map((v) => JSON.stringify(v))).size).toBe(540);
    expect(both.slice(0, 20).some((v) => v.family === "trend") && both.slice(0, 20).some((v) => v.family === "orb")).toBe(true);
    // mit nur einer Familie: keine Mischung
    expect(assembleVariants({ seed: 7, trend: { interval: "4h" } }).every((v) => v.family === "trend")).toBe(true);
    expect(assembleVariants({ seed: 7, orb: {} })).toHaveLength(540);
  });

  it("eine gemeinsame Suche: 1.000 gezählt, der Sieger kommt aus der Familie mit dem Muster, Datenstand beider Familien", () => {
    const trendBars = market(3000, 41);
    const input = { ...searchInput(trendBars, 7), ...orbInput(orbMarket(130, 12, { pattern: true }), 7) };
    const r = runSearchSync({ ...searchInput(trendBars, 7), orb: input.orb });
    expect(r.counts).toMatchObject({ variants: 1000, candidates: 3000, isRuns: 3000, oosRuns: 1002, winnerOosRuns: 1, byFamily: { orb: 540, trend: 460 } });
    expect(r.rows).toHaveLength(1000);
    expect(r.families.sort()).toEqual(["orb", "trend"]);
    expect(r.datasets.map((d) => d.family).sort()).toEqual(["orb", "trend"]);
    expect(r.winnerFamily).toBe("orb");
    expect(r.verdict.passed).toBe(true);
    // die Mehrfachtest-Korrektur zählt alle 3.000 Kandidaten (1.000 Varianten × 3 Stop-Führungen)
    expect(r.deflation!.trials).toBe(3000);
  });
});

describe("Kandidat der Eröffnungs-Range: Gründe einzeln, nur bei echtem Signal", () => {
  const V: OrbVariant = { family: "orb", id: 0, session: "ny", rangeMin: 60, volThr: 1.5, targetR: 2, stop: "range", trend: false };
  const bars = orbMarket(10, 3, { pattern: true, share: 1 });
  // Tag 2 (Mittwoch 08.01.2025): Ausbruchskerze = Kerze 174 des Tages (14:30 UTC)
  const dayStart = 2 * 288;
  const upTo = (k: number) => bars.slice(0, dayStart + k + 1);
  const closeAt = (b: typeof bars) => (b[b.length - 1]!.t + 300) * 1000;

  it("Signal auf der letzten geschlossenen Kerze → Long/Short mit Volumen-Faktor 3,0×, Trend ja/nein, Note, Stop = Range", () => {
    const b = upTo(174);
    const c = candidateOf(b, "5m", V, closeAt(b));
    expect(["long", "short"]).toContain(c.state);
    expect(c.family).toBe("orb");
    const vol = c.reasons!.find((x) => x.label === "Volumen")!;
    expect(vol.value).toMatch(/^3,0× des Schnitts der 20 Kerzen davor/);
    expect(vol.ok).toBe(true);
    expect(c.reasons!.map((x) => x.label)).toEqual(["Ausbruch", "Volumen", "Trend", "Note"]);
    expect(c.reasons!.find((x) => x.label === "Note")!.value).toMatch(/^A\+?$/);
    expect(c.signal!.entry).toBe(b[b.length - 1]!.c);
    expect(c.signal!.target).not.toBeNull();
    expect((c.signal!.target! - c.signal!.entry) * (c.state === "long" ? 1 : -1)).toBeGreaterThan(0);
  });

  it("vor dem Ausbruch: „Heute kein Signal – warte“ ohne Gründe; später am Tag: kein Einstieg mehr (kein Nachsteigen)", () => {
    const before = upTo(170);
    const c0 = candidateOf(before, "5m", V, closeAt(before));
    expect(c0.state).toBe("none");
    expect(c0.text).toMatch(/^Heute kein Signal – warte\./);
    expect(c0.reasons).toBeUndefined();
    const later = upTo(180);
    const c1 = candidateOf(later, "5m", V, closeAt(later));
    expect(c1.state).toBe("none");
    expect(c1.signal).toBeNull();
    expect(c1.text).toMatch(/Einstieg war zur Eröffnung der Folgekerze|Heute kein Einstieg mehr/);
    expect(c1.reasons).toBeDefined();
  });

  it("Filter der Variante: Schwelle über dem Faktor → kein Signal für diese Variante; Sitzung noch nicht begonnen; Kerzen nicht aktuell", () => {
    const b = upTo(174);
    expect(candidateOf(b, "5m", { ...V, volThr: 4 as unknown as 2 }, closeAt(b)).state).toBe("none");
    const early = upTo(100);
    expect(candidateOf(early, "5m", V, closeAt(early)).text).toMatch(/beginnt um 13:30 UTC/);
    expect(candidateOf(b, "5m", V, closeAt(b) + 3_600_000).state).toBe("stale");
  });
});
