/**
 * Writes of the optimiser into `settings.evolve`: saved at once (no draft, no Speichern button), always from the LATEST
 * settings so a write never throws away what another tab, the cloud sync or the runner wrote in between; unknown keys and
 * unreadable proposals survive (`withEvolve`). Every change of a proposal is the user's click – the run itself only ever adds
 * OPEN proposals and counts its trials.
 */
import { recordDecision, recordOutcome, effectivePrior, evolveOfSettings, nextLineage, withEvolve, MAX_REASON, type EvolvePatch, type EvolveSettings, type LiveCheck, type ProposalDraft, type StoredProposal } from "@/domain/evolve";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";

export const evolveNow = (): EvolveSettings => evolveOfSettings(useJournal.getState().settings);

/** Applies `fn` to the latest `settings.evolve` and saves when something changed. `fn` returns a patch or `null` for "no change". */
export async function writeEvolve(fn: (cur: EvolveSettings) => EvolvePatch | null): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const patch = fn(evolveOfSettings(settings));
  if (!patch) return true;
  const evolve = withEvolve(settings.evolve, patch);
  if (evolve === settings.evolve) return true;
  try {
    await saveSettings({ ...settings, evolve });
    return true;
  } catch {
    return false;
  }
}

/** A finished run: its proposals become OPEN proposals (older open ones of the same strategies are replaced), trials are counted. */
export async function addRunResult(drafts: readonly ProposalDraft[], lineage: readonly { sid: string; prior: number; trials: number; dataTo: number }[], now: number): Promise<StoredProposal[]> {
  const made: StoredProposal[] = drafts.map((d) => ({ ...d, id: newId("ev_"), createdAt: now, decision: "open" as const }));
  const ok = await writeEvolve((cur) => {
    const sids = new Set(drafts.map((d) => d.sid));
    const kept = cur.proposals.filter((p) => !(p.decision === "open" && sids.has(p.sid)));
    const lineages = { ...cur.lineages };
    for (const l of lineage) lineages[l.sid] = nextLineage(l.prior, l.trials, l.dataTo, lineages[l.sid]?.runs ?? 0);
    return { proposals: [...made, ...kept], lineages, stats: { ...cur.stats, proposed: cur.stats.proposed + made.length } };
  });
  return ok ? made : [];
}

export type Decide = { decision: "saved"; savedAs: string } | { decision: "challenger"; challengerId: string; savedAs?: string } | { decision: "rejected"; reason?: string };

/**
 * The user's decision on one proposal. The learning counts the FIRST decision of a proposal once (accepted when it was saved
 * or sent to the live test, rejected when it was rejected); later steps (a saved proposal also started as a challenger) only
 * add information to the proposal.
 */
export async function decideProposal(id: string, d: Decide, now: number): Promise<boolean> {
  return writeEvolve((cur) => {
    const p = cur.proposals.find((x) => x.id === id);
    if (!p) return null;
    const first = p.decision === "open";
    const next: StoredProposal = { ...p, decision: d.decision, decidedAt: first ? now : (p.decidedAt ?? now) };
    if (d.decision === "saved") next.savedAs = d.savedAs;
    if (d.decision === "challenger") {
      next.challengerId = d.challengerId;
      if (d.savedAs) next.savedAs = d.savedAs;
    }
    if (d.decision === "rejected" && d.reason?.trim()) next.reason = d.reason.trim().slice(0, MAX_REASON);
    const proposals = cur.proposals.map((x) => (x.id === id ? next : x));
    if (!first) return { proposals };
    const accepted = d.decision !== "rejected";
    return {
      proposals,
      learn: recordDecision(cur.learn, p.kinds, accepted),
      stats: { ...cur.stats, accepted: cur.stats.accepted + (accepted ? 1 : 0), rejected: cur.stats.rejected + (accepted ? 0 : 1) },
    };
  });
}

/** The first verdict of the live check that is not "too early": recorded once on the proposal and fed into the learning. */
export async function recordLiveVerdict(id: string, check: LiveCheck, now: number): Promise<boolean> {
  if (check.level !== "confirmed" && check.level !== "below") return true;
  return writeEvolve((cur) => {
    const p = cur.proposals.find((x) => x.id === id);
    if (!p || p.outcome) return null;
    const outcome = { at: now, level: check.level as "confirmed" | "below", avgR: check.actualR, pctPer30d: check.actualPct, n: check.n, days: check.days };
    const dev = check.actualPct != null && check.expectedPct != null ? check.actualPct - check.expectedPct : null;
    const good = check.level === "confirmed";
    return {
      proposals: cur.proposals.map((x) => (x.id === id ? { ...p, outcome } : x)),
      learn: recordOutcome(cur.learn, p.kinds, good),
      stats: { ...cur.stats, confirmed: cur.stats.confirmed + (good ? 1 : 0), below: cur.stats.below + (good ? 0 : 1), devSum: cur.stats.devSum + (dev ?? 0), devN: cur.stats.devN + (dev != null ? 1 : 0) },
    };
  });
}

export async function setPower(power: "gentle" | "normal" | "full"): Promise<boolean> {
  return writeEvolve((cur) => (cur.prefs.power === power ? null : { prefs: { power } }));
}

/** Earlier trials of a strategy that still count for today's candles. */
export const priorFor = (sid: string, dataTo: number, testSpanMs: number): number => effectivePrior(evolveNow().lineages[sid], dataTo, testSpanMs);
