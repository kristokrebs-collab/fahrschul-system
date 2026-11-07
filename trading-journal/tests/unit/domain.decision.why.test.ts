import { describe, expect, it } from "vitest";
import { explainDecision, lateEntry, lateMaxROf, LATE_MAX_R_DEFAULT, withLateMaxR, type WhyInput } from "@/domain/decision";
import type { GradedPart } from "@/domain/signals/parts";
import type { TfCheck } from "@/domain/signals/verdict";

const CFG = { ladder: ["30m", "45m", "1h", "4h"], required: 2, rsiOs: 30, rsiOb: 70, rsiNear: 10 };

function check(tf: string, over: Partial<TfCheck> = {}): TfCheck {
  return { tf, ok: true, closeAt: 0, rsi: 36, rsiMa: 40, wt: {} as TfCheck["wt"], zone: { zone: "discount", pos: 0.3 } as TfCheck["zone"], longSignal: true, shortSignal: false, rsiLong: true, rsiShort: false, ...over } as TfCheck;
}
const part = (over: Partial<GradedPart> & Pick<GradedPart, "id">): GradedPart =>
  ({ side: "long", label: over.id, grade: 1, points: 5, weight: 5, ok: true, bonus: true, state: "confirmed", data: true, items: [], detail: "3 von 4", ...over }) as GradedPart;

function input(over: Partial<WhyInput> = {}): WhyInput {
  return {
    side: "long",
    verdict: { valid: true, rsiOk: true, zoneOk: true, tiers: 3, strength: 3, score: 80, strongSignal: true, label: "Starker Long-Einstieg", state: "confirmed", parts: [] },
    other: { valid: false, strength: 0, label: "Kein Signal" },
    checks: [check("30m"), check("45m"), check("1h"), check("4h", { longSignal: false })],
    zone: check("4h"),
    cfg: CFG,
    knife: null,
    lage: null,
    price: 100,
    plan: { trigger: 100, stop: 98 },
    feed: "ok",
    ...over,
  };
}

describe("explainDecision – groups", () => {
  it("all required conditions met, nothing against it → Handeln, each row with a reason", () => {
    const w = explainDecision(input());
    expect(w.decision).toBe("trade");
    expect(w.headline).toBe("Handeln – alle Pflichtbedingungen erfüllt");
    expect(w.required.map((r) => [r.id, r.status])).toEqual([
      ["ladder", "met"],
      ["rsi", "met"],
      ["closed", "met"],
      ["stop", "met"],
    ]);
    expect(w.required.every((r) => r.reason.length > 10)).toBe(true);
    expect(w.contradictions).toEqual([]);
    expect(w.late.status).toBe("ok");
  });

  it("separates required, optional, contradictions and missing data", () => {
    const w = explainDecision(
      input({
        verdict: {
          valid: true,
          rsiOk: true,
          zoneOk: false,
          tiers: 2,
          strength: 1,
          score: 62,
          strongSignal: false,
          label: "Long-Einstieg",
          state: "confirmed",
          parts: [part({ id: "traders", label: "Top-Trader", ok: false, grade: 0.25, detail: "1 von 4" }), part({ id: "div", label: "Divergenz", data: false, ok: false }), part({ id: "sr", label: "Support", detail: "am Level" })],
        },
        other: { valid: true, strength: 2, label: "Short-Einstieg" },
        checks: [check("30m"), check("45m"), check("1h", { longSignal: false, shortSignal: true }), null],
        zone: check("4h", { zone: { zone: "premium", pos: 0.8 } as TfCheck["zone"] }),
        plan: { trigger: 100, stop: null },
      }),
    );
    expect(w.optional.map((r) => r.id)).toEqual(["zone", "strong", "part:traders", "part:sr"]);
    expect(w.optional.find((r) => r.id === "part:traders")!.status).toBe("unmet");
    expect(w.contradictions.map((r) => r.id)).toEqual(["other", "zone-against", "against:1h"]);
    expect(w.missing.map((r) => r.id)).toEqual(expect.arrayContaining(["stop", "part:div", "rung:4h"]));
    expect(w.missing.every((r) => r.status === "unknown")).toBe(true);
    expect(w.decision).toBe("caution");
  });

  it("missing data is never reported as met or as unmet", () => {
    const w = explainDecision(input({ checks: [check("30m"), null, null, null], verdict: { ...input().verdict, tiers: 1 } }));
    const ladder = w.required.find((r) => r.id === "ladder")!;
    expect(ladder.status).toBe("unknown");
    expect(ladder.reason).toContain("45m");
    expect(w.decision).toBe("unclear");
  });
});

