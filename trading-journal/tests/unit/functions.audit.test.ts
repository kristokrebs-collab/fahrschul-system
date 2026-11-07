// @vitest-environment node
/// <reference types="node" />
/**
 * B1 audit of the server functions: EVERY file in `netlify/functions/*.mts` (read from the directory – a function added by a
 * later package is picked up without editing this file) must fit one class below, and each class has patterns the source has
 * to show. A function that fits no class fails by name; a deliberate exception needs an entry WITH a reason, and the
 * entry is itself checked against the source (so an exception cannot rot into a lie).
 *
 * Classes
 *   user     signed-in user: `requireUser` (aal2 when the user has 2FA, unless listed), rate limit, validated body
 *   public   no login, public data or capability URL: a rate limit (shared guard, database or per-instance) and fixed inputs
 *   token    a secret in the URL or header (webhook token, operator token): compared by hash, size-limited, rate-limited
 *   webhook  signed by the sender: signature verified BEFORE anything is processed, size-limited
 *   cron     scheduled in code, no route: nothing from a request
 * Static analysis finds patterns, not logic errors – it is the net that catches a forgotten `requireUser`, not a proof.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FUNCTION_ENV } from "../../netlify/functions/_lib/envSpec";

const root = join(__dirname, "../../netlify/functions");
const files = readdirSync(root).filter((f) => f.endsWith(".mts")).sort();
const src = (f: string) => readFileSync(join(root, f), "utf8");
const name = (f: string) => f.replace(/\.mts$/, "");

type Cls = "user" | "public" | "token" | "webhook" | "cron";

function classify(f: string): Cls | null {
  const s = src(f);
  const cfg = /export const config[^=]*=\s*(\{[\s\S]*?\});/.exec(s)?.[1] ?? "";
  if (/schedule:\s*"/.test(cfg)) return "cron";
  if (/verifyWebhook\(/.test(s)) return "webhook";
  if (/OPS_TOKEN|hashToken\(|resolveToken\(/.test(s) && !/requireUser\(/.test(s)) return "token";
  if (/requireUser\(/.test(s)) return "user";
  if (/optionalUser\(|stockGuard\(|enforceRateLimit\(|memoryLimit\(|limitIp\(|slots\./.test(s)) return "public";
  return null;
}

/** `user` functions that may run on an aal1 session, with the reason. */
const AAL1_OK: Record<string, string> = {
  audit: "client-side security events (sign-in, password reset) happen before the code step; the trail itself needs aal2",
  "sec-facts": "public SEC filings data, no account data in or out",
  "sec-filings": "public SEC filings data, no account data in or out",
  "account-mfa-recovery": "`redeem` is the lost-device path: the user has only the password session; `generate` / status demand aal2",
};

