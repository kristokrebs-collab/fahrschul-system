# `src/journal/ocr` – Screenshot-Import ohne API-Key (F29 / F30)

A screenshot of an exchange's order, position or trade history is read **on the device**: pick, drop or paste one or more
pictures → text recognition in a Web Worker (tesseract.js, WebAssembly) → a layout-aware parser → the preview with every
trade → one tap writes them all, the toast offers „Rückgängig“. No server, no key, no account; the pictures are neither
stored nor sent. The optional model path (`netlify/functions/shot-extract.mts`, `src/journal/extract/`) stays; the sheet
offers it as a second engine ("KI") only when the server reports a key. Without one the local reading is the only path.

```
assets.ts      the ONE manifest of the engine files (versions, paths); the Vite plugin copies them, the engine loads them
engine.ts      OcrEngine over tesseract.js (createWorker with self-hosted worker / wasm core / language data); no CDN
pixels.ts      Raster / Plane types and the plain pixel maths (no canvas: the same code runs in the browser and in Node)
preprocess.ts  background = most common colour, "ink" = distance from it (any theme, dark mode, coloured text), print plane
               (black on white), scale from the median text-line height, strips cut at blank rows, crops for re-reads
recognize.ts   strips → words (PSM 3; sparse PSM 11 only when most records lack core fields; PSM 7 re-read of a table header)
lines.ts       words → lines → segments (gaps wider than ~0.9 line heights), icon / chevron junk removed
vocab.ts       EN + DE dictionary (labels, tabs, order names "Long öffnen" …), fuzzy matching, exchange layouts as CONSTANTS
layout.ts      cards (anchored at the symbol line) and tables (header band), wrapped date / time cells, inferred labels
refine.ts      second reading: crops of doubtful number / time / leverage cells re-read at several scales, voting
plausibility.ts  pure checks: gross = (exit − entry) × qty × dir, derived fees, ROI ≈ result / (notional / leverage), side hint
records.ts     ReadRecord / RField (value, raw text, confidence, notes), colour convention, cut-off cards (IncompleteCard)
toExtraction.ts   records → the existing `Extraction` (so `normalize` / `implied.ts` / `candidate.ts` / `merge.ts` are reused)
candidates.ts  Extraction → `Candidate[]` (pnlMode "shot"), duplicates, zone
pipeline.ts    readPicture / readPictures: the whole chain for one or many pictures (Node and browser)
preview.ts     the preview model: rows, cells, live checks after every edit, derived fees, typed times
commit.ts      buildTrade / commitTrades / undoCommit (sequential saveTrade; undo removes exactly what was written)
duplicates.ts  trades already in the journal (same market / side / prices / quantity, time offset ≤ 14 h whole hours)
truth.ts       scoring a reading against a known truth (used by the tests and `scripts/ocrCheck.ts`)
store.ts       open / close of the sheet (lazy host: `src/journal/extract/ShotImportHost.tsx`)
browser.ts     decode (createImageBitmap, HEIC where the browser can), PNG blob encode, crops, engine start, support check
node/          io.ts (jpeg-js / pngjs decode, PNG encode, language data cache), cli.ts (the report of scripts/ocrCheck.ts)
ui/            OcrImportSheet.tsx (pick / reading / preview), PreviewList.tsx (rows, cells, original crop)
```

## Engine files (self-hosted, no CDN)

