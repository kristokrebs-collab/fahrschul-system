/**
 * „Aus Screenshot übernehmen“ in the trade form WITHOUT the model: the local reader fills the open form.
 *   - the ROI repair (one typically confused digit, the SOL card of the user's Bitget screenshot: read -6.96 %, the numbers
 *     give -6.56 %) and that anything else keeps its warning;
 *   - the sheet opened from the form (target `editor`) on the real Bitget screenshot's own word list: it reads the form's
 *     picture at once, offers the two trades with „Für dieses Formular“, names the cut-off BTC card and never offers it,
 *     fills the form with the chosen one (marks per field), „Alle übernehmen“ writes the other one (duplicate check stays);
 *   - one complete trade fills the form without a stop in the list;
 *   - the form side: `applyShotDraft` sets exactly the read fields and keeps what the trader typed.
 * The browser-only parts (decoding, the WebAssembly engine, the picture store) are replaced, as in `ocr.sheet.test.tsx`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotRef } from "@/domain/types";
import { clearShotFill, useShotFill } from "@/journal/editor/shotFill";
import { parsePage } from "@/journal/ocr/layout";
import { checkRecord, glyphFix } from "@/journal/ocr/plausibility";
import { correctionTexts, finalizePage } from "@/journal/ocr/records";
import { closeScreenshotImport, openScreenshotFill } from "@/journal/ocr/store";
import type { OcrPage } from "@/journal/ocr/types";
import OcrImportSheet from "@/journal/ocr/ui/OcrImportSheet";
import { parseShotNumber } from "@/journal/extract/numbers";
import { applyShotDraft, defaultForm, shotFieldValue } from "@/overlays/TradeEditor";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import words from "../fixtures/ocr/words-bitget-positionshistorie-1.json";
import { seedV0 } from "./store.fixture";

const BITGET = words as unknown as OcrPage;
/** The same page with the SOL card's ROI as the second reading got it in the user's run: „-6.96“. */
const misread = (text: string): OcrPage => ({ ...BITGET, words: BITGET.words.map((w) => (w.text === "-6.56" ? { ...w, text } : w)) });
const page = vi.hoisted(() => ({ current: null as OcrPage | null }));

vi.mock("@/journal/ocr/browser", async (orig) => {
  const m = await orig<typeof import("@/journal/ocr/browser")>();
  return {
    ...m,
    ocrSupport: () => ({ ok: true as const }),
    loadPicture: async (file: File, id: string) => ({
      picture: { id, name: file.name, width: 1440, height: 3120, bitmap: { width: 1440, height: 3120, close: () => undefined } as unknown as ImageBitmap, thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
      raster: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
    }),
    startEngine: async () => ({ recognize: async () => [], terminate: async () => undefined }),
    cropUrl: async () => "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  };
});
vi.mock("@/journal/ocr/pipeline", async (orig) => {
  const m = await orig<typeof import("@/journal/ocr/pipeline")>();
  return {
    ...m,
    readPicture: async (_raster: unknown, index: number) => {
      const parsed = parsePage({ ...page.current!, index });
      return { read: {} as never, parsed, refine: { checked: 0, reread: 0, changed: 0, recheck: 0 }, records: finalizePage(parsed) };
    },
  };
});
vi.mock("@/journal/extract/client", async (orig) => {
  const m = await orig<typeof import("@/journal/extract/client")>();
  return { ...m, blobOfShot: async () => new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }) };
});

const SHOT: ScreenshotRef = { id: "s1", store: "local", key: "k1", name: "positionshistorie.jpg", type: "image/jpeg", w: 1440, h: 3120, size: 566498, addedAt: "2026-11-08T20:00:00.000Z" } as unknown as ScreenshotRef;

/* -------------------------------------------------------------------- ROI repair */

