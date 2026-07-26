#!/usr/bin/env node
/**
 * Lädt die .env aus dem Repository-Wurzelverzeichnis und startet damit den
 * übergebenen Befehl.
 *
 * Hintergrund: die Einstiegspunkte nutzen `dotenv/config`, das relativ zum
 * Arbeitsverzeichnis des Prozesses sucht. Bei `pnpm --filter <paket> <skript>`
 * ist das aber das Paketverzeichnis (z. B. packages/database), nicht das
 * Repo-Root – die .env dort wurde deshalb nie gefunden und Befehle wie
 * `pnpm db:migrate` scheiterten mit "DATABASE_URL ist nicht gesetzt",
 * obwohl eine gültige .env existierte.
 *
 * Bereits gesetzte Variablen werden NICHT überschrieben: explizite Exporte
 * und CI-Variablen haben Vorrang vor der Datei.
 *
 *   node scripts/with-env.mjs pnpm --filter @fahrschul/database migrate
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(repoRoot, ".env");

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Umschließende Anführungszeichen entfernen (wie dotenv)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} else {
  console.error(
    `Hinweis: ${envPath} existiert nicht. Anlegen mit: cp .env.example .env (oder ./setup.sh)`,
  );
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Aufruf: node scripts/with-env.mjs <befehl> [argumente...]");
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: "inherit",
  cwd: repoRoot,
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error(`Konnte '${command}' nicht starten: ${err.message}`);
  process.exit(1);
});
