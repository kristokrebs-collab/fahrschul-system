/**
 * Dünner API-Client für apps/office.
 *
 * Anders als apps/student gibt es hier bewusst KEINEN Offline-Lese-Cache:
 * Büro-Daten (Heute-Queue, Planung, Matching-Vorschläge) sind zeitkritisch
 * genug, dass ein veralteter Offline-Stand irreführend wäre – die UI zeigt bei
 * einem Netzwerkfehler lieber einen klaren Fehlerzustand als einen stillen
 * alten Stand.
 *
 * PROMPT -1 Phase 2 hat zwei Dinge ergänzt, die vorher fehlten:
 *
 *  1. **Der Offline-Vertrag aus §8 gilt jetzt auch hier – geprüft.** Dass
 *     apps/office "keinen Offline-Pfad hat" war eine Beobachtung, keine
 *     Zusage: `apiMutate` hätte offline einfach einen Netzwerkfehler geworfen,
 *     ohne zu unterscheiden, ob der Vorgang überhaupt offline erlaubt gewesen
 *     wäre. Jetzt entscheidet `assertOfflineAllowed` (dieselbe Tabelle wie in
 *     den anderen drei Apps, fail closed) und die UI bekommt einen
 *     eindeutigen `OfflineNotAllowedError` – wichtig, weil hier
 *     Dokumentverifizierung und Prüfungs-Pipeline bedient werden, also zwei
 *     der ausdrücklich NICHT offline abschließbaren Vorgänge.
 *  2. **Jede Mutation trägt einen `Idempotency-Key`.** Damit ist die
 *     Voraussetzung erfüllt, unter der Phase 1 die Pflicht für
 *     `POST /pruefungen/:id/transition` zurückgestellt hatte.
 *
 * Zusätzlich wird die Version (`ETag`) einer GET-Antwort mitgeliefert, damit
 * Schreibvorgänge sie als `If-Match` zurücksenden können (§4).
 */
import { assertOfflineAllowed, OfflineNotAllowedError } from "@fahrschul/sync";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export { OfflineNotAllowedError };

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

function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  const body = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface ApiGetWithVersion<T> {
  data: T;
  /** §1/§4: ETag des Servers – Grundlage für `If-Match` beim Schreiben. */
  version: string | null;
  fetchedAt: string;
}

/** Wie apiGet, liefert aber zusätzlich die Serverversion des Stands. */
export async function apiGetVersioned<T>(path: string): Promise<ApiGetWithVersion<T>> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  const body = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return { data: body as T, version: res.headers.get("etag"), fetchedAt: new Date().toISOString() };
}

export interface MutateOptions {
  /** §2: stabiler Idempotenzschlüssel (aus der persistenten Vorgangsliste). */
  idempotencyKey?: string;
  /** §4: gelesene Version -> `If-Match`. */
  expectedVersion?: number | null;
}

export async function apiMutate<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  options: MutateOptions = {},
): Promise<T> {
  // §8: fail closed – was nicht ausdrücklich als Entwurf erlaubt ist, ist
  // offline verboten. Dokumentverifizierung und Prüfung-Go fallen darunter.
  assertOfflineAllowed(method, path, online());
  if (!online()) throw new OfflineError();

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
