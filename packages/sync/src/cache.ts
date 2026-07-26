import { STALE_AFTER_MS } from "@fahrschul/domain";
import type { KeyValueStore } from "./store.js";

/**
 * PROMPT -1 §1 (ANZEIGEHÄLFTE) – "Client-Caches sind Kopien mit Zeitstempel,
 * Version und Quelle. Sie sind nie eine konkurrierende fachliche Wahrheit."
 *
 * Phase 1 hat die Serverseite dieser Regel abgesichert (DB als einzige
 * Wahrheit, Invarianten als Constraints). Was fehlte, war die Anzeigeseite:
 * ein Cache-Eintrag, der nicht sagt, WANN und WOHER er stammt, ist von
 * frischer Wahrheit nicht unterscheidbar – und genau daraus entsteht die
 * Illusion, der Client wisse etwas Eigenes.
 *
 * Deshalb trägt hier JEDER Eintrag drei Pflichtangaben:
 *   `fetchedAt`  Zeitstempel des letzten bestätigten Serverstands
 *   `version`    ETag / Versionsnummer des Servers (oder null, wenn der
 *                Endpunkt keine liefert) – die Grundlage für §4-Konflikte
 *   `source`     "server" (frisch geladen) oder "cache" (aus der Kopie gelesen)
 *
 * Der Cache wird NIE für Schreibvorgänge herangezogen, nur gelesen und
 * angezeigt – dieselbe Regel wie in apps/student seit Prompt 1, hier nur
 * explizit gemacht und um Version/Quelle erweitert.
 */

export interface CacheEntry<T> {
  data: T;
  /** Zeitpunkt des letzten bestätigten Serverstands (ISO-8601). */
  fetchedAt: string;
  /** ETag bzw. Versionsnummer, wie der Server sie geliefert hat. */
  version: string | null;
  /** Woher der ANGEZEIGTE Stand kommt. */
  source: "server" | "cache";
}

export function writeCacheEntry<T>(
  store: KeyValueStore,
  key: string,
  data: T,
  options: { version?: string | null; now?: Date } = {},
): CacheEntry<T> {
  const entry: CacheEntry<T> = {
    data,
    fetchedAt: (options.now ?? new Date()).toISOString(),
    version: options.version ?? null,
    source: "server",
  };
  store.set(`cache:${key}`, JSON.stringify(entry));
  return entry;
}

/** Liest die Kopie. Die Quelle wird auf "cache" korrigiert – siehe §1. */
export function readCacheEntry<T>(store: KeyValueStore, key: string): CacheEntry<T> | null {
  const raw = store.get(`cache:${key}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed?.fetchedAt !== "string") return null;
    return { ...parsed, source: "cache" };
  } catch {
    return null;
  }
}

export function clearCacheEntries(store: KeyValueStore): void {
  for (const key of store.keys()) {
    if (key.startsWith("cache:")) store.remove(key);
  }
}

export interface DataAge {
  /** Alter in Millisekunden. */
  ageMs: number;
  /** Kurzform für die Anzeige, z. B. "vor 3 Min." */
  label: string;
  /** true, sobald der Stand älter als STALE_AFTER_MS ist (§7-Zustand `stale`). */
  stale: boolean;
  fetchedAt: string;
}

/**
 * §1 "Datenalter". Bewusst eine Funktion, keine Komponente: alle vier
 * Frontends haben unterschiedliche Darstellungen, aber müssen dieselbe
 * Rechnung und dieselbe `stale`-Schwelle benutzen.
 */
export function describeDataAge(
  fetchedAt: string | null | undefined,
  options: { now?: Date; staleAfterMs?: number } = {},
): DataAge | null {
  if (!fetchedAt) return null;
  const zeit = Date.parse(fetchedAt);
  if (Number.isNaN(zeit)) return null;
  const now = (options.now ?? new Date()).getTime();
  const ageMs = Math.max(0, now - zeit);
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  return { ageMs, label: formatAge(ageMs), stale: ageMs >= staleAfterMs, fetchedAt };
}

export function formatAge(ageMs: number): string {
  const sekunden = Math.floor(ageMs / 1000);
  if (sekunden < 10) return "gerade jetzt";
  if (sekunden < 60) return `vor ${sekunden} Sek.`;
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) return `vor ${minuten} Min.`;
  const stunden = Math.floor(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Std.`;
  const tage = Math.floor(stunden / 24);
  return `vor ${tage} Tag${tage === 1 ? "" : "en"}`;
}
