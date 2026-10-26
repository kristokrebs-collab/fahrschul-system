/**
 * Analysis states for the archive (F26): what the app's own analysis says about the LIVE symbol at this moment – the
 * Lage-Ampel and the phase of the newest box on 4h / 1D / 1W. Read from the stores the pages already feed (nothing is
 * computed here, nothing is fetched); a part that is not running or has no data is simply left out, never guessed.
 */
import type { Cell, SeriesId } from "@/domain/archive";
import type { BoxTf } from "@/domain/boxes";
import { getBoxes } from "../boxes/store";
import { getLage } from "../lage";
import type { StateRead } from "./collector";

const BOX_SERIES: Readonly<Record<BoxTf, SeriesId>> = { "4h": "box4h", "1d": "box1d", "1w": "box1w" };
const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The live symbol's Lage-Ampel and box states; `[]` when the analysis is not running. */
export function readLiveStates(symbol: string | null): StateRead[] {
  if (!symbol) return [];
  const out: StateRead[] = [];
  const lage = getLage().lage;
  if (lage && lage.state !== "none") {
    out.push({ series: "lage", symbol, d: { state: lage.state, signs: lage.signsMet, price: num(lage.price), dist: num(lage.dist) } satisfies Record<string, Cell> });
  }
  const boxes = getBoxes();
  if (boxes.state === "ok" && boxes.symbol === symbol) {
    for (const tf of ["4h", "1d", "1w"] as const) {
      const a = boxes.tfs[tf].analysis;
      const b = a?.box.box;
      if (!a || !b) continue;
      out.push({ series: BOX_SERIES[tf], symbol, d: { phase: a.box.phase, dir: a.box.dir, top: num(b.top), bottom: num(b.bottom), grade: b.grade, pos: num(a.box.pos), price: num(a.box.price) } });
    }
  }
  return out;
}
