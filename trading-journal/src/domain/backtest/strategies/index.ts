/** Lab strategies (P07): Eigene Idee (F73, the user's rule tree), Box-zu-Box (real box engine), MCB ladder (real entry check), rule builder. */
export { paramGrid, paramKey, loopStepper, type LabStrategy, type ParamSpec, type ParamValue, type Params, type Prepared, type Stepper, type FunnelNode, type StrategyFunnel, type StrategyVariant } from "./types";
export { boxToBox, BOX_WINDOW, BOX_WARMUP, KIND_TAG, type BoxCfgIn, type BoxTfChoice, type BoxCandidate, type BoxFacts } from "./boxToBox";
export { mcbLadder, sourceOf, neededTfs, MCB_WARMUP_BARS, type McbCfgIn, type McbStep, type McbFact, type McbFacts } from "./mcbLadder";
export { ruleBuilder, evalConds, sanitizeCond, condText, rulesLookback, RULE_LABEL, RULE_DEFAULTS, type RuleKind, type RuleCond, type RulesCfgIn, type RuleFacts } from "./rules";
export { customStrategy, defaultCustomIn, manageOf, type CustomCfgIn, type CustomFacts } from "./custom";
