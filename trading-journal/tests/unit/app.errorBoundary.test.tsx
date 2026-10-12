/**
 * Error boundary (P13): the three sizes (app with "Neu laden", page with "Erneut versuchen", widget tile), the dot
 * matrix "ERR" mark (seeded glitch frames that rest on the clean word), every catch reported (source "boundary"),
 * retry re-mounts the children and `resetKeys` re-arms the boundary (page switch).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, ERROR_STRINGS, glitchFrames } from "@/app/ErrorBoundary";
import { textFrame } from "@/motion";

vi.mock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), reportError: vi.fn() }));
const { reportError } = await import("@/cloud");

let broken = true;
function Flaky({ label = "Inhalt" }: { label?: string }) {
  if (broken) throw new Error("Testfehler 42");
  return <p>{label}</p>;
}

describe("ErrorBoundary", () => {
  beforeAll(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    broken = true;
    vi.mocked(reportError).mockClear();
  });

  it("glitch frames are seeded, corrupted, and end on the clean word", () => {
    const a = glitchFrames("ERR");
    const b = glitchFrames("ERR");
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
    expect(a.at(-1)).toEqual(textFrame("ERR"));
    expect(a.slice(0, -1).some((f) => JSON.stringify(f) !== JSON.stringify(textFrame("ERR")))).toBe(true);
  });

  it("page: the ERR mark, the honest copy, the details, and it reports the catch", () => {
    render(
      <ErrorBoundary variant="page">
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-boundary", "page");
    expect(screen.getByRole("heading", { level: 1, name: ERROR_STRINGS.title })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ERR" })).toBeInTheDocument();
    expect(screen.getByText("Testfehler 42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neu laden" })).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Testfehler 42" }), expect.objectContaining({ source: "boundary", extra: { variant: "page" } }));
  });

  it("Erneut versuchen re-mounts the children once the cause is gone", () => {
    render(
      <ErrorBoundary variant="page">
        <Flaky />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("app: full stage, Neu laden reloads the page, no retry", () => {
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, reload } });
    try {
      render(
        <ErrorBoundary variant="app">
          <Flaky />
        </ErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toHaveAttribute("data-error-boundary", "app");
      expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Neu laden" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  it("widget: a compact tile naming what broke", () => {
    render(
      <ErrorBoundary variant="widget" label="Monte Carlo">
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-boundary", "widget");
    expect(alert).toHaveTextContent("Monte Carlo: Dieses Widget hat einen Fehler.");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("resetKeys: a page switch re-arms the boundary", () => {
    function Shell() {
      const [page, setPage] = useState("trades");
      return (
        <>
          <button onClick={() => setPage("setups")}>Setups</button>
          <ErrorBoundary variant="page" resetKeys={[page]}>
            <Flaky label={page} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Shell />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Setups" }));
    expect(screen.getByText("setups")).toBeInTheDocument();
  });

  it("a custom fallback still gets the error and the retry", () => {
    render(
      <ErrorBoundary fallback={(e, retry) => <button onClick={retry}>{e.message}</button>}>
        <Flaky />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Testfehler 42" }));
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
