#!/usr/bin/env bash
#
# Fahrschule Krebs – Einrichtung der Produktionsplattform für lokale Tests.
#
#   ./setup.sh              einrichten (überspringt, was schon da ist)
#   ./setup.sh --reset      Datenbanken vorher löschen und neu aufbauen
#   ./setup.sh --start      nach dem Einrichten API + alle vier Apps starten
#   ./setup.sh --help
#
# Das Skript installiert KEINE Systemsoftware. Fehlen Node, pnpm oder
# PostgreSQL, sagt es das und bricht ab – Systempakete gehören nicht
# unbemerkt von einem Skript installiert.
#
# Für Windows: setup.ps1 verwenden (oder dieses Skript in Git Bash / WSL).

set -euo pipefail
cd "$(dirname "$0")"

RESET=0
START=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --start) START=1 ;;
    -h|--help) sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $arg (--help für Hilfe)" >&2; exit 2 ;;
  esac
done

info() { printf '\033[36m>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32mOK\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31mX\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. Voraussetzungen ──────────────────────────────────────────────────
info "Voraussetzungen prüfen"

command -v node >/dev/null || die "Node.js fehlt. Nötig: Version 20 oder neuer (https://nodejs.org)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js $(node -v) ist zu alt. Nötig: 20 oder neuer."
ok "Node $(node -v)"

if ! command -v pnpm >/dev/null; then
  warn "pnpm fehlt – versuche 'corepack enable'"
  corepack enable 2>/dev/null || die "pnpm fehlt. Installieren mit: npm i -g pnpm"
fi
ok "pnpm $(pnpm -v)"

# ── 2. .env anlegen ─────────────────────────────────────────────────────
if [ -f .env ]; then
  ok ".env vorhanden (bleibt unverändert)"
else
  info ".env aus .env.example anlegen"
  cp .env.example .env
  # Echtes Secret einsetzen: der Platzhalter aus .env.example darf nicht
  # stehen bleiben – er signiert Sessions, CSRF-Token und Dokument-Links.
  SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
  sed "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env > .env.tmp && mv .env.tmp .env
  ok ".env angelegt, SESSION_SECRET zufällig erzeugt"
fi

# DATABASE_URL aus .env lesen, ohne die Datei auszuführen
DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
DB_URL_TEST=$(grep -E '^DATABASE_URL_TEST=' .env | head -1 | cut -d= -f2- || true)
[ -n "$DB_URL" ] || die "DATABASE_URL fehlt in .env"

DB_NAME=$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$DB_URL")
DB_NAME_TEST=""
if [ -n "${DB_URL_TEST:-}" ]; then
  DB_NAME_TEST=$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$DB_URL_TEST")
fi
ADMIN_URL=$(node -e "const u=new URL(process.argv[1]); u.pathname='/postgres'; console.log(u.toString())" "$DB_URL")

# ── 3. Abhängigkeiten und PostgreSQL ────────────────────────────────────
info "Abhängigkeiten installieren"
pnpm install
ok "Abhängigkeiten installiert"

info "PostgreSQL prüfen"
# Reiner TCP-Test: braucht kein npm-Modul und funktioniert deshalb
# unabhängig davon, wo im Workspace der Treiber liegt. Ob die Zugangsdaten
# stimmen, zeigt der erste echte SQL-Aufruf.
pg_reachable() { node -e '
const net = require("net");
const u = new URL(process.argv[1]);
const s = net.connect(Number(u.port || 5432), u.hostname);
s.on("connect", () => { s.destroy(); process.exit(0); });
s.on("error", () => process.exit(1));
s.setTimeout(3000, () => { s.destroy(); process.exit(1); });
' "$1" 2>/dev/null; }

if pg_reachable "$ADMIN_URL"; then
  ok "PostgreSQL erreichbar"
elif command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  info "Postgres-Container starten (docker compose up -d)"
  docker compose up -d || die "Container-Start fehlgeschlagen. Läuft Docker Desktop?"
  for i in $(seq 1 30); do
    if pg_reachable "$ADMIN_URL"; then break; fi
    [ "$i" = 30 ] && die "Container läuft, Postgres antwortet nicht. Log: docker compose logs postgres"
    sleep 1
  done
  ok "PostgreSQL erreichbar (Container)"
else
  die "PostgreSQL nicht erreichbar und Docker nicht nutzbar.
  Entweder Docker Desktop starten (dann macht dieses Skript den Rest),
  oder PostgreSQL 16 lokal installieren – Rolle, Passwort und Port wie in .env."
fi

# ── 4. Datenbanken ──────────────────────────────────────────────────────
# SQL läuft über @fahrschul/database, weil dort der Treiber (postgres.js)
# liegt; aus dem Repo-Root ist er im pnpm-Workspace nicht auflösbar.
sql_admin() {
  pnpm --filter @fahrschul/database exec node --input-type=module -e '
import postgres from "postgres";
const sql = postgres(process.argv[1], { max: 1, onnotice: () => {} });
try {
  const rows = await sql.unsafe(process.argv[2]);
  if (rows.length) console.log("ROWS:" + JSON.stringify(rows));
} finally {
  await sql.end();
}
' "$ADMIN_URL" "$1" 2>/dev/null | grep '^ROWS:' || true
}

db_exists() { [ -n "$(sql_admin "select 1 from pg_database where datname='$1'")" ]; }

if [ "$RESET" = 1 ]; then
  warn "--reset löscht die Datenbank '$DB_NAME'${DB_NAME_TEST:+ und '$DB_NAME_TEST'}"
  printf 'Wirklich löschen? Alle lokalen Testdaten gehen verloren [j/N] '
  read -r answer
  case "$answer" in
    j|J|y|Y) ;;
    *) die "Abgebrochen." ;;
  esac
  for d in $DB_NAME $DB_NAME_TEST; do
    sql_admin "select pg_terminate_backend(pid) from pg_stat_activity where datname='$d'" >/dev/null
    sql_admin "drop database if exists \"$d\"" >/dev/null
    ok "Datenbank '$d' gelöscht"
  done
