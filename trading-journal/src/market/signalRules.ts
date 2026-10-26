/**
 * Regelstand of the Einstiegs-Check (F25/F31): the canonical string of everything that changes how it evaluates – the whole
 * configuration (`signalCfgKey`) and the Lage gate in front of it – and the reference the app gives that string
 * (`ruleVersions`). Used by the signal recorder (a signal carries it) and by the trade editor (the snapshot stored on a trade
 * carries it). Not part of the first load.
 */
import { signalCfgKey, type SignalCfg } from "@/domain/signals";
import type { RuleRef } from "@/domain/missed";
import { ruleRefFor } from "./ruleVersions";

type LageLike = { cfg: { on: boolean; mode: string } } | null | undefined;

/**
 * What decides how the Einstiegs-Check evaluates: its configuration and the Lage gate in front of it. A gate that is off – or
 * absent, as in a check rebuilt from history without the Lage – is the same rule set whatever its mode says.
 */
export function entryRuleSource(s: { cfg: SignalCfg; lage?: LageLike }): string {
  const gate = s.lage?.cfg?.on ? `1:${s.lage.cfg.mode}` : "0";
  return `${signalCfgKey(s.cfg)}|lage:${gate}`;
}

/** The reference of the rules a check ran with (registers a new fingerprint the first time it is seen). */
export const entryRulesOf = (s: { cfg: SignalCfg; lage?: LageLike }, now?: number): RuleRef => ruleRefFor("entry", "", entryRuleSource(s), now);
