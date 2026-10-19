/**
 * Strategy library (F06 / F15) – import from here, never from the `@/domain/lab` barrel: the cards carry a lot of text and
 * are only needed by the library sheet (its own lazy chunk). See README.md of the lab views.
 */
export { STRATEGY_CARDS, KIND_LABEL, KIND_ORDER, LEVELS, LEVEL_LABEL, LEVEL_NOTE, buildCard, cardById, valueText, valuesOf, type LibLevel, type LibParam, type StrategyCard, type StrategyKind } from "./cards";
export { searchCards } from "./search";
