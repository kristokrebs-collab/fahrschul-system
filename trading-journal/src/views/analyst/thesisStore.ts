/**
 * Writes and monitoring of the Kaufthese. `settings.theses` is saved at once (no draft, no Speichern button – like the key levels
 * and the optimiser): every edit goes through `updateThesis` (cleaned like a stored value), and unknown keys and unreadable
 * entries of the stored object survive (`withTheses`).
 *
 * Monitoring runs ONLY while a panel that asked for it is open (`useThesisMonitor`): per monitored thesis whose last check is older
 * than a day (or missing) the SEC numbers are read once and the criteria are checked against the newest quarter. The result is
 * stored with its source and stand; a quarter newer than the one of the check before is marked as new. Nothing runs in the
 * background and nothing is changed except the `check` of that thesis.
 */
import { useEffect, useRef, useState } from "react";
import { checkDue, checkThesis, thesesCfgOf, withTheses, type Thesis, type ThesesCfg } from "@/domain/thesis";
import { SecError, toSecError } from "@/market/sec";
import { useJournal } from "@/store/journalStore";
import { loadAnalysis } from "./data";

/** Applies `update` to the stored theses and saves. `false` when nothing could be saved. */
export async function writeTheses(update: (list: Thesis[]) => Thesis[]): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const cur = thesesCfgOf(settings.theses);
  const next = withTheses(settings.theses, update(cur.theses));
  if (next === settings.theses) return true;
  try {
    await saveSettings({ ...settings, theses: next });
    return true;
  } catch {
    return false;
  }
}

export const cfgOfSettings = (raw: unknown): ThesesCfg => thesesCfgOf(raw);

/** Reads the SEC numbers of a thesis' company, checks its criteria and stores the result. Throws `SecError`. */
export async function runCheck(id: string, opts: { fetchImpl?: typeof fetch; now: number }): Promise<void> {
  const t = thesesCfgOf(useJournal.getState().settings.theses).theses.find((x) => x.id === id);
  if (!t || !t.ticker) return;
  let analysis;
  try {
    analysis = await loadAnalysis(t.ticker, { ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), now: opts.now, fresh: true });
  } catch (e) {
    throw toSecError(e);
  }
  // re-read: the thesis may have been edited while the numbers were on their way
  await writeTheses((list) =>
    list.map((x) => {
      if (x.id !== id) return x;
      const check = checkThesis(x, analysis.result, opts.now);
      return { ...x, check, updatedAt: opts.now };
    }),
  );
}

/** Marks the last result as seen (the "new quarter" hint goes away). */
export async function markSeen(id: string, now: number): Promise<boolean> {
  return writeTheses((list) => list.map((x) => (x.id === id && x.check && !x.check.seen ? { ...x, check: { ...x.check, seen: true }, updatedAt: now } : x)));
}

export interface MonitorState {
  /** ids being checked right now */
  running: ReadonlySet<string>;
  /** the reason a check failed, per thesis id */
  errors: Readonly<Record<string, SecError>>;
}

const MAX_PER_RUN = 5;

/**
 * Checks the due, monitored theses once when the panel opens and again when the list of theses changes (a new monitored thesis).
 * Every thesis is tried at most once per mount, so a failing SEC does not turn into a loop.
 */
export function useThesisMonitor(theses: readonly Thesis[], opts: { enabled: boolean; now: () => number; fetchImpl?: typeof fetch }): { state: MonitorState; check: (id: string) => Promise<void> } {
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, SecError>>({});
  const tried = useRef(new Set<string>());
  const { enabled, now, fetchImpl } = opts;

  const check = async (id: string): Promise<void> => {
    setRunning((r) => new Set(r).add(id));
    setErrors((e) => {
      const { [id]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
    try {
      await runCheck(id, { now: now(), ...(fetchImpl ? { fetchImpl } : {}) });
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: e instanceof SecError ? e : (toSecError(e) as SecError) }));
    } finally {
      setRunning((r) => {
        const n = new Set(r);
        n.delete(id);
        return n;
      });
    }
  };

  const due = enabled ? theses.filter((t) => checkDue(t, now())).map((t) => t.id) : [];
  const dueKey = due.join(",");
  useEffect(() => {
    if (!dueKey) return;
    const ids = dueKey
      .split(",")
      .filter((id) => !tried.current.has(id))
      .slice(0, MAX_PER_RUN);
    for (const id of ids) tried.current.add(id);
    let alive = true;
    void (async () => {
      for (const id of ids) {
        if (!alive) return;
        await check(id);
      }
    })();
    return () => {
      alive = false;
    };
    // `check` is recreated on every render; the effect depends on WHICH theses are due
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKey]);

  return { state: { running, errors }, check };
}
