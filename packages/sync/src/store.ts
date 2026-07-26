/**
 * PROMPT -1 §7/§8 – Der lokale Ablageplatz.
 *
 * Bewusst eine winzige Schnittstelle statt einer Abhängigkeit auf
 * localStorage/IndexedDB: sie ist im Test injizierbar, und sie macht die
 * Grundregel aus §1 an der engsten Stelle sichtbar –
 *
 *   **Ein Client-Cache und eine Client-Outbox sind KOPIEN. Sie sind niemals
 *   eine konkurrierende fachliche Wahrheit.**
 *
 * Deshalb speichert dieses Modul auch nichts von sich aus: es kennt keine
 * Fachbegriffe, nur Schlüssel und Zeichenketten.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/**
 * localStorage-gestützt und absichtlich fehlertolerant: ein voller oder
 * gesperrter Speicher (Privatmodus) darf die App nicht zum Absturz bringen.
 * Der Preis – ein Entwurf kann verloren gehen – wird über
 * `persistenceHealthy()` sichtbar gemacht statt verschwiegen.
 */
export function localKeyValueStore(prefix: string): KeyValueStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        // Speicher voll/gesperrt – siehe persistenceHealthy().
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // ignorieren
      }
    },
    keys() {
      try {
        return Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
      } catch {
        return [];
      }
    },
  };
}

export function memoryKeyValueStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/**
 * Prüft, ob der Speicher tatsächlich schreibt. Wird von der Statusanzeige
 * benutzt, damit ein Benutzer im Privatmodus nicht glaubt, sein Entwurf sei
 * gesichert.
 */
export function persistenceHealthy(store: KeyValueStore): boolean {
  const probe = `__probe_${Math.random().toString(36).slice(2)}`;
  store.set(probe, "1");
  const ok = store.get(probe) === "1";
  store.remove(probe);
  return ok;
}
