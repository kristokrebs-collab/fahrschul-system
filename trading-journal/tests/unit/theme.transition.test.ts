import { afterEach, describe, expect, it, vi } from "vitest";
import { coverRadius, defaultOrigin, runThemeTransition, THEME_SWITCHING_ATTR } from "@/app/themeTransition";

/** Installs / removes `document.startViewTransition` (jsdom has none). */
function setVT(fn: ((cb: () => void) => unknown) | undefined) {
  if (fn) Object.defineProperty(document, "startViewTransition", { value: fn, configurable: true, writable: true });
  else Reflect.deleteProperty(document, "startViewTransition");
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })),
  );
}

describe("theme transition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setVT(undefined);
    document.documentElement.removeAttribute("data-safe-fx");
    document.documentElement.removeAttribute(THEME_SWITCHING_ATTR);
    document.body.innerHTML = "";
  });

  it("covers the viewport from any origin", () => {
    expect(coverRadius(0, 0, 300, 400)).toBe(500);
    expect(coverRadius(150, 200, 300, 400)).toBe(250);
    expect(defaultOrigin(1440)).toEqual({ x: 1392, y: 36 });
  });

  it("reduced motion: applies at once, no overlay, no view transition", () => {
    stubMotion(true);
    const vt = vi.fn();
    setVT(vt);
    const apply = vi.fn();
    runThemeTransition(apply, { x: 1, y: 1 }, "dark", "light");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(vt).not.toHaveBeenCalled();
    expect(document.querySelector('[data-layer="Theme-Wechsel"]')).toBeNull();
  });

  it("View Transitions: marks <html>, applies inside the update and clears the mark when finished", async () => {
    stubMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const animate = vi.fn();
    document.documentElement.animate = animate as unknown as typeof document.documentElement.animate;
    setVT((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished };
    });
    const apply = vi.fn();
    runThemeTransition(apply, { x: 40, y: 50 }, "dark", "light");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute(THEME_SWITCHING_ATTR)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0]!;
    expect((frames as { clipPath: string[] }).clipPath[0]).toBe("circle(0px at 40px 50px)");
    expect((opts as { pseudoElement: string }).pseudoElement).toBe("::view-transition-new(root)");
    finish();
    await finished;
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.hasAttribute(THEME_SWITCHING_ATTR)).toBe(false);
  });

  it("fallback: a disc covers the page, the theme flips once it covers, then the disc fades and is removed", () => {
    stubMotion(false);
    const anims: { onfinish: null | (() => void); oncancel: null | (() => void) }[] = [];
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const prev = proto.animate;
    proto.animate = function () {
      const a = { onfinish: null, oncancel: null };
      anims.push(a);
      return a;
    };
    try {
      const apply = vi.fn();
      runThemeTransition(apply, undefined, "light", "dark");
      const disc = document.querySelector<HTMLElement>('[data-layer="Theme-Wechsel"]');
      expect(disc).not.toBeNull();
      expect(disc!.getAttribute("aria-hidden")).toBe("true");
      expect(apply).not.toHaveBeenCalled();
      anims[0]!.onfinish!();
      expect(apply).toHaveBeenCalledTimes(1);
      anims[1]!.onfinish!();
      expect(document.querySelector('[data-layer="Theme-Wechsel"]')).toBeNull();
    } finally {
      proto.animate = prev;
    }
  });
});