/** `public` / `token` / `webhook` functions without `enforceRateLimit` (another guard stands in) – each checked below. */
const OWN_LIMITER: Record<string, { pattern: RegExp; why: string }> = {
  "klines-proxy": { pattern: /limitIp\(/, why: "per-IP counter, host allow-list, fixed parameters (public Binance candles)" },
  "ops-status": { pattern: /fail\(who, now\)[\s\S]*OPS_MAX_FAILURES|locked\(who/, why: "lock-out after 10 wrong tokens per address pseudonym, per instance (must work when Supabase is down)" },
  "ops-flags": { pattern: /slots\.get\(key\)/, why: "per-instance counter; four booleans, no database" },
  "stripe-webhook": { pattern: /verifyWebhook\(/, why: "the Stripe signature is the gate; events are idempotent (`stripe_events`), body ≤ 1 MB" },
};

/** Functions that read the raw body themselves (everything else goes through `readJson` + a schema). */
const RAW_BODY: Record<string, string> = {
  "stripe-webhook": "the signature covers the exact bytes; size-limited before and after reading",
  "hooks-tradingview": "TradingView sends free text / JSON without headers; parsed by `parseTvAlert`, size-limited (MAX_BYTES)",
};

/** Public functions: what keeps them from being an open relay. */
const PUBLIC_FIXED_INPUT: Record<string, RegExp> = {
  "klines-proxy": /VENUES|SYMBOL_RE|INTERVALS/,
  "congress-index": /stockGuard\(/,
  "congress-ptr": /stockGuard\(/,
  "industry-daily": /stockGuard\(/,
  "stock-bars": /stockGuard\(/,
  "stock-news": /stockGuard\(/,
  "stock-quote": /stockGuard\(/,
  "stock-symbols": /stockGuard\(/,
  "social-shared": /\[A-Za-z0-9_-\]\{22\}/,
  "billing-code": /enforceRateLimit\([\s\S]*failClosed/,
  "billing-status": /enforceRateLimit\(/,
  "billing-referral": /enforceRateLimit\(/,
  feedback: /readJson\(/,
  log: /readJson\(/,
  "ops-flags": /switchStates\(/,
};

describe("every function fits a class", () => {
  it("lists the functions found (a sanity floor)", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)("%s is classified", (f) => {
    expect(classify(f), `${f} matches no class (user / public / token / webhook / cron) – add the missing auth pattern or an exception with a reason`).not.toBeNull();
  });

  it("every function with a route is under /api/v1/ and known to the release check (envSpec FUNCTION_ENV)", () => {
    const known = new Set(FUNCTION_ENV.map((f) => f.fn));
    const missing = files.map(name).filter((n) => !known.has(n));
    expect(missing, "functions the operator status does not know – add them to FUNCTION_ENV in _lib/envSpec.ts").toEqual([]);
    const stale = [...known].filter((n) => !files.map(name).includes(n));
    expect(stale, "FUNCTION_ENV lists functions that do not exist").toEqual([]);
    for (const f of files) {
      const cfg = /export const config[^=]*=\s*(\{[\s\S]*?\});/.exec(src(f))?.[1] ?? "";
      if (/schedule:/.test(cfg)) continue;
      for (const m of cfg.matchAll(/"(\/[^"]+)"/g)) expect(m[1], f).toMatch(/^\/api\/v1\//);
    }
  });
});

describe("class user: login, 2FA rule, limit, schema", () => {
  const users = files.filter((f) => classify(f) === "user");

  it("there are user functions", () => expect(users.length).toBeGreaterThan(20));

  it.each(users)("%s: requireUser with the aal2 rule (or a listed reason)", (f) => {
    const s = src(f);
    const calls = [...s.matchAll(/requireUser\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    if (name(f) in AAL1_OK) return;
    for (const c of calls) expect(c, `${f}: requireUser(${c}) without aal2 – the database rule (mfa_satisfied) says a 2FA account needs the code step`).toMatch(/aal2/);
  });

  it.each(users)("%s: rate limited (or through a shared guard)", (f) => {
    expect(src(f)).toMatch(/enforceRateLimit\(|rateLimit\(|stockGuard\(/);
  });

  it("the exceptions are real: every AAL1_OK function exists and uses a plain requireUser", () => {
    for (const k of Object.keys(AAL1_OK)) {
      expect(files, k).toContain(`${k}.mts`);
      expect(src(`${k}.mts`), k).toMatch(/requireUser\(req\)/);
    }
  });

  it.each(users)("%s: never takes the owner from the request", (f) => {
    const s = src(f);
    expect(s, `${f} reads a user id from the body or the query`).not.toMatch(/body\.(userId|user_id|owner|ownerId)\b|searchParams\.get\(["'](user|userId|user_id|owner)["']\)/);
  });
});

describe("class public / token / webhook / cron", () => {
  it.each(files.filter((f) => ["public", "token", "webhook"].includes(classify(f) ?? "")))("%s has a limiter or a signature gate", (f) => {
    const s = src(f);
    const own = OWN_LIMITER[name(f)];
    if (own) expect(s, `${f}: ${own.why}`).toMatch(own.pattern);
    else expect(s, `${f}: public without a rate limit`).toMatch(/enforceRateLimit\(|stockGuard\(/);
  });

  it.each(Object.entries(PUBLIC_FIXED_INPUT))("%s: public input is bounded (%s)", (n, pattern) => {
    expect(src(`${n}.mts`)).toMatch(pattern);
  });

  it("token functions compare by hash or constant time and never log the token", () => {
    const ops = src("ops-status.mts");
    expect(ops).toMatch(/timingSafeEqual\(digest\(presented\), digest\(token\)\)/);
    const hook = src("hooks-tradingview.mts");
    expect(hook).toMatch(/hashToken\(token\)/);
    for (const f of ["ops-status.mts", "hooks-tradingview.mts", "trades-api.mts"]) expect(src(f), f).not.toMatch(/console\.\w+\([^)]*\btoken\b[^"')]*\)/);
  });

  it("the Stripe webhook verifies the signature before processing, and bounds the body", () => {
    const s = src("stripe-webhook.mts");
    expect(s.indexOf("verifyWebhook(")).toBeGreaterThan(0);
    expect(s.indexOf("verifyWebhook(")).toBeLessThan(s.indexOf("processEvent("));
    expect(s).toMatch(/payload_too_large/);
  });

  it.each(files.filter((f) => classify(f) === "cron"))("%s is scheduled in code, has no route and reads nothing from a request", (f) => {
    const s = src(f);
    const cfg = /export const config[^=]*=\s*(\{[\s\S]*?\});/.exec(s)?.[1] ?? "";
    expect(cfg, f).not.toMatch(/path:/);
    expect(s, `${f} reads a request`).not.toMatch(/\breq\.(json|text|url|headers)\b/);
  });
});

describe("hygiene across all functions and their libraries", () => {
  const libs = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? libs(join(dir, e.name)) : /\.(mts|ts)$/.test(e.name) ? [join(dir, e.name)] : []));
  const all = libs(root);

  it("bodies are read through readJson + a schema; raw reads are listed with a reason", () => {
    const offenders = files.filter((f) => /\breq\.(json|text|formData|arrayBuffer)\(/.test(src(f)) && !(name(f) in RAW_BODY)).map(name);
    expect(offenders, "reads the body without readJson").toEqual([]);
    for (const k of Object.keys(RAW_BODY)) expect(src(`${k}.mts`), k).toMatch(/MAX_BYTES|maxBytes/);
  });

  it("every default export goes through handler() (generic error texts), schedules through errorFrom", () => {
    const bad = files.filter((f) => {
      const s = src(f);
      if (classify(f) === "cron") return !/errorFrom\(|handler\(/.test(s);
      return !/export default handler\(/.test(s);
    });
    expect(bad).toEqual([]);
  });

  it("logs carry no address, token, key or header (names only, codes only)", () => {
    const offenders: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/console\.(?:log|error|warn|info)\(([\s\S]*?)\);/g)) {
        // look at what is passed, not at the German / English words inside string literals
        const args = m[1]!.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "");
        if (/\b(email|jwt|secret|apiKey|api_key|password|authorization|token|headers|\.ip\b|ip\))/i.test(args)) offenders.push(`${f.replace(root, "")}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no wildcard CORS and no redirect built from request input", () => {
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/access-control-allow-origin/i);
      expect(text, f).not.toMatch(/Response\.redirect\(/);
    }
  });

  it("server errors are generic: an unhandled error becomes 500 `internal`, never the message", () => {
    const http = readFileSync(join(root, "_lib/http.ts"), "utf8");
    expect(http).toMatch(/error\(500, "internal"\)/);
    expect(http).not.toMatch(/error\(500, "internal", e\./);
  });

  it("secrets are only read through env helpers – no literal key in the source", () => {
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\b(sk_live_|sk_test_|rk_live_|whsec_[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9]{10,}|re_[A-Za-z0-9]{20,})/);
    }
  });
});