describe("ROI: one confused digit is repaired and marked, anything else stays a warning", () => {
  const sol = { side: "long" as const, entry: 95, exit: 92.06, qty: 2.31, pnl: -7.20171012, leverage: 2, fee: null };
  const parse = (t: string) => parseShotNumber(t, "point")?.value ?? null;

  it("SOL card: read -6.96 %, result / position value / leverage give -6.56 % → 9 was a 5", () => {
    const p = checkRecord({ ...sol, roi: -6.96 });
    expect(p.roiOk).toBe(false);
    expect(p.roiExpected).toBeCloseTo(-6.5634, 3);
    expect(glyphFix("-6.96 %", p.roiExpected!, parse)).toEqual({ value: -6.56, text: "-6.56 %", from: "9", to: "5" });
  });

  it("two wrong digits, a digit that is no typical confusion, or the wrong sign: no repair", () => {
    const expected = checkRecord({ ...sol, roi: -6.96 }).roiExpected!;
    expect(glyphFix("-6.99 %", expected, parse)).toBeNull(); // two digits off
    expect(glyphFix("-6.16 %", expected, parse)).toBeNull(); // 1 ↔ 5 is not a glyph confusion here
    expect(glyphFix("-4.56 %", expected, parse)).toBeNull(); // 4 is not in the set
    expect(glyphFix("6.96 %", expected, parse)).toBeNull(); // sign
  });

  it("in the reading of the real Bitget page: the SOL ROI is taken as -6.56 %, marked „korrigiert“, no ROI warning left", () => {
    const recs = finalizePage(parsePage(misread("-6.96"))).records;
    const solRec = recs.find((r) => r.symbol.text === "SOLUSDT")!;
    expect(solRec.nums.roi!.value).toBe(-6.56);
    expect(solRec.nums.roi!.corrected).toEqual({ read: "-6.96 %", from: "9", to: "5" });
    expect(solRec.nums.roi!.notes.join(" ")).toContain("korrigiert");
    expect(solRec.plausibility.flags.some((f) => f.code === "roi_mismatch")).toBe(false);
    expect(solRec.plausibility.roiOk).toBe(true);
    expect(correctionTexts([solRec])[0]).toMatch(/^ROI korrigiert: gelesen „-6.96 %“, -6,56 % passt/);
    // the TRUMP card read correctly is untouched
    const trump = recs.find((r) => r.symbol.text === "TRUMPUSDT")!;
    expect(trump.nums.roi!.corrected).toBeUndefined();
  });

  it("an ROI that is off by more than one confused digit keeps its warning and its value", () => {
    const solRec = finalizePage(parsePage(misread("-4.12"))).records.find((r) => r.symbol.text === "SOLUSDT")!;
    expect(solRec.nums.roi!.value).toBe(-4.12);
    expect(solRec.nums.roi!.corrected).toBeUndefined();
    expect(solRec.plausibility.flags.find((f) => f.code === "roi_mismatch")?.text).toContain("erwartet ≈ -6,56 %");
  });
});

/* ------------------------------------------------------------- sheet from the form */

async function openFromForm(): Promise<HTMLElement> {
  act(() => openScreenshotFill([SHOT]));
  const sheet = await screen.findByTestId("ocr-sheet");
  expect(sheet).toHaveAttribute("data-target", "editor");
  return sheet;
}

