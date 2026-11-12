/**
 * Paket P – the quiet "Weiter, wo du aufgehört hast" line of the Konto page: only for a setup that was begun and paused, with the real
 * progress and no deadline; the Konto page carries it, the Übersicht and the Cockpit never do.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RESUME_NOTE, WizardResumeNote } from "@/onboarding/wizard/WizardResumeNote";
import { useWizard, WIZARD_KEY } from "@/onboarding/wizard/wizardStore";

const store = (status: string, step = 0) => localStorage.setItem(WIZARD_KEY, JSON.stringify({ v: 1, status, step, data: "demo", at: "2026-11-08T10:00:00Z" }));

beforeEach(() => {
  localStorage.clear();
  useWizard.setState({ open: false, step: 0, data: null, loaded: false });
});

describe("WizardResumeNote", () => {
  it("shows the real progress and the way back for an `active` setup", () => {
    store("active", 2);
    render(<WizardResumeNote />);
    expect(screen.getByTestId("wizard-resume")).toHaveTextContent("2 von 4 Schritten durchgegangen – als Nächstes: Verbindung.");
    expect(screen.getByRole("button", { name: RESUME_NOTE.resume })).toBeInTheDocument();
    expect(screen.getByTestId("wizard-resume").textContent).not.toMatch(/nur noch|schnell|verpass|\d+ ?%|Frist|bis zum/i);
  });

  it("is absent for a setup that is finished, declined, only armed or never started", () => {
    for (const status of ["done", "skipped", "pending"]) {
      localStorage.clear();
      store(status, 2);
      const { container, unmount } = render(<WizardResumeNote />);
      expect(container, status).toBeEmptyDOMElement();
      unmount();
    }
    localStorage.clear();
    const { container } = render(<WizardResumeNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the button opens the wizard at the stored step, and the note steps aside while it is open", () => {
    store("active", 3);
    render(<WizardResumeNote />);
    fireEvent.click(screen.getByTestId("wizard-resume-open"));
    expect(useWizard.getState()).toMatchObject({ open: true, step: 3 });
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
    act(() => useWizard.setState({ open: false }));
    expect(screen.getByTestId("wizard-resume")).toHaveTextContent("3 von 4 Schritten");
  });

  it("belongs to the Konto page only – not to the Übersicht, the Cockpit or the app shell", () => {
    const src = (f: string) => readFileSync(join(__dirname, "..", "..", f), "utf8");
    expect(src("src/views/konto/KontoView.tsx")).toContain("WizardResumeNote");
    for (const f of ["src/views/overview/OverviewView.tsx", "src/views/cockpit/CockpitView.tsx", "src/App.tsx"]) {
      try {
        expect(src(f), f).not.toContain("WizardResumeNote");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  });
});
