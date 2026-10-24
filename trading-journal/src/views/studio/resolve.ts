/**
 * Which rules does a strategy mean right now? Pure helpers shared by the editor, "Alle testen" and the live start:
 * - the text and answers equal the newest saved version → that version's rules (an AI reading stays what it was),
 * - otherwise the local parser reads the text again (deterministic: same text and answers, same rules),
 * - and why a strategy cannot run yet (an open blocking question, a lab error, no rule at all) in one German sentence.
 */
import { activeLeaves, customKey, validateCustom, type CustomConfig } from "@/domain/lab";
import { parseStrategyText, type Answers, type StoredStrategy, type StrategyParse, type StrategySetup, type StudioVersion } from "@/domain/strategytext";

export interface Resolved {
  config: CustomConfig;
  setup: StrategySetup;
  /** the newest saved version this equals, `null` = a draft that differs from every saved version */
  versionNo: number | null;
  source: "local" | "ai";
  ready: boolean;
  /** why it cannot run (`null` = it can) */
  why: string | null;
}

const canon = (a: Answers): string => JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y)));

/** Does the saved version say exactly this text with these answers? */
export const versionMatches = (v: StudioVersion | undefined, text: string, answers: Answers): v is StudioVersion => !!v && v.text === text && canon(v.answers) === canon(answers);

/** Why the rules cannot run, or `null`. */
export function whyNotReady(config: CustomConfig, ask?: Pick<StrategyParse, "asks" | "issues" | "ready">): string | null {
  const open = ask?.asks.find((a) => a.blocking && a.chosen == null);
  if (open) return `Offene Frage: ${open.text}`;
  const err = (ask?.issues ?? validateCustom(config)).find((i) => i.level === "error");
  if (err) return err.text;
  if (activeLeaves(config).length === 0) return "Noch keine Bedingung verstanden.";
  if (ask && !ask.ready) return "Es fehlt noch etwas Nötiges.";
  return null;
}

/** The rules of a parse as the studio uses them. */
export function resolveParse(p: StrategyParse, versionNo: number | null = null): Resolved {
  const why = whyNotReady(p.rules, p);
  return { config: p.rules, setup: p.setup, versionNo, source: p.source, ready: why == null, why };
}

/**
 * The rules of a text: a fresh local reading – unless the newest version says the same text and its rules differ from that
 * reading (an AI reading, or one made by an older parser): then the saved rules stay what they were. A saved version does not
 * remember an open question, so when the local reading IS the saved one, its questions decide whether it can run.
 */
export function resolveText(text: string, answers: Answers, versions: readonly StudioVersion[]): Resolved {
  const p = parseStrategyText(text, { answers });
  const last = versions[versions.length - 1];
  if (!versionMatches(last, text, answers)) return resolveParse(p, null);
  if (last.key === customKey(p.rules)) return resolveParse(p, last.n);
  const why = whyNotReady(last.config);
  return { config: last.config, setup: last.setup, versionNo: last.n, source: "ai", ready: why == null, why };
}

/** The rules of the strategy in the editor: its fresh reading (or a new local one), labelled "vN" only when they ARE that version's rules. */
export function resolveEditor(ed: { text: string; answers: Answers }, parsed: StrategyParse | null, versions: readonly StudioVersion[]): Resolved {
  const p = parsed && parsed.text === ed.text ? parsed : parseStrategyText(ed.text, { answers: ed.answers });
  const last = versions[versions.length - 1];
  return resolveParse(p, versionMatches(last, ed.text, ed.answers) && last.key === customKey(p.rules) ? last.n : null);
}

export const resolveStored =(s: Pick<StoredStrategy, "text" | "answers" | "versions">): Resolved => resolveText(s.text, s.answers, s.versions);

/** Do two sets of rules mean the same thing? (the lab's own key) */
export const sameRules = (a: CustomConfig, b: CustomConfig): boolean => customKey(a) === customKey(b);
