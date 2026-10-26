/**
 * Regelstände (F25/F31) – the registry that gives each fingerprint of a rule set its running number (`@/domain/missed/rules`),
 * kept in this browser only (`tj2-rule-versions`, versioned `{ v: 1, items }`). Written when the app raises a signal or stores a
 * trade snapshot: the first time it sees a fingerprint it notes the time; the same settings later get the same number again.
 *
 * Browser storage can be empty or blocked (private window): the registry then lives in memory for the session, and a signal
 * still carries its fingerprint (the number may then be 1 again in the next session – the fingerprint is the fact).
 */
// from the module itself, not the `@/domain/missed` barrel: this file is part of the first load (the trade editor), the barrel is not
import type { RuleRef, SignalSource } from "@/domain/missed/archive";
import { fingerprint, parseRuleVersions, registerRule, RULE_VERSIONS_VERSION, type RuleVersion } from "@/domain/missed/rules";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const RULE_VERSIONS_KEY = storageKey("rule-versions");

let cache: RuleVersion[] | null = null;

const load = (): RuleVersion[] => (cache ??= parseRuleVersions(readJson<unknown>(RULE_VERSIONS_KEY, null)));

/**
 * The reference of the rule set described by `source` (a canonical string of the settings that change the evaluation):
 * its fingerprint and the number the app gives it. `scope` = the level id for a key level, `""` otherwise.
 */
export function ruleRefFor(kind: SignalSource, scope: string, source: string, now: number = Date.now()): RuleRef {
  const cur = load();
  const { items, ref, added } = registerRule(cur, kind, scope, fingerprint(source), now);
  if (added) {
    cache = items;
    writeJson(RULE_VERSIONS_KEY, { v: RULE_VERSIONS_VERSION, items });
  }
  return ref;
}

/** The versions the app has seen, oldest first (for the listing in the signal balance). */
export const getRuleVersions = (): readonly RuleVersion[] => load();

/** Tests: forget the in-memory copy. */
export function __resetRuleVersions(): void {
  cache = null;
}
