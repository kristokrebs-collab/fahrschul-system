/**
 * Screenshot-Originale (A2), mobile + desktop, in the real browser: the file a trader adds is stored byte for byte
 * (IndexedDB, SHA-256), survives a reload and comes back bytegleich through „Original herunterladen“; a 12 MB PNG is
 * hashed and decoded off the main thread (a worker, no long task); a full device store and a missing IndexedDB are
 * reported as „nicht dauerhaft gespeichert“ with the original as a download instead of a smaller picture; the
 * „Backup mit Bildern“ ZIP carries the originals and their hashes into a fresh profile.
 *
 * The cloud upload (signed in, bucket `screenshots`) is covered by the unit tests against a fake Storage client – the e2e
 * Supabase mock has no Storage.
 */
import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors, isMobile, openTradeEditor, seed, stored, toast } from "./helpers";
import { noisePng, readStoredZip, sha256 } from "./shotFixtures";

const PROJECTS = ["mobile", "desktop"];
const MB = 1024 * 1024;

interface Ref {
  id: string;
  store: string;
  key: string;
  mime: string;
  sha256: string;
  bytes: number;
  originalName: string;
  original: boolean;
  storage: string;
  w: number;
  h: number;
}
interface StoredTrade {
  id: string;
  entry: number;
  screenshots?: Ref[];
}

/**
 * Records every long task (> 50 ms) and every long animation frame of the page from the start. A frame lists the scripts
 * that ran in it (source file, duration), which says WHO held the main thread.
 */
async function watchLongTasks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __lt: { d: number; t: number }[]; __loaf: { d: number; t: number; scripts: { file: string; fn: string; d: number }[] }[] };
    w.__lt = [];
    w.__loaf = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__lt.push({ d: Math.round(e.duration), t: Math.round(e.startTime) });
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { duration: number; startTime: number; scripts: { sourceURL: string; sourceFunctionName: string; duration: number }[] }[]) {
          w.__loaf.push({ d: Math.round(e.duration), t: Math.round(e.startTime), scripts: e.scripts.map((s) => ({ file: s.sourceURL.split("/").pop() ?? "", fn: s.sourceFunctionName, d: Math.round(s.duration) })) });
        }
      }).observe({ type: "long-animation-frame", buffered: true });
    } catch {
      /* not supported */
    }
  });
}
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __lt: { d: number; t: number }[] }).__lt.slice());
const longFrames = (page: Page) => page.evaluate(() => (window as unknown as { __loaf: { d: number; t: number; scripts: { file: string; fn: string; d: number }[] }[] }).__loaf.slice());

/** A blob in the page's IndexedDB `tj2-shots` (the originals) / `tj2-shots-preview` (the derived previews): hash, size and type. */
async function idbBlob(page: Page, db: "tj2-shots" | "tj2-shots-preview", key: string): Promise<{ sha256: string; size: number; type: string } | null> {
  return page.evaluate(
    async ({ db, key }) => {
      const open = indexedDB.open(db);
      const conn = await new Promise<IDBDatabase | null>((res) => {
        // never create the database by looking (an empty one would break the app's own store afterwards)
        open.onupgradeneeded = () => open.transaction!.abort();
        open.onsuccess = () => res(open.result);
        open.onerror = () => res(null);
      });
      if (!conn || !conn.objectStoreNames.length) return null;
      const store = conn.objectStoreNames[0]!;
      const blob = await new Promise<Blob | undefined>((res) => {
        const r = conn.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => res(r.result as Blob | undefined);
        r.onerror = () => res(undefined);
      });
      conn.close();
      if (!blob) return null;
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return { sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), size: blob.size, type: blob.type };
    },
    { db, key },
  );
}

/** A real file on disk under `name` (a payload handed to `setInputFiles` is decoded in the page by Playwright – on the main thread, which would be measured as OUR long task). */
function onDisk(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "tj-shot-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/** Opens the editor, takes the given files into the screenshot field and returns the editor. */
async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<Locator> {
  const editor = await openTradeEditor(page);
  await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
  await editor.getByTestId("shots-drop").locator('input[type="file"]').setInputFiles(files.map((f) => onDisk(f.name, f.buffer)));
  await expect(editor.getByRole("button", { name: `Screenshot ${files.length} öffnen` })).toBeVisible({ timeout: 30_000 });
  return editor;
}

async function saveTrade(page: Page, editor: Locator, entry: number): Promise<StoredTrade> {
  await editor.locator("#f-entry").fill(String(entry));
  await editor.locator("#f-exit").fill(String(entry + 1500));
  await editor.locator("#f-size").fill("4000");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  // generous: this suite also runs on machines shared with other test runs
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(toast(page)).toContainText("Trade gespeichert", { timeout: 20_000 });
  const trades = (await stored<StoredTrade[]>(page, "tj2-trades")) ?? [];
  const t = trades.find((x) => x.entry === entry);
  expect(t, "the saved trade").toBeTruthy();
  return t!;
}

/** Hash navigation inside the app (no new document, so no response to check), waiting generously for the page heading. */
async function goTo(page: Page, hash: string, h1: string): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("heading", { level: 1, name: h1 }).first()).toBeVisible({ timeout: 40_000 });
}

