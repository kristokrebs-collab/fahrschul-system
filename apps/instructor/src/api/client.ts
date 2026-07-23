/**
 * Dünner API-Client für apps/instructor (Muster aus apps/student, siehe
 * dortige api/client.ts). GETs fallen offline auf den zuletzt bestätigten
 * Stand zurück (Tagesplan/Briefing). Mutationen (apiMutate) haben KEINEN
 * Offline-Fallback – "NOT final offline": Terminänderung/Prüfung-Go/
 * Fahrzeugblockierung/Rechnungsabschluss (hier: Stunde starten/beenden,
 * Prüfungs-Pipeline, Fahrzeug-Mangelmeldung als "wartung"-Setzung) müssen
 * live gegen apps/api laufen.
 */
import { readCache, writeCache } from "./cache.js";

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
    if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
    throw new OfflineError();
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
    const body = await parseJson(res);
    if (!res.ok) throw new ApiError(res.status, body);
    writeCache(path, body);
    return { data: body as T, fromCache: false, cachedAt: null };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const cached = readCache<T>(path);
    if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
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
): Promise<T> {
  if (!navigator.onLine) {
    throw new OfflineError();
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }
  const parsed = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
