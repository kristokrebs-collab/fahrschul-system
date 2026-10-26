/**
 * F24 im Trade-Editor (minimal): „Entscheidung“ Offen · Ich · Regelwerk · KI – ein unberührter alter Trade gewinnt keinen
 * Schlüssel, eine gespeicherte Marke behält `via` / `ref`, solange der Händler sie nicht ändert, und seine Wahl ersetzt sie.
 * Und die Entwürfe aus Handelsplan und Box-Setup tragen die Marke, die die App wirklich kennt.
 */
import { describe, expect, it } from "vitest";
import { dropEmptyJournalKeys, journalDefaults, journalFromTrade, journalRecord, journalReset } from "@/journal/editor/form";
import type { Trade } from "@/domain/types";
import { journalDraftOf } from "@/views/plan/actions";

const ctx = { status: "closed" as const, side: "long" as const };
const draftSource = { symbol: "BTCUSDT", side: "long" as const, entry: 100, stop: 99, target: 102, qty: 1, notional: 100, leverage: 2, account: "scalp" as const, stopLabel: "x", targetLabel: "y", sessionLabel: "z" };

describe("Entscheidung im Editor-Formular", () => {
  it("ein unberührtes Formular schreibt nichts: kein neuer Schlüssel am Trade", () => {
    const rec = journalRecord(journalDefaults(), ctx);
    expect(rec.decision).toBeUndefined();
    expect(Object.keys(dropEmptyJournalKeys({ id: "x", ...rec }))).toEqual(["id"]);
    expect(journalFromTrade({}).decision).toBe("");
  });

  it("liest die gespeicherte Marke ins Formular und schreibt sie unverändert zurück (mit via und ref)", () => {
    const stored: Partial<Trade> = { decision: { by: "rules", via: "plan", ref: "p_1" } };
    const j = journalFromTrade(stored);
    expect(j.decision).toBe("rules");
    expect(journalRecord(j, ctx, stored).decision).toEqual({ by: "rules", via: "plan", ref: "p_1" });
  });

  it("wählt der Händler etwas anderes, gilt sein Wort: ohne via / ref; „Offen“ nimmt die Marke weg", () => {
    const j = journalFromTrade({ decision: { by: "rules", via: "box" } });
    expect(journalRecord({ ...j, decision: "own" }, ctx).decision).toEqual({ by: "own" });
    const rec = journalRecord({ ...j, decision: "" }, ctx);
    expect(rec.decision).toBeUndefined();
    expect("decision" in dropEmptyJournalKeys({ ...rec, decision: undefined })).toBe(false);
  });

  it("„Speichern & neu“ übernimmt die Entscheidung nicht in den nächsten Trade", () => {
    expect(journalReset(journalFromTrade({ decision: { by: "ai" } })).decision).toBe("");
  });
});

describe("Entwürfe, die die Herkunft schon kennen", () => {
  it("Handelsplan: das Signal des Einstiegs-Timers ist Regelwerk, ein eigener oder geplanter Einstieg ist eigene Entscheidung", () => {
    expect(journalDraftOf({ ...draftSource, entrySource: "signal" }).decision).toEqual({ by: "rules", via: "plan" });
    expect(journalDraftOf({ ...draftSource, entrySource: "manual" }).decision).toEqual({ by: "own", via: "plan" });
    expect(journalDraftOf({ ...draftSource, entrySource: "level" }).decision).toEqual({ by: "own", via: "plan" });
  });

  it("ohne Angabe zur Quelle des Einstiegs bleibt die Herkunft unbekannt (nichts geraten)", () => {
    expect("decision" in journalDraftOf(draftSource)).toBe(false);
  });

  it("der Entwurf kommt über das Formular bis in den Trade", () => {
    const draft = journalDraftOf({ ...draftSource, entrySource: "signal" });
    const j = journalFromTrade(draft);
    expect(journalRecord(j, ctx, draft).decision).toEqual({ by: "rules", via: "plan" });
  });
});