`assets.ts` (`OCR_VERSION = "7.0.0-1"`): `worker.min.js` (tesseract.js 7.0.0), the **LSTM-only** WebAssembly cores
(`tesseract.js-core` `relaxedsimd-lstm` / `simd-lstm` / `lstm`, chosen by the browser's own feature detection) and
`@tesseract.js-data/{eng,deu}` `4.0.0_best_int` (gzip). The Vite plugin `ocrAssets(share)` copies them at `closeBundle` to
`dist/ocr/<version>/` (the personal build only; the share edition (`/teilen/`) ships the same lazy code but NO copy of the
files – it reads the personal build's `/ocr/` of the same site, its main chunk grew by ~0.6 KiB gz; the single-file build
reports "nicht unterstützt") and serves them in dev. Everything is same origin: `connect-src 'self'` covers the fetches,
`worker-src 'self' blob:` already existed, `script-src` gets `'wasm-unsafe-eval'` (netlify.toml, tested in
`tests/unit/integration.deploy.test.ts`). `/ocr/*` is cached immutable (the version is part of the path). There is no
service worker, so nothing is precached: **the first load does not grow** (the sheet is a lazy chunk; the engine files are
fetched when the first picture is read – one device loads the worker 0.1 MB, ONE core 3.9 MB and the language data 1.3 + 3.0 MB, i.e. about 8 MB once, then from the browser cache; `dist/ocr` holds all three cores, 16 MB on the host).

## What the reading does (and does not)

- Background / ink from the picture itself: dark and light themes, coloured text; colours (red / green) are only used for
  the **sign** and only as a flagged assumption when the minus is not readable ("Vorzeichen aus der Farbe angenommen").
- Layouts: phone cards (symbol line + label / value rows, wrapped date and time) and desktop tables (header band), for
  positions, trade history and order history. A value without a readable label is placed by its sibling cards and marked
  `inferred`. Orders are paired (open / close by market, side and quantity); cancelled orders are skipped.
- Number formats: `81,214.3`, `81.214,3`, `81 214,3` (the style is decided per picture from the numbers that are
  unambiguous); dates and times as `src/journal/extract/time.ts` parses them (`2026-10-22 17:07:22`, `22.10.2026 17:07`,
  with or without seconds). The times are the exchange app's **local** time – the sheet shows the zone as an assumption you can
  change.
- Second reading: every doubtful number / time / leverage cell is cropped and read again at other scales with a digit
  whitelist; two agreeing readings win, otherwise the cell stays yellow. Then the numbers must fit each other
  (`plausibility.ts`): when they do not, all numbers of that record are read once more.
- The screenshot's result is NET of fees, so the fees are **derived** (gross − result) when the picture shows none, only
  when the amount is believable (−0.05 % … 0.6 % of the notional), and labelled „abgeleitet“. Leverage and ROI are checked
  against each other; a mismatch is a warning, never a silent correction.
- A card that is cut off at the picture's edge is reported as incomplete („Bitte den nächsten Ausschnitt mit hochladen“)
  and **never entered**; when the next screenshot covers it, it is complete there (no trade twice). Missing values are
  never guessed.
- Nothing is saved before the button; `updatedAt` of a written trade is its exit time, so the coach / risk watchers do not
  treat the import as a fresh trade. Every written trade carries the tag `Screenshot-Import` and a note with the source.

## Checking a picture from the terminal

```
npm run ocr:check -- <image> [--words] [--json] [--expect truth.json] [--zone Europe/Berlin]
```

Runs the same pipeline as the browser (Node: jpeg-js / pngjs decode, tesseract.js with the language data cached in
`node_modules/.cache/tj-ocr/lang`) and prints the read table with confidences, the second-reading statistics, the cut-off
cards, the resulting trades and – with `--expect` – the hit rate per field against a truth file. `--words` prints the raw
recognised words (the format of `tests/fixtures/ocr/words-*.json`).

## Tests

| file | what |
|---|---|
| `tests/unit/ocr.basics.test.ts` | pixels, preprocessing, scale, strips, label vocabulary, number / time parsers |
| `tests/unit/ocr.layout.test.ts` | parser tables on OCR word lists (cards, tables, EN / DE, cut-off, inferred labels) |
| `tests/unit/ocr.import.test.ts` | records → trades, plausibility, derived fees, preview model, commit / undo, duplicates |
| `tests/unit/ocr.sheet.test.tsx` | the sheet in the DOM on the real screenshot's word list (fix a cell, write all, undo, deselect, paste) |
| `tests/unit/ocr.engine.test.ts` | REAL recognition in Node on the real screenshot and four rendered mocks, hit rate per field (~3 min) |
| `tests/e2e/screenshotImport.spec.ts` | pick the real screenshot in a built app under the production CSP (mobile + desktop) |

Fixtures: `tests/fixtures/ocr/bitunix-positionshistorie-1.jpg` (a real screenshot sent by the user, with its `.truth.json`)
and mocks rendered by `node tests/fixtures/ocr/generate.mjs` (Playwright, seeded values: dark table, 390-px cards, light
order table, 390-px order cards). Only the real picture shows how a real app renders; the mocks only prove the parser
is not tuned to one layout.

Keine professionelle Finanzberatung. The app never sends orders.
