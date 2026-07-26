/**
 * Dünner API-Client für apps/student.
 *
 * PROMPT -1 Phase 2 (§1/§7/§8/§9) hat hier drei Dinge geändert, ohne die alte
 * Zusage aufzugeben:
 *
 *  1. **Der Offline-Vertrag ist jetzt geprüft, nicht nur kommentiert.**
 *     `assertOfflineAllowed` (packages/sync) entscheidet anhand einer
 *     gemeinsamen Tabelle, was offline überhaupt passieren darf – fail closed.
 *     Buchen, Stornieren, Zahlen, Prüfungsaktionen bleiben live-pflichtig; neu
 *     ist, dass ein neuer Endpunkt standardmäßig gesperrt ist.
 *  2. **Jede kritische Mutation trägt einen `Idempotency-Key`.** Damit ist die
 *     Voraussetzung erfüllt, unter der Phase 1 die Pflicht für sechs weitere
 *     Operationen zurückgestellt hatte. Kritische Vorgänge holen ihren
 *     Schlüssel aus der persistenten Vorgangsliste (`@fahrschul/sync`), damit
 *     er einen Neustart überlebt; für alles andere wird pro Aufruf einer
 *     erzeugt.
 *  3. **GET-Antworten tragen `ETag`/`Last-Modified` in den Cache** (§1: Kopie
 *     mit Zeitstempel, Version und Quelle). Der Cache bleibt ein reiner
 *     Lese-Fallback und ist NIEMALS die Quelle der Wahrheit.
 */
import { assertOfflineAllowed, OfflineNotAllowedError } from "@fahrschul/sync";
import { readCache, writeCache } from "./cache.js";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export { OfflineNotAllowedError };

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** §4/§7: Serverzustand aus einer Konfliktantwort, falls vorhanden. */
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
  /** ETag bzw. Versionsangabe des Servers (§1 "Version"). */
  version: string | null;
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

function neuerSchluessel(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * GET mit Offline-Fallback auf den zuletzt erfolgreich geladenen Stand.
 * Schreibzugriffe verwenden apiMutate() und haben KEINEN Fallback.
 */
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
    // Netzwerkfehler (z.B. Verbindungsabbruch mitten im Request): auf Cache
    // zurückfallen, sonst als Offline-Fehler weiterreichen.
    const cached = readCache<T>(path);
    if (cached) {
      return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt, version: cached.version ?? null };
    }
    throw new OfflineError();
  }
}

export interface MutateOptions {
  /**
   * §2: stabiler Idempotenzschlüssel. Kritische Vorgänge übergeben den
   * Schlüssel aus der persistenten Vorgangsliste, damit ein Retry nach einem
   * Absturz denselben benutzt. Ohne Angabe wird pro Aufruf einer erzeugt –
   * das schützt gegen doppelte Zustellung EINES Klicks, nicht gegen einen
   * zweiten Klick nach unklarem Ausgang (dafür ist die Liste da).
   */
  idempotencyKey?: string;
  /** §4: gelesene Version -> `If-Match`. */
  expectedVersion?: number | null;
}

/**
 * Für alle mutierenden Aktionen (POST/PUT/PATCH/DELETE). Es gibt hier
 * absichtlich KEINEN Offline-Fallback/keine stille Warteschlange – schlägt der
 * Live-Request fehl, bekommt die UI einen klaren Zustand
 * (Non-Negotiable: appointment acceptance/cancellation/upload/payment/exam
 * actions require a live connection).
 */
export async function apiMutate<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  options: MutateOptions = {},
): Promise<T> {
  // Wirft OfflineNotAllowedError, wenn der Vorgang offline nicht erlaubt ist.
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

/**
 * Upload (multipart). Der Idempotenzschlüssel geht als HEADER mit, damit er
 * ausgewertet wird, BEVOR der Server die Datei einliest – und weil der
 * Server den SHA-256 des Dateiinhalts in den Anfrage-Hash aufnimmt, ist
 * derselbe Schlüssel mit einer anderen Datei ein erkennbarer Konflikt.
 */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: MutateOptions = {},
): Promise<T> {
  assertOfflineAllowed("POST", path, navigator.onLine);
  if (!navigator.onLine) {
    throw new OfflineError();
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "idempotency-key": options.idempotencyKey ?? neuerSchluessel() },
      body: formData,
    });
  } catch {
    throw new OfflineError();
  }
  const parsed = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
