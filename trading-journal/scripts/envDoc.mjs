#!/usr/bin/env node
/**
 * Writes `docs/ENV.md` from the one list of environment variables (`netlify/functions/_lib/envSpec.ts`):
 *   node scripts/envDoc.mjs --write     # (re)generate docs/ENV.md
 *   node scripts/envDoc.mjs             # print it
 * A unit test (`tests/unit/ops.env.test.ts`) fails when the file on disk differs from this output.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCOPE = { functions: "Funktionen (Netlify, Scope Functions)", client: "Browser-Build (Scope Builds, öffentlich)", build: "Build" };
const NEED = { must: "Pflicht", feature: "Pflicht für den Bereich", optional: "Optional" };

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderEnvDoc(spec, groups, labels) {
  const out = [];
  out.push("# Umgebungsvariablen");
  out.push("");
  out.push("> Diese Datei wird aus `netlify/functions/_lib/envSpec.ts` erzeugt (`node scripts/envDoc.mjs --write`). Ein Test prüft, dass sie");
  out.push("> dazu passt. Dieselbe Liste speist `node scripts/releaseCheck.mjs` und die Betreiber-Seite `/api/v1/ops/status`.");
  out.push("");
  out.push("**Grundregel:** Eine fehlende Variable heißt „nicht eingerichtet“ – der Bereich läuft dann nicht und sagt das. Sie heißt nie „frei“");
  out.push("und schaltet nie etwas auf, was bezahlt oder geschützt sein soll. (Einzige Ausnahme, bewusst: ohne Stripe sind alle Funktionen");
  out.push("zugänglich, weil es dann keine Tarife gibt – die Konto-Seite sagt „Zahlungen noch nicht eingerichtet“.)");
  out.push("");
  out.push("Alle Werte stehen nur in Netlify (Site configuration → Environment variables), Server-Werte mit „Contains secret values“, **nie** mit");
  out.push("`VITE_`-Vorsatz und nie im Repo. Vorlage: `.env.example`. Prüfung vor dem Deploy: `node scripts/releaseCheck.mjs`.");
  out.push("");
  out.push("**Spalten:** Name · Zweck · Pflicht? · Scope · ohne sie → Verhalten. „Geheim“ = Netlify-Secret, nie in Logs. „(geplant)“ = der Name ist");
  out.push("vereinbart, der Code liest ihn in diesem Stand noch nicht.");
  out.push("");
  const ids = [...groups.map((g) => g.id), ...Object.keys(labels).filter((id) => !groups.some((g) => g.id === id))];
  for (const id of ids) {
    const rows = spec.filter((e) => e.group === id);
    if (!rows.length) continue;
    const g = groups.find((x) => x.id === id);
    out.push(`## ${labels[id]}`);
    out.push("");
    if (g) out.push(`Hängt daran: ${g.serves}.${g.core ? " **Kern-Bereich** – ohne ihn schlägt der Release-Check fehl." : ""}`);
    if (g) out.push("");
    out.push("| Name | Zweck | Pflicht? | Scope | Ohne sie → Verhalten |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const e of rows) {
      const tags = `${e.secret ? " · geheim" : ""}${e.planned ? " · (geplant)" : ""}`;
      out.push(`| \`${e.name}\` | ${cell(e.purpose)} | ${NEED[e.need]}${tags} | ${SCOPE[e.scope]} | ${cell(e.without)} |`);
    }
    out.push("");
  }
  out.push("## Welche Funktion braucht welchen Bereich");
  out.push("");
  out.push("Aus `FUNCTION_ENV` in `envSpec.ts`; `/api/v1/ops/status` zeigt dasselbe live („eingerichtet“ / „teilweise“ / „nicht eingerichtet“).");
  out.push("");
  return out;
}

export function renderFunctions(fns, labels) {
  const out = ["| Funktion | Route | Bereiche | Notfall-Schalter |", "| --- | --- | --- | --- |"];
  for (const f of fns) out.push(`| \`${f.fn}\` | ${cell(f.route)} | ${f.groups.length ? f.groups.map((g) => labels[g] ?? g).join(", ") : "keine (öffentliche Daten)"} | ${f.switch ? `\`KILL_${f.switch.toUpperCase()}\`` : "–"} |`);
  out.push("");
  return out;
}

export async function envDocText() {
  const { ENV_SPEC, ENV_GROUPS, FUNCTION_ENV, GROUP_LABELS } = await import(resolve(root, "netlify/functions/_lib/envSpec.ts"));
  return [...renderEnvDoc(ENV_SPEC, ENV_GROUPS, GROUP_LABELS), ...renderFunctions(FUNCTION_ENV, GROUP_LABELS)].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await envDocText();
  if (process.argv.includes("--write")) {
    writeFileSync(resolve(root, "docs/ENV.md"), text);
    console.log("docs/ENV.md geschrieben");
  } else console.log(text);
}
