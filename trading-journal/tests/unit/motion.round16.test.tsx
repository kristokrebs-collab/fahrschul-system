/**
 * Runde 16 (motion review, measured in the running app – `docs/ANIMATIONEN-MATRIX.md`, „Runde 16“): exits that LEAVE instead of
 * blinking out. These tests pin the contracts; order, presence and the curves were measured frame by frame in the browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tween } from "@/motion/tokens";

const read = (p: string) => readFileSync(p, "utf8");

describe("Sheet: a sheet without a morph leaves (exitStyle)", () => {
  const sheet = read("src/motion/Sheet.tsx");

  it("the tokens: the panel follows its contents a beat later and accelerates out, the dim takes exactly that whole way", () => {
    // contents fade on `tween.exit`; the emptied panel starts before they are fully gone, never before they started
    expect(tween.sheetLeave.delay).toBeGreaterThan(0);
    expect(tween.sheetLeave.delay).toBeLessThanOrEqual(tween.exit.duration);
    // ease-in (accelerating): the same curve as every large surface that leaves
    expect(tween.sheetLeave.ease).toEqual(tween.exitSurface.ease);
    expect(tween.dimLeave.ease).toEqual(tween.exitSurface.ease);
    // before Runde 16 the dim was gone (0.12 s) while the panel still stood at full opacity: now both end in the same frame
    expect(tween.dimLeave.duration).toBeCloseTo(tween.sheetLeave.delay + tween.sheetLeave.duration, 5);
  });

  it("an exit is shorter than its entrance: the phone sheet drops out faster than it came", () => {
    expect(tween.sheetDrop.duration).toBeLessThan(tween.sheetIos.duration);
    expect(tween.dimLeave.duration).toBeLessThan(tween.sheetIos.duration);
    expect(tween.sheetDrop.ease).toEqual(tween.exitSurface.ease);
  });

  it("the default is `leave`; a morphing sheet (layoutId) is never touched by it", () => {
    expect(sheet).toMatch(/exitStyle = "leave"/);
    expect(sheet).toMatch(/const leave = exitStyle === "leave" && !morph;/);
    // the phone sheet keeps its contents inside on the way out ("ride"), a fling keeps its own physics
    expect(sheet).toMatch(/flung \?\? \(leave && !desktop \? "ride" : null\)/);
  });

  it("guard rail: „Trade eintragen / bearbeiten“ keeps the exit it had – it is the only sheet that asks for `classic`", () => {
    expect(read("src/overlays/TradeEditor.tsx")).toMatch(/exitStyle="classic"/);
    const others = [
      "src/overlays/SetupEditor.tsx",
      "src/app/ShortcutSheet.tsx",
      "src/legal/LegalSheet.tsx",
      "src/views/wachstum/CheckInSheet.tsx",
      "src/billing/ui/UpgradeSheet.tsx",
      "src/exchanges/csv/CsvImportSheet.tsx",
    ];
    for (const file of others) expect(read(file), file).not.toMatch(/exitStyle=/);
  });
});
