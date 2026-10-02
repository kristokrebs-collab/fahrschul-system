import { CONFIG, DEG } from "@/intro/introConfig";
import { rollCurve, zoomCurve } from "@/intro/curves";
import { clamp01, easeOutCubic } from "@/motion/pulse/engine";

/**
 * glyph-portal camera on a 2D canvas (the pack's technique: the wall stays a crisp vector at 30×+, a DOM transform
 * would rasterise): stage surface + Nothing dot grid + the wordmark, zoomed and rolled about the dive point; the
 * counter of the "O" is cut out (destination-out), so the real app shows through and the hole grows until it covers
 * the viewport. One clear + three fills per frame, no layout reads.
 */

export interface PortalRow {
  text: string;
  /** left edge of the text (viewport px) */
  x: number;
  /** alphabetic baseline (viewport px) */
  baseline: number;
}

export interface PortalSetup {
  vw: number;
  vh: number;
  dpr: number;
  font: string;
  letterSpacing: string;
  rows: PortalRow[];
  /** dive point = centre of the letter's counter (viewport px) */
  ox: number;
  oy: number;
  /** counter radius at scale 1 (px) */
  r0: number;
}

/** Final scale so the hole (r0 · s) reaches the farthest viewport corner (+4 %) – the pack's auto zoom span. */
export function portalEndScale(r0: number, ox: number, oy: number, vw: number, vh: number): number {
  const far = Math.max(Math.hypot(ox, oy), Math.hypot(vw - ox, oy), Math.hypot(ox, vh - oy), Math.hypot(vw - ox, vh - oy));
  return Math.max(2, (far / Math.max(1, r0)) * 1.04);
}

/**
 * Camera at portal progress u (0..1): scale e^(span · g(u)), roll · h(u) degrees. Both curves are renormalised from
 * `from` (the preroll point), so the camera starts exactly at scale 1 / roll 0 – registered on the DOM wordmark it
 * replaces – and still ends at `endScale` / the full roll.
 */
export function portalCamera(u: number, endScale: number, from = 0): { scale: number; rot: number } {
  const span = Math.log(endScale);
  const norm = (f: (x: number) => number) => {
    const f0 = f(from);
    return (f(clamp01(u)) - f0) / (1 - f0);
  };
  const roll = norm(rollCurve);
  return { scale: Math.exp(span * Math.max(0, norm(zoomCurve))), rot: roll > 0 ? CONFIG.portal.roll * roll : 0 };
}

/**
 * Largest empty circle around the ink centre of `ch` (its counter), via 32 rays on a one-off offscreen render.
 * Both values are fractions of the font size: `cy` = ink centre relative to the baseline (negative = above), `r` =
 * counter radius.
 */
export function measureCounter(font: string, ch = "O"): { cy: number; r: number } {
  const S = 160;
  const c = document.createElement("canvas");
  c.width = S * 2;
  c.height = S * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { cy: -0.36, r: 0.18 };
  const f = font.replace(/\d+(\.\d+)?px/, `${S}px`);
  ctx.font = f;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  const m = ctx.measureText(ch);
  const bx = S - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
  const base = S + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.fillText(ch, bx, base);
  const data = ctx.getImageData(0, 0, S * 2, S * 2).data;
  let min = Infinity;
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos((a / 32) * Math.PI * 2);
    const dy = Math.sin((a / 32) * Math.PI * 2);
    for (let r = 1; r < S; r++) {
      const x = Math.round(S + dx * r);
      const y = Math.round(S + dy * r);
      if ((data[(y * S * 2 + x) * 4 + 3] ?? 0) > 110) {
        min = Math.min(min, r);
        break;
      }
    }
  }
  const inkMid = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2; // above the baseline, at S px
  const r = Number.isFinite(min) ? (min * 0.9) / S : 0.18;
  return { cy: -inkMid / S, r };
}

export interface Portal {
  readonly endScale: number;
  /** draws portal progress u with hole opening `open` (0..1) and wordmark alpha; returns true once the hole covers. */
  draw(u: number, open: number, textAlpha: number, rimAlpha: number): boolean;
  destroy(): void;
}

export function createPortal(canvas: HTMLCanvasElement, s: PortalSetup): Portal | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = Math.round(s.vw * s.dpr);
  canvas.height = Math.round(s.vh * s.dpr);
  const tile = document.createElement("canvas");
  const P = CONFIG.stage.gridPitch;
  tile.width = P;
  tile.height = P;
  const tctx = tile.getContext("2d");
  if (tctx) {
    tctx.fillStyle = CONFIG.stage.gridColor;
    tctx.beginPath();
    tctx.arc(CONFIG.stage.gridDot, CONFIG.stage.gridDot, CONFIG.stage.gridDot, 0, Math.PI * 2);
    tctx.fill();
  }
  const pattern = ctx.createPattern(tile, "repeat");
  const endScale = portalEndScale(s.r0, s.ox, s.oy, s.vw, s.vh);
  const far = (s.r0 * endScale) / 1.04;
  const diag = Math.hypot(s.vw, s.vh);

  return {
    endScale,
    draw(u, open, textAlpha, rimAlpha) {
      const cam = portalCamera(u, endScale, CONFIG.portal.preroll);
      const r = s.r0 * easeOutCubic(open);
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = CONFIG.stage.bg;
      ctx.fillRect(0, 0, s.vw, s.vh);
      ctx.translate(s.ox, s.oy);
      ctx.rotate(cam.rot * DEG);
      ctx.scale(cam.scale, cam.scale);
      ctx.translate(-s.ox, -s.oy);
      const gridA = 1 - clamp01((cam.scale - 1) / CONFIG.portal.gridFadeScale);
      if (pattern && gridA > 0.002) {
        ctx.globalAlpha = gridA;
        ctx.fillStyle = pattern;
        const half = diag / cam.scale;
        ctx.fillRect(s.ox - half, s.oy - half, half * 2, half * 2);
      }
      if (textAlpha > 0.002) {
        ctx.globalAlpha = textAlpha;
        ctx.fillStyle = "#f2f2f2";
        ctx.font = s.font;
        ctx.letterSpacing = s.letterSpacing;
        ctx.textBaseline = "alphabetic";
        for (const row of s.rows) ctx.fillText(row.text, row.x, row.baseline);
      }
      ctx.globalAlpha = 1;
      if (r > 0.05) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(s.ox, s.oy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        if (rimAlpha > 0.002) {
          ctx.globalAlpha = rimAlpha;
          ctx.strokeStyle = CONFIG.signal.color;
          ctx.lineWidth = CONFIG.portal.rimPx / cam.scale;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      return r * cam.scale >= far;
    },
    destroy() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
