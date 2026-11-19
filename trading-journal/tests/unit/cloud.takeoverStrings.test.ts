/**
 * Funktionsprüfung Runde 18 (account pass): two lines of the data-takeover dialog said something the takeover does not do.
 */
import { describe, expect, it } from "vitest";
import { ZERO, type TakeoverPreview, type TakeoverResult } from "@/cloud/sync/takeover";
import { effectLine, summaryLine, TAKEOVER } from "@/cloud/ui/takeoverStrings";

const result = (p: Partial<TakeoverResult>): TakeoverResult => ({ choice: "merge", pushed: 0, pulled: 0, conflicts: 0, duplicates: 0, undoUntil: null, ...p });

describe("takeover dialog: the done line and the option lines", () => {
  it("„Nur Cloud“ over an empty account: this device was replaced – not „Beide Seiten waren schon gleich.“", () => {
    expect(summaryLine(result({ choice: "cloud" }))).toBe(TAKEOVER.done.cloudOnly);
    expect(TAKEOVER.done.cloudOnly).toMatch(/Sicherung/);
    // a merge that really moved nothing keeps its line; numbers win over both
    expect(summaryLine(result({ choice: "merge" }))).toBe("Beide Seiten waren schon gleich.");
    expect(summaryLine(result({ choice: "cloud", pulled: 3 }))).toBe("3 Einträge hierher");
  });

  it("„Lokale Daten übernehmen“ names what comes to this device too (the account-only entries arrive here)", () => {
    const preview: TakeoverPreview = {
      otherOwner: false,
      local: { ...ZERO, trades: 13 },
      cloud: { ...ZERO, trades: 3 },
      same: { ...ZERO },
      localOnly: { ...ZERO, trades: 12 },
      cloudOnly: { ...ZERO, trades: 2 },
      differ: { ...ZERO, trades: 1 },
      duplicates: 0,
      settings: "same",
      cloudEmpty: false,
      allowed: ["merge", "local", "cloud", "keep"],
      recommended: "merge",
    };
    expect(effectLine("local", preview)).toBe("12 Einträge ins Konto · 1 Eintrag im Konto überschrieben · 2 Einträge hierher");
    expect(TAKEOVER.options.local.text).not.toMatch(/bleibt dort/);
    expect(TAKEOVER.options.local.text).toMatch(/kommt auf dieses Gerät dazu/);
  });
});
