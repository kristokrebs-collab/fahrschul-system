/**
 * Transport-free request / response shapes of the mock backends (Paket S). The same handlers answer
 *   - Playwright's `page.route` (the e2e mocks in `tests/e2e/mocks/*`: they only translate a route into a `MockReq` and a `MockRes` into `route.fulfill`), and
 *   - the Showroom's in-app `fetch` interceptor (`../install.ts`, Netlify deploy previews).
 * No Node and no DOM API in here (runs in both worlds): bytes go through `btoa` / `TextEncoder`.
 */

export interface MockReq {
  method: string;
  url: URL;
  /** header names in lower case */
  headers: Record<string, string>;
  /** parsed JSON body (`{}` when there is none or it is no JSON) */
  body: Record<string, unknown>;
}

export interface MockRes {
  status: number;
  headers?: Record<string, string>;
  contentType?: string;
  body?: string;
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

export function jsonRes(status: number, body: unknown, extra: Record<string, string> = {}): MockRes {
  return { status, headers: { "content-type": "application/json", ...CORS, ...extra }, body: body === undefined ? "" : JSON.stringify(body) };
}

/** Same-origin function answer (`/api/v1/*`): JSON with the content type set the way `route.fulfill({ contentType })` did. */
export function fnRes(status: number, body: unknown): MockRes {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

/** Parses a request body as a JSON object (anything else → `{}`). */
export function parseBody(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const b64url = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

export const fromB64url = (part: string): string => {
  const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
