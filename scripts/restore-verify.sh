#!/usr/bin/env bash
#
# PROMPT -1 §14 / §20 Szenario 15 (Phase 4) –
# Wiederherstellung in eine ISOLIERTE Umgebung und Integritätsnachweis.
#
# ## Was „isoliert" hier bedeutet, und was nicht
#
# Wiederhergestellt wird in eine EIGENE, frisch erzeugte Datenbank auf derselben
# Postgres-Instanz. Das ist eine echte Isolation gegen den häufigsten Fehler
# eines Wiederherstellungstests – dass er die Produktionsdaten überschreibt –
# und es prüft Schema, Constraints, Trigger und Daten vollständig.
#
# Was es NICHT prüft, und das steht so auch im Bericht: einen Ausfall der
# INSTANZ oder des Hosts. Dafür braucht es einen zweiten Server, den es in dieser
# Umgebung nicht gibt. Die physische Variante (`--pitr`) kommt näher heran: sie
# startet einen ZWEITEN Postgres-Cluster auf einem eigenen Port aus einer
# Basissicherung und spielt WAL-Segmente bis zu einem Zeitpunkt nach.
#
# ## Warum die Prüfung Code und kein `psql`-Skript ist
#
# `checkDatabaseIntegrity` (packages/database/src/integrity.ts) wird von diesem
# Skript UND von `apps/api/src/__tests__/chaos.test.ts` benutzt. Damit ist die
# Prüfung selbst getestet – ein Prüfskript, das niemand nachrechnet, kann
# stillschweigend nichts prüfen.
#
# ## Benutzung
#
#   BACKUP_KEY_FILE=... DATABASE_URL=... scripts/restore-verify.sh <label>
#   BACKUP_KEY_FILE=... DATABASE_URL=... scripts/restore-verify.sh <label> --pitr '<ISO-Zeitpunkt>'
#
set -euo pipefail

LABEL="${1:-}"
MODE="${2:-}"
PITR_TARGET="${3:-}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/fahrschul}"
KEY_FILE="${BACKUP_KEY_FILE:-${BACKUP_ROOT}/backup.key}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$LABEL" || -z "${DATABASE_URL:-}" ]]; then
  echo "Benutzung: DATABASE_URL=... $0 <backup-label> [--pitr '<ISO-Zeitpunkt>']" >&2
  exit 2
fi

psql_q() { psql "$DATABASE_URL" -tAX -c "$1"; }

ROW="$(psql_q "select kind || '|' || location || '|' || status || '|' || coalesce(checksum_sha256,'')
               from backup_runs where label = '${LABEL}'")"
[[ -n "$ROW" ]] || { echo "FEHLER: kein backup_runs-Eintrag mit label='${LABEL}'." >&2; exit 3; }
IFS='|' read -r KIND LOCATION STATUS CHECKSUM <<<"$ROW"
[[ "$STATUS" == "erfolgreich" ]] || { echo "FEHLER: Sicherung '${LABEL}' hat Status '${STATUS}'." >&2; exit 3; }

echo "== Wiederherstellungstest für ${LABEL} (${KIND}) =="

# ---------------------------------------------------------------------------
# Schritt 0: Prüfsumme. Ein Artefakt, dessen Prüfsumme nicht stimmt, wird NICHT
# wiederhergestellt – ein halb übertragenes Backup zurückzuspielen ist
# schlimmer als keins.
# ---------------------------------------------------------------------------
if [[ "$KIND" != "wal" ]]; then
  IST="$(sha256sum "$LOCATION" | cut -d' ' -f1)"
  if [[ "$IST" != "$CHECKSUM" ]]; then
    echo "FEHLER: Prüfsumme weicht ab. soll=${CHECKSUM} ist=${IST}" >&2
    psql_q "update backup_runs set verify_method='checksum', verify_details='{\"ok\":false,\"grund\":\"checksum_mismatch\"}'
            where label='${LABEL}'" >/dev/null
    exit 4
  fi
  echo "  [ok] SHA-256 stimmt (${CHECKSUM:0:16}…)"
fi

START_MS=$(date +%s%3N)

