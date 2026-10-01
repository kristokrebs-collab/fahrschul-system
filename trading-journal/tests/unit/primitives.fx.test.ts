import { frame } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beamSpan } from "@/primitives/BorderBeam";
import { GLOW_PROXIMITY, MAX_ACTIVE_GLOWS, distanceToRect, nearestAngle, pickGlows, pointerAngle, readGlow, registerGlow } from "@/primitives/glowField";
import { MAX_RIPPLES, rippleGeometry, spawnRipple } from "@/primitives/ripple";
import { formatRoll, parseRollValue } from "@/primitives/rollValue";

const rect = { left: 100, top: 100, width: 200, height: 100 };
const nextFrame = () => new Promise<void>((resolve) => frame.postRender(() => resolve()));

describe("glowField geometry", () => {
  it("measures the conic angle from the centre: 0° up, clockwise", () => {
    expect(pointerAngle(200, 0, rect)).toBeCloseTo(0);
    expect(pointerAngle(400, 150, rect)).toBeCloseTo(90);
    expect(pointerAngle(200, 300, rect)).toBeCloseTo(180);
    expect(pointerAngle(0, 150, rect)).toBeCloseTo(270);
  });

  it("re-expresses a target angle on the short way round", () => {
    expect(nearestAngle(350, 10)).toBe(370);
    expect(nearestAngle(10, 350)).toBe(-10);
    expect(nearestAngle(720, 90)).toBe(810);
    expect(nearestAngle(0, 180)).toBe(-180);
  });

  it("measures the distance to the edge (0 inside)", () => {
    expect(distanceToRect(150, 150, rect)).toBe(0);
    expect(distanceToRect(310, 150, rect)).toBe(10);
    expect(distanceToRect(303, 204, rect)).toBe(5);
  });

  it("is active near the edge and within the proximity margin, but not in the dead centre or far away", () => {
    expect(readGlow(200, 150, rect).active).toBe(false); // centre
    expect(readGlow(110, 105, rect).active).toBe(true); // inside, near the corner
    expect(readGlow(300 + GLOW_PROXIMITY - 1, 150, rect).active).toBe(true);
    expect(readGlow(300 + GLOW_PROXIMITY + 1, 150, rect).active).toBe(false);
  });

  it("caps the glowing cards, nearest first", () => {
    const g = (distance: number, active = true) => ({ active, angle: 0, distance });
    const picked = pickGlows([g(30), g(5), g(0, false), g(10), g(60), g(1)], 3);
    expect([...picked].sort()).toEqual([1, 3, 5]);
    expect(pickGlows([g(1), g(2)], 0).size).toBe(0);
    expect(MAX_ACTIVE_GLOWS).toBeGreaterThan(0);
  });
});

describe("glowField registry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lights a registered surface while a mouse is near its edge and switches it off when the pointer leaves", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...rect, right: 300, bottom: 200, x: 100, y: 100, toJSON: () => ({}) } as DOMRect);
    const calls: [boolean, number][] = [];
    const off = registerGlow(el, (active, angle) => calls.push([active, Math.round(angle)]));

    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 60, pointerType: "mouse" }));
    await nextFrame();
    expect(calls.at(-1)).toEqual([true, 0]);

    // touch never drives the glow
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 150, pointerType: "touch" }));
    await nextFrame();
    expect(calls.at(-1)).toEqual([true, 0]);

    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 900, clientY: 900, pointerType: "mouse" }));
    await nextFrame();
    expect(calls.at(-1)?.[0]).toBe(false);
    const n = calls.length;

    off();
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 60, pointerType: "mouse" }));
    await nextFrame();
    expect(calls).toHaveLength(n);
    el.remove();
  });

  it("keeps cards behind an open dialog (inert subtree) dark", async () => {
    const page = document.createElement("div");
    const el = document.createElement("div");
    page.appendChild(el);
    document.body.appendChild(page);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...rect, right: 300, bottom: 200, x: 100, y: 100, toJSON: () => ({}) } as DOMRect);
    const listener = vi.fn();
    const off = registerGlow(el, listener);
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 60, pointerType: "mouse" }));
    await nextFrame();
    expect(listener).toHaveBeenLastCalledWith(true, expect.any(Number));
    page.setAttribute("inert", "");
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 205, clientY: 60, pointerType: "mouse" }));
    await nextFrame();
    expect(listener).toHaveBeenLastCalledWith(false, 0);
    off();
    page.remove();
  });
});

describe("ripple", () => {
  it("covers the farthest corner from the press point", () => {
    const g = rippleGeometry(100, 40, 10, 10);
    const r = Math.hypot(90, 30);
    expect(g.size).toBeCloseTo(2 * r);
    expect(g.x).toBeCloseTo(10 - r);
    expect(g.y).toBeCloseTo(10 - r);
    const c = rippleGeometry(100, 40, 50, 20);
    expect(c.size).toBeCloseTo(2 * Math.hypot(50, 20));
  });

  it("keeps at most MAX_RIPPLES circles in the host", () => {
    const host = document.createElement("span");
    for (let i = 0; i < MAX_RIPPLES + 2; i++) spawnRipple(host, rippleGeometry(80, 32, 10, 10), "rgb(255 255 255 / 0.18)");
    expect(host.childElementCount).toBe(MAX_RIPPLES);
    const dot = host.firstElementChild as HTMLElement;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.style.borderRadius).toBe("9999px");
    expect(dot.style.pointerEvents).toBe("none");
  });
});

describe("rollValue", () => {
  it("parses signed de-DE values with prefix and suffix", () => {
    expect(parseRollValue("+396,00")).toEqual({ prefix: "", sign: "+", value: 396, decimals: 2, grouped: false, suffix: "" });
    expect(parseRollValue("+1.234,50 USDT")).toMatchObject({ sign: "+", value: 1234.5, decimals: 2, grouped: true, suffix: " USDT" });
    expect(parseRollValue("−12 %")).toMatchObject({ sign: "−", value: 12, decimals: 0, suffix: " %" });
    expect(parseRollValue("offen")).toBeNull();
  });

  it("formats intermediate values in the source shape and ends on the original string", () => {
    for (const src of ["+396,00", "+1.234,50 USDT", "−12 %", "+0,5"]) {
      const spec = parseRollValue(src);
      expect(spec).not.toBeNull();
      if (!spec) continue;
      expect(formatRoll(spec, spec.value)).toBe(src);
    }
    const spec = parseRollValue("+1.234,50 USDT");
    expect(spec && formatRoll(spec, 7.5)).toBe("+7,50 USDT");
    expect(spec && formatRoll(spec, 0)).toBe("+0,00 USDT");
  });
});

describe("BorderBeam", () => {
  it("maps the beam size to a readable arc span", () => {
    expect(beamSpan(80)).toBeCloseTo(36);
    expect(beamSpan(10)).toBe(20);
    expect(beamSpan(1000)).toBe(120);
  });
});
