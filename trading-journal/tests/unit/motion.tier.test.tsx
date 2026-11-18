/**
 * The plan's motion profile (`src/motion/tier.ts`): the mapping, and that the tier comes from the confirmed plan and nothing else.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMotionMode, useMotionPref } from "@/motion/profile";
import { bindTierSource, currentMotionTier, motionTierOf, resetMotionTier, setMotionTier, TIER_INTRO_MS, useMotionTierSync, type MotionTier } from "@/motion/tier";

const html = document.documentElement;

beforeEach(() => {
  resetMotionTier();
  useMotionPref.setState({ mode: "system" });
  applyMotionMode("system");
});
afterEach(() => resetMotionTier());

describe("motionTierOf", () => {
  it("maps the four plans; anything else is the calm Free profile", () => {
    expect(motionTierOf("free")).toBe("free");
    expect(motionTierOf("pro")).toBe("pro");
    expect(motionTierOf("premium")).toBe("premium");
    expect(motionTierOf("team")).toBe("team");
    for (const x of [null, undefined, "", "enterprise", "PRO", "gold"]) expect(motionTierOf(x)).toBe("free");
  });
});

describe("setMotionTier takes only the confirmed tier", () => {
  it("does nothing while no source is bound (not before the shell mounted)", () => {
    expect(setMotionTier("premium")).toBe(false);
    expect(html.hasAttribute("data-motion-tier")).toBe(false);
    expect(currentMotionTier()).toBeNull();
  });

  it("a tier that is not the one the source names is refused – a flag, a devtools write, a stale caller change nothing", () => {
    let confirmed: MotionTier = "free";
    bindTierSource(() => confirmed);
    expect(setMotionTier("premium")).toBe(false);
    expect(html.hasAttribute("data-motion-tier")).toBe(false);
    expect(setMotionTier("free")).toBe(true);
    expect(html.getAttribute("data-motion-tier")).toBe("free");
    expect(setMotionTier("team")).toBe(false);
    expect(html.getAttribute("data-motion-tier")).toBe("free");
    confirmed = "pro";
    expect(setMotionTier("pro")).toBe(true);
    expect(html.getAttribute("data-motion-tier")).toBe("pro");
    expect(setMotionTier("nonsense" as never)).toBe(false);
  });

  it("the first tier of a session is silent; a real change plays the introduction once and ends by itself", async () => {
    let confirmed: MotionTier = "free";
    bindTierSource(() => confirmed);
    setMotionTier("free");
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(html.hasAttribute("data-motion-intro")).toBe(false);
    confirmed = "premium";
    expect(setMotionTier("premium")).toBe(true);
    await waitFor(() => expect(html.getAttribute("data-motion-intro")).toBe("premium"));
    // the same tier again is no change
    html.removeAttribute("data-motion-intro");
    expect(setMotionTier("premium")).toBe(true);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(html.hasAttribute("data-motion-intro")).toBe(false);
    expect(TIER_INTRO_MS).toBeLessThanOrEqual(1200);
  });

  it("no introduction when the reader chose reduced motion", async () => {
    let confirmed: MotionTier = "free";
    bindTierSource(() => confirmed);
    setMotionTier("free");
    useMotionPref.setState({ mode: "reduced" });
    confirmed = "pro";
    expect(setMotionTier("pro")).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(html.hasAttribute("data-motion-intro")).toBe(false);
    expect(html.getAttribute("data-motion-tier")).toBe("pro");
  });
});

describe("useMotionTierSync follows the plan it is given", () => {
  it("sets the tier of the plan, changes with it, and the imperative source answers before React re-renders", async () => {
    let plan = "free";
    const { rerender } = renderHook(({ p }) => useMotionTierSync(p, () => plan), { initialProps: { p: "free" } });
    expect(html.getAttribute("data-motion-tier")).toBe("free");
    // the purchase flow calls `setMotionTier` the moment the store has the new plan – before the hook re-rendered
    plan = "pro";
    act(() => void setMotionTier("pro"));
    expect(html.getAttribute("data-motion-tier")).toBe("pro");
    rerender({ p: "pro" });
    expect(html.getAttribute("data-motion-tier")).toBe("pro");
    plan = "team";
    rerender({ p: "team" });
    await waitFor(() => expect(html.getAttribute("data-motion-tier")).toBe("team"));
  });

  it("an unknown or missing plan is Free", () => {
    renderHook(() => useMotionTierSync(undefined));
    expect(html.getAttribute("data-motion-tier")).toBe("free");
  });
});
