import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenButton } from "@/app/DisplayActions";
import { Dock, flickHop, hopFor } from "@/app/Dock";
import {
  bottomInset,
  canInstall,
  DISPLAY_STRINGS,
  fullscreenSupported,
  installViewportInset,
  isIosSafari,
  isSamsungInternet,
  isStandalone,
  promptInstall,
  VV_KEYBOARD_MIN,
} from "@/app/pwa";
import { MotionRoot } from "@/motion/MotionRoot";
import { spring } from "@/motion/tokens";
import { useUi } from "@/store/uiStore";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("grey-bar fix: visual-viewport bottom inset", () => {
  it("measures host UI over the page bottom, ignores pinch zoom and the keyboard", () => {
    expect(bottomInset(978, { offsetTop: 0, height: 978, scale: 1 })).toBe(0);
    // a 48 px browser bar laid over the bottom of the layout viewport (the user's screenshot)
    expect(bottomInset(978, { offsetTop: 0, height: 930, scale: 1 })).toBe(48);
    expect(bottomInset(978, { offsetTop: 0, height: 929.6, scale: 1 })).toBe(48);
    // pinch-zoomed: the visual viewport pans inside the page – no inset
    expect(bottomInset(978, { offsetTop: 120, height: 500, scale: 2 })).toBe(0);
    // the on-screen keyboard: the dock stays behind it (iOS), no lift
    expect(bottomInset(978, { offsetTop: 0, height: 978 - VV_KEYBOARD_MIN, scale: 1 })).toBe(0);
    expect(bottomInset(978, { offsetTop: 0, height: 600, scale: 1 })).toBe(0);
    expect(bottomInset(978, null)).toBe(0);
    expect(bottomInset(Number.NaN, { offsetTop: 0, height: 900, scale: 1 })).toBe(0);
  });

  it("writes --vv-bottom once installed (ref-counted) and removes it with the last holder", () => {
    const root = document.documentElement;
    const a = installViewportInset();
    const b = installViewportInset();
    // jsdom has no visualViewport: rAF-coalesced write of 0px
    return new Promise<void>((done) => {
      requestAnimationFrame(() => {
        expect(root.style.getPropertyValue("--vv-bottom")).toBe("0px");
        a();
        expect(root.style.getPropertyValue("--vv-bottom")).toBe("0px");
        b();
        expect(root.style.getPropertyValue("--vv-bottom")).toBe("");
        done();
      });
    });
  });
});

describe("grey-bar fix: install / fullscreen / browser detection", () => {
  it("detects Samsung Internet and iOS Safari from the user agent", () => {
    const samsung = "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36";
    const chrome = "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    expect(isSamsungInternet(samsung)).toBe(true);
    expect(isSamsungInternet(chrome)).toBe(false);
    expect(isIosSafari(ipad, 5)).toBe(true);
    expect(isIosSafari(ipad, 0)).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/129.0 Mobile/15E148 Safari/604.1", 5)).toBe(false);
  });

  it("keeps the browser's install prompt and fires it from a click, once", async () => {
    expect(canInstall()).toBe(false);
    expect(await promptInstall()).toBe("unavailable");
    const prompt = vi.fn(async () => {});
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt?: unknown; userChoice?: unknown };
    e.prompt = prompt;
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    act(() => {
      window.dispatchEvent(e);
    });
    // the mini-infobar is suppressed: the app offers "App installieren" itself
    expect(e.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    expect(await promptInstall()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false);
  });

  it("reports a tab (not standalone) and no Fullscreen API in jsdom – the header button then renders nothing", () => {
    expect(isStandalone()).toBe(false);
    expect(fullscreenSupported()).toBe(false);
    const { container } = render(<FullscreenButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the toggle where the Fullscreen API exists", () => {
    const req = vi.fn(async () => {});
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
    const proto = HTMLElement.prototype as HTMLElement & { requestFullscreen?: unknown };
    const had = "requestFullscreen" in proto;
    Object.defineProperty(proto, "requestFullscreen", { value: req, configurable: true, writable: true });
    try {
      render(<FullscreenButton />);
      const b = screen.getByRole("button", { name: DISPLAY_STRINGS.fullscreen });
      expect(b).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(b);
      expect(req).toHaveBeenCalledWith({ navigationUI: "hide" });
    } finally {
      Object.defineProperty(document, "fullscreenEnabled", { value: undefined, configurable: true });
      if (!had) delete (proto as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });
});

describe("dock physics (additive)", () => {
  it("a quick tap, a keyboard activation and programmatic switches keep EXACTLY the tuned hop", () => {
    expect(hopFor(100)).toEqual({ ...spring.pop, velocity: -600 });
    expect(hopFor(150)).toEqual({ ...spring.pop, velocity: -600 });
    expect(hopFor(Number.NaN)).toEqual({ ...spring.pop, velocity: -600 });
  });

  it("a deliberate press lifts calmly on spring.smooth, in between both blend", () => {
    expect(hopFor(500)).toEqual({ ...spring.smooth, velocity: -300 });
    const mid = hopFor(275);
    expect(mid.velocity).toBeGreaterThan(-600);
    expect(mid.velocity).toBeLessThan(-300);
    expect(mid).toMatchObject({ type: "spring" });
  });

  it("a flick launches the new icon faster, capped", () => {
    expect(flickHop(400).velocity).toBe(-600);
    expect(flickHop(1600).velocity).toBe(-700);
    expect(flickHop(6000).velocity).toBe(-750);
  });

  it("re-tapping the active tab scrolls back to the top (iOS)", () => {
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(
      <MotionRoot>
        <Dock />
      </MotionRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Übersicht" }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(useUi.getState().page).toBe("trades");
    expect(scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 0, behavior: "smooth" }));
  });
});