describe("a high score never overrides a failed required condition", () => {
  it.each([
    ["ladder", { tiers: 1 }, "Zeiteinheiten bestätigen"],
    ["rsi", { rsiOk: false }, "RSI"],
    ["closed", { state: "provisional" as const }, "Signalkerze"],
  ])("%s fails with score 99 → Auslassen", (_id, patch, label) => {
    const w = explainDecision(input({ verdict: { ...input().verdict, score: 99, strength: 4, valid: true, ...patch } }));
    expect(w.decision).toBe("skip");
    expect(w.headline).toBe("Auslassen – Pflichtbedingung fehlt");
    expect(w.summary).toContain(label);
    expect(w.scoreNote).toContain("Score 99");
    expect(w.scoreNote).toContain("ersetzt keine Pflichtbedingung");
  });
  it("the Lage gate blocks a long (required), but not a short", () => {
    const lage = { on: true, hasData: true };
    const blocked = { ...input().verdict, lage: { blocked: true, counts: false, label: "Lage rot – fällt noch", state: "red" } } as WhyInput["verdict"];
    expect(explainDecision(input({ verdict: blocked, lage })).decision).toBe("skip");
    expect(explainDecision(input({ side: "short", verdict: blocked, lage })).required.some((r) => r.id === "lage")).toBe(false);
  });
  it("a Lage without data leaves a long unbeurteilbar, not green", () => {
    const w = explainDecision(input({ lage: { on: true, hasData: false } }));
    expect(w.decision).toBe("unclear");
    expect(w.missing.some((r) => r.id === "lage")).toBe(true);
  });
  it("a stop on the wrong side is a failed required condition", () => {
    const w = explainDecision(input({ plan: { trigger: 100, stop: 101 } }));
    expect(w.decision).toBe("skip");
    expect(w.required.find((r) => r.id === "stop")!.reason).toContain("so ist kein Long möglich");
    expect(explainDecision(input({ side: "short", plan: { trigger: 100, stop: 99 } })).decision).toBe("skip");
  });
  it("stale data cannot confirm anything: unbeurteilbar", () => {
    const w = explainDecision(input({ feed: "stale" }));
    expect(w.decision).toBe("unclear");
    expect(w.missing[0]!.reason).toContain("veraltet");
  });
});

describe("zu spät", () => {
  it("is late beyond 0.5 R of the planned risk past the trigger, and says by how much", () => {
    // risk 2 points; 0.5 R = 1 point
    expect(lateEntry("long", { trigger: 100, stop: 98 }, 101, 0.5).status).toBe("ok");
    const late = lateEntry("long", { trigger: 100, stop: 98 }, 101.2, 0.5);
    expect(late.status).toBe("late");
    expect(late.movedR).toBeCloseTo(0.6, 9);
    expect(late.risk).toBe(2);
    expect(late.text).toContain("Zu spät");
    expect(late.text).toContain("0,60 R");
    expect(late.text).toContain("erlaubt sind 0,5 R");
  });
  it("short mirrors it", () => {
    expect(lateEntry("short", { trigger: 100, stop: 102 }, 98.9, 0.5).status).toBe("late");
    expect(lateEntry("short", { trigger: 100, stop: 102 }, 99.1, 0.5).status).toBe("ok");
  });
  it("the limit is configurable", () => {
    expect(lateEntry("long", { trigger: 100, stop: 98 }, 101.2, 1).status).toBe("ok");
    expect(lateEntry("long", { trigger: 100, stop: 98 }, 100.4, 0.1).status).toBe("late");
  });
  it("a price below the trigger, or beyond the stop, is not 'late' (the second is dead)", () => {
    expect(lateEntry("long", { trigger: 100, stop: 98 }, 99, 0.5)).toMatchObject({ status: "ok" });
    const dead = lateEntry("long", { trigger: 100, stop: 98 }, 97, 0.5);
    expect(dead.beyondStop).toBe(true);
    expect(dead.text).toContain("erledigt");
  });
  it("without trigger, stop or price nothing is claimed", () => {
    expect(lateEntry("long", { trigger: 100, stop: null }, 105).status).toBe("unknown");
    expect(lateEntry("long", { trigger: null, stop: 98 }, 105).status).toBe("unknown");
    expect(lateEntry("long", null, 105).status).toBe("unknown");
    expect(lateEntry("long", { trigger: 100, stop: 98 }, null).status).toBe("unknown");
    expect(lateEntry("long", { trigger: 100, stop: 100 }, 105).status).toBe("unknown");
  });
  it("a late entry is skipped although every required condition holds and the score is high", () => {
    const w = explainDecision(input({ price: 101.5, plan: { trigger: 100, stop: 98 } }));
    expect(w.required.every((r) => r.status === "met")).toBe(true);
    expect(w.decision).toBe("skip");
    expect(w.headline).toBe("Auslassen – zu spät");
    expect(w.summary).toContain("Zu spät");
    expect(w.scoreNote).toContain("Score 80");
  });
  it("the configured limit applies (maxLateR)", () => {
    expect(explainDecision(input({ price: 101.5, maxLateR: 1 })).decision).toBe("trade");
  });
});

describe("settings.signals.lateMaxR", () => {
  it("defaults to 0.5, clamps, keeps every other key", () => {
    expect(lateMaxROf(undefined)).toBe(LATE_MAX_R_DEFAULT);
    expect(lateMaxROf({ lateMaxR: 0.75 })).toBe(0.75);
    expect(lateMaxROf({ lateMaxR: 99 })).toBe(3);
    expect(lateMaxROf({ lateMaxR: 0 })).toBe(0.1);
    expect(lateMaxROf({ lateMaxR: "x" })).toBe(0.5);
    const signals = { ladder: ["30m"], odd: 1 };
    expect(withLateMaxR(signals, 1)).toEqual({ ladder: ["30m"], odd: 1, lateMaxR: 1 });
    const same = { lateMaxR: 1 };
    expect(withLateMaxR(same, 1)).toBe(same);
  });
});
