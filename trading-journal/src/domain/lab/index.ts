/**
 * Lab domain (F73): the rule tree of "Eigene Idee" (versioned config, building blocks, validation, plain-language text,
 * evaluation without look-ahead) and the deterministic diagnosis "Warum so schwach?" (`diagnoseRun`, usable by the AI
 * assistant). Pure TypeScript, no React, no I/O. See README.md.
 */
export * from "./rules/types";
export { BLOCKS, BLOCK_ORDER, defaultParams, sanitizeParams, isBlockId, makeCtx, type BlockDef, type EvalCtx } from "./rules/blocks";
export {
  MAX_DEPTH,
  MAX_CHILDREN,
  MAX_LEAVES_PER_SIDE,
  MAX_NAME,
  DEFAULT_STOP,
  DEFAULT_TARGET,
  DEFAULT_EXITS,
  newLeaf,
  newGroup,
  defaultCustom,
  mirrorGroup,
  leavesOf,
  groupsOf,
  sidesOf,
  activeLeaves,
  findNode,
  nextNum,
  editNode,
  sanitizeCustom,
  sanitizeStop,
  sanitizeTarget,
  sanitizeExits,
  parseCustom,
  customKey,
  blockAvailability,
  tfAvailability,
  validateCustom,
  leafText,
  nodeText,
  stopText,
  exitsText,
  summarizeCustom,
  higherTfsOf,
  needsLadder,
  warmupMsOf,
  mapToExec,
  evaluateLeaves,
  combineTree,
  type Combined,
  type SeriesSet,
} from "./rules/tree";
export { CUSTOM_TEMPLATES, type CustomTemplate } from "./rules/templates";
export { diagnoseRun, DIAG } from "./diagnosis/diagnose";
export * from "./diagnosis/types";
export { translateIdea, ideaFromBoxSetup, ideaFromSignal, ideaFromCombo, classifyBoxReason, symbolOfPair, type IdeaDraft, type IdeaGap, type IdeaInput, type IdeaFactor, type BoxSetupLike, type VerdictLike } from "./idea";
