/**
 * Lese-Cache für "offline lesbar: letzter bestätigter Stand" (Termine,
 * Feedback, Lerninhalte).
 *
 * PROMPT -1 §1 (Phase 2): jeder Eintrag trägt jetzt zusätzlich zur Zeit auch
 * die **Version** (ETag des Servers) und die **Quelle**. Grund: ein Eintrag,
 * der nicht sagt, wann und woher er stammt, ist von frischer Wahrheit nicht
 * unterscheidbar – und genau daraus entsteht die Illusion, der Client wisse
 * etwas Eigenes. Er bleibt AUSDRÜCKLICH ein Lese-Fallback: nie Quelle der
 * Wahrheit, nie Grundlage eines Schreibvorgangs (Non-Negotiable aus
 * docs/security-risks.md).
 *
 * Bewusst weiterhin localStorage und kein IndexedDB/Service-Worker (Prompt 1:
 * "pick something reasonably simple") – für JSON-GET-Antworten dieser
 * Größenordnung ausreichend. Die *verschlüsselten* Entwürfe liegen NICHT hier,
 * sondern in der Vorgangsliste von `@fahrschul/sync`.
 */
const PREFIX = "fahrschul:cache:";

interface CacheEntry<T> {
  data: T;
  cachedAt: string;
  /** ETag/Version des Servers, falls der Endpunkt eine liefert. */
  version?: string | null;
  /** Quelle des Eintrags – beim Lesen immer "cache". */
  source?: "server" | "cache";
}

export function writeCache<T>(key: string, data: T, version: string | null = null): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      cachedAt: new Date().toISOString(),
      version,
      source: "server",
    };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Speicher voll o.ä. – Cache ist ein Fallback, kein Muss.
  }
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    // Aus dem Cache gelesen heißt IMMER source "cache".
    return { ...parsed, source: "cache" };
  } catch {
    return null;
  }
}

export function clearCache(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
