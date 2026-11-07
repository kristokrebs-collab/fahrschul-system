/** `MotionTierHost`: the profile follows the confirmed plan, and the purchase flow's `onPlanChange` introduces a changed one. */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MotionTierHost } from "@/app/MotionTierHost";
import { announcePlanChange } from "@/billing/planChange";
import { useBilling } from "@/billing/store";
import { useMotionPref } from "@/motion/profile";
import { resetMotionTier } from "@/motion/tier";

const html = document.documentElement;

beforeEach(() => {
  resetMotionTier();
  useMotionPref.setState({ mode: "system" });
});
afterEach(() => resetMotionTier());

describe("MotionTierHost", () => {
  it("sets Free without payments; an announced change to a plan the store does not confirm changes nothing", () => {
    render(<MotionTierHost />);
    expect(html.getAttribute("data-motion-tier")).toBe("free");
    act(() => announcePlanChange({ from: "free", to: "premium" }));
    expect(html.getAttribute("data-motion-tier")).toBe("free");
    expect(useBilling.getState().account).toBeNull();
  });

  it("unmounting removes the listener; an announcement without listeners is harmless", () => {
    const { unmount } = render(<MotionTierHost />);
    unmount();
    expect(() => announcePlanChange({ from: "free", to: "pro" })).not.toThrow();
  });
});
