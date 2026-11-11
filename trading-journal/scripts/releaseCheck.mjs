#!/usr/bin/env node
/**
 * Release check (C4 Betrieb): before a deploy, which environment variables are missing – per area and per function.
 *
 *   node scripts/releaseCheck.mjs                    # reads the process environment (CI, Netlify build, `netlify env:import`)
 *   node scripts/releaseCheck.mjs --env-file .env    # also reads a dotenv file (names and presence only)
 *   node scripts/releaseCheck.mjs --require billing,mail   # these areas must be set up, else exit 1
 *   node scripts/releaseCheck.mjs --json             # machine-readable
 *
 * Honest by construction: a missing variable is "nicht eingerichtet" (the area does not run), never "frei" / "ok". The
 * exit code is 1 when a CORE area (Supabase, site address) is incomplete, when any area is half-set (one Stripe key without
 * the webhook secret), or when a `--require`d area is not "eingerichtet". Optional areas that are simply off do not fail
 * the check – but they are listed, with what the app does without them. Values are never printed.
 *
 * The list lives in `netlify/functions/_lib/envSpec.ts` (one source for this script, the operator endpoint
 * /api/v1/ops/status and docs/ENV.md – a test keeps them equal). Needs Node ≥ 22.18 (type stripping, no flag).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const { ENV_SPEC, ENV_GROUPS, evaluateEnv } = await import(resolve(root, "netlify/functions/_lib/envSpec.ts"));

const env = { ...process.env };
const file = value("--env-file");
if (file) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) {
    console.error(`Datei nicht gefunden: ${p}`);
    process.exit(2);
  }
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const report = evaluateEnv((n) => env[n], Object.keys(env));
const required = (value("--require") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknownRequired = required.filter((r) => !ENV_GROUPS.some((g) => g.id === r));
if (unknownRequired.length) {
  console.error(`Unbekannter Bereich in --require: ${unknownRequired.join(", ")} (gültig: ${ENV_GROUPS.map((g) => g.id).join(", ")})`);
  process.exit(2);
}

const failures = [];
for (const g of report.groups) {
  if (g.core && g.state !== "eingerichtet") failures.push(`Kern-Bereich „${g.label}“ ist ${g.state}: fehlt ${g.missing.join(", ")}`);
  else if (g.state === "teilweise") failures.push(`„${g.label}“ ist nur teilweise gesetzt: fehlt ${g.missing.join(", ")}`);
  if (required.includes(g.id) && g.state !== "eingerichtet") failures.push(`Verlangter Bereich „${g.label}“ ist ${g.state}`);
}
for (const u of report.unknown) failures.push(`Unbekannter Name ${u} – Tippfehler? (steht in keiner Liste)`);
for (const x of report.production ?? []) failures.push(x);
const ok = failures.length === 0;

if (flag("--json")) {
  console.log(JSON.stringify({ ok, verdict: report.verdict, failures, groups: report.groups, switches: report.switches, unknown: report.unknown }, null, 2));
  process.exit(ok ? 0 : 1);
}

const mark = { eingerichtet: "OK    ", teilweise: "TEIL  ", "nicht eingerichtet": "AUS   " };
console.log(`Release-Check – ${report.verdict === "bereit" ? "Kern bereit" : report.verdict}\n`);
for (const g of report.groups) {
  console.log(`${mark[g.state]} ${g.label}${g.core ? " (Kern)" : ""} – ${g.state}`);
  if (g.state !== "eingerichtet") {
    console.log(`       fehlt: ${g.missing.join(", ")}`);
    const names = new Set([...ENV_SPEC.filter((e) => e.group === g.id).map((e) => e.name)]);
    const first = ENV_SPEC.find((e) => names.has(e.name) && e.need !== "optional");
    if (first) console.log(`       ohne sie: ${first.without}`);
  }
}
const on = Object.entries(report.switches).filter(([, v]) => v).map(([k]) => k);
console.log(`\nNotfall-Schalter: ${on.length ? `AN für ${on.join(", ")} (diese Bereiche sind abgeschaltet)` : "alle aus (nichts abgeschaltet)"}`);
const off = report.functions.filter((f) => f.state !== "eingerichtet");
console.log(`Funktionen, die so nicht laufen: ${off.length ? off.map((f) => f.fn).join(", ") : "keine"}`);
if (failures.length) {
  console.log("\nProbleme:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(ok ? "\nErgebnis: keine Fehler. Bereiche, die „AUS“ sind, laufen nicht – das ist gewollt, wenn du sie nicht brauchst." : "\nErgebnis: NICHT bereit (Exit 1).");
process.exit(ok ? 0 : 1);
