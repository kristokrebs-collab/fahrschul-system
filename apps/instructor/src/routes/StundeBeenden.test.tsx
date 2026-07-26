import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StundeBeenden } from "./StundeBeenden.js";
import { DriveLockProvider } from "../state/DriveLockContext.js";
import { WithSync } from "../test/renderWithSync.js";

function renderScreen() {
  return render(
    // PROMPT -1 Phase 2: "Stunde beenden" ist ein KRITISCHER Vorgang und
    // läuft jetzt über die persistente Vorgangsliste (§7) – die Ansicht
    // braucht deshalb den Provider. Der Wrapper stellt einen Transport
    // bereit, der nichts tut; geprüft wird weiterhin nur der Wizard.
    <MemoryRouter initialEntries={["/dokumentieren/beenden/booking-1"]}>
      <WithSync>
        <DriveLockProvider>
          <Routes>
            <Route path="/dokumentieren/beenden/:id" element={<StundeBeenden />} />
          </Routes>
        </DriveLockProvider>
      </WithSync>
    </MemoryRouter>,
  );
}

describe("Stunde beenden – mandatory ordered flow (client wizard)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts on step 1 (Dauer) and cannot advance until it is filled", () => {
    renderScreen();
    expect(screen.getByText(/Schritt 1 von 8/)).toBeInTheDocument();
    const weiter = screen.getByRole("button", { name: "Weiter" });
    expect(weiter).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/1\) Tatsächliche Dauer/), { target: { value: "45" } });
    expect(weiter).not.toBeDisabled();
  });

  it("does not skip ahead to bestätigung without going through every step in order", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/1\) Tatsächliche Dauer/), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText(/Schritt 2 von 8/)).toBeInTheDocument();
    // Kurznotiz/nächstes Ziel/Feedback-Felder sind auf Schritt 2 noch nicht sichtbar.
    expect(screen.queryByLabelText(/5\) Kurznotiz/)).toBeNull();
  });

  it("keeps the confirmation as the final, explicit step", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/1\) Tatsächliche Dauer/), { target: { value: "45" } });
    for (let i = 0; i < 7; i++) {
      const weiter = screen.queryByRole("button", { name: "Weiter" });
      if (!weiter) break;
      if (!weiter.hasAttribute("disabled")) {
        fireEvent.click(weiter);
        continue;
      }
      // Pflichtfeld des aktuellen Schritts füllen.
      const field = document.querySelector("input:not([type=checkbox]), textarea, select") as HTMLInputElement;
      fireEvent.change(field, { target: { value: "Wert" } });
      fireEvent.click(weiter);
    }
    expect(screen.getByText(/8\) Bestätigung/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bestätigen & Stunde beenden/ })).toBeInTheDocument();
  });
});