describe("Aus Screenshot übernehmen (trade form, local reader)", () => {
  beforeEach(async () => {
    page.current = misread("-6.96");
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
    act(() => closeScreenshotImport());
    clearShotFill();
  });

  it("reads the form's picture at once; two trades → the choice list, the cut-off BTC card is named and not offered; nothing is saved", async () => {
    render(<OcrImportSheet />);
    const sheet = await openFromForm();
    expect(screen.getByRole("dialog", { name: "Aus Screenshot übernehmen" })).toBeInTheDocument();
    await waitFor(() => expect(sheet).toHaveAttribute("data-phase", "preview"), { timeout: 8000 });
    expect(screen.getByTestId("ocr-summary")).toHaveTextContent("2 Trades erkannt");
    expect(screen.getByTestId("ocr-incomplete")).toHaveTextContent("BTCUSDT");
    expect(screen.getByTestId("ocr-incomplete")).toHaveTextContent("abgeschnitten");
    expect(screen.getByTestId("ocr-form-hint")).toHaveTextContent("wähle den für dieses Formular");
    const rows = within(sheet).getAllByTestId("ocr-trade");
    expect(rows.map((r) => r.querySelector("h3")!.textContent)).toEqual(["TRUMP/USDT · Short · 15×", "SOL/USDT · Long · 2×"]);
    // the SOL card's ROI was repaired – shown as a correction, not as a warning
    expect(within(rows[1]!).getByTestId("ocr-info")).toHaveTextContent("ROI korrigiert");
    expect(within(rows[1]!).queryAllByTestId("ocr-warning")).toHaveLength(0);
    // the first one is chosen for the form; the trades page's write button is not there
    expect(within(rows[0]!).getByTestId("ocr-form-pick")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("ocr-commit")).toBeNull();
    expect(screen.getByTestId("ocr-fill-all")).toHaveTextContent("Alle 2 übernehmen");
    expect(useShotFill.getState().fill).toBeNull();
    expect(useJournal.getState().trades.some((t) => t.tags?.includes("Screenshot-Import"))).toBe(false);
  });

  it("pick TRUMP → „Übernehmen“: the form gets entry 1.547, exit 1.485, qty 667.91, Short, 15×, isolated, the times, the derived fees, the PnL – every field marked; nothing written", async () => {
    render(<OcrImportSheet />);
    const sheet = await openFromForm();
    await waitFor(() => expect(sheet).toHaveAttribute("data-phase", "preview"), { timeout: 8000 });
    const before = useJournal.getState().trades.length;
    const rows = within(sheet).getAllByTestId("ocr-trade");
    fireEvent.click(within(rows[1]!).getByTestId("ocr-form-pick"));
    fireEvent.click(within(rows[0]!).getByTestId("ocr-form-pick"));
    fireEvent.click(screen.getByTestId("ocr-fill"));
    await waitFor(() => expect(useShotFill.getState().fill).not.toBeNull());
    const fill = useShotFill.getState().fill!;
    expect(fill.draft).toMatchObject({ pair: "TRUMP/USDT", side: "short", leverage: 15, marginMode: "isolated", market: "perp", entry: 1.547, exit: 1.485, qty: 667.91, date: "2026-11-04T01:26", exitDate: "2026-11-04T03:43:57", pnlManual: 41.34228791, status: "closed", tags: ["Screenshot-Import"] });
    expect(fill.draft.fees).toBeCloseTo(0.0681, 4);
    expect(fill.draft.screenshots).toBeUndefined();
    expect(fill.marks).toMatchObject({ entry: { state: "read" }, exit: { state: "read" }, qty: { state: "read" }, side: { state: "read" }, leverage: { state: "read" }, marginMode: { state: "read" }, date: { state: "read" }, exitDate: { state: "read" }, pnlManual: { state: "read" }, fees: { state: "derived" }, size: { state: "derived" } });
    expect(fill.note).toContain("auf diesem Gerät gelesen, ohne KI");
    expect(fill.note).toContain("Nicht übernommen: BTCUSDT");
    expect(fill.note).toContain("Gespeichert wird erst mit „Speichern“");
    expect(fill.draft.notes).toContain("Texterkennung auf dem Gerät");
    await waitFor(() => expect(screen.queryByTestId("ocr-sheet")).toBeNull());
    expect(useJournal.getState().trades).toHaveLength(before);
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Werte aus dem Screenshot eingetragen");
  });

  it("„Alle 2 übernehmen“: the chosen one fills the form, the other is written through the import's commit (undo offered); a second run finds it as duplicate", async () => {
    render(<OcrImportSheet />);
    let sheet = await openFromForm();
    await waitFor(() => expect(sheet).toHaveAttribute("data-phase", "preview"), { timeout: 8000 });
    const before = useJournal.getState().trades.length;
    fireEvent.click(screen.getByTestId("ocr-fill-all"));
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(before + 1));
    const written = useJournal.getState().trades.find((t) => t.tags?.includes("Screenshot-Import"))!;
    expect(written).toMatchObject({ pair: "SOL/USDT", side: "long", entry: 95, exit: 92.06, qty: 2.31, leverage: 2, marginMode: "cross", pnlManual: -7.20171012 });
    expect(written.notes).toContain("ROI korrigiert");
    expect(useShotFill.getState().fill!.draft.pair).toBe("TRUMP/USDT");
    const toast = useUi.getState().toasts.find((t) => t.title === "Werte aus dem Screenshot eingetragen")!;
    expect(toast.detail).toContain("1 weiterer Trade eingetragen");
    expect(toast.action?.label).toBe("Rückgängig");
    await waitFor(() => expect(screen.queryByTestId("ocr-sheet")).toBeNull());
    // again: the SOL trade is in the journal now – not pre-selected, no „Alle“ for it
    sheet = await openFromForm();
    await waitFor(() => expect(sheet).toHaveAttribute("data-phase", "preview"), { timeout: 8000 });
    const rows = within(sheet).getAllByTestId("ocr-trade");
    expect(rows[1]).toHaveTextContent("Schon vorhanden");
    expect(screen.queryByTestId("ocr-fill-all")).toBeNull();
  });

  it("one complete trade on the picture: the form is filled right after the reading, without the list", async () => {
    // only the TRUMP card (the picture cut above the SOL card)
    page.current = { ...BITGET, words: BITGET.words.filter((w) => w.box.y1 < 1800) };
    render(<OcrImportSheet />);
    await openFromForm();
    await waitFor(() => expect(useShotFill.getState().fill).not.toBeNull(), { timeout: 8000 });
    expect(useShotFill.getState().fill!.draft).toMatchObject({ pair: "TRUMP/USDT", entry: 1.547, exit: 1.485, qty: 667.91 });
    await waitFor(() => expect(screen.queryByTestId("ocr-sheet")).toBeNull());
  });
});

