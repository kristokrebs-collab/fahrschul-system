import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelReplay, cssEasing, replay, toWaapiKeyframes } from "@/motion/replay";
import { ease, tween } from "@/motion/tokens";

describe("replay (one native animation per element, restarted)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("easing and keyframes map 1:1 from the tween tokens / Motion's object form", () => {
    expect(cssEasing(ease.out)).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(cssEasing("easeOut")).toBe("cubic-bezier(0, 0, 0.58, 1)");
    expect(cssEasing("linear")).toBe("linear");
    expect(toWaapiKeyframes({ transform: ["scale(1)", "scale(2.2)"], opacity: [0.9, 0] })).toEqual([
      { transform: "scale(1)", opacity: 0.9 },
      { transform: "scale(2.2)", opacity: 0 },
    ]);
  });

  it("builds the WAAPI animation once and restarts it on every later call (nothing allocated per tick)", () => {
    const anim = { currentTime: 123 as number | null, play: vi.fn(), cancel: vi.fn() };
    const el = document.createElement("span");
    const animateSpy = vi.fn(() => anim as unknown as Animation);
    (el as unknown as { animate: unknown }).animate = animateSpy;
    replay(el, { opacity: [1, 0] }, tween.flash);
    replay(el, { opacity: [1, 0] }, tween.flash);
    const c = replay(el, { opacity: [1, 0] }, tween.flash);
    expect(animateSpy).toHaveBeenCalledTimes(1);
    expect(animateSpy).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" });
    expect(anim.play).toHaveBeenCalledTimes(3);
    expect(anim.currentTime).toBe(0);
    c.stop();
    cancelReplay(el);
    // created (then cancelled until the first play), stop + cancelReplay
    expect(anim.cancel).toHaveBeenCalledTimes(3);
    // other keyframes on the same element rebuild it
    replay(el, { opacity: [0.5, 0] }, tween.flash);
    expect(animateSpy).toHaveBeenCalledTimes(2);
  });
});
