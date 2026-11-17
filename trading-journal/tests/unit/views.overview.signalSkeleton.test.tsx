/**
 * Einstiegs-Check loading state (design pass v3, coordinator A): a skeleton with the evaluated card's structure, the
 * exact height of the last evaluated body at this window width when known, and the height cache itself.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOADING_TEXT } from "@/domain/signals";
import { installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  return { ...actual, useSignalCheck: () => ({ state: "loading", snapshot: null, updatedAt: 0, message: null }) };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SIGNAL_HEIGHT_KEY, SignalCard, rememberSignalHeight, reservedSignalHeight } from "@/views/overview/SignalCard";

beforeAll(() => installDomPolyfills());
const wrap = () =>
  render(
    <MotionRoot>
      <MorphDialogProvider>
        <SignalCard />
      </MorphDialogProvider>
    </MotionRoot>,
  );

const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { value: w, configurable: true });

describe("signal card height reservation", () => {
  afterEach(() => localStorage.removeItem(SIGNAL_HEIGHT_KEY));

  it("remembers the evaluated height per window width and returns it for the same width only", () => {
    setWidth(390);
    expect(reservedSignalHeight()).toBeNull();
    rememberSignalHeight(1932);
    expect(reservedSignalHeight()).toBe(1932);
    setWidth(1692);
    expect(reservedSignalHeight()).toBeNull();
    rememberSignalHeight(872);
    expect(reservedSignalHeight()).toBe(872);
    setWidth(390);
    expect(reservedSignalHeight()).toBe(1932);
  });

  it("keeps the six most recent widths and ignores garbage", () => {
    for (let w = 300; w < 1100; w += 100) {
      setWidth(w);
      rememberSignalHeight(1000 + w);
    }
    const stored = JSON.parse(localStorage.getItem(SIGNAL_HEIGHT_KEY)!) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(6);
    expect(stored["1000"]).toBe(2000);
    expect(stored["300"]).toBeUndefined();
    localStorage.setItem(SIGNAL_HEIGHT_KEY, "{not json");
    expect(reservedSignalHeight()).toBeNull();
    localStorage.setItem(SIGNAL_HEIGHT_KEY, JSON.stringify({ "1000": "x", "900": 5 }));
    setWidth(1000);
    expect(reservedSignalHeight()).toBeNull();
  });
});

describe("SignalCard loading state", () => {
  afterEach(() => localStorage.removeItem(SIGNAL_HEIGHT_KEY));

  it("shows the structural skeleton (bias, ladder of 4 rungs, three parts, zone + reasons, note) with the loading text inside", () => {
    setWidth(390);
    wrap();
    const sk = screen.getByTestId("signal-skeleton");
    expect(sk.children).toHaveLength(5);
    expect(within(sk).getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(sk).not.toHaveAttribute("data-reserved");
    expect(sk.style.height).toBe("");
    // the note line of the evaluated card is reserved (invisible) so the header keeps its height
    expect(screen.getByTestId("signal-card").textContent).toContain("live · ");
  });

  it("reserves the exact height of the last evaluated card at this width", () => {
    setWidth(1692);
    rememberSignalHeight(872);
    wrap();
    const sk = screen.getByTestId("signal-skeleton");
    expect(sk).toHaveAttribute("data-reserved", "872");
    expect(sk.style.height).toBe("872px");
  });
});