if [[ "$MODE" == "--pitr" ]]; then
  # =========================================================================
  # PHYSISCHE Wiederherstellung + PITR in einen ZWEITEN Cluster
  # =========================================================================
  [[ "$KIND" == "physical" ]] || { echo "FEHLER: --pitr braucht eine physische Sicherung." >&2; exit 2; }
  [[ -n "$PITR_TARGET" ]] || { echo "FEHLER: --pitr braucht einen Zielzeitpunkt." >&2; exit 2; }

  RESTORE_DIR="${BACKUP_ROOT}/restore/pitr-$$"
  RESTORE_PORT="${RESTORE_PORT:-5433}"
  rm -rf "$RESTORE_DIR"
  mkdir -p "$RESTORE_DIR"

  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" \
    -in "$LOCATION" | tar -xf - -C "$RESTORE_DIR"
  echo "  [ok] Basissicherung entschlüsselt und entpackt"

  # Debian/Ubuntu legen `postgresql.conf`, `pg_hba.conf` und `pg_ident.conf`
  # unter /etc/postgresql/<ver>/<cluster>/ ab – NICHT im Datenverzeichnis. Eine
  # Basissicherung enthält sie deshalb nicht, und ein daraus gestarteter Cluster
  # findet keine Konfiguration. Das ist eine Eigenheit der Paketierung, kein
  # Fehler von pg_basebackup, und sie muss hier ausgeglichen werden.
  PG_ETC="${PG_ETC:-/etc/postgresql/16/main}"
  for datei in postgresql.conf pg_hba.conf pg_ident.conf; do
    if [[ -f "$PG_ETC/$datei" ]]; then
      cp "$PG_ETC/$datei" "$RESTORE_DIR/$datei"
    fi
  done
  # Die eingebundenen Zusatzdateien (u. a. archive_command) NICHT mitnehmen: der
  # Wiederherstellungscluster darf auf keinen Fall in dasselbe WAL-Archiv
  # schreiben. Er würde die Segmente überschreiben, die er selbst gerade liest.
  sed -i "s|^include_dir|#include_dir|; s|^data_directory|#data_directory|; \
          s|^hba_file|#hba_file|; s|^ident_file|#ident_file|; \
          s|^external_pid_file|#external_pid_file|" "$RESTORE_DIR/postgresql.conf"

  chown -R postgres:postgres "$RESTORE_DIR"
  chmod 700 "$RESTORE_DIR"

  # recovery.signal + restore_command: so und nur so entsteht PITR.
  cat > "$RESTORE_DIR/postgresql.auto.conf" <<CONF
port = ${RESTORE_PORT}
restore_command = 'cp ${BACKUP_ROOT}/wal/%f %p'
recovery_target_time = '${PITR_TARGET}'
recovery_target_action = 'promote'
archive_mode = off
hot_standby = on
CONF
  touch "$RESTORE_DIR/recovery.signal"
  chown postgres:postgres "$RESTORE_DIR/postgresql.auto.conf" "$RESTORE_DIR/recovery.signal"

  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$RESTORE_DIR' -o '-p ${RESTORE_PORT}' \
      -l '$RESTORE_DIR/recovery.log' -w -t 120 start" \
    || { echo "FEHLER: Wiederherstellungscluster startet nicht:"; tail -40 "$RESTORE_DIR/recovery.log"; exit 5; }
  echo "  [ok] Wiederherstellungscluster läuft auf Port ${RESTORE_PORT}"

  RESTORE_URL="postgres://fahrschul:fahrschul_dev_pw@localhost:${RESTORE_PORT}/fahrschul_dev"
  VERIFY_URL="$RESTORE_URL"
  CLEANUP="su postgres -c \"/usr/lib/postgresql/16/bin/pg_ctl -D '$RESTORE_DIR' -m immediate -w -t 60 stop\" >/dev/null 2>&1; rm -rf '$RESTORE_DIR'"
  VERIFY_METHOD="pitr-cluster"
else
  # =========================================================================
  # LOGISCHE Wiederherstellung in eine ISOLIERTE Datenbank
  # =========================================================================
  [[ "$KIND" == "logical" ]] || { echo "FEHLER: ohne --pitr wird eine logische Sicherung erwartet." >&2; exit 2; }

  RESTORE_DB="fahrschul_restore_$(date +%s)"
  BASE_URL="${DATABASE_URL%/*}"
  VERIFY_URL="${BASE_URL}/${RESTORE_DB}"

  psql "${BASE_URL}/postgres" -q -c "create database ${RESTORE_DB}" \
    || { echo "FEHLER: Zieldatenbank ${RESTORE_DB} nicht anlegbar." >&2; exit 5; }
  echo "  [ok] isolierte Zieldatenbank ${RESTORE_DB} angelegt"

  # Wichtig: KEIN --disable-triggers. Genau das würde die Invarianten
  # aushebeln, und die Integritätsprüfung würde es (zu Recht) melden.
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$LOCATION" \
    | pg_restore --no-owner --no-privileges --exit-on-error -d "$VERIFY_URL" \
    || { echo "FEHLER: pg_restore fehlgeschlagen." >&2; exit 5; }
  echo "  [ok] pg_restore ohne Fehler durchgelaufen"

  CLEANUP="psql '${BASE_URL}/postgres' -q -c 'drop database if exists ${RESTORE_DB}'"
  VERIFY_METHOD="logical-isolated-db"
