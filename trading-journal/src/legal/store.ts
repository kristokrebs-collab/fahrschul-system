/** Which legal page the sheet shows (`null` = closed); `loaded` once the sheet was asked for (kept for its exit). */
import { create } from "zustand";
import type { LegalPage } from "./config";

export const useLegal = create<{ open: LegalPage | null; loaded: boolean }>(() => ({ open: null, loaded: false }));
export const openLegal = (doc: LegalPage): void => useLegal.setState({ open: doc, loaded: true });
export const closeLegal = (): void => useLegal.setState({ open: null });