fi

for d in $DB_NAME $DB_NAME_TEST; do
  if db_exists "$d"; then
    ok "Datenbank '$d' vorhanden"
  else
    sql_admin "create database \"$d\"" >/dev/null
    ok "Datenbank '$d' angelegt"
  fi
done

# ── 5. Migrationen ──────────────────────────────────────────────────────
info "Migrationen anwenden"
pnpm db:migrate
if [ -n "$DB_NAME_TEST" ]; then
  DATABASE_URL="$DB_URL_TEST" pnpm db:migrate >/dev/null
  ok "Test-Datenbank migriert"
fi

# ── 6. Seed, nur wenn noch leer ─────────────────────────────────────────
# db:seed ist nicht wiederholbar: ein zweiter Lauf bricht mit einer
# Unique-Verletzung ab. Deshalb vorher zählen.
USER_COUNT=$(pnpm --filter @fahrschul/database exec node --input-type=module -e '
import postgres from "postgres";
const sql = postgres(process.argv[1], { max: 1, onnotice: () => {} });
try {
  const rows = await sql`select count(*)::int as n from benutzer`;
  console.log("N:" + rows[0].n);
} catch {
  console.log("N:0");
} finally {
  await sql.end();
}
' "$DB_URL" 2>/dev/null | grep -oE 'N:[0-9]+' | tail -1 | cut -d: -f2 || echo 0)

if [ "${USER_COUNT:-0}" -gt 0 ]; then
  ok "Testdaten vorhanden ($USER_COUNT Konten) – Seed übersprungen"
else
  info "Testdaten anlegen"
  pnpm db:seed
  ok "Testdaten angelegt"
fi

# ── 7. Zusammenfassung ──────────────────────────────────────────────────
cat <<'ENDE'

----------------------------------------------------------------
  Einrichtung fertig.

  Starten (fuenf Terminals, API zuerst):

    pnpm dev:api          -> http://localhost:4000
    pnpm dev:student      -> http://localhost:5173   Schueler
    pnpm dev:office       -> http://localhost:5174   Buero
    pnpm dev:instructor   -> http://localhost:5175   Fahrlehrer
    pnpm dev:finance      -> http://localhost:5176   Finanzen

  Oder alles zusammen:  ./setup.sh --start

  Passwort fuer alle Konten:  Test-Passwort-123!

    schueler@example.test     Schueler           :5173
    buero@example.test        Buero              :5174
    fahrlehrer@example.test   Fahrlehrer         :5175
    finanzen@example.test     Finanzen           :5176
    leitung@example.test      Geschaeftsfuehrung :5176

  Alle ausser dem Schueler brauchen zusaetzlich einen 6-stelligen Code:

    pnpm dev:totp --watch

  Meldet der Login "mfa_required_or_invalid", fehlt nur dieser Code.

  Tests:  pnpm -r test        (erwartet 794 gruen)
----------------------------------------------------------------
ENDE

if [ "$START" = 1 ]; then
  info "API und alle vier Apps starten (Beenden mit Strg+C)"
  trap 'kill 0' EXIT INT TERM
  pnpm dev:api &
  sleep 4
  pnpm dev:student &
  pnpm dev:office &
  pnpm dev:instructor &
  pnpm dev:finance &
  wait
fi
