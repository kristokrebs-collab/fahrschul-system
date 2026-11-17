/**
 * Runde 12 – the search answers by TASK: „Trade suchen“, „Screenshot finden“, „Alarm konfigurieren“, „Simulation öffnen“ lead to the function that
 * does it – first in the list, with the field or card it lands on – not just somewhere into the function index.
 */
import { describe, expect, it } from "vitest";
import { featureById } from "@/app/features";
import { searchTargets } from "@/app/featureQuery";

const first = (q: string) => searchTargets(q)[0]?.entry;

describe("task phrases of the search", () => {
  it("„Trade suchen“ / „Trade finden“ → the search field of the trade list (and not a page that merely has „Trade“ in its name)", () => {
    for (const q of ["Trade suchen", "trade finden", "trade nach symbol suchen"]) expect(first(q)?.id, q).toBe("trade-filter");
    expect(featureById("trade-filter")?.anchor).toEqual({ testid: "trades-search" });
    expect(featureById("trade-filter")?.page).toBe("trades");
    // a function that needs trades says so instead of silently landing at the top
    expect(featureById("trade-filter")?.needs).toMatch(/Trade/);
  });

  it("„Screenshot finden“ / „Screenshot suchen“ → the stored screenshots with their hashes (import stays the answer to „hochladen“)", () => {
    for (const q of ["Screenshot finden", "screenshot suchen", "Bild finden", "gespeicherte Screenshots ansehen"]) expect(first(q)?.id, q).toBe("bild-originale");
    expect(first("screenshot hochladen")?.id).toBe("screenshot-ocr");
    expect(featureById("bild-originale")?.page).toBe("settings");
  });

  it("„Alarm konfigurieren“ → the alarms card with its channels, quiet times and protocol", () => {
    for (const q of ["Alarm konfigurieren", "alarm einstellen", "alarm einrichten"]) expect(first(q)?.id, q).toBe("alarme");
    expect(featureById("alarme")?.anchor).toEqual({ testid: "alerts-card" });
  });

  it("„Simulation öffnen“ / „Simulation starten“ → the Zeitmaschine section where the scenarios are computed", () => {
    for (const q of ["Simulation öffnen", "simulation starten", "Simulation", "szenarien berechnen", "10000 szenarien"]) expect(first(q)?.id, q).toBe("zeitmaschine");
    expect(featureById("zeitmaschine")?.anchor).toEqual({ testid: "tm-section" });
    expect(featureById("zeitmaschine")?.page).toBe("labor");
  });

  it("the neighbours stay where they were: „Trade eintragen“ still opens the editor, „Abo verwalten“ the plan", () => {
    expect(first("trade eintragen")?.id).toBe("trade-eintragen");
    expect(first("abo verwalten")?.id).toBe("abo");
  });
});
