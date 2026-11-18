/**
 * Writes of the forward test (F23): `settings.forward` is saved at once (no draft, no Speichern button), always from the
 * LATEST settings so a write never throws away what another tab, the cloud sync or the runner wrote in between. Unknown keys
 * and unreadable account entries survive (`withAccounts`).
 */
import {
  endAccount,
  forwardOfSettings,
  newAccount,
  newAccountError,
  pauseAccount,
  resumeAccount,
  withAccounts,
  type ForwardAccount,
  type NewAccountInput,
} from "@/domain/forward";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { useForwardRuntime } from "./forwardStore";

export const accountsNow = (): ForwardAccount[] => forwardOfSettings(useJournal.getState().settings).accounts;

/** Applies `fn` to the latest accounts and saves when something changed. `fn` returns the new list or `null` for "no change". */
export async function writeAccounts(fn: (accounts: ForwardAccount[]) => ForwardAccount[] | null): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const cur = forwardOfSettings(settings).accounts;
  const next = fn(cur);
  if (!next) return true;
  const forward = withAccounts(settings.forward, next);
  if (forward === settings.forward) return true;
  try {
    await saveSettings({ ...settings, forward });
    return true;
  } catch {
    return false;
  }
}

export type StartResult = { ok: true; id: string } | { ok: false; error: string };

/** Starts a virtual account now. The rules are frozen as given; nothing is calculated before the first candle closes. */
export async function startAccount(input: Omit<NewAccountInput, "id">, now: number = Date.now()): Promise<StartResult> {
  const err = newAccountError(input, accountsNow());
  if (err) return { ok: false, error: err };
  const id = newId("f_");
  const account = newAccount({ ...input, id }, now);
  const ok = await writeAccounts((list) => [...list, account]);
  return ok ? { ok: true, id } : { ok: false, error: "Das Konto konnte nicht gespeichert werden." };
}

const change = (id: string, f: (a: ForwardAccount) => ForwardAccount) => writeAccounts((list) => (list.some((a) => a.id === id) ? list.map((a) => (a.id === id ? f(a) : a)) : null));

export const pauseById = (id: string, now: number = Date.now()): Promise<boolean> => change(id, (a) => pauseAccount(a, now));
export const resumeById = (id: string, now: number = Date.now()): Promise<boolean> => change(id, (a) => resumeAccount(a, now));
export const endById = (id: string, now: number = Date.now()): Promise<boolean> => change(id, (a) => endAccount(a, now));

export async function removeById(id: string): Promise<boolean> {
  const ok = await writeAccounts((list) => (list.some((a) => a.id === id) ? list.filter((a) => a.id !== id) : null));
  if (ok) useForwardRuntime.getState().forget(id);
  return ok;
}

export const renameById = (id: string, name: string): Promise<boolean> => {
  const clean = name.trim().slice(0, 60);
  return clean ? change(id, (a) => (a.name === clean ? a : { ...a, name: clean })) : Promise.resolve(false);
};
