/**
 * The panel another agent builds in parallel: the Zeitmaschine (replay the plan through the candles). It is a lazy component
 * that loads `./slotsImpl`; the body lives in `slotsImpl.tsx` (the Zeitmaschine card, loaded after a click). The props are
 * `TimeMachineSlotProps` (`./types`). Nothing here imports the other agent's files: the main agent replaces the body in
 * `slotsImpl.tsx`.
 */
import { lazy } from "react";

export type { TimeMachineSlotProps } from "./types";

export const TimeMachineSlot = lazy(() => import("@/views/plan/slotsImpl").then((m) => ({ default: m.TimeMachineSlotImpl })));
