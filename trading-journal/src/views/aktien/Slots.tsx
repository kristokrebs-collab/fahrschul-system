/**
 * The two sections other parts of the project build: `AnalystSlot` (Quartalszahlen, DCF, Kaufthese – F68/F69) and
 * `CongressSlot` (the Congress tracker, later). Each is a lazy component that loads `./slotsImpl`; until the real module is
 * wired in there, the placeholder says "Kommt gleich". The props are `AktienSlotProps` (`./types`). Nothing here imports the
 * other parts' files: whoever builds a section replaces the body in `slotsImpl.tsx` (or the import below) and nothing else on
 * the page changes.
 */
import { lazy } from "react";

export type { AktienSlotProps } from "./types";

export const AnalystSlot = lazy(() => import("@/views/aktien/slotsImpl").then((m) => ({ default: m.AnalystSlotImpl })));
export const CongressSlot = lazy(() => import("@/views/aktien/slotsImpl").then((m) => ({ default: m.CongressSlotImpl })));
