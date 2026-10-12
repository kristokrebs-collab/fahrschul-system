/**
 * Share picture of one trade (Journal v3, P06; the share flow of P12 builds on it): a 1200 × 675 PNG in the Nothing
 * style – ink background with the dot grid, the result as dot-matrix digits (the `DotMatrix` 5 × 7 glyphs, lit cells
 * with a soft bloom), pair / side / entry → exit / holding time / rating, an optional price path.
 *
 * Privacy first: the default `privacy: "percent"` shows R and the move in % only – no money amounts, no account size.
 * `"full"` adds the P&L in the journal currency. Nothing leaves the device: the picture is drawn into a canvas and
 * downloaded (or handed to the caller as a Blob).
 *
 * `shareCardModel()` is pure (tested); `drawShareCard()` paints a model into any 2D context.
 */
import type { EnrichedTrade, Setup } from "@/domain/types";
import { holdLabel, holdMs } from "@/domain/excursion";
import { tradeTime } from "@/lib/dates";
import { date as fmtDate, n1, price as fmtPrice, time as fmtTime } from "@/lib/format";
import { glyphFor } from "@/motion/DotMatrix";

export const SHARE_CARD = { width: 1200, height: 675 } as const;

/** Colours of the card (the chart / token palette; red stays the single signal accent). */
const C = {
  bg: "#0a0a0a",
  panel: "#111111",
  grid: "rgba(255,255,255,0.055)",
  line: "#1f1f1f",
  fg: "#f2f2f2",
  mute: "#9b9b9b",
  faint: "#5f5f5f",
  win: "#3ddc84",
  loss: "#ff4d4f",
  signal: "#e5202e",
  off: "rgba(255,255,255,0.07)",
} as const;

export type SharePrivacy = "percent" | "full";

export interface ShareCardOptions {
  privacy?: SharePrivacy;
  currency?: string;
  setups?: readonly Pick<Setup, "id" | "name">[];
  /** Closes of the price path around the trade (ms time). */
  path?: readonly { time: number; close: number }[];
}

