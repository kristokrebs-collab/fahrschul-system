import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DriveLock } from "./DriveLock.js";
import { DriveLockProvider, useDriveLock } from "../state/DriveLockContext.js";

function Locked() {
  const { lock } = useDriveLock();
  useEffect(() => {
    lock("booking-1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <DriveLock />;
}

describe("DriveLock screen", () => {
  it("only exposes Notfall, Büro, and Stunde beenden – no text input fields", () => {
    render(
      <MemoryRouter>
        <DriveLockProvider>
          <Locked />
        </DriveLockProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("notfall-link")).toBeInTheDocument();
    expect(screen.getByTestId("buero-link")).toBeInTheDocument();
    expect(screen.getByTestId("stunde-beenden-link")).toBeInTheDocument();
    expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  });
});
