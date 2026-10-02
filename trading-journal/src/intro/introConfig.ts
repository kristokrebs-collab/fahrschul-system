/**
 * Intro choreography tokens (ms from the stage start unless noted). Timings and curves are the pulse-motion pack's
 * measured values (product-launch-hero, text-ascii-cascade, pixel-text-fill, text-animate, reel-collage, glyph-portal,
 * slanted-spread-hero, cinematic-orbit-hero); colours are the Nothing palette.
 */
export const CONFIG = {
  /** Stage surface (ink-950) and the Nothing dot grid (product-launch-hero: 24 px, dot .085 white, fade .10–.41 s). */
  stage: { bg: "#040404", gridPitch: 24, gridDot: 1, gridColor: "rgba(255,255,255,0.085)", gridIn: [100, 410] as const },
  /** Rotating outline marker around the dive letter (product-launch-hero `square`: 52 px, 1.5 px, .36 white). */
  square: { fadeIn: [170, 550] as const, rot0: 2, degPerSec: 18.5, sizeEm: 0.46, border: 1.5, color: "rgba(255,255,255,0.36)" },
  /** Signal dot inside the "O": pops, pings twice. */
  signal: { dotPx: 7, popMs: 180, pings: [60, 520] as const, pingMs: 700, pingScale: 4.2, color: "#e5202e" },
  /** Wordmark rows (AsciiCascade, measured phases): fall depth tightened from 1.02 em so the rows keep their gap. */
  wordmark: { top: "TRADE", bottom: "JOURNAL", dive: { row: 1, index: 1 }, drop: 0.62 },
  statement: { text: "Disziplin schlägt Gefühl.", delay: 560, speed: 1.4 },
  /** Typewriter of the real data line (pack 65 ms/char is tuned down so the line lands before the reels). */
  type: { at: 1000, msPerChar: 24, waitMax: 1200 },
  /** reel-collage: window opens between the rows, hard cuts at the measured reel starts, scaleY collapse. */
  reels: {
    openAt: 1700,
    openDur: 340,
    startAt: 2040,
    starts: [0, 95, 205, 335, 468, 630, 835] as const,
    collapseAt: 906,
    collapseDur: 340,
    padPx: 14,
    glowMs: 300,
    /** window size at the 1234 px reference, capped by the viewport. */
    w: 490,
    h: 337,
    statementOut: 260,
  },
  /** glyph-portal: dive into the "O" (zoom/roll keys in curves.ts), hole = the counter, reveals the real app. */
  portal: { gap: 40, dur: 1000, roll: -5, textFade: 120, openDur: 260, rimPx: 1.5, gridFadeScale: 2.5, squareOut: 160, maxDpr: 2 },
  /**
   * product-launch zoom-out of the app seen through the hole (over portal progress u). No blur: the overview grid is
   * page-tall, a filter on it costs a full re-raster per frame (hard rule: blur only on small areas).
   */
  app: { scaleFrom: 1.06, blurFrom: 0, from: 0.3 },
  /** slanted-spread compact deck (cinematic-orbit fan angle) at the viewport centre. */
  deck: { scale: 0.6, fitH: 0.5, fitW: 0.74, rot: -12, stepX: 20, stepY: -8, tilt: [0, -0.9, 0.9, -1.2, 1.5, -1.2, 0.9, -0.6] as const },
  /** cinematic-orbit travel (ORBIT_KEYS, 2.8 s) sped up, staggered in reading order; starts at portal start + startAt. */
  flight: { startAt: 560, speed: 2.1, stagger: 90, landAt: 0.9, fold: 1.6 },
  skip: { ms: 260, overlayMs: 200 },
  pillIn: [400, 700] as const,
} as const;

export const DEG = Math.PI / 180;
