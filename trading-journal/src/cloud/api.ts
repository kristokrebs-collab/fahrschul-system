/**
 * Calls to the Netlify functions (Wave-0 contract, moved here from `index.ts` unchanged; re-exported by `@/cloud`).
 * Server calls go through `apiFetch("/billing/checkout", …)` → same-origin `/api/v1/billing/checkout` with the user's
 * bearer token; errors arrive as `ApiError` (`status`, `code`, German `message`).
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

/** P09 registers the Supabase session's access-token getter here (refreshing as needed). */
export function setAccessTokenProvider(fn: TokenProvider | null): void {
  tokenProvider = fn ?? (async () => null);
}

/** Current access token (JWT) or `null` when signed out. */
export function getAccessToken(): Promise<string | null> {
  return tokenProvider();
}

/** Same-origin prefix of every function route (`netlify/functions/*.mts` → `config.path`). */
export const API_BASE = "/api/v1";

/** Error envelope every function returns on failure (`_lib/http.ts` `error()`): `{ error: { code, message } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** JSON-serialised (plain objects / arrays); strings, `FormData` and `Blob` are sent as they are. */
  body?: unknown;
  /** Query parameters; `undefined` / `null` values are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Attach the bearer token (default true). The request goes out without one when signed out. */
  auth?: boolean;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ERROR = "Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.";
/** The site answered with its app page instead of a function (no server functions deployed here). */
export const FUNCTIONS_MISSING = "Die Server-Funktionen sind auf dieser Seite nicht eingerichtet.";

function apiUrl(path: string, query?: ApiFetchInit["query"]): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) qs.set(k, String(v));
  const s = qs.toString();
  return `${API_BASE}${p}${s ? `?${s}` : ""}`;
}

/**
 * Calls a function route: `apiFetch<T>("/exchange/sync", { method: "POST", body: { dryRun: true } })`.
 * Resolves with the parsed JSON (or the text of a non-JSON reply, `undefined` for 204). Rejects with `ApiError`:
 * `status` 0 + code `unavailable` in file builds / network failures, otherwise the server's `{ error: { code, message } }`.
 */
export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { body, query, auth = true, fetchImpl, headers, ...rest } = init;
  if (IS_FILE_BUILD || isFileProtocol()) throw new ApiError(0, "unavailable", "In der Offline-Datei gibt es keine Server-Funktionen.");
  const h = new Headers(headers);
  let payload: BodyInit | undefined;
  if (body === undefined || body === null) payload = undefined;
  else if (typeof body === "string" || body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams) payload = body;
  else {
    payload = JSON.stringify(body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  if (!h.has("accept")) h.set("accept", "application/json");
  if (auth) {
    const token = await getAccessToken();
    if (token) h.set("authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await (fetchImpl ?? fetch)(apiUrl(path, query), { credentials: "same-origin", ...rest, headers: h, body: payload });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "unavailable", DEFAULT_ERROR);
  }
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data: unknown = isJson ? await res.json().catch(() => null) : await res.text();
  // A function never answers HTML: a 200 page is the SPA fallback of a host without the functions (vite preview,
  // a deploy without `netlify/functions`) – the call did not reach any server code.
  if (res.ok && typeof data === "string" && /^\s*(<!doctype html|<html)/i.test(data)) throw new ApiError(0, "unavailable", FUNCTIONS_MISSING);
  if (!res.ok) {
    const err = (data as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? DEFAULT_ERROR, err?.details);
  }
  return data as T;
}
