import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RequireUnlocked } from "./RequireUnlocked.js";
import { DriveLockProvider, useDriveLock } from "../state/DriveLockContext.js";

function Protected() {
  return <p>Geschützter Inhalt (Termine/Schüler/etc.)</p>;
}

function LockedGate() {
  const { locked } = useDriveLock();
  return <p>drivelock:{String(locked)}</p>;
}

function AutoLock() {
  const { lock } = useDriveLock();
  useEffect(() => {
    lock("booking-1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("RequireUnlocked route guard", () => {
  it("renders the protected route normally when unlocked", () => {
    render(
      <MemoryRouter initialEntries={["/heute"]}>
        <DriveLockProvider>
          <Routes>
            <Route
              path="/heute"
              element={
                <RequireUnlocked>
                  <Protected />
                </RequireUnlocked>
              }
            />
            <Route path="/drivelock" element={<LockedGate />} />
          </Routes>
        </DriveLockProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Geschützter Inhalt/)).toBeInTheDocument();
  });

  it("redirects any other route to /drivelock while a lesson is started, so it is unreachable", () => {
    render(
      <MemoryRouter initialEntries={["/heute"]}>
        <DriveLockProvider>
          <AutoLock />
          <Routes>
            <Route
              path="/heute"
              element={
                <RequireUnlocked>
                  <Protected />
                </RequireUnlocked>
              }
            />
            <Route path="/drivelock" element={<LockedGate />} />
          </Routes>
        </DriveLockProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Geschützter Inhalt/)).toBeNull();
    expect(screen.getByText("drivelock:true")).toBeInTheDocument();
  });
});
