/**
 * The whole local reading of screenshots: pixels → words → layout → second reading of doubtful cells → typed,
 * cross-checked records → `Extraction` for the import's normalisers. The SAME code runs in the browser (engine from
 * `engine.ts` + canvas pixels from `browser.ts`) and in Node (tests, `scripts/ocrCheck.ts`): this file only knows the
 * `OcrEngine` interface and `Raster`s.
 */
import type { OcrEngine } from "./engine";
import { parsePage, type ParsedPage } from "./layout";
import { recognizePicture, type PictureRead } from "./recognize";
import { dropCoveredIncomplete, finalizePage } from "./records";
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
}

export interface PipelineResult extends OcrExtraction {
  pictures: PictureResult[];
  ms: number;
}

export async function readPictures(rasters: readonly Raster[], engine: OcrEngine, onProgress?: (p: PipelineProgress) => void): Promise<PipelineResult> {
  const t0 = Date.now();
  const pictures: PictureResult[] = [];
  const pages = [];
  const n = rasters.length;
  for (let i = 0; i < n; i++) {
    const per = 1 / n;
    onProgress?.({ picture: i, of: n, phase: "recognize", fraction: i * per });
    const read = await recognizePicture(rasters[i]!, i, engine, (d, total) => onProgress?.({ picture: i, of: n, phase: "recognize", fraction: i * per + per * 0.6 * (d / total) }));
    const parsed = parsePage(read.page);
    onProgress?.({ picture: i, of: n, phase: "refine", fraction: i * per + per * 0.6 });
    const refine = await refineRecords(parsed.records, read.prep, engine, (d, total) => onProgress?.({ picture: i, of: n, phase: "refine", fraction: i * per + per * (0.6 + 0.4 * (d / Math.max(1, total))) }));
    pictures.push({ read, parsed, refine });
    pages.push(finalizePage(parsed));
  }
  onProgress?.({ picture: n - 1, of: n, phase: "done", fraction: 1 });
  const ex = toExtraction(dropCoveredIncomplete(pages));
  return { ...ex, pictures, ms: Date.now() - t0 };
}
