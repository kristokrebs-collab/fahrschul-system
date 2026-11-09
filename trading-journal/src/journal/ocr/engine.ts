/**
 * The recognition engine (tesseract.js, WebAssembly) behind a tiny interface. LAZY: this file is only ever reached by a
 * dynamic import from the import sheet, so tesseract.js (and the megabytes it loads) never weigh on the first load.
 *
 * Nothing is fetched from a third party: the worker script, the WebAssembly core and the language data (`eng`, `deu`)
 * are served from this site (`/ocr/<version>/…`, copied at build time by `vite.config.ts` from the pinned
 * `tesseract.js` / `tesseract.js-core` / `@tesseract.js-data/*` packages) – DSGVO-friendly, offline-capable after the
 * first use, and nothing about the picture leaves the device. In Node (tests, `scripts/ocrCheck.ts`) the same packages are
 * read from `node_modules`.
 */
import type { Box, Plane } from "./types";

export interface EngineWord {
  text: string;
  /** 0–100 */
  conf: number;
  /** Pixels of the plane that was recognised. */
  box: Box;
}

export interface RecognizeOptions {
  /** Tesseract page segmentation mode: "3" auto (default), "7" one line, "8" one word, "11" sparse text. */
  psm?: "3" | "6" | "7" | "8" | "11";
  /** Only these characters (a re-read of a number cell). */
  whitelist?: string;
}

export interface OcrEngine {
  recognize(img: Plane, opts?: RecognizeOptions): Promise<EngineWord[]>;
  terminate(): Promise<void>;
}

export interface EngineProgress {
  /** Phase as the engine names it ("loading tesseract core", "loading language traineddata", "recognizing text" …). */
  status: string;
  /** 0–1 within the phase. */
  progress: number;
}

export interface TesseractEngineOptions {
  /** Directory URL / path holding `eng.traineddata.gz`, `deu.traineddata.gz`. */
  langPath: string;
  /** Directory URL / path with the `tesseract-core*-lstm.wasm.js` files (browser only; Node reads `node_modules`). */
  corePath?: string;
  /** URL of `worker.min.js` (browser only). */
  workerPath?: string;
  langs?: readonly string[];
  /** The plane as something the engine accepts (a PNG `Blob` in the browser, a PNG `Buffer` in Node). */
  encode: (p: Plane) => Promise<unknown>;
  onProgress?: (p: EngineProgress) => void;
  /** Browser: keep the language data in IndexedDB after the first download ("write"); tests: "none". */
  cacheMethod?: "write" | "readOnly" | "refresh" | "none";
  /** Browser: spawn the worker from a blob (the default of the library) – off, because the script is same-origin. */
  workerBlobURL?: boolean;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TessData {
  text?: string;
  blocks?: { paragraphs: { lines: { words: TessWord[] }[] }[] }[] | null;
}
interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: unknown, opts?: object, out?: object): Promise<{ data: TessData }>;
  terminate(): Promise<unknown>;
}
interface TessModule {
  createWorker(langs: string[], oem?: number, options?: Record<string, unknown>, config?: Record<string, string>): Promise<TessWorker>;
}

/** Starts the engine (downloads / loads core + language data on first use; `onProgress` reports the phases). */
export async function createTesseractEngine(o: TesseractEngineOptions): Promise<OcrEngine> {
  const mod = (await import("tesseract.js")) as unknown as TessModule & { default?: TessModule };
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  if (!createWorker) throw new Error("tesseract.js: createWorker fehlt");
  const langs = [...(o.langs ?? ["eng", "deu"])];
  const worker = await createWorker(
    langs,
    1,
    {
      langPath: o.langPath,
      ...(o.corePath ? { corePath: o.corePath } : {}),
      ...(o.workerPath ? { workerPath: o.workerPath } : {}),
      workerBlobURL: o.workerBlobURL ?? false,
      cacheMethod: o.cacheMethod ?? "write",
      gzip: true,
      logger: (m: { status?: string; progress?: number }) => o.onProgress?.({ status: String(m.status ?? ""), progress: Number(m.progress ?? 0) }),
    },
    {},
  );
  let current = "";
  const setParams = async (psm: string, whitelist: string): Promise<void> => {
    const key = `${psm}|${whitelist}`;
    if (key === current) return;
    await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    current = key;
  };
  return {
    async recognize(img, opts = {}) {
      await setParams(opts.psm ?? "3", opts.whitelist ?? "");
      const { data } = await worker.recognize(await o.encode(img), {}, { blocks: true, text: true });
      const words: EngineWord[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) if (w.text.trim()) words.push({ text: w.text.trim(), conf: w.confidence, box: { ...w.bbox } });
      return words;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
