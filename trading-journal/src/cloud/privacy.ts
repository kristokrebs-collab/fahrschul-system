/**
 * Privacy choices (P09 PrivacyCard): light store, no Supabase import.
 * - `sync` (default on): this DEVICE syncs while signed in. Off = the journal stays local, the account stays signed in.
 *   Device-local by design (a work laptop can opt out without touching the phone).
 * - `telemetry` (default OFF): anonymised error reports to `/api/v1/log` (`report.ts`). Opt-in, DSGVO Art. 6 (1) a.
 * - `leaderboard` (default off): may appear in community rankings (P12 reads `useLeaderboardOptIn()`).
 * `telemetry` and `leaderboard` follow the account: they are mirrored into `profiles.privacy` when signed in
 * (`client.ts` pushes / adopts them); the local copy (`<prefix>cloud-privacy`) makes them work offline and signed out.
 */
import { create } from "zustand";
import { readJson, storageKey, writeJson } from "@/store/storage";

export interface PrivacyPrefs {
  sync: boolean;
  telemetry: boolean;
  leaderboard: boolean;
}

export const DEFAULT_PRIVACY: Readonly<PrivacyPrefs> = Object.freeze({ sync: true, telemetry: false, leaderboard: false });

/** Keys that live in `profiles.privacy` (account-wide). */
export const ACCOUNT_PRIVACY_KEYS = ["telemetry", "leaderboard"] as const satisfies readonly (keyof PrivacyPrefs)[];

export const PRIVACY_KEY = storageKey("cloud-privacy");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses stored / remote prefs over the defaults (unknown keys ignored, non-booleans ignored). */
export function parsePrivacy(raw: unknown, base: PrivacyPrefs = DEFAULT_PRIVACY): PrivacyPrefs {
  const out = { ...base };
  if (!isObj(raw)) return out;
  for (const k of Object.keys(DEFAULT_PRIVACY) as (keyof PrivacyPrefs)[]) if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  return out;
}

/** Current prefs, read synchronously from storage (works before any React render). */
export function readPrivacy(): PrivacyPrefs {
  return parsePrivacy(readJson<unknown>(PRIVACY_KEY, null));
}

export const usePrivacy = create<PrivacyPrefs>()(() => readPrivacy());

/** A listener may answer with a promise: resolving `false` = it could not store the change (the account mirror failed); anything else = ok. */
type PrivacyListener = (next: PrivacyPrefs, changed: (keyof PrivacyPrefs)[]) => unknown;
const listeners = new Set<PrivacyListener>();

/** Account-sync hook (`client.ts` pushes account keys to the profile). */
export function onPrivacyChange(fn: PrivacyListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Changes prefs locally (persisted) and notifies the account mirror. `silent` = adopted from the profile. Resolves `true` when
 * the change is stored where it must be: this device's storage took it AND (signed in, an account key) the account mirror
 * answered ok – the Konto card shows its ✓ only then (Speicher-Morph). Callers that do not care ignore the promise.
 */
export function setPrivacy(patch: Partial<PrivacyPrefs>, opts: { silent?: boolean } = {}): Promise<boolean> {
  const cur = usePrivacy.getState();
  const next = parsePrivacy(patch, cur);
  const changed = (Object.keys(next) as (keyof PrivacyPrefs)[]).filter((k) => next[k] !== cur[k]);
  if (!changed.length) return Promise.resolve(true);
  const stored = writeJson(PRIVACY_KEY, next);
  usePrivacy.setState(next);
  if (opts.silent) return Promise.resolve(stored);
  return notify(next, changed).then((mirrored) => stored && mirrored);
}

async function notify(next: PrivacyPrefs, changed: (keyof PrivacyPrefs)[]): Promise<boolean> {
  const answers = await Promise.all(
    [...listeners].map(async (l) => {
      try {
        return (await l(next, changed)) !== false;
      } catch {
        return false;
      }
    }),
  );
  return answers.every(Boolean);
}

/** Sends the account keys to the account again (the „Erneut versuchen“ of a mirror that failed). Resolves whether it worked. */
export function resyncPrivacy(): Promise<boolean> {
  return notify(usePrivacy.getState(), [...ACCOUNT_PRIVACY_KEYS]);
}

/** Community ranking opt-in (P12). */
export function useLeaderboardOptIn(): boolean {
  return usePrivacy((s) => s.leaderboard);
}
