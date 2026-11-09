/**
 * Strategie-Studio (page `studio`). The shell loads `StudioView` through `pages.ts` (a lazy chunk); this barrel is for tests and
 * for code that lives next to the page – never import it statically from the shell.
 */
export { StudioView } from "./StudioView";
export { useStudio, __resetStudio, flushStudio, strategyView, EMPTY_EDITOR, type Editor } from "./studioStore";
export { runStudioBacktest, runStudioCompare, StudioRunError, type StudioRun, type StudioComparison } from "./runner";
export { resolveEditor, resolveStored, resolveText, whyNotReady, type Resolved } from "./resolve";
export { startLive, startLiveAll } from "./live";
export { saveStrategyVersion, saveDraftCopy, removeStrategy, strategiesNow } from "./studioWrites";
export { resetCompileStatusForTests } from "./aiClient";
export { DiscoveryPanel, EvolvePanel } from "./Slots";
export type { StudioPanelProps, StudioProposal, StudioStrategy } from "./types";
export { STUDIO, EXAMPLES, NO_ADVICE, PAST_NOT_FORECAST } from "./strings";
