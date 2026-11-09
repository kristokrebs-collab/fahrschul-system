/**
 * What the „Ähnliche Situationen“ card remembers (F19): timeframe, horizon, unit and the chosen features – a per-device
 * convenience in localStorage (`storageKey("similar")`), never part of the synced settings. Reading is lenient: anything
 * unknown falls back to the default; a blocked storage just means the card forgets.
 */
import { isKeyTf, type KeyTf } from "@/domain/keylevels";
import { DEFAULT_SIMILAR_CFG, FEATURE_IDS, HORIZONS, type FeatureId, type SimUnit } from "@/domain/similar";
import { storageKey } from "@/store/storage";

export const SIMILAR_PREFS_VERSION = 1 as const;

export interface SimilarPrefs {
  tf: KeyTf;
  horizon: number;
  unit: SimUnit;
  features: FeatureId[];
}

export const DEFAULT_PREFS: Readonly<SimilarPrefs> = { tf: "4h", horizon: DEFAULT_SIMILAR_CFG.horizon, unit: "r", features: [...DEFAULT_SIMILAR_CFG.features] };

export function sanitizePrefs(raw: unknown): SimilarPrefs {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const want = new Set(Array.isArray(r.features) ? r.features : DEFAULT_PREFS.features);
  const features = FEATURE_IDS.filter((f) => want.has(f));
  return {
    tf: isKeyTf(r.tf) ? r.tf : DEFAULT_PREFS.tf,
    horizon: HORIZONS.find((h) => h === r.horizon) ?? DEFAULT_PREFS.horizon,
    unit: r.unit === "pct" ? "pct" : "r",
    features: Array.isArray(r.features) ? features : [...DEFAULT_PREFS.features],
  };
}

const KEY = (): string => storageKey("similar");

export function readPrefs(): SimilarPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY());
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizePrefs(null);
  }
}

export function writePrefs(p: SimilarPrefs): void {
  try {
    globalThis.localStorage?.setItem(KEY(), JSON.stringify({ v: SIMILAR_PREFS_VERSION, ...p }));
  } catch {
    /* private mode / quota: works without remembering */
  }
}
