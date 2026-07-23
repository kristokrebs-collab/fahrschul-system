import { describe, expect, it } from "vitest";
import { assertTransitionAllowed, possibleNextStates, PruefungTransitionError } from "../pruefungspipeline.js";

describe("Prüfungs-Pipeline state machine", () => {
  it("allows buero to move a fresh exam into voraussetzungen_fehlen", () => {
    const edge = assertTransitionAllowed("in_vorbereitung", "voraussetzungen_fehlen", "buero");
    expect(edge.to).toBe("voraussetzungen_fehlen");
  });

  it("requires an actor with role fahrlehrer for the fahrlehrer_go transition", () => {
    expect(() => assertTransitionAllowed("in_vorbereitung", "fahrlehrer_go", "buero")).toThrow(
      PruefungTransitionError,
    );
    const edge = assertTransitionAllowed("in_vorbereitung", "fahrlehrer_go", "fahrlehrer");
    expect(edge.to).toBe("fahrlehrer_go");
  });

  it("rejects a schueler actor for any transition", () => {
    expect(() => assertTransitionAllowed("in_vorbereitung", "fahrlehrer_go", "schueler")).toThrow(
      /fahrlehrer/,
    );
  });

  it("rejects transitions that skip states or go backwards where not modelled", () => {
    try {
      assertTransitionAllowed("in_vorbereitung", "ergebnis_dokumentiert", "buero");
      expect.fail("expected assertTransitionAllowed to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PruefungTransitionError);
      expect((err as PruefungTransitionError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("lists the possible next states for a given status", () => {
    expect(possibleNextStates("in_vorbereitung").sort()).toEqual(
      ["voraussetzungen_fehlen", "fahrlehrer_go"].sort(),
    );
    expect(possibleNextStates("ergebnis_dokumentiert")).toEqual([]);
  });

  it("walks the full happy path from in_vorbereitung to ergebnis_dokumentiert", () => {
    const path: Array<[Parameters<typeof assertTransitionAllowed>[0], Parameters<typeof assertTransitionAllowed>[1], Parameters<typeof assertTransitionAllowed>[2]]> = [
      ["in_vorbereitung", "fahrlehrer_go", "fahrlehrer"],
      ["fahrlehrer_go", "bueroprüfung", "buero"],
      ["bueroprüfung", "unterlagen_vollstaendig", "buero"],
      ["unterlagen_vollstaendig", "termin_angefragt", "buero"],
      ["termin_angefragt", "termin_bestaetigt", "buero"],
      ["termin_bestaetigt", "durchgefuehrt", "buero"],
      ["durchgefuehrt", "ergebnis_dokumentiert", "buero"],
    ];
    for (const [from, to, role] of path) {
      expect(() => assertTransitionAllowed(from, to, role)).not.toThrow();
    }
  });
});
