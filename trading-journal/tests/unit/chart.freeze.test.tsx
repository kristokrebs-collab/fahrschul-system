import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/ui/chart";
import { axisTick } from "@/chart/AxisTick";

const rect = { x: 0, y: 0, width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, toJSON: () => ({}) };

/** A ResizeObserver that reports the box size on observe, like a browser's first observation. */
class ReportingRO {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() => this.cb([{ target, contentRect: rect } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ReportingRO);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const data = [
  { k: "a", v: 3 },
  { k: "b", v: 5 },
];
const TICK = axisTick({ fill: "#5f5f5f", fontSize: 11 });

function Chart({ mode, rows, thaw = false }: { mode: "visible" | "hidden"; rows: typeof data; thaw?: boolean }) {
  return (
    <Activity mode={mode}>
      <ChartContainer config={{}} style={{ height: 200 }} freezeKey={[rows]} thawOnInteract={thaw}>
        <BarChart data={rows}>
          <XAxis dataKey="k" tick={TICK} />
          <YAxis interval={0} tick={TICK} />
          <Bar dataKey="v" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Activity>
  );
}

const flushTimers = () => act(() => new Promise<void>((r) => setTimeout(r, 5)));

describe("ChartContainer on a keep-alive page", () => {
  it("sizes from the box (no ResponsiveContainer) and draws axis labels without Recharts' measured Text", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    const { container } = render(<Chart mode="visible" rows={data} />);
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
    expect(container.querySelector("svg.recharts-surface")?.getAttribute("width")).toBe("400");
    expect(container.querySelector(".recharts-cartesian-axis-tick-value")).toBeNull();
    // (jsdom: every measured X label is as wide as the mocked box, so only the unmeasured Y labels show)
    expect(container.querySelector(".recharts-cartesian-axis-tick-label text")?.textContent).toBeTruthy();
  });

  it("stands its last markup in while hidden and stays static after the re-show until the data change", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    const { container, rerender } = render(<Chart mode="visible" rows={data} />);
    const box = container.querySelector<HTMLElement>("[data-slot=chart]")!;
    await flushTimers();
    const markup = box.querySelector("[data-slot=chart-size]")!.innerHTML;
    rerender(<Chart mode="hidden" rows={data} />);
    await flushTimers();
    rerender(<Chart mode="visible" rows={data} />);
    expect(box.hasAttribute("data-frozen")).toBe(true);
    expect(box.querySelector("[data-slot=chart-size]")!.innerHTML).toBe(markup);
    expect(box.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);

    rerender(<Chart mode="visible" rows={[...data, { k: "c", v: 1 }]} />);
    expect(box.hasAttribute("data-frozen")).toBe(false);
    expect(box.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(3);
  });

  it("draws live again on the first pointer when it carries Recharts' interaction", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    const { container, rerender } = render(<Chart mode="visible" rows={data} thaw />);
    const box = container.querySelector<HTMLElement>("[data-slot=chart]")!;
    rerender(<Chart mode="hidden" rows={data} thaw />);
    await flushTimers();
    rerender(<Chart mode="visible" rows={data} thaw />);
    expect(box.hasAttribute("data-frozen")).toBe(true);
    fireEvent.pointerDown(box);
    expect(box.hasAttribute("data-frozen")).toBe(false);
    expect(box.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
  });

  it("never freezes on a real unmount or the StrictMode re-run", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    const { container, unmount } = render(<Chart mode="visible" rows={data} />);
    const box = container.querySelector<HTMLElement>("[data-slot=chart]")!;
    await flushTimers();
    expect(box.hasAttribute("data-frozen")).toBe(false);
    unmount();
    await flushTimers();
  });
});
