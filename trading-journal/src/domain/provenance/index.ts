/**
 * Herkunft der Entscheidung und KI-Protokoll (F24) – siehe README.md. Rein, ohne I/O.
 */
export { BASIS_LABEL, DECISION_BY, DECISION_LABEL, DECISION_SHORT, decisionOf, inboxLinksOf, isDecisionBy, withDecision, type DecisionBasis, type ResolvedDecision } from "./decision";
export { basisLine, compareDecisions, INTERVAL_PCT, MIN_GROUP_N, rText, winText, type DecisionGroup, type DecisionPair, type DecisionReport, type PairTest } from "./compare";
export { signalHints, type DecisionHint } from "./hints";
export {
  AI_HELPER_LABEL,
  AI_HELPERS,
  AI_LOG_VERSION,
  aiLogCfgOf,
  aiLogOfSettings,
  appendEntry,
  decideEntry,
  EMPTY_AI_LOG,
  entryOf,
  isAiHelper,
  MAX_AI_LOG,
  normalizeEntry,
  splitModel,
  summarizeAiLog,
  withAiLog,
  type AiHelper,
  type AiHelperInfo,
  type AiLogEntry,
  type AiLogInput,
  type AiLogRow,
  type ParsedAiLog,
} from "./aiLog";
