/**
 * Dünner API-Client für apps/finance (Finanz-/Flotten-/GF-Cockpit).
 *
 * PROMPT -1 Phase 2 (§2/§8): Auch hier gilt der Offline-Vertrag jetzt geprüft
 * statt implizit. Das ist in dieser App besonders relevant, weil sie
 * ZAHLUNGS- und RECHNUNGS-Vorgänge bedient – beides ausdrücklich NICHT offline
 * abschließbar. Vorher wäre ein Klick ohne Verbindung in einem generischen
 * Netzwerkfehler gelandet, ohne dass die App die fachliche Regel überhaupt
 * kannte. Jetzt entscheidet dieselbe Tabelle wie in den anderen drei Apps
 * (`assertOfflineAllowed`, fail closed), und jede Mutation trägt einen
 * `Idempotency-Key`.
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
  // §8: Zahlung, Rechnung und Bankabgleich sind offline verboten – fail closed
  // gilt auch für Endpunkte, die es zur Bauzeit noch nicht gab.
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
