import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StundeBeenden } from "./StundeBeenden.js";
import { DriveLockProvider } from "../state/DriveLockContext.js";
import { readDraft } from "../api/cache.js";

/**
 * Offline-Verhalten (Muster aus apps/student): Berichtsentwurf bleibt
 * offline lesbar/entwerfbar, das FINALE "Stunde beenden" (Mutation)
 * scheitert dagegen klar und explizit, statt still zu queuen.
 */
describe("Stunde beenden – offline behavior", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists the draft locally even while offline, but blocks the final submit", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    render(
      <MemoryRouter initialEntries={["/dokumentieren/beenden/booking-1"]}>
        <DriveLockProvider>
          <Routes>
            <Route path="/dokumentieren/beenden/:id" element={<StundeBeenden />} />
          </Routes>
        </DriveLockProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/1\) Tatsächliche Dauer/), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

    // Entwurf wurde trotz Offline lokal gespeichert.
    const draft = readDraft<{ tatsaechlicheDauerMinuten: string }>("stunde-beenden:booking-1");
    expect(draft?.data.tatsaechlicheDauerMinuten).toBe("45");

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
});
