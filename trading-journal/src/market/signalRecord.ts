/**
 * Signalprotokoll (F25/F28) – the recorders the three raising places call: they add what the raising code knows at that moment –
 * the conditions that held (`prereq`) and the version of the rules the signal came from (`rules`) – to the event and store it in
 * the signal archive. The first load never imports this module (the Einstiegs-Check notifier loads it on demand, like the
 * archive); the Box and key-level hosts are deferred anyway.
 *
 * Never throws: a broken recorder must not break the alert that raised it (the toast and the delivery log are already out).
 */
import { toSignalSnapshot, type Side, type SignalCfg, type Signals } from "@/domain/signals";
import { levelFingerprint } from "@/domain/keylevels/watch";
import type { KeyLevel, LevelEvaluation } from "@/domain/keylevels/types";
import type { BoxesCfg } from "@/domain/boxes";
import { boxPrereq, entryPrereq, keyPrereq, type RuleRef, type SignalEventInput, type SignalPrereq } from "@/domain/missed";
import { ruleRefFor } from "./ruleVersions";
import { entryRulesOf } from "./signalRules";
import { recordSignalEvent } from "./signalArchive";

/** What decides how the Box engine grades a setup: the lowest grade that counts and the engine's tuning (not the watchlist or the switches). */
export function boxRuleSource(cfg: Pick<BoxesCfg, "minGrade" | "box">): string {
  return JSON.stringify({ g: cfg.minGrade, b: cfg.box });
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The Einstiegs-Check fired for `side`: stores the event with the snapshot's conditions and the rule version. */
export function recordEntrySignal(input: SignalEventInput, s: Signals & { cfg: SignalCfg }, side: Side, symbol: string): void {
  const prereq: SignalPrereq[] = safe(() => entryPrereq(toSignalSnapshot(s, side, s.cfg, { mode: "live", symbol: symbol || undefined }))) ?? [];
  const rules: RuleRef | null = safe(() => entryRulesOf(s)) ?? null;
  recordSignalEvent({ ...input, prereq, rules });
}

/** A Box alert: a setup or scanner row carries its graded reasons, a phase change has none (it is context). */
export function recordBoxSignal(input: SignalEventInput, reasons: ReadonlyArray<{ text: string; ok: boolean }> | null | undefined, cfg: Pick<BoxesCfg, "minGrade" | "box">): void {
  const prereq = reasons?.length ? (safe(() => boxPrereq(reasons)) ?? []) : [];
  const rules: RuleRef | null = safe(() => ruleRefFor("box", "", boxRuleSource(cfg))) ?? null;
  recordSignalEvent({ ...input, prereq, rules });
}

/** A key level confirmed or retested: its rule and the version of the level's definition. */
export function recordKeySignal(input: SignalEventInput, level: KeyLevel, stage: "confirm" | "retest", ev: LevelEvaluation): void {
  const prereq = safe(() => keyPrereq(level, stage, ev)) ?? [];
  const rules: RuleRef | null = safe(() => ruleRefFor("key", level.id, levelFingerprint(level))) ?? null;
  recordSignalEvent({ ...input, prereq, rules });
}
