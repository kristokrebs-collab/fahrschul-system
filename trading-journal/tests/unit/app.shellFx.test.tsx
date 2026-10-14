import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { expoCurve, springCurve } from "@/app/cssEasing";
import { DOCK_CONFIG, dockEntrance } from "@/app/Dock";
import { CONFIG as FOOTER, Footer, FOOTER_TICKER_LABEL, FOOTER_TOP_LABEL, nextFooterShown } from "@/app/Footer";
import { headerIntroTarget } from "@/app/Header";
import { ENTER_FADE } from "@/app/PageHost";
import { shellStatTexts } from "@/app/shellStats";
import { setIntroPhase } from "@/intro/introStore";
import { MotionRoot } from "@/motion/MotionRoot";
import { springAt } from "@/motion/pulse/engine";
import { spring, tween } from "@/motion/tokens";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const stops = (easing: string) =>
  easing
    .replace(/^linear\(|\)$/g, "")
    .split(",")
    .map((v) => Number(v.trim()));

describe("css curves from the pack's measured motion", () => {
  it("exponential approach: τ·5 long, starts at 0, lands exactly on 1, monotonic, 63 % after one τ", () => {
    const c = expoCurve(38);
    expect(c.ms).toBe(190);
    const s = stops(c.easing);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(1);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] ?? 0);
    // the stop at t = τ (20 samples over 5 τ → index 4)
    expect(stops(expoCurve(38, 5, 20).easing)[4]).toBeCloseTo((1 - Math.exp(-1)) / (1 - Math.exp(-5)), 3);
  });

  it("spring curve follows engine.springAt with its overshoot and ends at 1", () => {
    const c = springCurve(DOCK_CONFIG.tipSpring);
    const s = stops(c.easing);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(1);
    expect(Math.max(...s)).toBeGreaterThan(1); // 1000/38 overshoots (~0.6 px on the 6 px rise)
    expect(s[6]).toBeCloseTo(springAt((c.ms / 1000) * (6 / (s.length - 1)), DOCK_CONFIG.tipSpring), 2);
  });
});

describe("intro choreography of the shell", () => {
  it("dock: parked during the stage, soft-bounce rise on build, always ends at y 0 / opacity 1", () => {
    // the session entrance's blur (mounted before the intro started) is dropped in the stage, never animated in the build
    expect(dockEntrance("stage", false, false).animate).toEqual({ y: DOCK_CONFIG.introRise, opacity: 0, filter: "none" });
    const build = dockEntrance("build", true, false);
    expect(build.animate).toEqual({ y: 0, opacity: 1, filter: "none" });
    expect(build.transition.y).toBe(spring.reveal);
    for (const p of ["off", "done"] as const) {
      expect(dockEntrance(p, false, false).animate).toEqual({ y: 0, opacity: 1 });
      expect(dockEntrance(p, true, false).animate).toMatchObject({ y: 0, opacity: 1 });
    }
    // reduced motion: no entrance, never parked
    expect(dockEntrance("stage", true, true)).toMatchObject({ initial: false, animate: { y: 0, opacity: 1 } });
  });

  it("header: covered (parked above) during the stage only", () => {
    expect(headerIntroTarget("stage")).toEqual({ y: "-110%", opacity: 0 });
    for (const p of ["off", "build", "done"] as const) expect(headerIntroTarget(p)).toEqual({ y: "0%", opacity: 1 });
  });
});

describe("page switch (SH-02)", () => {
  it("the entering page fades in only after the leaving page has faded out", () => {
    expect(ENTER_FADE.delay).toBe(tween.exit.duration);
    expect(ENTER_FADE.duration).toBe(tween.page.duration);
  });
});

describe("footer", () => {
  beforeAll(() => installDomPolyfills());

  it("reveal hysteresis: on at ≥ 72 %, off only at ≤ 50 %", () => {
    expect(FOOTER.revealAt).toBe(0.72);
    expect(FOOTER.hideAt).toBe(0.5);
    expect(nextFooterShown(false, true, true)).toBe(true);
    expect(nextFooterShown(false, false, true)).toBe(false);
    expect(nextFooterShown(true, false, true)).toBe(true);
    expect(nextFooterShown(true, false, false)).toBe(false);
  });

  it("stat texts: de-DE, signed net with currency, `–` while unknown", () => {
    expect(shellStatTexts({ trades: 13, setups: 7, rules: 5, net: 1232, winRate: 0.55, currency: "USDT" })).toEqual({
      net: "+1.232,00 USDT",
      winRate: "55 %",
      trades: "13",
      setups: "7",
      rules: "5",
    });
    expect(shellStatTexts({ trades: 0, setups: 0, rules: 0, net: 0, winRate: null, currency: "USDT" }).winRate).toBe("–");
  });

  it("renders the attribution and a back-to-top button; the ticker sleeps (unmounted) while the curtain covers it", async () => {
    await bootFixtureJournal();
    render(
      <MotionRoot>
        <Footer />
      </MotionRoot>,
    );
    expect(screen.getByRole("button", { name: FOOTER_TOP_LABEL })).toBeInTheDocument();
    expect(screen.getByText(/Lightweight Charts/)).toBeInTheDocument();
    // not uncovered yet (the IntersectionObserver never reported the curtain edge): no marquee loop runs
    expect(screen.queryByRole("marquee", { name: FOOTER_TICKER_LABEL })).toBeNull();
    // e2e reads `13 Trades` exactly from the trades header: the footer never forms that text in one element
    expect(screen.queryByText("13 Trades", { exact: true })).toBeNull();
    // no live region in the footer (the toast island stays the only one)
    expect(document.querySelector("footer [aria-live]")).toBeNull();
  });
});

describe("footer revealed", () => {
  it("mounts the stats marquee once the curtain edge passes 72 % (live figures, price aria-hidden)", async () => {
    await bootFixtureJournal();
    const Original = globalThis.IntersectionObserver;
    class Uncovered {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        const rect = { top: 100 } as DOMRectReadOnly;
        queueMicrotask(() => this.cb([{ isIntersecting: true, target: el, boundingClientRect: rect, rootBounds: null } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = Uncovered as unknown as typeof IntersectionObserver;
    // the footer measures its height before it watches the edge
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 300 });
    try {
      render(
        <MotionRoot>
          <Footer />
        </MotionRoot>,
      );
      const ticker = await screen.findByRole("marquee", { name: FOOTER_TICKER_LABEL });
      expect(ticker.textContent).toContain("+1.232,00 USDT");
      expect(ticker.textContent).toContain("Trades13");
      expect(screen.queryByText("13 Trades", { exact: true })).toBeNull();
      expect(document.querySelector("footer")).toHaveAttribute("data-shown");
    } finally {
      globalThis.IntersectionObserver = Original;
      if (offset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offset);
    }
  });
});

describe("intro phase drives the header", () => {
  it("phase changes never throw outside an intro host", () => {
    act(() => setIntroPhase("stage"));
    act(() => setIntroPhase("off"));
    expect(true).toBe(true);
  });
});
