/**
 * The screenshot import sheet end to end in the DOM (picture → preview → fix → write → undo). The browser-only parts
 * (decoding a picture, the WebAssembly engine) are replaced; the reading itself is the real parser / checker run on the
 * real screenshot's own word list (`words-bitunix-positionshistorie-1.json`), so the preview shows exactly what the
 * user's screenshot produces – including the one cell the first reading got wrong and the cut-off third card.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePage } from "@/journal/ocr/layout";
import { finalizePage } from "@/journal/ocr/records";
import { closeScreenshotImport, openScreenshotImport } from "@/journal/ocr/store";
import type { OcrPage } from "@/journal/ocr/types";
import OcrImportSheet from "@/journal/ocr/ui/OcrImportSheet";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import words from "../fixtures/ocr/words-bitunix-positionshistorie-1.json";
import { seedV0 } from "./store.fixture";

const REAL = words as unknown as OcrPage;
const support = vi.hoisted(() => ({ ok: true as boolean }));

vi.mock("@/journal/ocr/browser", async (orig) => {
  const m = await orig<typeof import("@/journal/ocr/browser")>();
  return {
    ...m,
    ocrSupport: () => (support.ok ? { ok: true as const } : { ok: false as const, reason: "Dieser Browser kann die Texterkennung nicht ausführen (WebAssembly oder Web Worker fehlen)." }),
    loadPicture: async (file: File, id: string) => ({
      picture: { id, name: file.name, width: 923, height: 2000, bitmap: { width: 923, height: 2000, close: () => undefined } as unknown as ImageBitmap, thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
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
      const parsed = parsePage({ ...REAL, index });
      return { read: {} as never, parsed, refine: { checked: 0, reread: 0, changed: 0, recheck: 0 }, records: finalizePage(parsed) };
    },
  };
});

const png = (name = "positionshistorie.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

async function openAndRead(): Promise<HTMLElement> {
  act(() => openScreenshotImport());
  await screen.findByTestId("ocr-sheet");
  fireEvent.change(screen.getByTestId("ocr-file"), { target: { files: [png()] } });
  await waitFor(() => expect(screen.getAllByTestId("ocr-picture")).toHaveLength(1));
  fireEvent.click(screen.getByTestId("ocr-read"));
  const sheet = screen.getByTestId("ocr-sheet");
  await waitFor(() => expect(sheet).toHaveAttribute("data-phase", "preview"), { timeout: 8000 });
  return sheet;
}

describe("Screenshot-Import sheet", () => {
  beforeEach(async () => {
    support.ok = true;
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
    act(() => closeScreenshotImport());
  });

  it("starts with the drop zone, the honest line and the first-load hint", async () => {
    render(<OcrImportSheet />);
    act(() => openScreenshotImport());
    expect(await screen.findByTestId("ocr-drop")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Screenshot importieren" });
    expect(dialog).toHaveTextContent("läuft nur auf deinem Gerät und kann sich vertun");
    expect(dialog).toHaveTextContent("Bilder werden weder gespeichert noch gesendet");
    expect(dialog).toHaveTextContent("einmalig");
    expect(screen.getByTestId("ocr-read")).toBeDisabled();
  });

  it("says why it cannot run instead of a dead drop zone", async () => {
    support.ok = false;
    render(<OcrImportSheet />);
    act(() => openScreenshotImport());
    expect(await screen.findByTestId("ocr-unsupported")).toHaveTextContent("WebAssembly");
    expect(screen.queryByTestId("ocr-drop")).toBeNull();
  });

  it("picture → preview: the two trades, the cut-off card as incomplete, the doubtful cell yellow with its reason, the original crop next to it", async () => {
    render(<OcrImportSheet />);
    const sheet = await openAndRead();
    expect(screen.getByTestId("ocr-summary")).toHaveTextContent("2 Trades erkannt");
    expect(screen.getByTestId("ocr-summary")).toHaveTextContent("1 Karte unvollständig");
    expect(screen.getByTestId("ocr-incomplete")).toHaveTextContent("abgeschnitten");
    expect(screen.getByTestId("ocr-incomplete")).toHaveTextContent("Bitte den nächsten Ausschnitt mit hochladen");
    expect(screen.getByTestId("ocr-zone-text")).toHaveTextContent("keine Zeitzone");
    const rows = within(sheet).getAllByTestId("ocr-trade");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("BTC/USDT · Long · 5×");
    // the first card's entry lost its decimal point in the first reading: yellow, with the reason, and an input to fix it
    const entry = within(rows[0]!).getByTestId("ocr-cell-entry");
    expect(entry).toHaveAttribute("data-state", "uncertain");
    expect(entry).toHaveTextContent("Dezimalzeichen");
    expect(within(rows[0]!).getByTestId("ocr-input-entry")).toBeInTheDocument();
    expect(await within(rows[0]!).findByTestId("ocr-crop")).toBeInTheDocument();
    // the first card's fees cannot be derived while its entry is wrong (no believable amount); the second card's can
    expect(within(rows[0]!).queryByTestId("ocr-cell-fees")).toBeNull();
    expect(within(rows[1]!).getByTestId("ocr-cell-fees")).toHaveTextContent("abgeleitet");
    expect(within(rows[1]!).getByTestId("ocr-cell-entry")).toHaveAttribute("data-state", "ok");
    // nothing is written yet
    expect(useJournal.getState().trades.some((t) => t.tags?.includes("Screenshot-Import"))).toBe(false);
    expect(screen.getByTestId("ocr-commit")).toHaveTextContent("Alle 2 Trades eintragen");
  });

  it("fix the yellow field in place → write all → the trades are in the journal, the toast offers „Rückgängig“ → undo removes exactly them", async () => {
    render(<OcrImportSheet />);
    const sheet = await openAndRead();
    const before = useJournal.getState().trades.length;
    const first = within(sheet).getAllByTestId("ocr-trade")[0]!;
    const input = within(first).getByTestId("ocr-input-entry");
    fireEvent.change(input, { target: { value: "81.214,3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(within(first).getByTestId("ocr-cell-entry")).toHaveAttribute("data-state", "ok"));
    // the corrected entry clears the doubt it caused, and the fees follow from the corrected numbers (derived, labelled)
    expect(within(first).queryAllByTestId("ocr-warning")).toHaveLength(0);
    expect(within(first).getByTestId("ocr-cell-fees")).toHaveTextContent("abgeleitet");
    fireEvent.click(screen.getByTestId("ocr-commit"));
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(before + 2));
    const added = useJournal.getState().trades.filter((t) => t.tags?.includes("Screenshot-Import"));
    expect(added).toHaveLength(2);
    expect(added.find((t) => t.leverage === 5)).toMatchObject({ pair: "BTC/USDT", side: "long", entry: 81214.3, exit: 80658, qty: 0.0224, pnlManual: -14.66565175, marginMode: "isolated" });
    await waitFor(() => expect(screen.queryByTestId("ocr-sheet")).toBeNull());
    const toast = useUi.getState().toasts.find((t) => t.title === "2 Trades eingetragen")!;
    expect(toast).toBeDefined();
    expect(toast.action?.label).toBe("Rückgängig");
    await act(async () => {
      toast.action!.onClick();
      await Promise.resolve();
    });
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(before));
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain("2 Trades wieder entfernt"));
  });

  it("a row can be deselected: only the chosen trades are written", async () => {
    render(<OcrImportSheet />);
    const sheet = await openAndRead();
    const before = useJournal.getState().trades.length;
    const rows = within(sheet).getAllByTestId("ocr-trade");
    fireEvent.click(within(rows[1]!).getByTestId("ocr-take"));
    await waitFor(() => expect(screen.getByTestId("ocr-commit")).toHaveTextContent("Trade eintragen"));
    expect(screen.getByTestId("ocr-commit")).not.toHaveTextContent("Alle");
    fireEvent.click(screen.getByTestId("ocr-commit"));
    await waitFor(() => expect(useJournal.getState().trades).toHaveLength(before + 1));
  });

  it("a trade that is already in the journal is recognised and not pre-selected", async () => {
    // write the second card first (same market, side, prices, time)
    render(<OcrImportSheet />);
    let sheet = await openAndRead();
    fireEvent.click(within(within(sheet).getAllByTestId("ocr-trade")[0]!).getByTestId("ocr-take"));
    fireEvent.click(screen.getByTestId("ocr-commit"));
    await waitFor(() => expect(useJournal.getState().trades.some((t) => t.leverage === 8 && t.tags?.includes("Screenshot-Import"))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("ocr-sheet")).toBeNull());
    sheet = await openAndRead();
    const rows = within(sheet).getAllByTestId("ocr-trade");
    expect(rows[1]).toHaveAttribute("data-taken", "0");
    expect(rows[1]).toHaveTextContent("Schon vorhanden");
    expect(rows[0]).toHaveAttribute("data-taken", "1");
  });

  it("pasting an image (Strg/Cmd + V) adds it", async () => {
    render(<OcrImportSheet />);
    act(() => openScreenshotImport());
    await screen.findByTestId("ocr-drop");
    const ev = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    ev.clipboardData = { files: [png("clip.png")], items: [] };
    act(() => {
      document.dispatchEvent(ev);
    });
    await waitFor(() => expect(screen.getAllByTestId("ocr-picture")).toHaveLength(1));
    expect(ev.defaultPrevented).toBe(true);
  });

  it("something that is not a picture is refused with a reason", async () => {
    render(<OcrImportSheet />);
    act(() => openScreenshotImport());
    await screen.findByTestId("ocr-drop");
    fireEvent.change(screen.getByTestId("ocr-file"), { target: { files: [new File(["x"], "notizen.txt", { type: "text/plain" })] } });
    expect(await screen.findByTestId("ocr-message")).toHaveTextContent("kein Bild");
    expect(screen.queryAllByTestId("ocr-picture")).toHaveLength(0);
  });
});
