#!/usr/bin/env bash
#
# PROMPT -1 §14 (Phase 4) – Verschlüsselte, protokollierte Sicherung.
#
# ## Was dieses Skript tut
#
#   1. `pg_dump` (logisch, Custom-Format) ODER `pg_basebackup` (physisch, PITR)
#   2. Verschlüsselung mit AES-256 (OpenSSL, Schlüssel aus einer Datei)
#   3. SHA-256-Prüfsumme über das VERSCHLÜSSELTE Artefakt
#   4. Eintrag in `backup_runs` – mit `verified_at = NULL`
#
# ## Warum Punkt 4 der wichtigste ist
#
# `verified_at` bleibt LEER. Eine Sicherung, die nie zurückgespielt wurde, ist
# keine Sicherung, sondern eine Hoffnung. Erst `scripts/restore-verify.sh` setzt
# dieses Feld – und erst dann öffnet das §15-Tor für eine zerstörende Migration
# (siehe `packages/database/src/migrate.ts`, `assertDestructiveAllowed`).
#
# ## Warum die Verschlüsselung SYMMETRISCH und nicht GPG ist
#
# GPG bräuchte einen Schlüsselbund im Betriebskonto – ein zusätzliches
# Geheimnis-Verwaltungsproblem für ein Skript, das ohnehin Zugang zur Datenbank
# hat. `openssl enc -aes-256-cbc -pbkdf2` mit einem Schlüssel aus einer Datei mit
# Modus 0400 ist hier die kleinere Angriffsfläche. Der Schlüssel selbst gehört
# im Produktivbetrieb in einen Secret-Store (der in dieser Umgebung fehlt,
# siehe docs/integration-gaps.md) – das Skript liest ihn aus
# `$BACKUP_KEY_FILE`, damit dieser Wechsel eine Konfigurationsänderung ist und
# keine Codeänderung.
#
# ## Benutzung
#
#   BACKUP_KEY_FILE=/etc/fahrschul/backup.key \
#   DATABASE_URL=postgres://... \
#     scripts/backup.sh logical            # pg_dump, portabel
#     scripts/backup.sh physical           # pg_basebackup, Grundlage für PITR
#
set -euo pipefail

KIND="${1:-logical}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/fahrschul}"
KEY_FILE="${BACKUP_KEY_FILE:-${BACKUP_ROOT}/backup.key}"
LABEL="${BACKUP_LABEL:-$(date -u +%Y%m%dT%H%M%SZ)-${KIND}}"
DEPLOYMENT_ID="${DEPLOYMENT_ID:-manuell}"
AUSGELOEST_VON="${AUSGELOEST_VON:-$(whoami)}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FEHLER: DATABASE_URL ist nicht gesetzt." >&2
  exit 2
fi

# Der Schlüssel wird NICHT vom Skript erzeugt, wenn er fehlt – ein automatisch
# erzeugter Schlüssel, den niemand gesichert hat, macht die Sicherung
# unlesbar und das Problem unsichtbar. Ausnahme: ausdrücklich verlangt.
if [[ ! -f "$KEY_FILE" ]]; then
  if [[ "${BACKUP_ALLOW_KEY_INIT:-0}" == "1" ]]; then
    mkdir -p "$(dirname "$KEY_FILE")"
    openssl rand -base64 48 > "$KEY_FILE"
    chmod 400 "$KEY_FILE"
    echo "HINWEIS: neuer Sicherungsschlüssel in $KEY_FILE erzeugt. SOFORT in den Secret-Store übernehmen." >&2
  else
    echo "FEHLER: Sicherungsschlüssel $KEY_FILE fehlt. Ohne ihn wird nicht unverschlüsselt gesichert." >&2
    echo "        (BACKUP_ALLOW_KEY_INIT=1 erzeugt einen neuen – nur für die Ersteinrichtung.)" >&2
    exit 3
  fi
fi
KEY_ID="sha256:$(sha256sum "$KEY_FILE" | cut -c1-16)"

mkdir -p "$BACKUP_ROOT/logical" "$BACKUP_ROOT/base" "$BACKUP_ROOT/wal"

# `head -n 1`: psql gibt bei `insert … returning` NACH der Zeile noch den
# Kommandostempel („INSERT 0 1") aus. Ohne diese Begrenzung landet er in der
# Variablen und danach in der nächsten Abfrage.
psql_q() { psql "$DATABASE_URL" -tAX -c "$1" | head -n 1; }

