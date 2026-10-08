import { describe, expect, it } from "vitest";
import { overviewScenario, RANGE_TITLE, shownScenarioKey } from "@/app/overviewScenario";
import { scenario } from "@/domain/trigger";
import type { MarketLevels } from "@/domain/types";

const m = { longTrigger: 85_900, longStop: 85_300, shortTrigger: 84_500, invalidation: 75_500 } as MarketLevels;

describe("overviewScenario (decision 13: no general short trigger on the Übersicht)", () => {
  it("passes the long and bear scenarios through unchanged", () => {
    const long = scenario(86_000, m);
    const bear = scenario(75_000, m);
    expect(overviewScenario(long, m)).toBe(long);
    expect(overviewScenario(bear, m)).toBe(bear);
  });

  it("a close under the short level and a close in the range both read as the neutral range (long trigger + invalidation only)", () => {
    const expected = { key: "range", tone: "mute", title: RANGE_TITLE, detail: "4H-Schluss unter dem Long-Trigger 85.900, über der Invalidierung 75.500. Abwarten – den Einstieg prüft der Einstiegs-Check." };
    expect(scenario(84_000, m)?.key).toBe("short");
    expect(overviewScenario(scenario(84_000, m), m)).toEqual(expected);
    expect(overviewScenario(scenario(85_000, m), m)).toEqual(expected);
    expect(JSON.stringify(overviewScenario(scenario(84_000, m), m))).not.toMatch(/Short|84\.500/);
  });

  it("without an invalidation level the range names the long trigger only; null stays null", () => {
    expect(overviewScenario(scenario(85_000, { ...m, invalidation: 0 }), { ...m, invalidation: 0 })?.detail).toBe(
      "4H-Schluss unter dem Long-Trigger 85.900. Abwarten – den Einstieg prüft der Einstiegs-Check.",
    );
    expect(overviewScenario(null, m)).toBeNull();
  });

  it("a persisted `short` key compares as the range (no toast for a change that is not shown)", () => {
    expect(shownScenarioKey("short")).toBe("range");
    expect(shownScenarioKey("long")).toBe("long");
    expect(shownScenarioKey("bear")).toBe("bear");
    expect(shownScenarioKey("range")).toBe("range");
  });
});
