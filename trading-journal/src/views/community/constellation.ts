import type { DotFrame } from "@/motion";

/**
 * The community glyph (P12): three dot-matrix people linked by dotted lines, 9 × 23 cells – and its build-up frames
 * (cells light up from the middle outwards, lines last), played ONCE by `Constellation`.
 */
const ROWS = 9;
const COLS = 23;
const PERSON = [".###.", ".#.#.", ".###.", ".....", "#####", "#...#"] as const;

function person(grid: number[][], col: number, row: number, v = 1): void {
  PERSON.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) if (line[c] === "#") grid[row + r]![col + c] = v;
  });
}

/** The final picture (cells 0..1). */
export function constellation(): DotFrame {
  const g = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  person(g, 1, 3);
  person(g, 9, 2);
  person(g, 17, 3);
  // links between the heads and an arc over all three
  for (const c of [7, 15]) g[4]![c] = 0.45;
  for (const c of [3, 5, 7, 15, 17, 19]) g[1]![c] = 0.3;
  for (const c of [9, 11, 13]) g[0]![c] = 0.3;
  return g;
}

/** Build-up: cells by distance from the centre, `steps` frames, the last one is the final picture. */
export function constellationFrames(steps = 14): DotFrame[] {
  const done = constellation();
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const cells: { r: number; c: number; d: number }[] = [];
  done.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v > 0) cells.push({ r, c, d: Math.hypot((c - cx) / 1.6, r - cy) + (v < 1 ? 6 : 0) });
    }),
  );
  const max = Math.max(...cells.map((x) => x.d));
  return Array.from({ length: steps }, (_, k) => {
    const lim = ((k + 1) / steps) * max;
    return done.map((row, r) => row.map((v, c) => (cells.some((x) => x.r === r && x.c === c && x.d <= lim) ? v : 0)));
  });
}
