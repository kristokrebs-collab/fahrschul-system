/**
 * Words → lines → cells (PURE). The engine returns words with boxes; its own line grouping is not used because a
 * history row has a label at the left and a value at the right edge with a wide gap, and the engine reads such rows
 * as one line, two lines or in the wrong order depending on the page-segmentation mode. Here a line is every word
 * whose vertical centre is close (y-clustering) and a cell (`Seg`) is a run of words that are close in x.
 */
import type { Box, InkColor, OcrWord } from "./types";

export interface Seg {
  text: string;
  /** Lowest word confidence in the cell (0–100): one doubtful glyph makes the cell doubtful. */
  conf: number;
  box: Box;
  words: OcrWord[];
  ink?: InkColor;
  lum?: number;
}

export interface Line {
  /** Index in reading order (top to bottom). */
  i: number;
  cy: number;
  /** Median glyph height of the line. */
  h: number;
  box: Box;
  words: OcrWord[];
  segs: Seg[];
}

export const boxW = (b: Box): number => b.x1 - b.x0;
export const boxH = (b: Box): number => b.y1 - b.y0;
export const boxCx = (b: Box): number => (b.x0 + b.x1) / 2;
export const boxCy = (b: Box): number => (b.y0 + b.y1) / 2;

export function unionBox(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Pure glyph noise: chevrons, dividers, icons the engine reads as punctuation. */
const NOISE = /^[<>›»«‹~=|¦_·•*"'`´\\/^[\]{}()+\-−–—]+$/;

/** True for a word that carries no text of the page (a chevron, a separator, a lone bracket). */
export function isNoise(w: OcrWord): boolean {
  const t = w.text.trim();
  if (!t) return true;
  if (/^[+\-−–—]$/.test(t)) return false; // a lone sign may belong to the next number (merged below)
  if (/^[()%]$/.test(t)) return false;
  return NOISE.test(t) || (w.conf < 25 && t.length <= 2 && !/\d/.test(t));
}

/** A word that is a lone sign directly in front of a number: „−“ + „14.66“. */
const SIGN = /^[+\-−–—]$/;
const STARTS_NUMBER = /^[\d.,]/;

function mergeSigns(words: readonly OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  const sorted = [...words].sort((a, b) => a.box.x0 - b.box.x0);
  const used = new Set<OcrWord>();
  for (const w of sorted) {
    if (used.has(w)) continue;
    if (SIGN.test(w.text.trim())) {
      const h = boxH(w.box);
      const next = sorted.find((n) => n !== w && !used.has(n) && STARTS_NUMBER.test(n.text) && n.box.x0 >= w.box.x1 - h * 0.3 && n.box.x0 - w.box.x1 < h * 0.9 && Math.abs(boxCy(n.box) - boxCy(w.box)) < h * 0.8);
      if (next) {
        used.add(next);
        out.push({ ...next, text: w.text.trim() + next.text, conf: Math.min(w.conf, next.conf), box: unionBox([w.box, next.box]), ink: next.ink ?? w.ink, lum: next.lum ?? w.lum });
        continue;
      }
      // a sign that stands alone is not text of the page
      continue;
    }
    out.push(w);
  }
  return out;
}

/** The words of a picture as lines, top to bottom, each cut into cells. */
export function buildLines(words: readonly OcrWord[]): Line[] {
  // a chevron glued to a number („80,726.1>“, „0.01»“) is the app's arrow, not part of it; a „<“ in front of one is a torn minus
  const kept = words
    .filter((w) => !isNoise(w))
    .map((w) => (/\d[>»›]+$/.test(w.text) || /^[<‹«]+\d/.test(w.text) ? { ...w, text: w.text.replace(/[>»›]+$/, "").replace(/^[<‹«]+(?=\d)/, "") } : w));
  if (!kept.length) return [];
  const medH = median(kept.filter((w) => /[A-Za-z0-9]/.test(w.text)).map((w) => boxH(w.box))) || 20;
  const sorted = [...kept].sort((a, b) => boxCy(a.box) - boxCy(b.box));
  const groups: { cy: number; words: OcrWord[]; y0: number; y1: number }[] = [];
  for (const w of sorted) {
    const cy = boxCy(w.box);
    const g = groups.length ? groups[groups.length - 1]! : null;
    const tol = Math.max(4, medH * 0.55);
    // the same line: the centre is close AND the boxes overlap vertically by at least a third of the smaller one
    if (g && Math.abs(cy - g.cy) <= tol) {
      const overlap = Math.min(g.y1, w.box.y1) - Math.max(g.y0, w.box.y0);
      if (overlap >= Math.min(g.y1 - g.y0, boxH(w.box)) * 0.3) {
        g.words.push(w);
        g.cy = (g.cy * (g.words.length - 1) + cy) / g.words.length;
        g.y0 = Math.min(g.y0, w.box.y0);
        g.y1 = Math.max(g.y1, w.box.y1);
        continue;
      }
    }
    groups.push({ cy, words: [w], y0: w.box.y0, y1: w.box.y1 });
  }
  const lines: Line[] = groups.map((g, i) => {
    const ws = mergeSigns(g.words).sort((a, b) => a.box.x0 - b.box.x0);
    const h = median(ws.filter((w) => /[A-Za-z0-9]/.test(w.text)).map((w) => boxH(w.box))) || medH;
    return { i, cy: g.cy, h, box: unionBox(ws.map((w) => w.box)), words: ws, segs: cutSegments(ws, h) };
  });
  return lines.filter((l) => l.words.length > 0).map((l, i) => ({ ...l, i }));
}

/** Words that are close in x belong to one cell; a gap of about a letter's height starts the next one. */
export function cutSegments(words: readonly OcrWord[], h: number): Seg[] {
  const segs: Seg[] = [];
  let cur: OcrWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const ink = dominantInk(cur);
    segs.push({
      text: cur.map((w) => w.text).join(" "),
      conf: Math.min(...cur.map((w) => w.conf)),
      box: unionBox(cur.map((w) => w.box)),
      words: cur,
      ...(ink.ink ? { ink: ink.ink } : {}),
      ...(ink.lum != null ? { lum: ink.lum } : {}),
    });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && w.box.x0 - last.box.x1 > h * 0.9) flush();
    cur.push(w);
  }
  flush();
  return segs;
}

/** The colour of the cell: the strongest coloured word wins (a red „−“ belongs to the red number). */
function dominantInk(ws: readonly OcrWord[]): { ink?: InkColor; lum?: number } {
  const coloured = ws.find((w) => w.ink === "red" || w.ink === "green");
  if (coloured) return { ink: coloured.ink!, lum: coloured.lum! };
  const first = ws.find((w) => w.ink);
  const lum = Math.max(...ws.map((w) => w.lum ?? 0));
  return first ? { ink: first.ink!, lum } : {};
}
