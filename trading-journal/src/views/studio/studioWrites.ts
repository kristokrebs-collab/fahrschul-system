/**
 * Writes of the Strategie-Studio: `settings.studio` is saved at once, always from the LATEST settings, so a write never
 * throws away what another tab or the cloud sync wrote in between. Unknown keys and unreadable entries survive
 * (`withStrategies`). A save that changes nothing writes nothing.
 */
import {
  addError,
  addLive,
  attachStats,
  newStrategy,
  saveVersion,
  setVersionNote,
  studioOfSettings,
  updateDraft,
  withStrategies,
  type Answers,
  type LiveLink,
  type StoredStats,
  type StoredStrategy,
  type StudioPeriod,
  type VersionInput,
} from "@/domain/strategytext";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";

export const strategiesNow = (): StoredStrategy[] => studioOfSettings(useJournal.getState().settings).strategies;

/** Applies `fn` to the latest strategies and saves when something changed; `fn` returns the new list or `null` for "no change". */
export async function writeStrategies(fn: (list: StoredStrategy[]) => StoredStrategy[] | null): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const cur = studioOfSettings(settings).strategies;
  const next = fn(cur);
  if (!next) return true;
  const studio = withStrategies(settings.studio, next);
  if (studio === settings.studio) return true;
  try {
    await saveSettings({ ...settings, studio });
    return true;
  } catch {
    return false;
  }
}

export interface Draft {
  name: string;
  text: string;
  answers: Answers;
  symbol: string;
  period: StudioPeriod;
}

export type SaveResult = { ok: true; id: string; versionNo: number; created: boolean } | { ok: false; error: string };

const FAILED = "Das Speichern ist fehlgeschlagen.";

/** The working copy of a strategy (text, answers, market, period, name) without a new version; creates the strategy when `id` is null. */
export async function saveDraftCopy(id: string | null, d: Draft, now: number = Date.now()): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let outId = id ?? "";
  let error = null as string | null;
  const ok = await writeStrategies((list) => {
    if (id == null) {
      error = addError(list);
      if (error) return null;
      outId = newId("s_");
      return [...list, newStrategy({ id: outId, name: d.name, text: d.text, answers: d.answers, symbol: d.symbol, period: d.period }, now)];
    }
    if (!list.some((s) => s.id === id)) {
      // the strategy was removed on another device: keep the work as a strategy again
      error = addError(list);
      if (error) return null;
      return [...list, newStrategy({ id, name: d.name, text: d.text, answers: d.answers, symbol: d.symbol, period: d.period }, now)];
    }
    return list.map((s) => (s.id === id ? updateDraft(s, d, now) : s));
  });
  if (error) return { ok: false, error };
  return ok ? { ok: true, id: outId } : { ok: false, error: FAILED };
}

/** Saves the working copy AND a new version when text, answers or rules changed since the newest one. */
export async function saveStrategyVersion(id: string | null, d: Draft, input: VersionInput, now: number = Date.now()): Promise<SaveResult> {
  let outId = id ?? "";
  let n = 0;
  let created = false;
  let error = null as string | null;
  const ok = await writeStrategies((list) => {
    let base = id == null ? undefined : list.find((s) => s.id === id);
    if (!base) {
      error = addError(list);
      if (error) return null;
      outId = id ?? newId("s_");
      base = newStrategy({ id: outId, name: d.name, text: d.text, answers: d.answers, symbol: d.symbol, period: d.period }, now);
      list = [...list, base];
    }
    const withDraft = updateDraft(base, d, now);
    const saved = saveVersion(withDraft, input, now, newId("").slice(0, 6));
    n = saved.versions[saved.versions.length - 1]?.n ?? 0;
    created = saved.versions.length !== base.versions.length || (saved.versions[saved.versions.length - 1]?.id ?? "") !== (base.versions[base.versions.length - 1]?.id ?? "");
    const target = base.id;
    return list.map((s) => (s.id === target ? saved : s));
  });
  if (error) return { ok: false, error };
  return ok ? { ok: true, id: outId, versionNo: n, created } : { ok: false, error: FAILED };
}

const change = (id: string, f: (s: StoredStrategy) => StoredStrategy): Promise<boolean> => writeStrategies((list) => (list.some((s) => s.id === id) ? list.map((s) => (s.id === id ? f(s) : s)) : null));

export const removeStrategy = (id: string): Promise<boolean> => writeStrategies((list) => (list.some((s) => s.id === id) ? list.filter((s) => s.id !== id) : null));
export const noteVersion = (id: string, n: number, note: string): Promise<boolean> => change(id, (s) => setVersionNote(s, n, note));
export const putStats = (id: string, n: number, stats: StoredStats): Promise<boolean> => change(id, (s) => attachStats(s, n, stats));
export const linkLive = (id: string, link: LiveLink): Promise<boolean> => change(id, (s) => addLive(s, link));
