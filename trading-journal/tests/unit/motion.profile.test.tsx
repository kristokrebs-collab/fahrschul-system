/**
 * The reader's motion setting (`src/motion/profile.ts`) and what reads it: versioned storage, the reduced / full rules, `useReducedFx`, the
 * `html[data-motion]` the stylesheets follow, the card in Einstellungen › Darstellung.
 */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MotionSection } from "@/app/MotionSection";
import { applyMotionMode, MOTION_KEY, MOTION_MODES, MOTION_VERSION, motionReduced, parseMotion, useMotionPref } from "@/motion/profile";
import { useReducedFx } from "@/motion/useReducedFx";

beforeEach(() => {
  localStorage.clear();
  useMotionPref.setState({ mode: "system" });
  applyMotionMode("system");
});
afterEach(() => applyMotionMode("system"));

describe("parseMotion (versioned key)", () => {
  it("reads a valid value of this version", () => {
    for (const mode of MOTION_MODES) expect(parseMotion({ v: MOTION_VERSION, mode })).toBe(mode);
  });
  it("anything unknown reads as `system` – nothing throws", () => {
    for (const bad of [null, undefined, 0, "reduced", [], {}, { v: 1 }, { v: 1, mode: "loud" }, { v: 2, mode: "reduced" }, { mode: "reduced" }]) expect(parseMotion(bad)).toBe("system");
  });
});

describe("motionReduced", () => {
  it("`reduced` always, `full` never, `system` as the device says", () => {
    expect(motionReduced("reduced", false)).toBe(true);
    expect(motionReduced("reduced", true)).toBe(true);
    expect(motionReduced("full", true)).toBe(false);
    expect(motionReduced("full", false)).toBe(false);
    expect(motionReduced("system", true)).toBe(true);
    expect(motionReduced("system", false)).toBe(false);
  });
});

describe("the store", () => {
  it("setMode stores `{ v, mode }`, writes `html[data-motion]` and refuses an unknown mode", () => {
    useMotionPref.getState().setMode("reduced");
    expect(JSON.parse(localStorage.getItem(MOTION_KEY) ?? "null")).toEqual({ v: MOTION_VERSION, mode: "reduced" });
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
    useMotionPref.getState().setMode("full");
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    useMotionPref.getState().setMode("system");
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
    useMotionPref.getState().setMode("nope" as never);
    expect(useMotionPref.getState().mode).toBe("system");
  });
});

describe("useReducedFx reads the setting", () => {
  it("`reduced` is reduced whatever the device says; `system` follows the device (jsdom: not reduced)", () => {
    const { result } = renderHook(() => useReducedFx());
    expect(result.current).toBe(false);
    act(() => useMotionPref.getState().setMode("reduced"));
    expect(result.current).toBe(true);
    act(() => useMotionPref.getState().setMode("full"));
    expect(result.current).toBe(false);
  });
});

describe("the card", () => {
  it("three profiles as a radio group; a pick is kept; the hint follows; the logo button replays; the preview does not throw without WAAPI", () => {
    render(<MotionSection />);
    const group = screen.getByRole("radiogroup", { name: "Bewegung" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(screen.getByTestId("motion-hint")).toHaveTextContent("Folgt der Einstellung");
    fireEvent.click(screen.getByRole("radio", { name: "Reduziert" }));
    expect(useMotionPref.getState().mode).toBe("reduced");
    expect(screen.getByTestId("motion-hint")).toHaveTextContent("sofort da");
    fireEvent.click(screen.getByRole("radio", { name: "Volles Profil" }));
    expect(useMotionPref.getState().mode).toBe("full");
    expect(screen.getByTestId("motion-hint")).toHaveTextContent("auch wenn dein Gerät");
    fireEvent.click(screen.getByTestId("motion-preview"));
    fireEvent.click(screen.getByTestId("motion-logo"));
  });
});
