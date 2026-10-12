/**
 * Cloud contract (Wave 0 – owner P09). Signatures are final; P09 replaces the stub bodies (`useCloudUser`,
 * `reportError`, `installErrorReporting`) and registers the session token via `setAccessTokenProvider`.
 *
 * Rules for every package:
 * - Local-first stays the default. Hide every cloud / billing / exchange / community surface when
 *   `!isCloudAvailable()` (file builds, missing env).
 * - This module must stay light: never import `@supabase/supabase-js` here statically – P09 loads its client as a
 *   lazy chunk (`import("./client")`).
 * - Server calls go through `apiFetch("/billing/checkout", …)` → same-origin `/api/v1/billing/checkout` with the
 *   user's bearer token; errors arrive as `ApiError` (`status`, `code`, German `message`).
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";

// ── Availability ────────────────────────────────────────────────────────────────────────────────────────────────

export interface CloudConfig {
  /** Supabase project URL without trailing slash, e.g. `https://<ref>.supabase.co`. */
  url: string;
  /** Publishable (browser) key `sb_publishable_…` – public by design. */
  publishableKey: string;
}

/** The two public client variables (tests pass their own object). */
export type CloudEnv = Partial<Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY", string | undefined>>;

// `import.meta.env.VITE_*` must be spelled out literally so Vite can inline it.
const BUILD_ENV: CloudEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

/** Supabase config of this build, or `null` when either variable is missing / not an http(s) URL. */
export function cloudConfig(env: CloudEnv = BUILD_ENV): CloudConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!/^https?:\/\/[^/\s]+/i.test(url) || !publishableKey) return null;
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

/**
 * True when login / sync / billing / exchange features may be shown: a web build served over http(s) with both
 * `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` set. Always false in the single-file builds and on file://.
 */
export function isCloudAvailable(env: CloudEnv = BUILD_ENV): boolean {
  if (IS_FILE_BUILD || isFileProtocol()) return false;
  return cloudConfig(env) !== null;
}

// ── Session (stub until P09) ────────────────────────────────────────────────────────────────────────────────────

export type Aal = "aal1" | "aal2";

export interface CloudUser {
  id: string;
  email: string | null;
  /** Assurance level of the current session (aal2 after a TOTP challenge). */
  aal: Aal;
  /** At least one verified MFA factor exists. */
  mfaEnrolled: boolean;
}

/** Signed-in user, or `null` (signed out, or cloud unavailable). STUB: always `null` until P09. */
export function useCloudUser(): CloudUser | null {
  return null;
}

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

// ── API calls to the Netlify functions ──────────────────────────────────────────────────────────────────────────

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
  if (!res.ok) {
    const err = (data as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? DEFAULT_ERROR, err?.details);
  }
  return data as T;
}

// ── Error reporting (stub until P09) ────────────────────────────────────────────────────────────────────────────

export interface ErrorContext {
  /** Where it was caught. */
  source?: "boundary" | "window" | "promise" | "manual";
  /** React component stack (ErrorBoundary). */
  componentStack?: string;
  /** Extra, non-personal data (no trade values, no notes). */
  extra?: Record<string, unknown>;
}

/**
 * Reports an error to `/api/v1/log` (sampled, PII-stripped, only with telemetry opt-in). Never throws.
 * STUB: no-op until P09.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  void error;
  void context;
}

/** Installs `window.onerror` / `unhandledrejection` → `reportError`; returns the uninstaller. STUB: no-op until P09. */
export function installErrorReporting(): () => void {
  return () => {};
}
