// Physik-basierte Bewegung nach Apple-Vorbild (SwiftUI/UIKit-Federn: response + dampingFraction).
// Dazu Kontext-Erkennung: wie schnell der Zeiger/Finger gerade bewegt wird, bestimmt die Feder.
// Langsam → weich und ohne Nachschwingen, schnell → direkt mit elastischem Bounce.
import type { Transition } from 'motion/react';

/** Apple-Feder (Masse 1): response = Dauer einer Schwingung in s, dampingFraction 1 = kein Überschwingen. */
export function appleSpring(response: number, dampingFraction: number, delay = 0): Transition {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const damping = (4 * Math.PI * dampingFraction) / response;
  return { type: 'spring', stiffness, damping, mass: 1, delay };
}

const SPRINGS = {
  smooth: [0.35, 0.9],
  snappy: [0.3, 0.78],
  bouncy: [0.38, 0.6],       // Wassertropfen: kurzes Nachschwingen
  soft: [0.45, 0.82],
  interactive: [0.15, 0.86], // folgt dem Finger (.interactiveSpring)
  sheet: [0.36, 0.84],
} as const;
export type SpringKind = keyof typeof SPRINGS;
export const spring = (kind: SpringKind, delay = 0) => appleSpring(SPRINGS[kind][0], SPRINGS[kind][1], delay);

// ── Kontext: Zeiger-Geschwindigkeit in px/ms, geglättet ──
let speed = 0, lx = 0, ly = 0, lt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    const t = e.timeStamp, dt = t - lt;
    const v = lt && dt > 0 && dt < 100 ? Math.hypot(e.clientX - lx, e.clientY - ly) / dt : 0;
    speed = speed * 0.55 + v * 0.45;
    lx = e.clientX; ly = e.clientY; lt = t;
  }, { passive: true });
}
/** Aktuelle Zeiger-Geschwindigkeit; klingt ab, wenn der Zeiger ruht. */
export function pointerSpeed() {
  const idle = performance.now() - lt;
  return idle > 160 ? speed * Math.max(0, 1 - idle / 600) : speed;
}

type Base = { stiffness: number; damping: number; mass?: number } | { bounce: number; duration: number };
/**
 * Feder passend zur Geste. Ruhige Bewegung = die bewährte Grundfeder unverändert,
 * schnelle Bewegung = direkter und elastischer (mehr Bounce). Nie träger als die Grundfeder.
 */
export function contextSpring(base: Base = { stiffness: 260, damping: 22, mass: 0.8 }, v = pointerSpeed()): Transition {
  const t = Math.max(0, Math.min(1, (v - 0.4) / 1.4));
  if ('bounce' in base) return { type: 'spring', bounce: Math.min(0.5, base.bounce + 0.2 * t), duration: base.duration * (1 - 0.15 * t) };
  return { type: 'spring', stiffness: base.stiffness * (1 + 0.4 * t), damping: base.damping * (1 - 0.3 * t), mass: base.mass ?? 1 };
}

/** Wohin ein Wurf ausrollen würde (UIScrollView-Verzögerung), Geschwindigkeit in px/s. */
export const project = (velocity: number, decel = 0.998) => (velocity / 1000) * decel / (1 - decel);

/** Gummiband wie in iOS: Widerstand wächst mit der Strecke. */
export const rubberband = (offset: number, dimension: number, c = 0.55) =>
  Math.sign(offset) * (1 - 1 / ((Math.abs(offset) * c) / dimension + 1)) * dimension;