# Konsistenzpunkt VOR dem Lauf festhalten: das ist der Zeitpunkt, auf den eine
# Wiederherstellung führt, und damit die Grundlage der RPO-Aussage.
CONSISTENT_AT="$(psql_q 'select now()')"
WAL_LSN="$(psql_q 'select pg_current_wal_lsn()')"

# Der Eintrag entsteht VOR dem Lauf (Status `laufend`). Ein abgebrochener Lauf
# hinterlässt damit eine SICHTBARE Spur statt gar keine – genau derselbe
# Gedanke wie bei `integration_outbound_calls` (§11).
BACKUP_ID="$(psql_q "insert into backup_runs
  (label, kind, location, encryption, key_id, consistent_at, wal_lsn, status, ausgeloest_von, deployment_id)
  values ('${LABEL}', '${KIND}', 'pending', 'aes-256-cbc/pbkdf2', '${KEY_ID}',
          '${CONSISTENT_AT}', '${WAL_LSN}', 'laufend', '${AUSGELOEST_VON}', '${DEPLOYMENT_ID}')
  returning id")"

START_MS=$(date +%s%3N)
fail() {
  local msg="$1"
  psql_q "update backup_runs set status='fehlgeschlagen', finished_at=now(),
          error=\$\$${msg}\$\$ where id='${BACKUP_ID}'" >/dev/null || true
  echo "FEHLER: $msg" >&2
  exit 1
}
trap 'fail "Abbruch in Zeile $LINENO"' ERR

case "$KIND" in
  logical)
    TARGET="$BACKUP_ROOT/logical/${LABEL}.dump.enc"
    # -Fc: Custom-Format (komprimiert, selektiv wiederherstellbar).
    # Die Verschlüsselung läuft in der PIPE – der Klartext-Dump berührt die
    # Platte nie.
    pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" \
      > "$TARGET" || fail "pg_dump/openssl fehlgeschlagen"
    ;;
  physical)
    # pg_basebackup braucht Dateisystemzugriff und läuft deshalb als
    # Betriebssystemnutzer `postgres`. Ergebnis ist ein TAR-Strom, den wir
    # ebenfalls in der Pipe verschlüsseln.
    TARGET="$BACKUP_ROOT/base/${LABEL}.tar.enc"
    RAW="$BACKUP_ROOT/base/${LABEL}.raw"
    su postgres -c "pg_basebackup -D - -Ft -X none -c fast" > "$RAW" || fail "pg_basebackup fehlgeschlagen"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" \
      -in "$RAW" -out "$TARGET" || fail "Verschlüsselung fehlgeschlagen"
    rm -f "$RAW"
    ;;
  wal)
    # Die archivierten Segmente sind bereits Dateien; hier wird nur ihr Zustand
    # protokolliert. Sie sind NICHT einzeln verschlüsselt – im Produktivbetrieb
    # gehört das Archivziel auf ein verschlüsseltes Volume bzw. hinter ein
    # `archive_command`, das selbst verschlüsselt (siehe docs/recovery-runbook.md).
    TARGET="$BACKUP_ROOT/wal"
    ;;
  *)
    fail "Unbekannte Sicherungsart '${KIND}' (erlaubt: logical|physical|wal)"
    ;;
esac

END_MS=$(date +%s%3N)
DURATION=$((END_MS - START_MS))

if [[ "$KIND" == "wal" ]]; then
  SIZE=$(du -sb "$TARGET" | cut -f1)
  CHECKSUM="n/a (Verzeichnis)"
else
  SIZE=$(stat -c%s "$TARGET")
  CHECKSUM=$(sha256sum "$TARGET" | cut -d' ' -f1)
fi

trap - ERR
psql_q "update backup_runs set
          location   = \$\$${TARGET}\$\$,
          size_bytes = ${SIZE},
          checksum_sha256 = '${CHECKSUM}',
          finished_at = now(),
          duration_ms = ${DURATION},
          status = 'erfolgreich'
        where id = '${BACKUP_ID}'" >/dev/null

cat <<EOF
Sicherung erfolgreich.
  label       : ${LABEL}
  art         : ${KIND}
  ziel        : ${TARGET}
  groesse     : ${SIZE} Bytes
  sha256      : ${CHECKSUM}
  konsistent  : ${CONSISTENT_AT}
  wal_lsn     : ${WAL_LSN}
  dauer       : ${DURATION} ms
  verified_at : NULL  <-- noch KEIN Nachweis. scripts/restore-verify.sh ausfuehren.
EOF
