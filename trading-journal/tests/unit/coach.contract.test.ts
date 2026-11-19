/**
 * Behaviour events contract (`src/domain/coach/events.ts`, Wave 0).
 */
import { describe, expect, it } from "vitest";
import { BEHAVIOR_KEYS, BEHAVIOR_LABEL, detectBehaviors } from "@/domain/coach/events";
import { defaultSettings } from "@/domain/defaults";

describe("behaviour events", () => {
  it("every key has a German label", () => {
    expect(Object.keys(BEHAVIOR_LABEL).sort()).toEqual([...BEHAVIOR_KEYS].sort());
    for (const k of BEHAVIOR_KEYS) expect(BEHAVIOR_LABEL[k].length).toBeGreaterThan(2);
  });

  it("an empty journal has no events", () => {
    expect(detectBehaviors({ trades: [], settings: defaultSettings(), now: 0 })).toEqual([]);
  });
});
