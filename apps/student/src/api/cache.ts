/**
 * Einfacher Lese-Cache für "offline lesbar: letzter bestätigter Stand"
 * (Termine, Feedback, Lerninhalte). BEWUSST kein IndexedDB/Service-Worker,
 * um die Komplexität für Prompt 1 gering zu halten (siehe Aufgabenstellung
 * "pick something reasonably simple") – localStorage genügt für JSON-GET-
 * Antworten in der hier benötigten Größenordnung. Dies ist AUSDRÜCKLICH kein
 * Ersatz für echte Produktivdaten im Client (Non-Negotiable aus
 * docs/security-risks.md) – es wird ausschließlich zwischengespeichert, was
 * der Server zuvor authentifiziert ausgeliefert hat, nie umgekehrt, und nie
 * für Schreibzugriffe verwendet.
 */
const PREFIX = "fahrschul:cache:";

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

export function clearCache(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