fi

END_MS=$(date +%s%3N)
RESTORE_MS=$((END_MS - START_MS))
echo "  [ok] Wiederherstellung in ${RESTORE_MS} ms"

# ---------------------------------------------------------------------------
# Schritt 2: die eigentliche Prüfung. Struktur UND Daten, nicht nur ein
# Exitcode.
# ---------------------------------------------------------------------------
BERICHT="$(cd "$REPO_ROOT" && QUELLE_URL="$DATABASE_URL" ZIEL_URL="$VERIFY_URL" \
  npx --yes tsx scripts/integrity-report.mjs 2>/dev/null)" \
  || { eval "$CLEANUP"; echo "FEHLER: Integritätsprüfung nicht ausführbar." >&2; exit 6; }

echo "$BERICHT" > "${BACKUP_ROOT}/restore/${LABEL}.verify.json"

# -----------------------------------------------------------------------------
# Bewertung – und der eine Punkt, an dem PITR anders bewertet werden MUSS
#
# Bei einer LOGISCHEN Wiederherstellung ist „gleiche Zeilenzahlen" die
# Kernaussage: das Ziel soll die Quelle sein.
#
# Bei PITR ist genau das FALSCH. Eine Zeitpunkt-Wiederherstellung stellt
# absichtlich einen ÄLTEREN Stand her; alles nach dem Zielzeitpunkt fehlt dort
# zu Recht. Würde man hier Gleichheit verlangen, wäre ein korrekter PITR-Lauf
# grundsätzlich „nicht verifiziert" – und ein Lauf, der den Zielzeitpunkt
# ignoriert und einfach alles nachspielt, wäre „verifiziert". Die Prüfung wäre
# also nicht nur zu streng, sondern hätte das falsche Vorzeichen.
#
# Für PITR gilt deshalb: STRUKTUR muss stimmen (Migrationsstand, Tabellen,
# Constraints, aktive Trigger, keine referenziellen Waisen), und die
# Zeilendifferenz wird als ERWARTETE Angabe protokolliert, nicht als Fehler.
# -----------------------------------------------------------------------------
OK="$(MODE="$MODE" python3 -c '
import json,os,sys
d = json.load(sys.stdin)
z, v = d["ziel"], d["vergleich"]
pitr = os.environ.get("MODE") == "--pitr"
print("ja" if z["ok"] and (pitr or v["gleich"]) else "nein")
print(z["migrationCount"], z["latestMigration"], z["tableCount"])
print(json.dumps(z["findings"]))
print(json.dumps(v["abweichungen"]))
print("erwartet (PITR: alter Stand)" if pitr else "muss leer sein")
' <<<"$BERICHT")"
ERGEBNIS="$(echo "$OK" | sed -n 1p)"
STAND="$(echo "$OK" | sed -n 2p)"
FINDINGS="$(echo "$OK" | sed -n 3p)"
ABWEICHUNGEN="$(echo "$OK" | sed -n 4p)"
BEWERTUNG="$(echo "$OK" | sed -n 5p)"

echo "  Migrationsstand/Tabellen: ${STAND}"
echo "  Befunde:                  ${FINDINGS}"
echo "  Zeilenabweichungen:       ${ABWEICHUNGEN}  [${BEWERTUNG}]"

eval "$CLEANUP"
echo "  [ok] isolierte Umgebung wieder abgebaut"

if [[ "$ERGEBNIS" == "ja" ]]; then
  psql_q "update backup_runs set
            verified_at = now(),
            verify_method = '${VERIFY_METHOD}',
            restore_duration_ms = ${RESTORE_MS},
            verify_details = \$\$${BERICHT}\$\$::jsonb
          where label = '${LABEL}'" >/dev/null
  echo
  echo "WIEDERHERSTELLUNG VERIFIZIERT. backup_runs.verified_at ist gesetzt –"
  echo "diese Sicherung ist jetzt ein gültiger Nachweis für das §15-Tor."
  exit 0
fi

psql_q "update backup_runs set
          verify_method = '${VERIFY_METHOD}',
          restore_duration_ms = ${RESTORE_MS},
          verify_details = \$\$${BERICHT}\$\$::jsonb
        where label = '${LABEL}'" >/dev/null
echo
echo "WIEDERHERSTELLUNG NICHT VERIFIZIERT. verified_at bleibt LEER." >&2
exit 7