export interface ShareCardModel {
  pair: string;
  side: "long" | "short";
  sideLabel: string;
  account: string;
  /** The dot-matrix headline, e.g. "+3,96R" or "+5,0%". */
  hero: string;
  heroTone: "win" | "loss" | "fg";
  /** Caption under the headline. */
  heroCaption: string;
  facts: { label: string; value: string }[];
  rating: number | null;
  tags: string[];
  setups: string[];
  dateLine: string;
  /** Normalised path 0–1 (x by time, y by price) plus the entry / exit points on it. */
  path: { pts: [number, number][]; entry: [number, number] | null; exit: [number, number] | null } | null;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const signedText = (v: number, d: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** Everything the card shows, as text – pure. */
export function shareCardModel(t: EnrichedTrade, opts: ShareCardOptions = {}): ShareCardModel {
  const privacy = opts.privacy ?? "percent";
  const open = t.result === "open";
  const r = fin(t.r) ? t.r : null;
  const move = fin(t.move) ? t.move * 100 : null;
  const hero = r != null ? `${signedText(r, 2)}R` : move != null ? `${signedText(move, 1)}%` : open ? "OFFEN" : "–";
  const toneOf = (v: number | null) => (v == null ? "fg" : v > 0 ? "win" : v < 0 ? "loss" : "fg");
  const heroTone = r != null ? toneOf(r) : toneOf(move);
  const heroCaption = r != null ? "R-Multiple" : move != null ? "Kursbewegung" : open ? "Position läuft" : "Ergebnis";
  const hold = holdMs(t);
  const facts: { label: string; value: string }[] = [
    { label: "Einstieg", value: fmtPrice(t.entry) },
    { label: "Ausstieg", value: open ? "offen" : fmtPrice(t.exit) },
  ];
  if (move != null && r != null) facts.push({ label: "Bewegung", value: `${signedText(move, 1)} %` });
  if (hold != null) facts.push({ label: "Haltedauer", value: holdLabel(hold) });
  if (fin(t.mfeR)) facts.push({ label: "MFE", value: `${n1(t.mfeR)} R` });
  if (privacy === "full" && fin(t.pnl)) facts.push({ label: "P&L", value: `${signedText(t.pnl, 2)} ${opts.currency ?? ""}`.trim() });
  if (fin(t.leverage)) facts.push({ label: "Hebel", value: `${n1(t.leverage).replace(",0", "")}x` });
  const d = tradeTime(t);
  const names = new Map((opts.setups ?? []).map((s) => [s.id, s.name] as const));
  return {
    pair: (t.pair || "–").toUpperCase(),
    side: t.side,
    sideLabel: t.side === "short" ? "▼ SHORT" : "▲ LONG",
    account: [t.account === "makro" ? "Makro" : "Scalp", t.market === "spot" ? "Spot" : t.market === "perp" ? "Perp" : "", t.exchange ?? ""].filter(Boolean).join(" · "),
    hero,
    heroTone,
    heroCaption,
    facts: facts.slice(0, 6),
    rating: fin(t.rating) ? t.rating : null,
    tags: (t.tags ?? []).slice(0, 4),
    setups: (t.setups ?? []).map((id) => names.get(id)).filter((n): n is string => Boolean(n)).slice(0, 3),
    dateLine: `${fmtDate(d)} ${fmtTime(d)}${t.timeframe ? ` · ${t.timeframe}` : ""}`,
    path: pathOf(t, opts.path),
  };
}

function pathOf(t: EnrichedTrade, path: ShareCardOptions["path"]): ShareCardModel["path"] {
  if (!path || path.length < 2) return null;
  const xs = path.map((p) => p.time);
  const ys = path.map((p) => p.close);
  const extra = [t.entry, t.exit].filter(fin);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys, ...extra);
  const y1 = Math.max(...ys, ...extra);
  const nx = (v: number) => (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5);
  const ny = (v: number) => (y1 > y0 ? (v - y0) / (y1 - y0) : 0.5);
  const at = new Date(t.date || 0).getTime();
  const exitAt = t.exitDate ? new Date(t.exitDate).getTime() : NaN;
  const point = (time: number, priceV: number | null): [number, number] | null => (fin(priceV) && Number.isFinite(time) && time >= x0 && time <= x1 ? [nx(time), ny(priceV)] : null);
  return { pts: path.map((p) => [nx(p.time), ny(p.close)]), entry: point(at, t.entry), exit: t.result === "open" ? null : point(exitAt, t.exit) };
}

/** `trade-BTCUSDT-2026-10-02.png` */
export function shareCardFilename(t: Pick<EnrichedTrade, "pair" | "date">): string {
  const pair = (t.pair || "trade").replace(/[^A-Za-z0-9]+/g, "").toUpperCase() || "TRADE";
  return `trade-${pair}-${(t.date || "").slice(0, 10) || "datum"}.png`;
}

/* ------------------------------------------------------------------ drawing */

/** Draws `text` as 5 × 7 dot-matrix glyphs at (x, y) top-left; returns the width used. */
export function drawMatrixText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, cell: number, color: string, glow = true): number {
  const gap = cell * 0.28;
  const pitch = cell + gap;
  let cx = x;
  const lit: [number, number][] = [];
  for (const ch of Array.from(text)) {
    const g = glyphFor(ch);
    const cols = g[0]?.length ?? 3;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < cols; c++) {
        const px = cx + c * pitch + cell / 2;
        const py = y + r * pitch + cell / 2;
        if (g[r]?.[c]) lit.push([px, py]);
        else {
          ctx.fillStyle = C.off;
          ctx.beginPath();
          ctx.arc(px, py, cell * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    cx += (cols + 1) * pitch;
  }
  if (glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = cell * 1.6;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = color;
    for (const [px, py] of lit) {
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.fillStyle = color;
  for (const [px, py] of lit) {
    ctx.beginPath();
    ctx.arc(px, py, cell * 0.46, 0, Math.PI * 2);
    ctx.fill();
  }
  return cx - x - pitch;
}

/** Width of `drawMatrixText` without drawing. */
export function matrixTextWidth(text: string, cell: number): number {
  const pitch = cell * 1.28;
  let w = 0;
  for (const ch of Array.from(text)) w += ((glyphFor(ch)[0]?.length ?? 3) + 1) * pitch;
  return Math.max(0, w - pitch);
}

const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints the card (logical 1200 × 675; scale the context for retina). */
export function drawShareCard(ctx: CanvasRenderingContext2D, m: ShareCardModel): void {
  const { width: W, height: H } = SHARE_CARD;
  const tone = m.heroTone === "win" ? C.win : m.heroTone === "loss" ? C.loss : C.fg;
  // background + top glow + dot grid
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.3, -120, 40, W * 0.3, -120, 760);
  glow.addColorStop(0, "rgba(255,255,255,0.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.grid;
  for (let y = 11; y < H; y += 22) for (let x = 11; x < W; x += 22) ctx.fillRect(x, y, 1.6, 1.6);

  // brand row
  ctx.fillStyle = C.signal;
  ctx.beginPath();
  ctx.arc(64, 62, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `500 15px ${MONO}`;
  ctx.fillStyle = C.mute;
  ctx.textBaseline = "middle";
  ctx.fillText("TRADING JOURNAL", 82, 63);
  ctx.textAlign = "right";
  ctx.fillText(m.dateLine, W - 60, 63);
  ctx.textAlign = "left";

  // pair + side
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 64px ${SANS}`;
  ctx.fillStyle = C.fg;
  ctx.fillText(m.pair, 60, 160);
  const pairW = ctx.measureText(m.pair).width;
  ctx.font = `600 20px ${MONO}`;
  ctx.fillStyle = m.side === "short" ? C.loss : C.win;
  ctx.fillText(m.sideLabel, 60 + pairW + 24, 158);
  if (m.account) {
    ctx.font = `400 18px ${SANS}`;
    ctx.fillStyle = C.mute;
    ctx.fillText(m.account, 60, 196);
  }

  // hero digits
  const cell = m.hero.length > 7 ? 13 : 16;
  drawMatrixText(ctx, m.hero, 60, 236, cell, tone);
  ctx.font = `500 15px ${MONO}`;
  ctx.fillStyle = C.faint;
  ctx.fillText(m.heroCaption.toUpperCase(), 62, 236 + 7 * cell * 1.28 + 34);

  // facts panel (right)
  const px = 720;
  const pw = W - px - 60;
  roundRect(ctx, px, 110, pw, 300, 22);
  ctx.fillStyle = "rgba(17,17,17,0.86)";
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  m.facts.forEach((f, i) => {
    const y = 160 + i * 44;
    ctx.font = `500 13px ${MONO}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(f.label.toUpperCase(), px + 28, y);
    ctx.font = `500 22px ${MONO}`;
    ctx.fillStyle = C.fg;
    ctx.textAlign = "right";
    ctx.fillText(f.value, px + pw - 28, y + 1);
    ctx.textAlign = "left";
    if (i < m.facts.length - 1) {
      ctx.fillStyle = C.line;
      ctx.fillRect(px + 28, y + 17, pw - 56, 1);
    }
  });

  // price path (bottom band)
  if (m.path) {
    const bx = 60;
    const by = 470;
    const bw = W - 120;
    const bh = 120;
    const X = (v: number) => bx + v * bw;
    const Y = (v: number) => by + (1 - v) * bh;
    ctx.strokeStyle = "rgba(242,242,242,0.75)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    m.path.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
    const dot = (p: [number, number] | null, color: string) => {
      if (!p) return;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(p[0]), Y(p[1]), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    dot(m.path.entry, C.fg);
    dot(m.path.exit, tone);
  }

  // footer: rating dots, tags, setups
  const fy = H - 44;
  let fx = 60;
  if (m.rating != null) {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < m.rating ? C.fg : C.off;
      ctx.beginPath();
      ctx.arc(fx + 7 + i * 20, fy - 6, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    fx += 5 * 20 + 24;
  }
  ctx.font = `500 15px ${SANS}`;
  for (const label of [...m.setups, ...m.tags.map((x) => `#${x}`)]) {
    const w = ctx.measureText(label).width + 28;
    if (fx + w > W - 60) break;
    roundRect(ctx, fx, fy - 22, w, 32, 16);
    ctx.strokeStyle = "#2c2c2c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.mute;
    ctx.fillText(label, fx + 14, fy);
    fx += w + 10;
  }
}

/** The card as a canvas (`null` without a 2D context, e.g. in tests). */
export function renderShareCard(t: EnrichedTrade, opts: ShareCardOptions = {}, scale = 2): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD.width * scale;
  canvas.height = SHARE_CARD.height * scale;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.scale(scale, scale);
  drawShareCard(ctx, shareCardModel(t, opts));
  return canvas;
}

/** Waits (≤ 1.5 s) for the card fonts so the first export is not drawn in the fallback face. */
async function fontsReady(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return;
  await Promise.race([Promise.all([fonts.load(`600 64px "IBM Plex Sans"`), fonts.load(`500 15px "IBM Plex Mono"`)]).catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
}

/** PNG blob of the card (`null` when the browser cannot draw it). */
export async function shareCardBlob(t: EnrichedTrade, opts: ShareCardOptions = {}): Promise<Blob | null> {
  await fontsReady();
  const canvas = renderShareCard(t, opts);
  if (!canvas || typeof canvas.toBlob !== "function") return null;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Downloads the card as PNG; resolves `false` when it could not be drawn or saved. */
export async function downloadShareCard(t: EnrichedTrade, opts: ShareCardOptions = {}): Promise<boolean> {
  const blob = await shareCardBlob(t, opts);
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = shareCardFilename(t);
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
