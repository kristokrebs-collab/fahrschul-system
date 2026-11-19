import { spring as motionSpring } from "motion";
import type { Transition } from "motion/react";
import { spring, tween } from "@/motion/tokens";
import {
  appleParams,
  appleParamsOf,
  appleSpring,
  axisLock,
  contextSpring,
  contextSpringAt,
  dampingRatio,
  decayInertia,
  dismissThreshold,
  flickDecision,
  flickStep,
  flingSpring,
  isTimeDefined,
  mixSpring,
  motionTimeSpring,
  pressTempo,
  progressVelocity,
  nearestIndex,
  physics,
  physicsOf,
  project,
  projectPoint,
  releaseSpring,
  rubberBand,
  rubberBandInverse,
  rubberClamp,
  snapIndex,
  swipeDecision,
  tempoOf,
} from "@/motion/physics";

/** Samples a Motion spring generator (the real one Motion runs) over 0…`ms`. */
function sample(opts: Record<string, unknown>, ms = 900, n = 180): number[] {
  const g = motionSpring({ keyframes: [0, 100], ...opts } as Parameters<typeof motionSpring>[0]);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(g.next((ms * i) / n).value as number);
  return out;
}
/** Rest thresholds that never snap, so two curves are compared over their whole length. */
const EXACT = { restDelta: 1e-9, restSpeed: 1e-9 };
const maxDiff = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);
const close = (a: number, b: number, eps: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("Apple spring conversion (WWDC23)", () => {
  it("Apple .smooth (0.5 s, 0) equals spring.smooth", () => {
    const s = appleSpring(0.5, 0);
    close(s.stiffness, 157.91, 0.01);
    close(s.damping, 25.13, 0.01);
    expect(s.mass).toBe(1);
    expect(s.type).toBe("spring");
    // our tuned token is that spring, rounded
    close(s.stiffness, spring.smooth.stiffness, 0.2);
    close(s.damping, spring.smooth.damping, 0.2);
    // and it moves the same: the real Motion generator, token vs conversion, < 0.5 % of travel (the token is rounded)
    expect(maxDiff(sample({ ...spring.smooth, ...EXACT }), sample({ ...s, ...EXACT }))).toBeLessThan(0.5);
  });

  it("damping for positive and negative (flattened) bounce", () => {
    close(appleSpring(0.5, 0.3).damping, 17.59, 0.01);
    close(appleSpring(0.5, -0.2).damping, 31.42, 0.01);
    close(appleSpring(0.36, 0.3).stiffness, 304.6, 0.1);
    close(appleSpring(0.36, 0.3).damping, 24.43, 0.01);
    close(dampingRatio(appleSpring(0.5, 0)), 1, 1e-9);
    close(dampingRatio(appleSpring(0.4, 0.15)), 0.85, 1e-9);
  });

  it("inverse: appleParams(spring.smooth) ≈ (0.5, 0.006) and round-trips every (duration, bounce)", () => {
    const p = appleParams(spring.smooth);
    close(p.duration, 0.4999, 0.001);
    close(p.bounce, 0.006, 0.001);
    for (const d of [0.15, 0.3, 0.36, 0.5, 0.8])
      for (const b of [-0.5, -0.2, 0, 0.15, 0.3, 0.4]) {
        const r = appleParams(appleSpring(d, b));
        close(r.duration, d, 1e-9);
        close(r.bounce, b, 1e-9);
      }
    // mass is honoured (k/m, c/m decide the motion)
    const hover = appleParams(spring.hover);
    close(hover.duration, 0.349, 0.001);
    close(hover.bounce, 0.237, 0.001);
  });

  it("physicsOf resolves time-defined tokens exactly like Motion (velocity can then be handed over)", () => {
    expect(isTimeDefined(spring.segment)).toBe(true);
    expect(isTimeDefined(spring.smooth)).toBe(false);
    for (const tok of [spring.segment, spring.detail]) {
      const p = physicsOf(tok)!;
      expect(p).not.toBeNull();
      // Motion's own time-defined run (duration in ms inside the generator) vs our physics: identical curve
      const ref = sample({ bounce: tok.bounce, duration: tok.duration * 1000 }, tok.duration * 1000 - 1);
      const ours = sample({ stiffness: p.stiffness, damping: p.damping, mass: p.mass, ...EXACT }, tok.duration * 1000 - 1);
      expect(maxDiff(ref, ours)).toBeLessThan(1e-6);
    }
    // the plan's brute-force fits agree (segment ≈ {390, 32.5}, detail ≈ {352, 34.5})
    const seg = physicsOf(spring.segment)!;
    close(seg.stiffness, 390, 8);
    close(seg.damping, 32.5, 0.5);
    const det = physicsOf(spring.detail)!;
    close(det.stiffness, 352, 8);
    close(det.damping, 34.5, 0.5);
    expect(physicsOf(tween.fade)).toBeNull();
    expect(physicsOf(spring.press)).toEqual({ type: "spring", stiffness: 500, damping: 30, mass: 1 });
    expect(motionTimeSpring({}).stiffness).toBeGreaterThan(0); // Motion defaults (0.8 s, 0.3)
    expect(physicsOf({ type: "spring", visualDuration: 0.3, bounce: 0.2 })!.stiffness).toBeCloseTo((2 * Math.PI / 0.36) ** 2, 6);
  });
});

describe("tempo, release and context springs", () => {
  it("tempoOf: 0 at ≤ 400 px/s, 1 at ≥ 1800 px/s, smooth and monotonic between, sign ignored", () => {
    expect(tempoOf(0)).toBe(0);
    expect(tempoOf(400)).toBe(0);
    expect(tempoOf(-300)).toBe(0);
    expect(tempoOf(1800)).toBe(1);
    expect(tempoOf(-5000)).toBe(1);
    close(tempoOf(1100), 0.5, 1e-9);
    close(tempoOf(1000), 0.3936, 1e-3);
    let prev = -1;
    for (let v = 0; v <= 2500; v += 25) {
      const t = tempoOf(v);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(tempoOf(Number.NaN)).toBe(0);
  });

  it("releaseSpring: slow = Apple(.5, 0) = spring.smooth, fast = Apple(.36, .3), velocity rides along", () => {
    expect(releaseSpring(200)).toEqual({ ...appleSpring(0.5, 0), velocity: 200 });
    expect(releaseSpring(-400)).toEqual({ ...appleSpring(0.5, 0), velocity: -400 });
    expect(releaseSpring(2500)).toEqual({ ...appleSpring(0.36, 0.3), velocity: 2500 });
    expect(releaseSpring(-1800)).toEqual({ ...appleSpring(0.36, 0.3), velocity: -1800 });
    // plan table: 1000 px/s → (0.445, 0.118); 1500 → (0.377, 0.27)
    const mid = appleParams(releaseSpring(1000));
    close(mid.duration, 0.445, 0.001);
    close(mid.bounce, 0.118, 0.001);
    const fast = appleParams(releaseSpring(1500));
    close(fast.duration, 0.377, 0.002);
    close(fast.bounce, 0.27, 0.01);
    // never above 0.3 release bounce, never above Apple's 0.4 line; physics-defined (keeps velocity in Motion 13)
    for (let v = 0; v <= 9000; v += 300) {
      const r = releaseSpring(v);
      expect(appleParams(r).bounce).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(isTimeDefined(r)).toBe(false);
    }
    // 2-D: speed decides the spring, velocity stays per axis
    expect(releaseSpring(100, 2000)).toEqual({ ...appleSpring(0.36, 0.3), velocity: 100 });
    // glitch clamp
    expect(releaseSpring(99999).velocity).toBe(physics.maxVelocity);
    expect(releaseSpring(Number.NaN).velocity).toBe(0);
  });

  it("slow release does not overshoot by itself, fast release does (momentum earns overshoot)", () => {
    // released 60 px from home moving AWAY at 100 px/s vs TOWARD it at 1500 px/s (exact Motion generator)
    const slow = releaseSpring(-100);
    const g1 = motionSpring({ keyframes: [60, 0], stiffness: slow.stiffness, damping: slow.damping, mass: 1, velocity: slow.velocity });
    let min1 = 60;
    for (let t = 0; t < 1500; t += 4) min1 = Math.min(min1, g1.next(t).value as number);
    expect(min1).toBeGreaterThan(-0.5);
    const fast = releaseSpring(-1500);
    const g2 = motionSpring({ keyframes: [60, 0], stiffness: fast.stiffness, damping: fast.damping, mass: 1, velocity: fast.velocity });
    let min2 = 60;
    for (let t = 0; t < 1500; t += 4) min2 = Math.min(min2, g2.next(t).value as number);
    expect(min2).toBeLessThan(-10);
  });

  it("contextSpring returns the EXACT token object at rest / normal speed for every token", () => {
    const all = { ...spring, ...tween } as Record<string, Transition>;
    for (const [name, tok] of Object.entries(all)) {
      for (const speed of [0, 120, 399, 400, -400]) expect(contextSpring(tok, speed), `${name}@${speed}`).toBe(tok);
      expect(contextSpringAt(tok, 0)).toBe(tok);
      expect(contextSpringAt(tok, Number.NaN)).toBe(tok);
      expect(contextSpringAt(tok, -1)).toBe(tok);
    }
    // tweens are never touched, even fast
    expect(contextSpring(tween.page, 5000)).toBe(tween.page);
  });

  it("contextSpring when fast: shorter and bouncier, capped at 0.4, monotonic, never slower or calmer than the token", () => {
    for (const [name, tok] of Object.entries(spring) as [string, Transition][]) {
      const base = appleParamsOf(tok)!;
      let prev = base;
      for (const speed of [500, 800, 1100, 1400, 1800, 3000]) {
        const c = contextSpring(tok, speed);
        expect(c).not.toBe(tok);
        const p = appleParamsOf(c)!;
        expect(p.bounce, name).toBeLessThanOrEqual(Math.max(physics.maxBounce, base.bounce) + 1e-9);
        expect(p.bounce, name).toBeGreaterThanOrEqual(prev.bounce - 1e-6);
        expect(p.duration, name).toBeLessThanOrEqual(prev.duration + 1e-6);
        prev = p;
      }
      // at full tempo the response is exactly 20 % shorter, and the result keeps velocity (physics-defined)
      const full = contextSpringAt(tok, 1);
      close(appleParamsOf(full)!.duration, base.duration * 0.8, 1e-9);
      expect(isTimeDefined(full)).toBe(false);
    }
    // plan numbers: hover (0.349, .24) → (0.279, .39); segment (0.319, .18) → (0.255, .33)
    const hover = appleParamsOf(contextSpringAt(spring.hover, 1))!;
    close(hover.duration, 0.279, 0.001);
    close(hover.bounce, 0.387, 0.002);
    const seg = appleParamsOf(contextSpringAt(spring.segment, 1))!;
    close(seg.duration, 0.255, 0.001);
    close(seg.bounce, 0.33, 1e-9);
    // half tempo: in between
    const half = appleParamsOf(contextSpringAt(spring.hover, 0.5))!;
    close(half.bounce, 0.237 + 0.075, 0.002);
    // extra fields of the token survive (PageHost rest thresholds)
    const page = contextSpringAt(spring.pageEnter, 1) as { restDelta: number; restSpeed: number };
    expect(page.restDelta).toBe(3.125);
    expect(page.restSpeed).toBe(12.5);
    // a token already above the cap is never calmed down
    const wild = { type: "spring", bounce: 0.6, duration: 0.5 } as const;
    close(appleParamsOf(contextSpringAt(wild, 1))!.bounce, 0.6, 1e-6);
    close(appleParamsOf(contextSpringAt(spring.pop, 1))!.bounce, appleParamsOf(spring.pop)!.bounce, 1e-9);
  });

  it("mixSpring is the identity at both ends and blends in Apple space; pressTempo / progressVelocity", () => {
    expect(mixSpring(spring.pop, spring.smooth, 0)).toBe(spring.pop);
    expect(mixSpring(spring.pop, spring.smooth, -1)).toBe(spring.pop);
    expect(mixSpring(spring.pop, spring.smooth, 1)).toBe(spring.smooth);
    const a = appleParamsOf(spring.pop)!;
    const b = appleParamsOf(spring.smooth)!;
    const m = appleParamsOf(mixSpring(spring.pop, spring.smooth, 0.5))!;
    close(m.duration, (a.duration + b.duration) / 2, 1e-9);
    close(m.bounce, (a.bounce + b.bounce) / 2, 1e-9);
    expect(mixSpring(tween.fade, tween.page, 0.3)).toBe(tween.fade);
    expect(pressTempo(Number.NaN)).toBe(0);
    expect(pressTempo(100)).toBe(0);
    expect(pressTempo(150)).toBe(0);
    close(pressTempo(275), 0.5, 1e-9);
    expect(pressTempo(400)).toBe(1);
    expect(pressTempo(2000)).toBe(1);
    expect(progressVelocity(-600, 300)).toBe(-2);
    expect(progressVelocity(500, 0)).toBe(0);
  });

  it("flingSpring: leaves at ≥ 900 px/s in the dismissal direction, critically damped", () => {
    const slow = flingSpring(1, 120);
    expect(slow.velocity).toBe(900);
    close(dampingRatio(slow), 1, 1e-9);
    expect(flingSpring(-1, -2400).velocity).toBe(-2400);
    expect(flingSpring(1, -500).velocity).toBe(900); // thrown the wrong way → minimum, still outward
    expect(flingSpring(1, 2000).stiffness).toBeGreaterThan(slow.stiffness); // fast exits are shorter
  });
});

describe("projection, inertia, rubber band", () => {
  it("project = UIScrollView deceleration (0.998 normal, 0.99 fast)", () => {
    close(project(1000), 499, 1e-9);
    close(project(1000, 0.99), 99, 1e-9);
    close(project(500), 249.5, 1e-9);
    close(project(-1500), -748.5, 1e-9);
    close(project(1500, physics.decelFast), 148.5, 1e-9);
    expect(project(0)).toBe(0);
    const p = projectPoint({ x: 10, y: 20 }, { x: 1000, y: -1000 }, 0.99);
    close(p.x, 109, 1e-9);
    close(p.y, -79, 1e-9);
  });

  it("decayInertia is the continuous equivalent (initial slope v, end v·τ)", () => {
    const n = decayInertia();
    close(n.timeConstant, 499.5, 0.05);
    close(n.power, 0.4995, 1e-4);
    expect(n.type).toBe("inertia");
    // Motion inertia travels power·v: within 0.2 % of project()
    close(n.power * 1000, project(1000), 1);
    close(decayInertia(0.99).timeConstant, 99.5, 0.01);
  });

  it("rubberBand: iOS c = 0.55, odd, monotonic, bounded by d", () => {
    expect(rubberBand(0, 300)).toBe(0);
    close(rubberBand(50, 300), 25.2, 0.05);
    close(rubberBand(100, 300), 46.5, 0.05);
    close(rubberBand(200, 300), 80.5, 0.05);
    close(rubberBand(600, 300), 157.1, 0.1);
    close(rubberBand(100, 60), 28.7, 0.05);
    close(rubberBand(300, 300), (1 - 1 / 1.55) * 300, 1e-9); // = 0.3548·d
    close(rubberBand(1e-6, 100) / 1e-6, 0.55, 1e-4); // slope at the edge
    expect(rubberBand(-100, 60)).toBe(-rubberBand(100, 60));
    let prev = 0;
    for (let x = 1; x < 5000; x += 7) {
      const b = rubberBand(x, 120);
      expect(b).toBeGreaterThan(prev);
      expect(b).toBeLessThan(120);
      expect(b).toBeLessThan(x);
      prev = b;
    }
    expect(rubberBand(100, 0)).toBe(0);
    expect(rubberBand(Infinity, 60)).toBe(60);
  });

  it("rubberBandInverse undoes rubberBand; rubberClamp is free inside and banded outside", () => {
    for (const x of [-500, -60, -1, 0, 3, 80, 400]) close(rubberBandInverse(rubberBand(x, 60), 60), x, 1e-6);
    expect(rubberClamp(50, 0, 100, 40)).toBe(50);
    close(rubberClamp(150, 0, 100, 40), 100 + rubberBand(50, 40), 1e-9);
    close(rubberClamp(-30, 0, 100, 40), -rubberBand(30, 40), 1e-9);
  });
});

describe("commit rules", () => {
  it("dismissThreshold = clamp(0.33·size, 140, 260)", () => {
    expect(dismissThreshold(100)).toBe(140);
    close(dismissThreshold(700), 231, 1e-9);
    expect(dismissThreshold(790)).toBe(260);
    expect(dismissThreshold(2000)).toBe(260);
  });

  it("swipeDecision decides on the projected position (plan examples)", () => {
    expect(swipeDecision({ offset: 40, velocity: 500, threshold: 231 })).toBe(true); // projects to 289.5
    expect(swipeDecision({ offset: 150, velocity: 0, threshold: 231 })).toBe(false); // slow drag returns
    expect(swipeDecision({ offset: 240, velocity: 0, threshold: 231 })).toBe(true); // dragged past and held
    expect(swipeDecision({ offset: 120, velocity: -400, threshold: 231 })).toBe(false); // flicked back
    expect(swipeDecision({ offset: 300, velocity: -400, threshold: 231 })).toBe(false); // flicked back past the line
    expect(swipeDecision({ offset: 10, velocity: 2000, threshold: 231 })).toBe(false); // barely moved
    expect(swipeDecision({ offset: 16, velocity: 2000, threshold: 231 })).toBe(true);
    expect(swipeDecision({ offset: 100, velocity: 300, threshold: 231, rate: physics.decelFast })).toBe(false);
  });

  it("flickDecision (toast: threshold 80, minOffset 12)", () => {
    const t = { threshold: 80, minOffset: 12 };
    expect(flickDecision({ offset: 30, velocity: 600, ...t })).toBe(1);
    expect(flickDecision({ offset: 60, velocity: 0, ...t })).toBe(0);
    expect(flickDecision({ offset: 90, velocity: -700, ...t })).toBe(-1);
    expect(flickDecision({ offset: -85, velocity: 0, ...t })).toBe(-1);
    expect(flickDecision({ offset: 5, velocity: 3000, ...t })).toBe(0); // min offset
    expect(flickDecision({ offset: 300, velocity: -250, ...t })).toBe(1); // still projects right, eased back gently
    expect(flickDecision({ offset: 300, velocity: -400, ...t })).toBe(0); // thrown back faster than 300 px/s: cancels
  });

  it("nearestIndex / snapIndex / flickStep", () => {
    const centres = [0, 100, 200, 300];
    expect(nearestIndex(centres, 140)).toBe(1);
    expect(nearestIndex(centres, 150)).toBe(1); // tie → lower
    expect(nearestIndex([], 5)).toBe(-1);
    expect(snapIndex(centres, 100, 300)).toBe(1); // too slow: lands where it is
    expect(snapIndex(centres, 100, 1200)).toBe(2); // +119 px (fast deceleration)
    expect(snapIndex(centres, 100, -1200)).toBe(0);
    expect(snapIndex(centres, 100, 5000, { rate: physics.decelNormal })).toBe(3);
    expect(flickStep({ offset: 40, velocity: 900, durationMs: 150 })).toBe(1);
    expect(flickStep({ offset: -40, velocity: -900, durationMs: 150 })).toBe(-1);
    expect(flickStep({ offset: 40, velocity: 900, durationMs: 400 })).toBe(0); // too long a press (scrub)
    expect(flickStep({ offset: 10, velocity: 900, durationMs: 100 })).toBe(0); // too short a travel
    expect(flickStep({ offset: 40, velocity: 300, durationMs: 100 })).toBe(0); // too slow
    expect(flickStep({ offset: 40, velocity: -900, durationMs: 100 })).toBe(0); // reversed at the end
  });

  it("axisLock: 10 px hysteresis, ≈ 40° cone", () => {
    expect(axisLock(5, 5, "y")).toBe("pending");
    expect(axisLock(0, 9.9, "y")).toBe("pending");
    expect(axisLock(0, 10, "y")).toBe("engage");
    expect(axisLock(4, 12, "y")).toBe("engage");
    expect(axisLock(9, 10, "y")).toBe("reject");
    expect(axisLock(12, 4, "x")).toBe("engage");
    expect(axisLock(12, 4, "y")).toBe("reject");
    expect(axisLock(-8, -8, "xy")).toBe("engage");
  });
});
