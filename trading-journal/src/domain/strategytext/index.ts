/**
 * Strategy text → lab rules (Strategie-Studio). Pure TypeScript, no React, no I/O. See README.md.
 */
export * from "./types";
export { parseStrategyText, pruneAnswers } from "./parse";
export { compareStrategies, createComparison, compareIntervals, compareWarmupMs, multipleTestingNote, sampleLevel, candleMs, MIN_TEST_TRADES, type CompareInput, type CompareOptions, type CompareResult, type CompareRow, type MultipleTesting, type PeriodFigures, type RowStatus, type SampleLevel } from "./compare";
export { RulesSchema, SetupSchema, AiOutputSchema, REFS, type AiOutput, type Ref } from "./schema";
export { AI_TOOL, AI_TEXT_MAX, aiToParse, buildSystemPrompt, buildUserPrompt, catalogText, groundingProblems, parseAiOutput, type AiParse } from "./ai";
export { strictParamsProblem } from "./strict";
export {
  addError,
  addLive,
  attachStats,
  diffVersions,
  newStrategy,
  saveVersion,
  setVersionNote,
  storedForm,
  strategyOf,
  studioCfgOf,
  studioOfSettings,
  updateDraft,
  withStrategies,
  EMPTY_STUDIO,
  DEFAULT_PERIOD,
  DEFAULT_SYMBOL,
  MAX_LIVE,
  MAX_STRATEGIES,
  MAX_VERSIONS,
  STUDIO_VERSION,
  type LiveLink,
  type NewStrategyInput,
  type StoredStats,
  type StoredStrategy,
  type StudioCfg,
  type StudioVersion,
  type VersionInput,
} from "./studioConfig";
