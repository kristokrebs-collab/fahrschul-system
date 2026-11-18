/**
 * F24 Herkunft der Entscheidung: die Marke am Trade (`trade.decision`) überlebt Normalisierung, Backup und den Drei-Wege-Merge;
 * `decisionOf` wertet in fester Reihenfolge aus (Marke, Posteingang-Verknüpfung, Bot/Webhook) und lässt alles andere
 * UNBEKANNT; ein Hinweis auf ein zeitlich passendes Signal ist nie eine Zuordnung.
 */
import { describe, expect, it } from "vitest";
import { normalizeTrade } from "@/domain/normalize";
import { TradeSchema } from "@/domain/schemas";
import { toJsonBackup } from "@/domain/csv";
import { decisionOf, inboxLinksOf, signalHints, withDecision } from "@/domain/provenance";
import type { Trade } from "@/domain/types";
import { merge3 } from "@/store/merge3";
import { at, ct, enrichC } from "./coach.fixtures";
import { signalEvent } from "./missed.fixtures";

const base = (over: Partial<Trade> = {}): Trade => ct(at(0, 600), { id: "t1", p: 100, ...over });

describe("trade.decision im Datenmodell", () => {
  it("bleibt unberührt, wo es fehlt: ein alter Trade bekommt keinen neuen Schlüssel", () => {
    const t = normalizeTrade(base());
    expect("decision" in t).toBe(false);
  });

  it("wird bereinigt: nur own / rules / ai gelten, fremde Schlüssel überleben; via und ref prüft das Lesen", () => {
    expect(normalizeTrade({ ...base(), decision: { by: "ai", via: "box", ref: "p_1" } }).decision).toEqual({ by: "ai", via: "box", ref: "p_1" });
    expect(normalizeTrade({ ...base(), decision: { by: "rules", extra: 7 } }).decision).toEqual({ by: "rules", extra: 7 });
    // ein unbekanntes via zählt beim Lesen als „von dir gesetzt“, nie als Plan oder Box
    expect(decisionOf(normalizeTrade({ ...base(), decision: { by: "rules", via: "unbekannt" } }))).toEqual({ by: "rules", basis: "set" });
    // unlesbar = unbekannt, nie geraten
    expect("decision" in normalizeTrade({ ...base(), decision: { by: "bot" } })).toBe(false);
    expect("decision" in normalizeTrade({ ...base(), decision: "ai" })).toBe(false);
  });

  it("übersteht das Backup (JSON-Rundlauf) und die Schema-Prüfung beim Import", () => {
    const t = normalizeTrade({ ...base(), decision: { by: "rules", via: "plan", ref: "p_9" } });
    const json = JSON.parse(JSON.stringify(toJsonBackup([t], { currency: "USDT" } as never, [], new Date(0))));
    const back = normalizeTrade(json.trades[0]);
    expect(back.decision).toEqual({ by: "rules", via: "plan", ref: "p_9" });
    expect(TradeSchema.safeParse(back).success).toBe(true);
    expect((TradeSchema.parse(back) as Trade).decision).toEqual({ by: "rules", via: "plan", ref: "p_9" });
  });

  it("wandert als Teil des Trades durch den Cloud-Merge: die jüngere Änderung am Feld gewinnt, nichts anderes geht verloren", () => {
    const b = base();
    const mine = { ...b, decision: { by: "own" as const }, notes: "meine Notiz" };
    const theirs = { ...b, decision: { by: "ai" as const } };
    const merged = merge3(b, mine, theirs) as Trade;
    expect(merged.notes).toBe("meine Notiz");
    // beide Seiten haben das Feld geändert: der Merge entscheidet für genau eine, nie für eine Mischung
    expect(["own", "ai"]).toContain(merged.decision?.by);
    expect(Object.keys(merged.decision ?? {})).toEqual(["by"]);
  });
});

describe("decisionOf", () => {
  it("nimmt zuerst die Marke am Trade und nennt ihren Grund", () => {
    expect(decisionOf(base({ decision: { by: "own" } }))).toEqual({ by: "own", basis: "set" });
    expect(decisionOf(base({ decision: { by: "rules", via: "plan", ref: "p_1" } }))).toEqual({ by: "rules", basis: "plan", ref: "p_1" });
    expect(decisionOf(base({ decision: { by: "rules", via: "box" } }))).toEqual({ by: "rules", basis: "box" });
  });

  it("die Marke des Händlers schlägt Posteingang und Quelle", () => {
    const links = new Map([["t1", "e1"]]);
    expect(decisionOf(base({ decision: { by: "ai" }, origin: { kind: "bot" } }), links)).toMatchObject({ by: "ai", basis: "set" });
  });

  it("eine von Hand gesetzte Verknüpfung im Posteingang zählt als Regelwerk, mit der Signal-Id", () => {
    expect(decisionOf(base(), new Map([["t1", "e7"]]))).toEqual({ by: "rules", basis: "inbox", ref: "e7" });
  });

  it("Bot und Webhook sind Regeln; Börsen-Sync, CSV und von Hand sagen nichts darüber, wer entschieden hat", () => {
    expect(decisionOf(base({ origin: { kind: "bot", botId: "Grid" } }))).toEqual({ by: "rules", basis: "source" });
    expect(decisionOf(base({ origin: { kind: "webhook" } }))).toEqual({ by: "rules", basis: "source" });
    for (const kind of ["api", "csv", "manual"] as const) expect(decisionOf(base({ origin: { kind } })), kind).toBeNull();
    expect(decisionOf(base())).toBeNull();
  });

  it("inboxLinksOf: nur Ereignisse mit Verknüpfung, das erste gewinnt", () => {
    const m = inboxLinksOf([signalEvent({ key: "a" }), signalEvent({ key: "b", tradeId: "t1" }), signalEvent({ key: "c", tradeId: "t1" })]);
    expect([...m.entries()]).toEqual([["t1", "b"]]);
  });

  it("withDecision setzt die Marke des Händlers (ohne via / ref) und nimmt sie mit null wieder weg", () => {
    const t = base({ decision: { by: "rules", via: "plan", ref: "p_1" } });
    expect(withDecision(t, "own").decision).toEqual({ by: "own" });
    expect("decision" in withDecision(t, null)).toBe(false);
    expect(t.decision).toEqual({ by: "rules", via: "plan", ref: "p_1" });
  });
});

describe("signalHints: ein Hinweis ist keine Zuordnung", () => {
  it("zeigt das zeitlich passende Signal (gleiche Seite, im Fenster), nicht mehr", () => {
    const trades = enrichC([ct(at(0, 605), { id: "near", p: 50 }), ct(at(2, 605), { id: "far", p: 50 }), ct(at(0, 606), { id: "short", p: 50, side: "short" })]);
    const t0 = new Date(2026, 2, 2, 10, 0).getTime();
    const ev = signalEvent({ key: "k1", at: t0, side: "long", symbol: "BTCUSDT" });
    const hints = signalHints(trades, [ev]);
    expect(hints.get("near")).toMatchObject({ eventId: "k1", gapMin: 5 });
    expect(hints.has("far")).toBe(false);
    expect(hints.has("short")).toBe(false);
    // und es schreibt nichts: die Herkunft des Trades bleibt unbekannt
    expect(decisionOf(trades[0]!)).toBeNull();
  });
});
