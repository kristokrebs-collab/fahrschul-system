import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CLOCK_SLACK_MS, clockHolders, msToNextSecond, nowMv, retainClock, useNowMv } from "@/motion/clock";

describe("shared clock (nowMv)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_500);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("msToNextSecond lands just after the next whole second", () => {
    expect(msToNextSecond(10_500)).toBe(500 + CLOCK_SLACK_MS);
    expect(msToNextSecond(10_999)).toBe(1 + CLOCK_SLACK_MS);
    expect(msToNextSecond(11_000)).toBe(1000 + CLOCK_SLACK_MS);
    expect(msToNextSecond(11_004)).toBe(996 + CLOCK_SLACK_MS);
  });

  it("ticks on second boundaries while retained and stops with the last release", () => {
    const release = retainClock();
    expect(clockHolders()).toBe(1);
    expect(nowMv.get()).toBe(10_500); // fresh on the first retain
    vi.advanceTimersByTime(500 + CLOCK_SLACK_MS - 1);
    expect(nowMv.get()).toBe(10_500);
    vi.advanceTimersByTime(1);
    expect(nowMv.get()).toBe(11_000 + CLOCK_SLACK_MS);
    vi.advanceTimersByTime(1000);
    expect(nowMv.get()).toBe(12_000 + CLOCK_SLACK_MS);

    const second = retainClock();
    expect(clockHolders()).toBe(2);
    release();
    release(); // idempotent
    expect(clockHolders()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(nowMv.get()).toBe(13_000 + CLOCK_SLACK_MS);

    second();
    expect(clockHolders()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(nowMv.get()).toBe(13_000 + CLOCK_SLACK_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-aligns immediately when the page becomes visible again", () => {
    const release = retainClock();
    vi.advanceTimersByTime(200);
    vi.setSystemTime(25_250); // a throttled background tab: the wall clock moved on
    document.dispatchEvent(new Event("visibilitychange"));
    expect(nowMv.get()).toBe(25_250);
    vi.advanceTimersByTime(750 + CLOCK_SLACK_MS);
    expect(nowMv.get()).toBe(26_000 + CLOCK_SLACK_MS);
    release();
  });

  it("useNowMv holds the clock while mounted", () => {
    function Probe() {
      useNowMv();
      return null;
    }
    const view = render(<Probe />);
    expect(clockHolders()).toBe(1);
    view.unmount();
    expect(clockHolders()).toBe(0);
  });
});