/* -------------------------------------------------------------------- the form side */

describe("applyShotDraft: the open form takes exactly the read fields", () => {
  it("sets the read fields, keeps what the trader typed, appends the notes once and replaces a previous screenshot's block", () => {
    const base = defaultForm({ pair: "BTC/USDT" }, "scalp");
    const typed = { d: { ...base.d, reason: "Breakout", notes: "eigene Notiz", stop: "1,6" }, t: { ...base.t, setups: ["s1"] } };
    const draft = { pair: "TRUMP/USDT", side: "short" as const, status: "closed" as const, date: "2026-11-04T01:26", entry: 1.547, exit: 1.485, qty: 667.91, size: 1033.25677, leverage: 15, fees: 0.06813209, pnlManual: 41.34228791, exitDate: "2026-11-04T03:43:57", market: "perp" as const, marginMode: "isolated" as const, tags: ["Screenshot-Import"], notes: "Aus Screenshot übernommen (A)" };
    const a = applyShotDraft(typed.d, typed.t, draft);
    expect(a.d).toMatchObject({ pair: "TRUMP/USDT", entry: "1,547", exit: "1,485", size: "1033,25677", leverage: "15", fees: "0,06813209", pnlManual: "41,34228791", date: "2026-11-04T01:26", reason: "Breakout", stop: "1,6" });
    expect(a.d.notes).toBe("eigene Notiz\nAus Screenshot übernommen (A)");
    expect(a.t).toMatchObject({ side: "short", status: "closed", setups: ["s1"] });
    expect(a.t.j).toMatchObject({ qty: "667,91", exitDate: "2026-11-04T03:43", market: "perp", marginMode: "isolated", tags: ["Screenshot-Import"] });
    expect(shotFieldValue(a.d, a.t, "qty")).toBe("667,91");
    expect(shotFieldValue(a.d, a.t, "side")).toBe("short");
    // a second screenshot replaces the first one's block (not stacked)
    const b = applyShotDraft(a.d, a.t, { ...draft, notes: "Aus Screenshot übernommen (B)" }, "Aus Screenshot übernommen (A)");
    expect(b.d.notes).toBe("eigene Notiz\nAus Screenshot übernommen (B)");
    expect(b.t.j.tags).toEqual(["Screenshot-Import"]);
  });
});
