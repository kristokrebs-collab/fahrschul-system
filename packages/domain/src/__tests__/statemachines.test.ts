import { describe, expect, it } from "vitest";
import {
  allowedNextStates,
  assertStateTransition,
  DOKUMENT_STATES,
  FAHRZEUGMANGEL_STATES,
  isTransitionAllowed,
  STATE_LEGACY_MAP,
  STATE_MACHINE_INITIAL,
  STATE_MACHINES,
  STATE_TRANSITIONS,
  StateTransitionError,
  TERMINANGEBOT_STATES,
  terminalStates,
  ZAHLUNG_STATES,
} from "../statemachines.js";

/**
 * PROMPT -1 §10 – Die Zustandsmengen müssen WÖRTLICH der Spezifikation
 * entsprechen. Dieser Test ist absichtlich pedantisch: er vergleicht die
 * Mengen zeichengenau, damit eine "ungefähre" Umsetzung auffällt.
 */
describe("§10 state machines: exact state sets", () => {
  it("Terminangebot has exactly the specified states in order", () => {
    expect([...TERMINANGEBOT_STATES]).toEqual([
      "created",
      "sent",
      "delivered",
      "accepted",
      "booking_pending",
      "confirmed",
      "rejected",
      "expired",
      "cancelled",
      "failed_review",
    ]);
  });

  it("Dokument has exactly the specified states in order", () => {
    expect([...DOKUMENT_STATES]).toEqual([
      "uploaded",
      "quarantined",
      "scanning",
      "submitted",
      "in_review",
      "verified",
      "rejected",
      "expired",
      "deleted",
    ]);
  });

  it("Zahlung has exactly the specified states in order", () => {
    expect([...ZAHLUNG_STATES]).toEqual([
      "imported",
      "matching",
      "suggested",
      "review_required",
      "matched",
      "partially_matched",
      "reversed",
      "failed",
    ]);
  });

  it("Fahrzeugmangel has exactly the specified states in order", () => {
    expect([...FAHRZEUGMANGEL_STATES]).toEqual([
      "reported",
      "triaged",
      "vehicle_blocked",
      "replacement_pending",
      "resolved",
      "reopened",
    ]);
  });

  it("declares a transition entry and a legacy mapping for every state of every machine", () => {
    const sets: Record<string, readonly string[]> = {
      terminangebot: TERMINANGEBOT_STATES,
      dokument: DOKUMENT_STATES,
      zahlung: ZAHLUNG_STATES,
      fahrzeugmangel: FAHRZEUGMANGEL_STATES,
    };
    for (const machine of STATE_MACHINES) {
      for (const state of sets[machine]) {
        expect(STATE_TRANSITIONS[machine][state], `${machine}.${state} transitions`).toBeDefined();
        expect(STATE_LEGACY_MAP[machine][state], `${machine}.${state} legacy mapping`).toBeTruthy();
      }
      // Keine erfundenen Zustände: jede Kante zeigt auf einen gültigen Zustand.
      for (const [from, next] of Object.entries(STATE_TRANSITIONS[machine])) {
        expect(sets[machine], `${machine}.${from} is a declared state`).toContain(from);
        for (const to of next) {
          expect(sets[machine], `${machine}.${from} -> ${to} targets a declared state`).toContain(to);
        }
      }
    }
  });
});

describe("§10 allow-list enforcement", () => {
  it("allows the happy path of an offer and rejects skipping steps", () => {
    expect(isTransitionAllowed("terminangebot", "created", "sent")).toBe(true);
    expect(isTransitionAllowed("terminangebot", "sent", "accepted")).toBe(true);
    expect(isTransitionAllowed("terminangebot", "accepted", "booking_pending")).toBe(true);
    expect(isTransitionAllowed("terminangebot", "booking_pending", "confirmed")).toBe(true);
    // Sprung über die Buchung hinweg ist NICHT erlaubt.
    expect(isTransitionAllowed("terminangebot", "sent", "confirmed")).toBe(false);
    expect(isTransitionAllowed("terminangebot", "created", "confirmed")).toBe(false);
  });

  it("throws a reasoned error naming the allowed alternatives", () => {
    try {
      assertStateTransition("dokument", "uploaded", "verified");
      throw new Error("expected assertStateTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.machine).toBe("dokument");
      expect(e.from).toBe("uploaded");
      expect(e.to).toBe("verified");
      expect(e.allowed).toEqual(["scanning", "quarantined", "deleted"]);
    }
  });

  it("treats a no-op transition as allowed (idempotent job re-runs)", () => {
    expect(isTransitionAllowed("zahlung", "matched", "matched")).toBe(true);
    expect(() => assertStateTransition("zahlung", "matched", "matched")).not.toThrow();
  });

  it("only lets a matched payment leave via reversed (§3: never fully matched twice)", () => {
    expect(allowedNextStates("zahlung", "matched")).toEqual(["reversed"]);
    for (const to of ZAHLUNG_STATES) {
      if (to === "matched" || to === "reversed") continue;
      expect(isTransitionAllowed("zahlung", "matched", to), `matched -> ${to}`).toBe(false);
    }
  });

  it("never lets a document reach verified/rejected without passing in_review", () => {
    for (const from of DOKUMENT_STATES) {
      // `in_review` ist der einzige legitime Vorzustand; ein Übergang auf sich
      // selbst ist ein idempotentes No-Op und daher ausgenommen.
      if (from === "in_review") continue;
      if (from !== "verified") {
        expect(isTransitionAllowed("dokument", from, "verified"), `${from} -> verified`).toBe(false);
      }
      if (from !== "rejected") {
        expect(isTransitionAllowed("dokument", from, "rejected"), `${from} -> rejected`).toBe(false);
      }
    }
    expect(isTransitionAllowed("dokument", "in_review", "verified")).toBe(true);
    expect(isTransitionAllowed("dokument", "in_review", "rejected")).toBe(true);
  });

  it("marks the expected terminal states", () => {
    expect(terminalStates("terminangebot").sort()).toEqual(["cancelled", "expired"]);
    expect(terminalStates("dokument")).toEqual(["deleted"]);
    expect(terminalStates("fahrzeugmangel")).toEqual([]);
  });

  it("starts every machine in its declared initial state", () => {
    expect(STATE_MACHINE_INITIAL.terminangebot).toBe("created");
    expect(STATE_MACHINE_INITIAL.dokument).toBe("uploaded");
    expect(STATE_MACHINE_INITIAL.zahlung).toBe("imported");
    expect(STATE_MACHINE_INITIAL.fahrzeugmangel).toBe("reported");
  });

  it("every non-terminal state is reachable from the initial state", () => {
    for (const machine of STATE_MACHINES) {
      const seen = new Set<string>([STATE_MACHINE_INITIAL[machine]]);
      const queue = [STATE_MACHINE_INITIAL[machine]];
      while (queue.length > 0) {
        const state = queue.shift()!;
        for (const next of allowedNextStates(machine, state)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      const declared = Object.keys(STATE_TRANSITIONS[machine]);
      expect([...seen].sort(), `${machine} reachability`).toEqual(declared.sort());
    }
  });
});
