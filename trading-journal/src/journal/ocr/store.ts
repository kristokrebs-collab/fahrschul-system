/**
 * Open state of the screenshot import sheet (OCR / optional model). Deliberately tiny: the buttons that open the sheet
 * (trades page, backup dialog, function register) import THIS file only – the sheet, the engine and the megabytes behind it
 * are lazy chunks / files that load when the first picture is read.
 */
import { create } from "zustand";

interface OcrImportState {
  open: boolean;
  /** Bumped by every opening: the sheet starts fresh (and takes `files`). */
  seq: number;
  /** Pictures handed over by the opener (a pasted or dropped image), picked up once. */
  files: File[];
}

export const useOcrImport = create<OcrImportState>(() => ({ open: false, seq: 0, files: [] }));

export function openScreenshotImport(files: readonly File[] = []): void {
  useOcrImport.setState((s) => ({ open: true, seq: s.seq + 1, files: [...files] }));
}

export function closeScreenshotImport(): void {
  useOcrImport.setState({ open: false });
}
