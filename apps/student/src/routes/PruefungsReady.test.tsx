import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PruefungsReady } from "./PruefungsReady.js";

const sample = {
  dataAsOf: new Date().toISOString(),
  formalPrerequisites: [{ typ: "sehtest", vorhanden: true, geprueft: true }],
  theoryStatus: { assignedResources: 0, visitedResources: 0, note: "Hinweis" },
  mandatoryDrives: { klasse: "B", done: { ueberland: 1 }, required: { ueberland: 5 } },
  competencyAreas: { source: "feedback.wentWell", items: [] },
  openLearningGoals: [],
  instructorClearance: { status: "offen", grantedAt: null },
  officeReview: { status: "offen" },
  disclaimer: "Keine zusammenfassende Kennzahl.",
};

describe("PruefungsReady – strictly read-only for students", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the individual facts but offers NO action to set a clearance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(sample), { status: 200 })));

    render(<PruefungsReady />);

    await waitFor(() => expect(screen.getByText(/Formale Voraussetzungen/)).toBeInTheDocument());

    // Es gibt keinerlei Button/Formular auf dieser Seite – nur Anzeige.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText(/Fahrlehrerfreigabe/)).toBeInTheDocument();
    expect(screen.getByText(/Keine zusammenfassende Kennzahl/)).toBeInTheDocument();
  });
});
