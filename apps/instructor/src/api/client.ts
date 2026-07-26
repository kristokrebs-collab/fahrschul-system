/**
 * PROMPT -1 Phase 2: der Offline-Vertrag ist jetzt geprüft statt kommentiert
 * (`assertOfflineAllowed`, fail closed), jede Mutation trägt einen
 * `Idempotency-Key`, und GET-Antworten bringen ihre Version (ETag) in den
 * Cache (§1: Kopie mit Zeitstempel, Version, Quelle).
 *
 * Dünner API-Client für apps/instructor (Muster aus apps/student, siehe
 * dortige api/client.ts). GETs fallen offline auf den zuletzt bestätigten
 * Stand zurück (Tagesplan/Briefing). Mutationen (apiMutate) haben KEINEN
 * Offline-Fallback – "NOT final offline": Terminänderung/Prüfung-Go/
 * Fahrzeugblockierung/Rechnungsabschluss (hier: Stunde starten/beenden,
 * Prüfungs-Pipeline, Fahrzeug-Mangelmeldung als "wartung"-Setzung) müssen
 * live gegen apps/api laufen.
 */
import { assertOfflineAllowed, OfflineNotAllowedError } from "@fahrschul/sync";
import { readCache, writeCache } from "./cache.js";

export { OfflineNotAllowedError };

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export class OfflineError extends Error {
  constructor() {
    super("offline");
  }
}

export interface ApiGetResult<T> {
  data: T;
  fromCache: boolean;
  cachedAt: string | null;
  /** §1: ETag/Version des angezeigten Stands. */
  version: string | null;
}

export interface MutateOptions {
  /** §2: stabiler Idempotenzschlüssel (aus der persistenten Vorgangsliste). */
  idempotencyKey?: string;
  /** §4: gelesene Version -> `If-Match`. */
  expectedVersion?: number | null;
}

function neuerSchluessel(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function parseJson(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function apiGet<T>(path: string): Promise<ApiGetResult<T>> {
  if (!navigator.onLine) {
    const cached = readCache<T>(path);
    if (cached) {
      return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt, version: cached.version ?? null };
    }
    throw new OfflineError();
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
    const body = await parseJson(res);
    if (!res.ok) throw new ApiError(res.status, body);
    const version = res.headers.get("etag");
    writeCache(path, body, version);
    return { data: body as T, fromCache: false, cachedAt: new Date().toISOString(), version };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const cached = readCache<T>(path);
    if (cached) {
      return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt, version: cached.version ?? null };
    }
    throw new OfflineError();
  }
}

/**
 * Für alle mutierenden Aktionen. KEIN Offline-Fallback/keine Warteschlange
 * (Non-Negotiable "NOT final offline") – schlägt der Live-Request fehl
 * (inkl. `navigator.onLine === false`), bekommt die UI einen klaren
 * "Keine Verbindung"-Zustand statt eine stillschweigende Warteschlange.
 */
export async function apiMutate<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  options: MutateOptions = {},
): Promise<T> {
  // §8: wirft OfflineNotAllowedError, wenn der Vorgang offline nicht erlaubt
  // ist – auch für Endpunkte, die es zur Bauzeit noch nicht gab (fail closed).
  assertOfflineAllowed(method, path, navigator.onLine);
  if (!navigator.onLine) {
    throw new OfflineError();
  }
  const headers: Record<string, string> = {
    "idempotency-key": options.idempotencyKey ?? neuerSchluessel(),
  };
  if (body) headers["content-type"] = "application/json";
  if (options.expectedVersion !== null && options.expectedVersion !== undefined) {
    headers["if-match"] = `W/"${options.expectedVersion}"`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }
  const parsed = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
