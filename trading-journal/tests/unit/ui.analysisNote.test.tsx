/**
 * AnalysisNote (Selbstprüfung): the one calm "Keine professionelle Finanzberatung." line at the end of the analysing
 * pages – default wording, a page-specific lead, the assistant's one-sentence variant – and the start page never has it.
 */
import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_BASIS, AnalysisNote, ASSISTANT_NOTE, NO_ADVICE_TEXT } from "@/ui/AnalysisNote";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("AnalysisNote", () => {
  it("says what the figures are made of and that it is no advice, in one paragraph", () => {
    render(<AnalysisNote />);
    const note = screen.getByTestId("analysis-note");
    expect(note.tagName).toBe("P");
    expect(note).toHaveTextContent(`${ANALYSIS_BASIS} ${NO_ADVICE_TEXT}`);
    expect(note.textContent).toBe("Auswertung deiner Daten und historischer Kurse – keine Prognose. Keine professionelle Finanzberatung.");
  });

  it("takes a page-specific lead but always ends with the no-advice sentence", () => {
    render(<AnalysisNote lead="Berechnet aus deinem Journal – eine Rückschau, keine Prognose." />);
    expect(screen.getByTestId("analysis-note").textContent).toBe("Berechnet aus deinem Journal – eine Rückschau, keine Prognose. Keine professionelle Finanzberatung.");
  });

  it("the assistant variant is the one standing sentence under the input", () => {
    render(<AnalysisNote variant="assistant" />);
    const note = screen.getByTestId("analysis-note");
    expect(note.textContent).toBe(ASSISTANT_NOTE);
    expect(note).toHaveAttribute("data-variant", "assistant");
    expect(note.textContent).toContain("keine professionelle Finanzberatung");
  });

  it("is set in the readable grey (text-mute: 4.5 : 1 on both themes), never in text-faint", () => {
    render(<AnalysisNote />);
    expect(screen.getByTestId("analysis-note").className).toContain("text-mute");
    expect(screen.getByTestId("analysis-note").className).not.toContain("text-faint");
  });

  it("the start page (overview, dock, header, cockpit, footer) never imports it", () => {
    const guarded = [...files("src/views/overview"), ...files("src/views/cockpit"), "src/app/Dock.tsx", "src/app/Header.tsx", "src/app/Footer.tsx", "src/App.tsx"];
    const offenders = guarded.filter((f) => /AnalysisNote/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("every analysing page and the assistant place it", () => {
    const placed = [
      "src/views/markt/MarktView.tsx",
      "src/views/analyse/AnalyseView.tsx",
      "src/views/risiko/RisikoView.tsx",
      "src/views/coach/CoachView.tsx",
      "src/views/berichte/BerichteView.tsx",
      "src/views/wachstum/WachstumView.tsx",
      "src/views/labor/LaborView.tsx",
      "src/views/studio/StudioView.tsx",
      "src/views/setups/SetupsView.tsx",
      "src/views/ueben/TrainingHost.tsx",
      "src/views/trades/whatif/WhatIfHost.tsx",
      "src/assistant/AssistantHost.tsx",
    ];
    expect(placed.filter((f) => !/<AnalysisNote/.test(read(f)))).toEqual([]);
  });
});
