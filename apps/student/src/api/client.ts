/**
 * Dünner API-Client für apps/student. Alle Schreibzugriffe (Buchen,
 * Stornieren, Upload, Zahlung, Prüfungsaktionen) laufen IMMER live gegen
 * apps/api – es gibt hier bewusst keine Offline-Warteschlange/Sync-Queue
 * (Non-Negotiable: "NOT final offline"). Nur GET-Antworten werden für den
 * lesenden Offline-Zugriff zwischengespeichert (siehe cache.ts) – der Cache
 * ist NIEMALS die Quelle der Wahrheit, sondern ausschließlich ein
 * Lese-Fallback, wenn `navigator.onLine` false ist oder der Request
 * fehlschlägt.
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

/**
 * GET mit Offline-Fallback auf den zuletzt erfolgreich geladenen Stand.
 * Schreibzugriffe verwenden apiMutate() und haben KEINEN Fallback.
 */
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
    // Netzwerkfehler (z.B. Verbindungsabbruch mitten im Request): auf Cache
    // zurückfallen, sonst als Offline-Fehler weiterreichen.
    const cached = readCache<T>(path);
    if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
    throw new OfflineError();
  }
}

/**
 * Für alle mutierenden Aktionen (POST/PUT/PATCH/DELETE). Es gibt hier
 * absichtlich KEINEN Offline-Fallback/keine Warteschlange – schlägt der
 * Live-Request fehl, bekommt die UI einen klaren "Keine Verbindung"-Zustand
 * (Non-Negotiable: appointment acceptance/cancellation/upload/payment/exam
 * actions require a live connection).
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

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  if (!navigator.onLine) {
    throw new OfflineError();
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch {
    throw new OfflineError();
  }
  const parsed = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
