import type { SpringConfig } from "@/motion/pulse/engine";

/** Position + velocity of a retargetable spring (units/s). */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * Advances `s` by `dt` seconds towards a constant `target` with the exact closed-form solution of the damped
 * spring (under-, critically and over-damped) – frame-rate independent at any dt, so a spring can be retargeted
 * mid-flight (open → close, reorder while settling) without substeps. Same parameters as engine.springAt.
 */
export function stepSpring(s: SpringState, target: number, { stiffness = 300, damping = 24, mass = 1 }: SpringConfig, dt: number): void {
  if (dt <= 0) return;
  const w0 = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  const d = s.x - target;
  const v = s.v;
  let nd: number;
  let nv: number;
  if (z < 0.9999) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w0 * dt);
    const c = Math.cos(wd * dt);
    const n = Math.sin(wd * dt);
    const b = (v + z * w0 * d) / wd;
    nd = e * (d * c + b * n);
    nv = e * ((b * wd - z * w0 * d) * c + (-d * wd - z * w0 * b) * n);
  } else if (z <= 1.0001) {
    const e = Math.exp(-w0 * dt);
    const b = v + w0 * d;
    nd = e * (d + b * dt);
    nv = e * (v - w0 * b * dt);
  } else {
    const q = w0 * Math.sqrt(z * z - 1);
    const r1 = -z * w0 + q;
    const r2 = -z * w0 - q;
    const c2 = (v - r1 * d) / (r2 - r1);
    const c1 = d - c2;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    nd = c1 * e1 + c2 * e2;
    nv = c1 * r1 * e1 + c2 * r2 * e2;
  }
  s.x = target + nd;
  s.v = nv;
}

/** True once the spring is within `eps` of `target` and practically still. */
export function springRests(s: SpringState, target: number, eps = 0.0005, vEps = 0.02): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < vEps;
}
