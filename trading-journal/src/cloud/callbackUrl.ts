/**
 * The address of a used or failed auth callback (pure, no Supabase import – unit-tested in `tests/unit/cloud.callbackUrl.test.ts`).
 *
 * Supabase reports a failed e-mail link in two shapes: in the QUERY (`/?error=access_denied&error_code=otp_expired&…`, PKCE) and – as its
 * verify endpoint does – in the FRAGMENT (`/#error=access_denied&error_code=otp_expired&error_description=…`). The fragment is also this
 * app's router, so the second shape used to be read as an unknown page and the visitor saw nothing (Launch-Audit D1, B9). Both shapes are
 * read here and taken out of the address; an ordinary hash route (`#preise`) is never touched.
 */

const QUERY_PARAMS = ["code", "error", "error_code", "error_description", "sb_flow_id"] as const;
const FRAGMENT_ERROR = /(^|&)(error|error_code|error_description)=/;

export interface CallbackRead {
  /** the address without the callback parameters; `null` when nothing had to be removed */
  cleaned: string | null;
  /** the error the link carried (query or fragment), if any */
  error: { code?: string; message: string } | null;
}

/** The parameters of an auth error in the fragment, or `null` for a hash route / an empty hash. */
function fragmentError(hash: string): URLSearchParams | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!FRAGMENT_ERROR.test(h)) return null;
  return new URLSearchParams(h);
}

export function readCallback(href: string): CallbackRead {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { cleaned: null, error: null };
  }
  const inQuery = QUERY_PARAMS.some((p) => u.searchParams.has(p));
  const frag = fragmentError(u.hash);
  if (!inQuery && !frag) return { cleaned: null, error: null };
  const pick = (name: string): string | null => u.searchParams.get(name) ?? frag?.get(name) ?? null;
  const code = pick("error_code") ?? pick("error");
  const desc = pick("error_description");
  for (const p of QUERY_PARAMS) u.searchParams.delete(p);
  if (frag) u.hash = ""; // the fragment was the error, not a page
  return { cleaned: u.toString(), error: code || desc ? { code: code ?? undefined, message: desc ?? "" } : null };
}

/**
 * The fragment shape must be read BEFORE the hash router runs: the router takes `#error=…` for an unknown page and rewrites the address
 * to `#overview` long before the cloud chunk (and with it `cleanCallbackUrl`) is there – measured on the built app, the reason was gone.
 * So the address the page was opened with is noted when this module loads (it is part of the first chunk through `hint.ts`).
 */
let bootFragmentError: CallbackRead["error"] = (() => {
  if (typeof location === "undefined") return null;
  try {
    return fragmentError(new URL(location.href).hash) ? readCallback(location.href).error : null;
  } catch {
    return null;
  }
})();

/** A link error the opening address carried in its fragment is still waiting to be shown. */
export function hasBootFragmentError(): boolean {
  return bootFragmentError !== null;
}

/** Hands that error out once (the router has long replaced the fragment). */
export function takeBootFragmentError(): CallbackRead["error"] {
  const e = bootFragmentError;
  bootFragmentError = null;
  return e;
}

/** Tests only: note an opening address as if the page had been loaded with it. */
export function noteBootHrefForTests(href: string): void {
  try {
    bootFragmentError = fragmentError(new URL(href).hash) ? readCallback(href).error : null;
  } catch {
    bootFragmentError = null;
  }
}
