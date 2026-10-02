/**
 * Shared fetch helper for all REST sources. No custom request headers (no CORS preflight).
 * Errors are classified into `FailureReason`s the health reducer understands.
 */
import type { ZodTypeAny, output as ZodOutput } from "zod";
import type { FailureReason } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class RestError extends Error {
  constructor(
    readonly kind: FailureReason,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "RestError";
  }
}

export function classifyStatus(status: number, body?: unknown): FailureReason {
  if (status === 451) return "blocked_451";
  if (status === 429 || status === 418 || status === 403) return "rate_limited";
  if (status >= 500) return "http_5xx";
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  // Binance -1121 "Invalid symbol", -1120 "Invalid interval"
  if (status === 400 && code === -1121) return "bad_symbol";
  if (status === 400 && code === -1120) return "bad_period";
  return "http_5xx";
}

/** Fetch errors are opaque in the browser: a CORS-less 451/429 rejects with `TypeError`. */
export function classifyThrown(err: unknown): FailureReason {
  if (err instanceof RestError) return err.kind;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (err instanceof TypeError) return "network";
  return "network";
}

export function toRestError(err: unknown): RestError {
  if (err instanceof RestError) return err;
  const kind = classifyThrown(err);
  return new RestError(kind, err instanceof Error ? err.message : String(err));
}

export interface FetchJsonOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** GET `url`, parse JSON, validate with `schema`. Throws `RestError`. */
export async function fetchJson<S extends ZodTypeAny>(url: string, schema: S, opts: FetchJsonOptions = {}): Promise<ZodOutput<S>> {
  const f = opts.fetch ?? defaultFetch;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = ctrl && opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
  if (ctrl && opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  let res: Response;
  try {
    res = await f(url, { method: "GET", signal: ctrl?.signal, cache: "no-store" });
  } catch (err) {
    if (timer) clearTimeout(timer);
    throw toRestError(err);
  }
  if (timer) clearTimeout(timer);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (!res.ok) throw new RestError(classifyStatus(res.status), `HTTP ${res.status}`, res.status);
    throw new RestError("http_5xx", "Antwort ist kein JSON", res.status);
  }
  if (!res.ok) throw new RestError(classifyStatus(res.status, body), `HTTP ${res.status}`, res.status, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RestError("http_5xx", `Antwort unerwartet: ${parsed.error.issues[0]?.message ?? "schema"}`, res.status, body);
  return parsed.data as ZodOutput<S>;
}

export function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
