/** Which legal document the sheet shows (`null` = closed); `loaded` once the sheet was asked for (kept for its exit). */
import { create } from "zustand";
import type { LegalDoc } from "./config";

export const useLegal = create<{ open: LegalDoc | null; loaded: boolean }>(() => ({ open: null, loaded: false }));
export const openLegal = (doc: LegalDoc): void => useLegal.setState({ open: doc, loaded: true });
export const closeLegal = (): void => useLegal.setState({ open: null });
