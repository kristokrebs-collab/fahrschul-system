/**
 * Builders for hand-made OCR word lists (what the engine returns: words with boxes, confidence and ink colour) – the
 * layout parser is tested on these, in the patterns real exchange screenshots have.
 */
import type { InkColor, OcrPage, OcrWord } from "@/journal/ocr/types";

export interface CellOpts {
  conf?: number;
  ink?: InkColor;
  lum?: number;
}
/** `[x, text, opts]` – a cell starting at x; a text with spaces becomes several words. */
export type Cell = [number, string, CellOpts?];

const H = 22;
const CHAR = 12;

/** One line of cells at vertical centre `y` (the engine's own boxes: ~ 22 px high, 12 px per character). */
export function line(y: number, cells: readonly Cell[], h = H): OcrWord[] {
  const out: OcrWord[] = [];
  for (const [x, text, o = {}] of cells) {
    let cx = x;
    for (const part of text.split(" ")) {
      if (!part) continue;
      out.push({ text: part, conf: o.conf ?? 92, box: { x0: cx, y0: y - h / 2, x1: cx + part.length * (CHAR * h) / H, y1: y + h / 2 }, ink: o.ink ?? "light", lum: o.lum ?? 255 });
      cx += part.length * ((CHAR * h) / H) + 8;
    }
  }
  return out;
}

export function pageOf(lines: readonly OcrWord[][], size: { width: number; height?: number } = { width: 900 }, index = 0): OcrPage {
  const words = lines.flat();
  return { index, width: size.width, height: size.height ?? Math.max(...words.map((w) => w.box.y1)) + 60, words };
}

const DIM: CellOpts = { lum: 150, ink: "dim" };

/** A Bitunix-like position card (German labels left, values right). */
export function positionCard(y: number, c: { symbol: string; side: "Long" | "Short"; lev: string; pnl: string; roi: string; entry: string; exit: string; qty: string; open: string; close: string; pnlInk?: InkColor; rows?: number }): OcrWord[][] {
  const ink = c.pnlInk ?? "red";
  const rows: OcrWord[][] = [
    line(y, [[30, c.symbol], [560, "Geschlossen", DIM]]),
    line(y + 46, [[30, c.side, { ink: c.side === "Long" ? "green" : "red" }], [120, "Isoliert"], [230, c.lev]]),
    line(y + 106, [[30, "Position PnL (Gewinn und Verlust)", DIM], [640, c.pnl, { ink }]]),
    line(y + 160, [[30, "ROI", DIM], [700, c.roi, { ink }]]),
    line(y + 216, [[30, "Einstiegspreis", DIM], [690, c.entry]]),
    line(y + 270, [[30, "Schlusspreis (USDT)", DIM], [690, c.exit]]),
    line(y + 324, [[30, "Maximal gehalten (BTC)", DIM], [730, c.qty]]),
    line(y + 378, [[30, "Geschlossene Menge (BTC)", DIM], [730, c.qty]]),
    line(y + 432, [[30, "Zeit geöffnet", DIM], [560, c.open]]),
    line(y + 486, [[30, "Zeit geschlossen", DIM], [560, c.close]]),
  ];
  return rows.slice(0, c.rows ?? rows.length);
}

export const TABS_POSITIONS: OcrWord[][] = [line(40, [[20, "Auftragshistorie", DIM], [330, "Positionshistorie", { lum: 255 }], [640, "Tradehistorie", DIM]])];
