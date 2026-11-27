/**
 * Runs the local screenshot reader (OCR) on an image file, exactly as the app does, and prints the recognised table
 * with the confidence of every field:
 *
 *   npm run ocr:check -- tests/fixtures/ocr/bitunix-positionshistorie-1.jpg
 *   npm run ocr:check -- shot.png --words              the layout parser's lines and cells
 *   npm run ocr:check -- shot.png --expect truth.json  hit rate per field against `{ "trades": [...] }`
 *
 * The logic lives in `src/journal/ocr/node/cli.ts` (type-checked with the app); this shim only wires the `@/` alias for
 * Node. Needs the dev dependencies (`pngjs`, `jpeg-js`, the pinned tesseract packages) – no network.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") }, interopDefault: true });
const { runCheck } = (await jiti.import(resolve(root, "src/journal/ocr/node/cli.ts"))) as { runCheck: (argv: readonly string[]) => Promise<number> };
process.exitCode = await runCheck(process.argv.slice(2));
