import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./BottomNav.js";
import { DriveLockProvider, useDriveLock } from "../state/DriveLockContext.js";

function LockButton() {
  const { lock } = useDriveLock();
  return (
    <button type="button" onClick={() => lock("booking-1")}>
      Stunde starten
    </button>
  );
}

/**
 * Non-Negotiable: "write a test asserting other nav is unreachable while
 * locked". Prüft, dass die BottomNav-Links im DOM verschwinden (nicht nur
 * per CSS versteckt sind), sobald Drive Lock Mode aktiv ist.
 */
describe("Drive Lock Mode restricts navigation", () => {
  it("renders all five nav tabs while unlocked", () => {
    render(
      <MemoryRouter>
        <DriveLockProvider>
          <BottomNav />
        </DriveLockProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("removes every nav link from the DOM once locked (not just visually hidden)", () => {
    render(
      <MemoryRouter>
        <DriveLockProvider>
          <LockButton />
          <BottomNav />
        </DriveLockProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(5);

    fireEvent.click(screen.getByText("Stunde starten"));

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByLabelText("Hauptnavigation")).toBeNull();
  });
});
