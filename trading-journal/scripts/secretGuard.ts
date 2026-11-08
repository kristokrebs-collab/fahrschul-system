/**
 * Build-time secret guard (Vite plugin, used by `vite.config.ts` and `vite.single.config.ts`).
 *
 * Everything in a `VITE_*` variable is copied as TEXT into the public JavaScript. Two checks keep a server secret out of it:
 *
 * 1. `configResolved`: every `VITE_*` variable the build sees is checked – `VITE_SUPABASE_PUBLISHABLE_KEY` must be a
 *    publishable or `anon` key (`src/cloud/publicKey.ts`), `VITE_STRIPE_PUBLISHABLE_KEY` a `pk_test_` / `pk_live_` key, no variable may
 *    be NAMED like a secret (`…SECRET…`,
 *    `…SERVICE_ROLE…`, `…PRIVATE…`, `…PASSWORD…`), and no value may LOOK like one (`sb_secret_…`, a `service_role` JWT, Stripe
 *    `sk_`/`rk_`/`whsec_`, a PEM private key, an Anthropic key).
 * 2. `generateBundle`: every emitted chunk and asset is scanned for the same value shapes – a secret that reached the bundle by
 *    any other road (a hard-coded literal, a `define`) fails the build too.
 *
 * One hit throws with the NAME of the variable or the file, never with the value. `findSecrets(text)` and `checkViteEnv(env)`
 * are exported for the unit test.
 */
import type { Plugin } from "vite";
import { checkPublicKey, jwtPayload } from "../src/cloud/publicKey.ts";

/** Names that say "server only". `VITE_SUPABASE_PUBLISHABLE_KEY` is fine; `VITE_SUPABASE_SECRET_KEY` is not. */
const SECRET_NAME = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PASSWD)/i;

/** Shapes of secrets (the tail length keeps a bare prefix in an error message or a placeholder from matching). */
const SECRET_SHAPES: readonly { what: string; re: RegExp }[] = [
  { what: "Supabase-Secret-Key (sb_secret_…)", re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { what: "Stripe-Schlüssel (sk_/rk_ live oder test)", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { what: "Stripe-Webhook-Secret (whsec_…)", re: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { what: "Anthropic-Schlüssel (sk-ant-…)", re: /\bsk-ant-[A-Za-z0-9_-]{32,}/ },
  { what: "privater Schlüssel (PEM)", re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
];

/** Every JWT-looking token of `text` whose role is not `anon` (a `service_role` token is the Supabase master key). */
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** What secrets `text` carries (descriptions, not values). */
export function findSecrets(text: string): string[] {
  const out: string[] = [];
  for (const { what, re } of SECRET_SHAPES) if (re.test(text)) out.push(what);
  for (const m of text.matchAll(JWT_RE)) {
    const role = jwtPayload(m[0])?.role;
    if (role === "service_role" || role === "supabase_admin") {
      out.push(`Supabase-JWT mit der Rolle „${role}“`);
      break;
    }
  }
  return out;
}

/** Problems with the `VITE_*` variables of a build (names, not values). */
export function checkViteEnv(env: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    const value = typeof raw === "string" ? raw : "";
    if (SECRET_NAME.test(name)) problems.push(`${name}: der Name sagt „geheim“ – ein VITE_-Wert landet im öffentlichen Bundle`);
    else if (name === "VITE_SUPABASE_PUBLISHABLE_KEY" && value.trim()) {
      const verdict = checkPublicKey(value);
      if (!verdict.ok) problems.push(`${name}: ${verdict.reason}`);
    } else if (name === "VITE_STRIPE_PUBLISHABLE_KEY" && value.trim()) {
      // Paket V: only Stripe's publishable key may go into the bundle (pk_test_ / pk_live_); a secret or restricted key never
      if (!/^pk_(test|live)_[A-Za-z0-9]{10,}$/.test(value.trim())) problems.push(`${name}: das ist kein veröffentlichbarer Stripe-Schlüssel (pk_test_… / pk_live_…)`);
    } else if (value) {
      const hits = findSecrets(value);
      if (hits.length) problems.push(`${name}: der Wert sieht aus wie ${hits.join(", ")}`);
    }
  }
  return problems;
}

const fail = (lines: string[]): never => {
  throw new Error(`Secret-Guard: Der Build wurde abgebrochen, weil ein Geheimnis im Browser-Bundle landen würde.\n  - ${lines.join("\n  - ")}\nGeheime Schlüssel gehören nur in Netlify (Scope Functions), nie in eine VITE_-Variable.`);
};

export function secretGuard(): Plugin {
  return {
    name: "tj-secret-guard",
    apply: "build",
    configResolved(config) {
      const problems = checkViteEnv(config.env as Record<string, unknown>);
      if (problems.length) fail(problems);
    },
    generateBundle(_options, bundle) {
      const leaks: string[] = [];
      for (const [file, item] of Object.entries(bundle)) {
        const text = item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : item.source.length < 20_000_000 ? new TextDecoder("utf-8", { fatal: false }).decode(item.source) : "";
        const hits = findSecrets(text);
        if (hits.length) leaks.push(`${file}: ${hits.join(", ")}`);
      }
      if (leaks.length) fail(leaks);
    },
  };
}
