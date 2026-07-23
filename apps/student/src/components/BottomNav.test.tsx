import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./BottomNav.js";

describe("BottomNav – required tabs + basic accessibility", () => {
  it("exposes exactly the five required tabs, each with an accessible name", () => {
    render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(nav).toBeInTheDocument();

    for (const label of ["Heute", "Ausbildung", "Termine", "Lernen", "Mehr"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("icons are decorative (aria-hidden) so screen readers only announce the label", () => {
    const { container } = render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>,
    );
    const icons = container.querySelectorAll('[aria-hidden="true"]');
    expect(icons.length).toBe(5);
  });
});
