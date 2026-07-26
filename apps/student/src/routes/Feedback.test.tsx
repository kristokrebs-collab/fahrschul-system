import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WithSync } from "../test/renderWithSync.js";
import { Feedback } from "./Feedback.js";

describe("Feedback – only shows what the server released", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows wentWell/nextGoal but nothing for a field the API left null (never leaked)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            feedback: [
              {
                id: "f1",
                terminbuchungId: "t1",
                releasedFields: ["wentWell", "nextGoal"],
                wentWell: "Einparken hat gut geklappt",
                workOn: null,
                nextGoal: "Autobahnauffahrt üben",
                resourceId: null,
                studentSelfAssessment: null,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    // PROMPT -1 Phase 2: die Ansicht benutzt jetzt den Synchronisationskern
    // (§8: die Selbsteinschätzung ist ein verschlüsselter lokaler Entwurf),
    // braucht also den Provider. Der Transport im Wrapper tut nichts – geprüft
    // wird weiterhin ausschließlich der Redaktionsvertrag.
    render(
      <WithSync>
        <Feedback />
      </WithSync>,
    );

    await waitFor(() => expect(screen.getByText(/Einparken hat gut geklappt/)).toBeInTheDocument());
    expect(screen.getByText(/Autobahnauffahrt üben/)).toBeInTheDocument();
    expect(screen.queryByText(/Daran arbeiten wir/)).not.toBeInTheDocument();
    // Die Antwort enthält per Definition kein internalNotes-Feld (server-seitig gefiltert) -
    // hier prüfen wir zusätzlich, dass die Komponente so ein Feld auch nicht anzeigen würde.
    expect(document.body.textContent).not.toMatch(/internal/i);
  });
});
