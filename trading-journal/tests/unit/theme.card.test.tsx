/**
 * "Darstellung" card (P13): three mode tiles and the accents as radio groups (one tab stop each, arrows move and
 * select), a pick writes the store, the DOM (`data-theme`, `data-accent`) and storage; System names what it follows.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { nextRadio, ThemeCard } from "@/app/ThemeCard";
import { MotionRoot } from "@/motion/MotionRoot";
import { setThemeTransition, THEME_KEY, useTheme } from "@/store/themeStore";

function mount() {
  return render(
    <MotionRoot>
      <ThemeCard />
    </MotionRoot>,
  );
}

describe("ThemeCard", () => {
  beforeEach(() => {
    // the circular reveal is covered in theme.transition.test – here the switch is instant
    setThemeTransition(null);
    localStorage.removeItem(THEME_KEY);
    act(() => {
      useTheme.getState().setPref("dark");
      useTheme.getState().setAccent("signal");
    });
  });

  it("roving radio keys wrap and jump", () => {
    expect(nextRadio("ArrowRight", 2, 3)).toBe(0);
    expect(nextRadio("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadio("ArrowDown", 0, 3)).toBe(1);
    expect(nextRadio("Home", 2, 3)).toBe(0);
    expect(nextRadio("End", 0, 3)).toBe(2);
    expect(nextRadio("a", 0, 3)).toBeNull();
  });

  it("mode: Dunkel / Hell / System as a radio group with one tab stop; a click switches and persists", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: "Modus" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Dunkel", "Hell", "System"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(radios[1]!);
    expect(useTheme.getState().resolved).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toMatchObject({ pref: "light" });
    expect(within(group).getByRole("radio", { name: "Hell" })).toHaveAttribute("aria-checked", "true");
  });

  it("arrow keys move focus and select; System explains what it follows", () => {
    mount();
    const dark = screen.getByRole("radio", { name: "Dunkel" });
    dark.focus();
    fireEvent.keyDown(dark, { key: "ArrowLeft" });
    const system = screen.getByRole("radio", { name: "System" });
    expect(system).toHaveFocus();
    expect(useTheme.getState().pref).toBe("system");
    expect(document.documentElement.dataset.themePref).toBe("system");
    expect(screen.getByText(/Folgt der Einstellung deines Geräts\. Gerade: (Dunkel|Hell)\./)).toBeInTheDocument();
  });

  it("accent: one pick, written to the DOM and storage", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: "Akzent" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Signalrot", "Kobalt", "Violett"]);
    fireEvent.click(within(group).getByRole("radio", { name: "Kobalt" }));
    expect(document.documentElement.dataset.accent).toBe("kobalt");
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toMatchObject({ accent: "kobalt" });
    fireEvent.keyDown(within(group).getByRole("radio", { name: "Kobalt" }), { key: "ArrowRight" });
    expect(useTheme.getState().accent).toBe("violett");
  });
});
