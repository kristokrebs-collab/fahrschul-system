/**
 * HTTP helpers for the v2 functions (`export default async (req: Request, ctx: Context) => Response`).
 * Wave-0 contract (owner P09). Every function answers JSON; errors use ONE envelope the client's `apiFetch`
 * understands: `{ error: { code, message, details? } }` with a German `message`.
 *
 * ```ts
 * export default handler(async (req) => {
 *   requireMethod(req, "POST");
 *   const user = await requireUser(req);
 *   const body = await readJson(req, z.object({ dryRun: z.boolean().optional() }));
 *   return json({ ok: true });
 * });
 * export const config: Config = { path: "/api/v1/exchange/sync", method: ["POST"] };
 * ```
 * The site CSP does not apply to function responses – headers are set here.
 */
import type { Context } from "@netlify/functions";
import type { z, ZodTypeAny } from "zod";

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Throw anywhere inside a `handler` – it becomes an `error()` response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;
  constructor(status: number, code: string, message?: string, details?: unknown, headers?: Record<string, string>) {
    super(message ?? defaultMessage(status));
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const MESSAGES: Readonly<Record<number, string>> = {
  400: "Ungültige Anfrage.",
  401: "Bitte melde dich an.",
  402: "Diese Funktion ist in deinem Tarif nicht enthalten.",
  403: "Keine Berechtigung.",
  404: "Nicht gefunden.",
  405: "Methode nicht erlaubt.",
  409: "Konflikt – bitte neu laden.",
  413: "Die Anfrage ist zu groß.",
  415: "Bitte JSON senden.",
  422: "Eingaben unvollständig oder ungültig.",
  429: "Zu viele Anfragen – bitte kurz warten.",
  500: "Interner Fehler – bitte später erneut versuchen.",
  502: "Ein externer Dienst antwortet gerade nicht.",
  503: "Der Dienst ist gerade nicht verfügbar.",
};

/** German default message of a status. */
export function defaultMessage(status: number): string {
  return MESSAGES[status] ?? (status >= 500 ? MESSAGES[500]! : MESSAGES[400]!);
}

/** Headers every function response carries. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function withBase(init: ResponseInit, contentType: string): Headers {
  const h = new Headers(BASE_HEADERS);
  h.set("content-type", contentType);
  for (const [k, v] of new Headers(init.headers).entries()) h.set(k, v);
  return h;
}

/** JSON response (status 200 unless `init.status`). */
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { ...init, headers: withBase(init, "application/json; charset=utf-8") });
}

/** Error response in the shared envelope. `message` defaults to the German text of the status. */
export function error(status: number, code: string, message?: string, details?: unknown, init: ResponseInit = {}): Response {
  const body: ErrorBody = { error: { code, message: message ?? defaultMessage(status), ...(details === undefined ? {} : { details }) } };
  return json(body, { ...init, status });
}

/** Maps anything thrown to a response; unknown errors become a generic 500 (logged, never echoed to the client). */
export function errorFrom(e: unknown): Response {
  if (e instanceof HttpError) return error(e.status, e.code, e.message, e.details, { headers: e.headers });
  console.error("[fn] unhandled", e instanceof Error ? `${e.name}: ${e.message}` : typeof e);
  return error(500, "internal");
}

export type FnHandler = (req: Request, ctx: Context) => Promise<Response> | Response;

/** Wraps a function body: thrown `HttpError`s and unexpected errors become envelope responses. */
export function handler(fn: FnHandler): (req: Request, ctx: Context) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorFrom(e);
    }
  };
}

/** Throws 405 (with `Allow`) unless the request uses one of `methods`. */
export function requireMethod(req: Request, ...methods: string[]): void {
  if (!methods.includes(req.method.toUpperCase())) throw new HttpError(405, "method_not_allowed", undefined, undefined, { allow: methods.join(", ") });
}

export interface ReadJsonOptions {
  /** Max body size in bytes (default 256 KiB). */
  maxBytes?: number;
}

/**
 * Parses the JSON body and validates it with a zod schema. Throws 415 (not JSON), 413 (too large), 400 (malformed)
 * or 422 (schema mismatch; `details` = zod issues with path and code only, never the submitted values).
 */
export async function readJson<S extends ZodTypeAny>(req: Request, schema: S, opts: ReadJsonOptions = {}): Promise<z.infer<S>> {
  const max = opts.maxBytes ?? 256 * 1024;
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, "unsupported_media_type");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new HttpError(413, "payload_too_large");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max) throw new HttpError(413, "payload_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Die Anfrage enthält kein gültiges JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
    throw new HttpError(422, "invalid_body", undefined, issues);
  }
  return parsed.data as z.infer<S>;
}

/** Client IP as Netlify reports it (`x-nf-client-connection-ip`, then `ctx.ip`), or null. Hash it before storing. */
export function clientIp(req: Request, ctx?: Pick<Context, "ip"> | null): string | null {
  return req.headers.get("x-nf-client-connection-ip") ?? ctx?.ip ?? null;
}
