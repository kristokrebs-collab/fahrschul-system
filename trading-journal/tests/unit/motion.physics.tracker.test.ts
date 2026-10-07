import { createVelocityTracker, physics, type PointerSampleSource } from "@/motion/physics";

/** Deterministic PRNG for jitter. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feeds samples of `pos(t)` every 1000/hz ms over [t0, t1]; returns the last timestamp. */
function feed(tr: ReturnType<typeof createVelocityTracker>, hz: number, t0: number, t1: number, pos: (t: number) => { x: number; y: number }) {
  const dt = 1000 / hz;
  let t = t0;
  let last = t0;
  for (let i = 0; t <= t1 + 1e-9; i++, t = t0 + i * dt) {
    const p = pos(t);
    tr.add(t, p.x, p.y);
    last = t;
  }
  return last;
}

const T0 = 10_000; // any clock works, as long as samples and `now` share it

describe("velocity tracker – weighted least squares, 100 ms horizon", () => {
  it.each([60, 120, 240, 1000])("constant velocity at %i Hz is exact (x, y, diagonal)", (hz) => {
    const tr = createVelocityTracker();
    const last = feed(tr, hz, T0, T0 + 150, (t) => ({ x: 1.2 * (t - T0), y: -0.7 * (t - T0) + 300 }));
    const v = tr.velocity(last);
    expect(v.x).toBeCloseTo(1200, 6);
    expect(v.y).toBeCloseTo(-700, 6);
    expect(tr.speed(last)).toBeCloseTo(Math.hypot(1200, 700), 6);
  });

  it("feeds coalesced samples (240 Hz digitiser delivered at 120 Hz / 60 Hz frames)", () => {
    for (const [frameHz, perFrame] of [
      [120, 2],
      [60, 4],
    ] as const) {
      const tr = createVelocityTracker();
      const dt = 1000 / 240;
      let t = T0;
      let lastEvent: PointerSampleSource | null = null;
      for (let f = 0; f < (frameHz === 120 ? 20 : 10); f++) {
        const list = Array.from({ length: perFrame }, () => {
          t += dt;
          return { timeStamp: t, clientX: 2 * (t - T0), clientY: 50 };
        });
        const tail = list[list.length - 1]!;
        lastEvent = { timeStamp: tail.timeStamp, clientX: tail.clientX, clientY: tail.clientY, getCoalescedEvents: () => list };
        tr.addEvent(lastEvent);
      }
      // every digitiser sample was used, not just one per frame
      expect(tr.count()).toBe(Math.min(physics.velocitySamples, frameHz === 120 ? 40 : 40));
      expect(tr.velocity(lastEvent!.timeStamp).x).toBeCloseTo(2000, 6);
    }
  });

  it("falls back to the event itself without coalesced events (jsdom / Safari)", () => {
    const tr = createVelocityTracker();
    for (let i = 0; i <= 12; i++) tr.addEvent({ timeStamp: T0 + i * 8, clientX: i * 8, clientY: 0, getCoalescedEvents: () => [] });
    for (let i = 13; i <= 20; i++) tr.addEvent({ timeStamp: T0 + i * 8, clientX: i * 8, clientY: 0 });
    expect(tr.velocity(T0 + 160).x).toBeCloseTo(1000, 6);
  });

  it("ignores samples older than 100 ms", () => {
    const tr = createVelocityTracker();
    // 200 ms fast (3 px/ms), then 100 ms at 0.5 px/ms
    let x = 0;
    let t = T0;
    for (; t < T0 + 200; t += 1000 / 120) {
      tr.add(t, x, 0);
      x += 3 * (1000 / 120);
    }
    const t1 = t;
    for (; t <= t1 + 110; t += 1000 / 120) {
      tr.add(t, x, 0);
      x += 0.5 * (1000 / 120);
    }
    const last = tr.lastTime();
    expect(tr.velocity(last).x).toBeCloseTo(500, 6);
  });

  it("stop rule: a pointer resting ≥ 40 ms before the release reads 0", () => {
    const tr = createVelocityTracker();
    const last = feed(tr, 120, T0, T0 + 100, (t) => ({ x: t - T0, y: 0 }));
    expect(tr.velocity(last + 39).x).toBeCloseTo(1000, 6);
    expect(tr.velocity(last + 40)).toEqual({ x: 0, y: 0 });
    expect(tr.velocity(last + 60)).toEqual({ x: 0, y: 0 });
    // without `now` there is no stop rule (the probe applies its own)
    expect(tr.velocity().x).toBeCloseTo(1000, 6);
  });

  it("pause rule: moving, then holding still for 40 ms with samples still arriving, reads 0", () => {
    const tr = createVelocityTracker();
    let last = feed(tr, 120, T0, T0 + 80, (t) => ({ x: 1.5 * (t - T0), y: 0 }));
    const xEnd = 1.5 * (last - T0);
    // 30 ms of stillness: not yet a pause (lagging fit, but non-zero)
    const still = feed(tr, 120, last + 1000 / 120, last + 30, () => ({ x: xEnd + 0.3, y: 0 }));
    expect(tr.velocity(still).x).toBeGreaterThan(50);
    // 45 ms of stillness (sub-pixel tremor): placed, not thrown
    last = feed(tr, 120, still + 1000 / 120, still + 25, (t) => ({ x: xEnd + 0.3 + 0.4 * Math.sin(t), y: 0 }));
    expect(tr.velocity(last)).toEqual({ x: 0, y: 0 });
  });

  it("duplicate timestamps keep the latest position; out-of-order and non-finite samples are dropped", () => {
    const tr = createVelocityTracker();
    tr.add(T0, 0, 0);
    tr.add(T0 + 10, 5, 0);
    tr.add(T0 + 10, 10, 0); // same timestamp: latest wins (no division by zero)
    expect(tr.count()).toBe(2);
    expect(tr.velocity(T0 + 10).x).toBeCloseTo(1000, 6);
    tr.add(T0 + 5, 999, 0); // out of order
    tr.add(T0 + 20, Number.NaN, 0);
    tr.add(Number.NaN, 30, 0);
    expect(tr.count()).toBe(2);
    expect(Number.isFinite(tr.velocity().x)).toBe(true);
  });

  it("is noise-robust: ±1 px jitter within 5 % at 60/120/240 Hz, ±3 px within 5 % at 240 Hz", () => {
    for (const [hz, amp] of [
      [60, 1],
      [120, 1],
      [240, 1],
      [240, 3],
    ] as const) {
      const rnd = prng(hz * 7 + amp);
      for (let run = 0; run < 25; run++) {
        const tr = createVelocityTracker();
        const last = feed(tr, hz, T0, T0 + 150, (t) => ({ x: (t - T0) + (rnd() * 2 - 1) * amp, y: 0 }));
        expect(Math.abs(tr.velocity(last).x - 1000), `${hz} Hz ±${amp} px run ${run}`).toBeLessThan(50);
      }
    }
  });

  it("an accelerating flick reads between the mean and the final speed (documented lag ≈ 1/3 horizon)", () => {
    for (const hz of [60, 120, 240]) {
      const tr = createVelocityTracker();
      // v(t) = 2000 px/s · t / 150 ms → 2000 px/s at the release
      const last = feed(tr, hz, T0, T0 + 150, (t) => ({ x: 0.5 * (2 / 150) * (t - T0) ** 2, y: 0 }));
      const v = tr.velocity(last).x;
      expect(v).toBeGreaterThan(1400);
      expect(v).toBeLessThan(2000);
    }
  });

  it("clamps glitches to ±8000 px/s; fewer than 2 samples read 0; reset forgets", () => {
    const tr = createVelocityTracker();
    expect(tr.velocity()).toEqual({ x: 0, y: 0 });
    tr.add(T0, 0, 0);
    expect(tr.velocity(T0)).toEqual({ x: 0, y: 0 });
    tr.add(T0 + 1, 100, -100);
    expect(tr.velocity(T0 + 1)).toEqual({ x: physics.maxVelocity, y: -physics.maxVelocity });
    tr.reset();
    expect(tr.count()).toBe(0);
    expect(Number.isNaN(tr.lastTime())).toBe(true);
  });

  it("a ring smaller than the horizon still measures a constant speed (1000 Hz mouse, 48 samples ≈ 48 ms)", () => {
    const tr = createVelocityTracker({ capacity: 48 });
    const last = feed(tr, 1000, T0, T0 + 200, (t) => ({ x: 0, y: 0.8 * (t - T0) }));
    expect(tr.count()).toBe(48);
    expect(tr.velocity(last).y).toBeCloseTo(800, 6);
  });
});
