/**
 * The whole local reading of screenshots: pixels → words → layout → second reading of doubtful cells → typed,
 * cross-checked records → `Extraction` for the import's normalisers. The SAME code runs in the browser (engine from
 * `engine.ts` + canvas pixels from `browser.ts`) and in Node (tests, `scripts/ocrCheck.ts`): this file only knows the
 * `OcrEngine` interface and `Raster`s.
 *
 * `readPicture` reads ONE picture (the sheet keeps its `PageRecords` per picture, so adding a second screenshot does
 * not read the first one again); `combine` turns the pages of all pictures into one extraction.
 */
import type { OcrEngine } from "./engine";
import { parsePage, type ParsedPage } from "./layout";
import { addBandPass, addSparsePass, recognizePicture, type PictureRead } from "./recognize";
import { dropCoveredIncomplete, finalizePage, type PageRecords } from "./records";
import { refineRecords, type RefineStats } from "./refine";
import { toExtraction, type OcrExtraction } from "./toExtraction";
import type { Raster } from "./types";

export interface PipelineProgress {
  /** 0-based picture being worked on. */
  picture: number;
  of: number;
  phase: "recognize" | "refine" | "done";
  /** 0–1 over the whole job. */
  fraction: number;
}

export interface PictureResult {
  read: PictureRead;
  parsed: ParsedPage;
  refine: RefineStats;
  records: PageRecords;
}

export interface PipelineResult extends OcrExtraction {
  pictures: PictureResult[];
  ms: number;
}

/**
 * Whether the automatic reading left the page incomplete: nothing found, or most records lack what a history row always
 * has (entry / exit / quantity of a position, a price of an order). Then the sparse-text reading fills the gaps.
 */
export function needsSparsePass(parsed: ParsedPage): boolean {
  if (!parsed.records.length) return true;
  // the LAST record may simply be cut off by the edge of the picture: it does not count (unless it is the only one)
  const judged = parsed.records.length > 1 ? parsed.records.slice(0, -1) : parsed.records;
  const lacking = judged.filter((r) => {
    const f = r.fields;
    const position = f.entry || f.exit || f.openTime || f.closeTime || parsed.view === "positions";
    return position ? !f.entry || (!f.exit && r.status?.word !== "open") || !f.qty : !(f.price || f.orderPrice) || !f.qty;
  });
  return lacking.length >= Math.max(1, Math.ceil(judged.length * 0.3));
}

/** Reads one picture completely. `slot` / `of` only scale the progress fraction (picture `slot` of `of`). */
export async function readPicture(raster: Raster, index: number, engine: OcrEngine, onProgress?: (p: PipelineProgress) => void, slot = 0, of = 1): Promise<PictureResult> {
  const per = 1 / of;
  const base = slot * per;
  onProgress?.({ picture: slot, of, phase: "recognize", fraction: base });
  const step = (d: number, total: number): void => onProgress?.({ picture: slot, of, phase: "recognize", fraction: base + per * 0.5 * (d / total) });
  let read = await recognizePicture(raster, index, engine, step);
  let parsed = parsePage(read.page);
  if (needsSparsePass(parsed)) {
    read = await addSparsePass(read, raster, engine, (d, total) => onProgress?.({ picture: slot, of, phase: "recognize", fraction: base + per * (0.5 + 0.2 * (d / total)) }));
    parsed = parsePage(read.page);
  }
  if (parsed.layout === "table" && parsed.header) {
    read = await addBandPass(read, raster, engine, parsed.header);
    parsed = parsePage(read.page);
  }
  onProgress?.({ picture: slot, of, phase: "refine", fraction: base + per * 0.7 });
  const refine = await refineRecords(parsed.records, read.prep, engine, (d, total) => onProgress?.({ picture: slot, of, phase: "refine", fraction: base + per * (0.7 + 0.3 * (d / Math.max(1, total))) }));
  return { read, parsed, refine, records: finalizePage(parsed) };
}

/** The pages of all pictures as one extraction (an incomplete card another picture shows complete is not reported). */
export function combine(pages: readonly PageRecords[]): OcrExtraction {
  return toExtraction(dropCoveredIncomplete([...pages].sort((a, b) => a.page - b.page)));
}

export async function readPictures(rasters: readonly Raster[], engine: OcrEngine, onProgress?: (p: PipelineProgress) => void): Promise<PipelineResult> {
  const t0 = Date.now();
  const pictures: PictureResult[] = [];
  for (let i = 0; i < rasters.length; i++) pictures.push(await readPicture(rasters[i]!, i, engine, onProgress, i, rasters.length));
  onProgress?.({ picture: rasters.length - 1, of: rasters.length, phase: "done", fraction: 1 });
  return { ...combine(pictures.map((p) => p.records)), pictures, ms: Date.now() - t0 };
}
