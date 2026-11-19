/**
 * Open state of the screenshot import sheet (OCR / optional model). Deliberately tiny: the buttons that open the sheet
 * (trades page, backup dialog, function register, the trade form's „Aus Screenshot übernehmen“) import THIS file only – the
 * sheet, the engine and the megabytes behind it are lazy chunks / files that load when the first picture is read.
 */
import { create } from "zustand";
import type { ScreenshotRef } from "@/domain/types";

/**
 * `trades`: the import of the trades page – the read trades are written to the journal.
 * `editor`: opened from the trade form – ONE read trade fills the open form (`@/journal/editor/shotFill`), nothing is saved
 * before the trader presses „Speichern“ there; the others can be written with „Alle übernehmen“.
 */
export type OcrTarget = "trades" | "editor";

interface OcrImportState {
  open: boolean;
  /** Bumped by every opening: the sheet starts fresh (and takes `files`). */
  seq: number;
  /** Pictures handed over by the opener (a pasted or dropped image), picked up once. */
  files: File[];
  target: OcrTarget;
  /** The trade form's own screenshots (target `editor`): the sheet reads their original bytes. */
  shots: ScreenshotRef[];
}

export const useOcrImport = create<OcrImportState>(() => ({ open: false, seq: 0, files: [], target: "trades", shots: [] }));

export function openScreenshotImport(files: readonly File[] = []): void {
  useOcrImport.setState((s) => ({ open: true, seq: s.seq + 1, files: [...files], target: "trades", shots: [] }));
}

/** „Aus Screenshot übernehmen“ in the trade form without the model: the form's pictures are read on this device. */
export function openScreenshotFill(shots: readonly ScreenshotRef[]): void {
  useOcrImport.setState((s) => ({ open: true, seq: s.seq + 1, files: [], target: "editor", shots: [...shots] }));
}

export function closeScreenshotImport(): void {
  useOcrImport.setState({ open: false });
}
