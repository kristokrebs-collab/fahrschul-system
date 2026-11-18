/**
 * QA Runde 13: the finder's fallback by card heading matched „Datenarchiv“ for the anchor „Daten“ while the „Daten“ card of the
 * settings page was not mounted yet – „Backup“ landed on the wrong card.
 */
import { describe, expect, it } from "vitest";
import { findAnchor, headingMatch } from "@/app/featureOpen";

describe("headingMatch", () => {
  it("the heading itself, or the heading as a whole first word – never a longer word that starts the same way", () => {
    expect(headingMatch("Daten", "Daten")).toBe("exact");
    expect(headingMatch("  Daten \n", "Daten")).toBe("exact");
    expect(headingMatch("Daten · lokal", "Daten")).toBe("prefix");
    expect(headingMatch("Box-Status", "Box")).toBe("prefix");
    expect(headingMatch("Version & Speicher", "Version")).toBe("prefix");
    expect(headingMatch("Datenarchiv", "Daten")).toBeNull();
    expect(headingMatch("Datenquellen", "Daten")).toBeNull();
    expect(headingMatch("Trades2", "Trades")).toBeNull();
    expect(headingMatch("Meine Daten", "Daten")).toBeNull();
  });
});

describe("findAnchor by heading", () => {
  const layer = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  it("does not land on „Datenarchiv“ while „Daten“ is not there yet (the finder then waits for the card)", () => {
    expect(findAnchor(layer("<h2>Datenarchiv</h2><h2>Version & Speicher</h2>"), { page: "settings", heading: "Daten" } as never)).toBeNull();
  });

  it("the exact heading wins over an earlier prefix match; the test id wins over both", () => {
    const l = layer('<h2>Daten · Archiv</h2><h2>Daten</h2><div data-testid="settings-data"></div>');
    expect(findAnchor(l, { page: "settings", heading: "Daten" } as never)?.textContent).toBe("Daten");
    expect(findAnchor(l, { page: "settings", heading: "Daten", testid: "settings-data" } as never)?.getAttribute("data-testid")).toBe("settings-data");
  });
});