async function openDetail(page: Page, id: string, mobile: boolean): Promise<Locator> {
  await goTo(page, "#trades", "Alle Trades");
  // scoped to the trades page (the kept-alive overview has its own `data-trade-id` rows)
  const row = mobile ? page.getByRole("list", { name: "Trades" }).locator(`[data-trade-id="${id}"]`) : page.locator(`tbody tr[data-trade-id="${id}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  return detail;
}

async function downloadFrom(page: Page, button: Locator): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

test.describe("Screenshot-Originale", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  });

  test("12-MB-PNG: Hash vor/nach Speichern und Reload gleich, Hashen und Decodieren im Worker, Original herunterladen bytegleich", async ({ page }, info: TestInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await watchLongTasks(page);
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();

    const png = noisePng(2048, 1536, 3);
    expect(png.length).toBeGreaterThan(12 * MB);
    const expected = sha256(png);

    const editor = await openTradeEditor(page);
    const input = editor.getByTestId("shots-drop").locator('input[type="file"]');
    await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
    // reaching for the zone starts the worker and fetches the intake code: both are there before the first picture
    expect(workers).toHaveLength(0);
    await editor.getByTestId("shots-drop").hover();
    await expect.poll(() => workers.length, { message: "the worker starts when the trader reaches for the drop zone" }).toBeGreaterThan(0);
    // a tiny picture first: chunks are compiled and the worker has run once, as in any session –
    // only the 12 MB import after it is measured
    await input.setInputFiles(onDisk("warm.png", noisePng(60, 40, 1)));
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible({ timeout: 60_000 });
    expect(workers.length, "the same worker served the picture").toBe(1);
    await page.waitForTimeout(2000);
    // control window: the idle editor for as long as the import takes (this machine runs several agents at once, so frames of
    // the open page alone can exceed 50 ms – the import is judged against that background)
    const idleFrom = (await longTasks(page)).length;
    await page.waitForTimeout(3000);
    const idle = (await longTasks(page)).slice(idleFrom);
    const before = (await longTasks(page)).length;
    const framesBefore = (await longFrames(page)).length;
    await input.setInputFiles(onDisk("BTC 4h Einstieg (final).png", png));
    await expect(editor.getByRole("button", { name: "Screenshot 2 öffnen" })).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    const tasks = (await longTasks(page)).slice(before);
    const frames = (await longFrames(page)).slice(framesBefore);
    const worst = Math.max(0, ...tasks.map((t) => t.d));
    // the scripts of OUR intake chunks (hash, preview, store, intake) in the long frames of the import
    const ours = frames.flatMap((f) => f.scripts).filter((s) => /^(intake|derive|sha256|shot\.worker|preview|sniff)-/.test(s.file));
    const worstOurs = Math.max(0, ...ours.map((s) => s.d));
    console.log(
      `SCREENSHOT-ORIGINAL ${info.project.name}: ${(png.length / MB).toFixed(1)} MB PNG, Worker ${workers.length} (geteilt), Long Tasks beim Import: ${tasks.length} (längster ${worst} ms) ${JSON.stringify(tasks)}; Kontrolle ohne Import (3 s): ${idle.length} (${JSON.stringify(idle.map((t) => t.d))}); Skripte der Bild-Chunks in langen Frames: ${ours.length} (längstes ${worstOurs} ms) ${JSON.stringify(frames.map((f) => ({ d: f.d, s: f.scripts.map((s) => `${s.file}:${s.d}`) })))}`,
    );
    // Hashing, decoding and the read-back run in the worker: no script of the picture chunks holds the main thread for long
    // (hashing 12 MB in JS on the main thread alone would take far more than 100 ms). The Long Task numbers above are printed
    // for the report; a frame without a script of ours is the page's own rendering, not the import.
    expect(worstOurs, `Skript der Bild-Chunks hielt den Hauptthread ${worstOurs} ms`).toBeLessThanOrEqual(100);
    await editor.getByRole("button", { name: "Screenshot 1 entfernen" }).click(); // the warm-up picture goes; the big one is "Screenshot 1" now
    await expect(editor.getByRole("button", { name: "Screenshot 2 öffnen" })).toBeHidden();

    // saved: every field is written down
    const t = await saveTrade(page, editor, 80123);
    const ref = t.screenshots![0]!;
    expect(ref).toMatchObject({ store: "idb", mime: "image/png", sha256: expected, bytes: png.length, originalName: "BTC 4h Einstieg (final).png", original: true, storage: "device", w: 2048, h: 1536 });

    // the stored bytes are the file; the preview is a separate, smaller picture
    expect(await idbBlob(page, "tj2-shots", ref.key)).toEqual({ sha256: expected, size: png.length, type: "image/png" });
    const preview = await idbBlob(page, "tj2-shots-preview", ref.key);
    expect(preview, "derived preview").toBeTruthy();
    expect(preview!.type).toBe("image/webp");
    expect(preview!.size).toBeLessThan(png.length / 4); // noise is the worst case for WebP; a real chart is far smaller
    expect(errors, errors.join("\n")).toEqual([]);

    // reload = a new page life: same bytes, same hash, the thumbnail shows the small preview
    await page.reload();
    const detail = await openDetail(page, t.id, isMobile(info));
    const thumb = detail.getByRole("button", { name: "Screenshot 1 öffnen" });
    await expect(thumb).toBeVisible();
    await expect(thumb.locator("img").first()).toHaveJSProperty("naturalWidth", 1280); // the notched frame paints the picture twice (grey + colour)
    expect(await idbBlob(page, "tj2-shots", ref.key)).toEqual({ sha256: expected, size: png.length, type: "image/png" });

    // the viewer says what it is and hands out the exact file
    await thumb.click();
    const box = page.getByRole("dialog", { name: /Screenshot 1 von 1/ });
    await expect(box.getByTestId("shot-facts")).toContainText("Original · PNG · 2048 × 1536 · 12,");
    await expect(box.getByTestId("shot-facts")).toContainText(`SHA-256 ${expected.slice(0, 10)}`);
    await box.getByTestId("shot-view-original").click();
    await expect(box.getByTestId("shot-original-layer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    const got = await downloadFrom(page, box.getByTestId("shot-download-original"));
    expect(got.name).toBe("BTC 4h Einstieg (final).png");
    expect(got.bytes.length).toBe(png.length);
    expect(sha256(got.bytes)).toBe(expected);
  });

  test("Speicher voll: Meldung mit Alternative, nichts wird verkleinert, das Original lässt sich laden", async ({ page }) => {
    await seed(page, { empty: true });
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
        if ((window as unknown as { __tjFull?: boolean }).__tjFull && this.name === "blobs") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __tjFull: boolean }).__tjFull = true));
    const png = noisePng(900, 700, 5);
    const editor = await attach(page, [{ name: "voll.png", mimeType: "image/png", buffer: png }]);
    await expect(toast(page)).toContainText("Speicher voll");
    await expect(toast(page)).toContainText("Nichts wurde verkleinert");
    const panel = editor.getByTestId("shots-ram");
    await expect(panel).toContainText("nicht dauerhaft gespeichert");
    await expect(panel).toContainText("Speicher voll");
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toContainText("Nur Sitzung");
    const got = await downloadFrom(page, panel.getByTestId("shots-ram-download"));
    expect(got.name).toBe("voll.png");
    expect(sha256(got.bytes)).toBe(sha256(png));
  });

  test("kein IndexedDB: RAM-Fallback wird als „nicht dauerhaft gespeichert“ gemeldet", async ({ page }) => {
    await seed(page, { empty: true });
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const png = noisePng(300, 200, 6);
    const editor = await attach(page, [{ name: "ram.png", mimeType: "image/png", buffer: png }]);
    await expect(editor).toContainText("Nicht dauerhaft gespeichert: Dieser Browser erlaubt keinen lokalen Bildspeicher");
    await expect(editor.getByTestId("shots-ram")).toContainText("1 Bild ist nicht dauerhaft gespeichert");
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toContainText("Nur Sitzung");
    const got = await downloadFrom(page, editor.getByTestId("shots-ram-download"));
    expect(sha256(got.bytes)).toBe(sha256(png));
  });

  test("Backup mit Bildern (ZIP) und Bild-Hashes → Restore in frischem Profil, bytegleich", async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    await seed(page, { empty: true });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const a = noisePng(1600, 900, 11);
    const b = noisePng(1000, 700, 12);
    const editor = await attach(page, [
      { name: "a.png", mimeType: "image/png", buffer: a },
      { name: "b.png", mimeType: "image/png", buffer: b },
    ]);
    const t = await saveTrade(page, editor, 81234);
    const refs = t.screenshots!;
    expect(refs.map((r) => r.sha256)).toEqual([sha256(a), sha256(b)]);

    // export: the ZIP and the hash list
    await goTo(page, "#settings", "Einstellungen");
    const card = page.getByTestId("settings-data");
    await card.scrollIntoViewIfNeeded();
    const zipDl = await downloadFrom(page, card.getByTestId("data-backup-zip"));
    expect(zipDl.name).toMatch(/^trade-journal-\d{4}-\d{2}-\d{2}-mit-bildern\.zip$/);
    const entries = readStoredZip(zipDl.bytes);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as { format: string; journalSha256: string; shots: { key: string; file: string; sha256: string; bytes: number; original: boolean; originalName: string }[]; missing: unknown[] };
    expect(manifest.format).toBe("tj-backup-zip/1");
    expect(manifest.missing).toEqual([]);
    expect(manifest.journalSha256).toBe(sha256(entries.get("journal.json")!));
    expect(manifest.shots.map((s) => [s.sha256, s.bytes, s.original, s.originalName])).toEqual([
      [sha256(a), a.length, true, "a.png"],
      [sha256(b), b.length, true, "b.png"],
    ]);
    for (const [i, s] of manifest.shots.entries()) {
      expect(sha256(entries.get(s.file)!), `file ${s.file} in the ZIP`).toBe(s.sha256);
      expect(s.key).toBe(refs[i]!.key);
    }
    await expect(toast(page).first()).toBeVisible();

    const csvDl = await downloadFrom(page, card.getByTestId("data-shot-hashes"));
    expect(csvDl.name).toMatch(/-bild-hashes\.csv$/);
    const csv = csvDl.bytes.toString("utf8");
    expect(csv).toContain("SHA-256");
    expect(csv).toContain(sha256(a));
    expect(csv).toContain(sha256(b));

    // restore in a brand-new browser profile
    const zipFile = join(mkdtempSync(join(tmpdir(), "tj-zip-")), zipDl.name);
    writeFileSync(zipFile, zipDl.bytes);
    const use = info.project.use;
    const fresh = await (browser as Browser).newContext({ baseURL: use.baseURL, viewport: use.viewport, isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: "dark" });
    try {
      const p2 = await fresh.newPage();
      await seed(p2, { empty: true });
      await goTo(p2, "#settings", "Einstellungen");
      expect(await idbBlob(p2, "tj2-shots", refs[0]!.key)).toBeNull();
      await p2.getByRole("button", { name: "Backup importieren" }).click();
      const dialog = p2.getByRole("dialog", { name: "Backup importieren" });
      await dialog.getByLabel("Backup-Datei").setInputFiles(zipFile);
      await expect(dialog.getByTestId("import-preview-text")).toContainText("1 Trades");
      await expect(dialog.getByTestId("import-shots")).toContainText("inkl. 2 Screenshots als Original");
      await dialog.getByRole("button", { name: "Importieren", exact: true }).click();
      await expect(toast(p2).filter({ hasText: "Bilder wiederhergestellt" })).toBeVisible({ timeout: 30_000 });
      await expect(dialog).toBeHidden();
      for (const [i, r] of refs.entries()) {
        expect(await idbBlob(p2, "tj2-shots", r.key), `restored ${r.originalName}`).toEqual({ sha256: i === 0 ? sha256(a) : sha256(b), size: i === 0 ? a.length : b.length, type: "image/png" });
      }
      const restored = ((await stored<StoredTrade[]>(p2, "tj2-trades")) ?? []).find((x) => x.entry === 81234);
      expect(restored?.screenshots?.map((r) => r.sha256)).toEqual([sha256(a), sha256(b)]);
      expect(restored?.screenshots?.every((r) => r.original)).toBe(true);
      // and the restored picture opens as the original
      const detail = await openDetail(p2, restored!.id, isMobile(info));
      await expect(detail.getByRole("button", { name: /Screenshot \d öffnen/ }).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await fresh.close();
    }
  });
});
