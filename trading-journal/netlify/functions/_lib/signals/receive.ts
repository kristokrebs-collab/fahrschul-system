/**
 * The receiving side of a signal address (Paket B3), shared by `signals-receive.mts` and the older `hooks-tradingview.mts`:
 *  - `resolveSignalOwner`: the token check. Constant time (the presented token's hash is compared with the stored hash by
 *    `timingSafeEqual`; an unknown token is compared with a dummy so both paths cost the same) and UNIFORM: a token of the wrong
 *    shape, an unknown one, a revoked one and one without the scope all give the SAME 401 – nothing tells an attacker which case it was.
 *  - `readBodyLimited`: reads at most `max` bytes of the body; anything longer is a 413 without reading the rest.
 *  - `receiveRateLimits`: per token AND per address (a flood of random tokens is limited too).
 * The token is never logged, echoed or stored (only its hash is looked up).
 */
import { timingSafeEqual } from "node:crypto";
import { ipRateId } from "../audit";
import { HttpError } from "../http";
import { enforceRateLimit, rateKey } from "../rateLimit";
import { supabaseAdmin } from "../supabase";
import { hashToken, isTokenShape, type TokenScope } from "../exchanges/tokens";

const DUMMY_HASH = hashToken("tj_dummy-token-for-constant-time-comparison-000");
const WRONG_SHAPE_HASH = hashToken("tj_shape-is-wrong-0000000000000000000000000");
const SCOPE: TokenScope = "webhook:tradingview";

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The owner of a signal address, or the one uniform 401. Touches `last_used_at` of a valid token. */
export async function resolveSignalOwner(token: string): Promise<{ userId: string; tokenHash: string }> {
  const shapeOk = isTokenShape(token);
  const hash = shapeOk ? hashToken(token) : WRONG_SHAPE_HASH;
  const { data, error } = await supabaseAdmin().from("api_tokens").select("id,user_id,token_hash,scopes,revoked_at").eq("token_hash", hash).maybeSingle();
  if (error) throw new HttpError(500, "db_error");
  const r = data as { id: string; user_id: string; token_hash: string; scopes: string[]; revoked_at: string | null } | null;
  // always exactly one comparison: with the stored hash when there is one, with a dummy when not
  const hashMatches = same(hash, r?.token_hash ?? DUMMY_HASH);
  if (!shapeOk || !r || !hashMatches || r.revoked_at || !Array.isArray(r.scopes) || !r.scopes.includes(SCOPE)) {
    throw new HttpError(401, "invalid_token", "Ungültige oder widerrufene Zieladresse.");
  }
  await supabaseAdmin().from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", r.id);
  return { userId: r.user_id, tokenHash: hash };
}

/** Per presented token (60 / min) and per calling address (300 / min). Over the limit → 429 with `Retry-After`, the same for every token. */
export async function receiveRateLimits(token: string, ip: string | null): Promise<void> {
  const addr = ipRateId(ip);
  if (addr) await enforceRateLimit(rateKey("signals-ip", addr), 300, 60);
  await enforceRateLimit(rateKey("signals", hashToken(token).slice(0, 24)), 60, 60);
}

/** The body as text, at most `max` bytes; longer → 413 (the declared length is checked first, a stream is cut off at the limit). */
export async function readBodyLimited(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, "payload_too_large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}
