/**
 * `@/views/timemachine` – the Zeitmaschine card. Import the TYPES from here (or `./types`); the card itself is a lazy chunk:
 * `TimeMachineCardLazy` (React `lazy`, fetched when it first renders) or `lazy(() => import("@/views/timemachine/TimeMachineCard"))`.
 * Nothing here loads the card, the charts or the worker before it is rendered. See README.md.
 */
import { lazy } from "react";

export type { TimeMachineCandle, TimeMachineInterval, TimeMachineProps } from "./types";
export { openTimeMachine, closeTimeMachine, useTmSheet } from "./sheetStore";
export { lastTimeMachine, type TimeMachineMemory } from "./lastResult";

/** The card as a lazy component (`<Suspense>` around it). */
export const TimeMachineCardLazy = lazy(() => import("./TimeMachineCard"));
