/**
 * The two panels other agents build in parallel: `DiscoveryPanel` (pattern discovery) and `EvolvePanel` (background
 * optimiser / evolution). Each is a lazy component that loads `./slotsImpl`; until the real modules are wired in there, the
 * placeholders say "Kommt gleich". The props are `StudioPanelProps` (`./types`) – the strategy, the candles and the last
 * result. Nothing here imports the other agents' files: the main agent replaces the bodies in `slotsImpl.tsx`.
 */
import { lazy } from "react";

export type { StudioPanelProps, StudioProposal, StudioStrategy } from "./types";

export const DiscoveryPanel = lazy(() => import("@/views/studio/slotsImpl").then((m) => ({ default: m.DiscoveryPanelImpl })));
export const EvolvePanel = lazy(() => import("@/views/studio/slotsImpl").then((m) => ({ default: m.EvolvePanelImpl })));
