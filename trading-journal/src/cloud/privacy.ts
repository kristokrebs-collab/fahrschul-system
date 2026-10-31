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

type PrivacyListener = (next: PrivacyPrefs, changed: (keyof PrivacyPrefs)[]) => void;
const listeners = new Set<PrivacyListener>();

/** Account-sync hook (`client.ts` pushes account keys to the profile). */
export function onPrivacyChange(fn: PrivacyListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Changes prefs locally (persisted) and notifies the account mirror. `silent` = adopted from the profile. */
export function setPrivacy(patch: Partial<PrivacyPrefs>, opts: { silent?: boolean } = {}): void {
  const cur = usePrivacy.getState();
  const next = parsePrivacy(patch, cur);
  const changed = (Object.keys(next) as (keyof PrivacyPrefs)[]).filter((k) => next[k] !== cur[k]);
  if (!changed.length) return;
  writeJson(PRIVACY_KEY, next);
  usePrivacy.setState(next);
  if (!opts.silent) for (const l of listeners) l(next, changed);
}

/** Community ranking opt-in (P12). */
export function useLeaderboardOptIn(): boolean {
  return usePrivacy((s) => s.leaderboard);
}
