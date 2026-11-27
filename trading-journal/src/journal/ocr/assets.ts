/**
 * Where the OCR files live – ONE list read by the build (`vite.config.ts`: copies the files into `dist/ocr/<version>/`,
 * serves them in `vite dev`), by the browser engine (URLs) and by Node (paths in `node_modules`). Alias-free and
 * dependency-free, so the Vite config may import it.
 *
 * The files are NOT part of the app bundle and NOT cached ahead of time: they are fetched the first time a screenshot
 * is read (a few MB: worker script, one WebAssembly core, two language files) and then come from the browser cache.
 * `OCR_VERSION` is part of the URL, so `Cache-Control: immutable` (netlify.toml) is safe; bump it whenever the pinned
 * `tesseract.js`, `tesseract.js-core` or `@tesseract.js-data/*` versions change (a unit test compares it with the
 * installed packages).
 */
export const OCR_VERSION = "7.0.0-1";
/** tesseract.js and tesseract.js-core of this release (the unit test pins them against `package.json`). */
export const OCR_TESSERACT_VERSION = "7.0.0";
/** URL prefix, root-absolute on purpose: the share edition (`/teilen/`) reuses the files of the personal build. */
export const OCR_URL_ROOT = "/ocr/";

/** The WebAssembly cores of the LSTM engine: which one loads depends on the device (relaxed SIMD, SIMD, plain). */
export const OCR_CORE_FILES = ["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"] as const;
/** Language data (`best_int` models of tessdata 4.0.0, gzip). */
export const OCR_LANGS = ["eng", "deu"] as const;
export const OCR_LANG_DIR = "4.0.0_best_int";

/** Package-relative sources (below `node_modules/`) → file name below `ocr/<version>/`. */
export function ocrSources(): { from: string; to: string }[] {
  return [
    { from: "tesseract.js/dist/worker.min.js", to: "worker.min.js" },
    ...OCR_CORE_FILES.map((f) => ({ from: `tesseract.js-core/${f}`, to: `core/${f}` })),
    ...OCR_LANGS.map((l) => ({ from: `@tesseract.js-data/${l}/${OCR_LANG_DIR}/${l}.traineddata.gz`, to: `lang/${l}.traineddata.gz` })),
  ];
}

/** Browser URLs (same origin). */
export function ocrUrls(root = OCR_URL_ROOT): { worker: string; core: string; lang: string } {
  const base = `${root.replace(/\/$/, "")}/${OCR_VERSION}`;
  return { worker: `${base}/worker.min.js`, core: `${base}/core`, lang: `${base}/lang` };
}
