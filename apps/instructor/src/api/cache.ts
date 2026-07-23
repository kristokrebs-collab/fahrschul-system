/**
 * Offline-Lese-/Entwurf-Cache (Muster aus apps/student, siehe
 * apps/student/src/api/cache.ts). Bewusst dasselbe einfache
 * localStorage-Muster statt einer neu erfundenen Lösung (Spec: "reuse that
 * offline-cache/mutation-gating approach rather than inventing a new one").
 *
 * Offline lesbar/entwerfbar (Non-Negotiable): Tagesplan, Briefing,
 * Berichtsentwurf (Stunde-beenden-Formular), Mangelentwurf
 * (Fahrzeug-Mangelmeldung-Formular). NICHT offline final: Terminänderung,
 * Prüfung-Go, Fahrzeugblockierung, Rechnungsabschluss – diese verlangen
 * eine Live-Verbindung (siehe api/client.ts apiMutate(), das KEINEN
 * Offline-Fallback hat).
 */
const PREFIX = "fahrschul:instructor:cache:";
const DRAFT_PREFIX = "fahrschul:instructor:draft:";

interface CacheEntry<T> {
  data: T;
  cachedAt: string;
}

export function writeCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cachedAt: new Date().toISOString() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Speicher voll o.ä. – Cache ist ein Fallback, kein Muss.
  }
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

/** Entwürfe (Berichtsentwurf/Mangelentwurf) – dürfen auch offline geschrieben werden. */
export function writeDraft<T>(key: string, data: T): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ data, savedAt: new Date().toISOString() }));
  } catch {
    // ignorieren – Entwurf ist ein Komfortfeature, kein Muss.
  }
}

export function readDraft<T>(key: string): { data: T; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  localStorage.removeItem(DRAFT_PREFIX + key);
}

export function clearCache(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
