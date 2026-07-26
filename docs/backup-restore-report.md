# Sicherungs- und Wiederherstellungsbericht (PROMPT -1 §14)

Datum: 2026-07-26. Branch `claude/driving-school-admin-tcz2cx`, Phase 4.
Verfasst vom **unabhängigen Release-Reviewer**, nicht von den Autoren der
Phasen 1–3.

**Alles unten ist AUSGEFÜHRT, nicht beschrieben.** Jede Zahl kommt aus einem
Lauf in dieser Sitzung gegen die lokale PostgreSQL-16.13-Instanz. Was
zusätzliche Infrastruktur braucht, steht in Abschnitt 7 und ist **nicht**
ausgeführt – dort steht keine Zahl.

---

## 1. Was tatsächlich lief – Übersicht

| # | Vorgang | Werkzeug | Ergebnis | Dauer |
|---|---|---|---|---|
| 1 | WAL-Archivierung einschalten | `conf.d/50-fahrschul-pitr.conf` + Cluster-Neustart | `archive_mode = on`, `archive_timeout = 60s`, bestätigt per `show` | – |
| 2 | Logische Sicherung, **verschlüsselt** | `scripts/backup.sh logical` | 614 kB, SHA-256 `bc03d52d…` | **298 ms** |
| 3 | Wiederherstellung in **isolierte** Datenbank + Integritätsprüfung | `scripts/restore-verify.sh` | **VERIFIZIERT**, 0 Befunde, 0 Zeilenabweichungen | **1518 ms** |
| 4 | Physische Basissicherung, **verschlüsselt** | `scripts/backup.sh physical` | 66 MB, SHA-256 `04fa9313…` | **2414 ms** |
| 5 | **PITR** in einen ZWEITEN Cluster auf eigenem Port | `scripts/restore-verify.sh --pitr` | **VERIFIZIERT**, Zielzeitpunkt exakt getroffen | **2171 ms** |
| 6 | WAL-Archiv protokollieren | `scripts/backup.sh wal` | 288 MB, 19 Segmente | 3 ms |
| 7 | §15-Tor „keine zerstörende Migration ohne Backup" | echter Migrationsläufer | 3× korrekt geblockt, 1× korrekt durchgelassen | – |

`backup_runs` nach diesen Läufen (echte Abfrage, nicht nachgetippt):

```
          label           |   kind   |   status    | verifiziert |    verify_method    | groesse | duration_ms | restore_duration_ms
--------------------------+----------+-------------+-------------+---------------------+---------+-------------+---------------------
 20260726-phase4-logical  | logical  | erfolgreich | t           | logical-isolated-db | 614 kB  |         298 |                1518
 20260726-phase4-physical | physical | erfolgreich | t           | pitr-cluster        | 66 MB   |        2414 |                2171
 20260726-phase4-wal      | wal      | erfolgreich | f           |                     | 288 MB  |           3 |
```

> Der WAL-Eintrag ist **absichtlich nicht** als verifiziert markiert: ein
> Verzeichnis archivierter Segmente ist für sich kein wiederherstellbares
> Artefakt. Sein Nachweis IST der PITR-Lauf (#5), der genau diese Segmente
> gelesen hat.

---

## 2. Verschlüsselung

| Eigenschaft | Wert |
|---|---|
| Verfahren | AES-256-CBC, PBKDF2 mit 200 000 Iterationen, Salt (`openssl enc`) |
| Schlüsselquelle | `$BACKUP_KEY_FILE` (Modus 0400) |
| Schlüsselkennung im Protokoll | `sha256:<erste 16 Zeichen>` – **nie der Schlüssel** |
| Klartext auf Platte | **nie**: `pg_dump | openssl enc > ziel` in einer Pipe |
| Prüfsumme | SHA-256 über das **verschlüsselte** Artefakt, in `backup_runs` |

**Bestätigt, nicht behauptet:** das Artefakt ist ohne den Schlüssel unlesbar,
und die Prüfsumme wird vor jeder Wiederherstellung geprüft – ein Artefakt mit
abweichender Prüfsumme wird **nicht** zurückgespielt (`restore-verify.sh`,
Schritt 0).

**Ehrliche Einschränkung.** Der Schlüssel liegt in dieser Umgebung als Datei
**neben** den Sicherungen. Für den Produktivbetrieb ist das nicht tragfähig: wer
die Sicherung stiehlt, stiehlt den Schlüssel mit. Er gehört in einen
Secret-Store, den es hier nicht gibt (`docs/integration-gaps.md`). Siehe
Abschnitt 7.

---

## 3. Der logische Wiederherstellungstest (Chaos-Szenario 15)

```
== Wiederherstellungstest für 20260726-phase4-logical (logical) ==
  [ok] SHA-256 stimmt (bc03d52db09f3f6f…)
  [ok] isolierte Zieldatenbank fahrschul_restore_1785056293 angelegt
  [ok] pg_restore ohne Fehler durchgelaufen
  [ok] Wiederherstellung in 1518 ms
  Migrationsstand/Tabellen: 10 0010_backup_and_deployment.sql 62
  Befunde:                  []
  Zeilenabweichungen:       []
  [ok] isolierte Umgebung wieder abgebaut

WIEDERHERSTELLUNG VERIFIZIERT.
```

### Warum das mehr ist als „pg_restore endete mit 0"

`pg_restore` kann erfolgreich sein und trotzdem eine **unbrauchbare** Datenbank
hinterlassen. `checkDatabaseIntegrity`
(`packages/database/src/integrity.ts`) prüft deshalb vier Ebenen:

| Ebene | Was ohne sie unentdeckt bliebe |
|---|---|
| **Migrationsstand** | Wiederherstellung eines ÄLTEREN Dumps – die Datenbank funktioniert, ist aber die falsche |
| **34 Pflichttabellen** | `--table=`-Teilmenge, abgebrochener Restore |
| **Constraints + Trigger, und ob sie AKTIV sind** | `--data-only`/`--disable-triggers` – Zeilen alle da, Invarianten weg |
| **6 referenzielle Prüfungen** | Restore ohne Constraints, danach reaktiviert |

Die geprüften Non-Negotiables sind namentlich benannt: die **beiden
GiST-EXCLUDE-Constraints** gegen Doppelbuchung (und ob sie wirklich
`contype = 'x'` sind, nicht ein gleichnamiger Unique-Index), der
Outbox-Trigger, die Append-only- und Hash-Kettentrigger des Audits, der
Versionstrigger und die Invariantentrigger FS001/FS005/FS009.

### Die Prüfung ist selbst getestet

Ein Prüfskript, das niemand nachrechnet, kann stillschweigend nichts prüfen.
`apps/api/src/__tests__/chaos.test.ts`, Szenario 15, weist nach, dass sie
**anschlägt**:

| Test | Beweist |
|---|---|
| „die Integritätsprüfung meldet für die aktuelle Datenbank `ok`" | keine Fehlalarme |
| „ERKENNT eine unvollständige Wiederherstellung (fehlender Migrationsstand)" | ein alter Dump fällt auf |
| „ERKENNT einen deaktivierten Invarianten-Trigger (`pg_restore --disable-triggers`)" | **kritischer** Befund, `ok = false` |
| „erkennt eine referenzielle Waise (Restore ohne Constraints)" | Waisen fallen auf |
| „`compareRowCounts` erkennt abweichende Zeilenzahlen" | Zeilenvergleich wirkt |
| „das Backup-Protokoll erzwingt einen Verifikationsnachweis" | `verified_at` ist nicht geschenkt |

---

## 4. Der PITR-Test – der eigentliche Nachweis

Aufbau: nach der Basissicherung wurden **zwei Marker** angelegt und der
Zielzeitpunkt dazwischen gelegt.

```
Marker A  angelegt 08:58:43.428157+00
ZIELZEIT             08:58:43.478747+00   <-- recovery_target_time
Marker B  angelegt 08:58:45.529711+00
```

Ergebnis im wiederhergestellten Cluster (Port 5433, eigener Datenbestand):

```sql
select name from organisationen where name like 'PITR-MARKER%';
-- PITR-MARKER-A          <-- vorhanden
-- (PITR-MARKER-B fehlt)  <-- korrekt NICHT nachgespielt
```

PostgreSQL-Wiederherstellungsprotokoll, wörtlich:

```
LOG:  consistent recovery state reached at 0/BA000100
LOG:  recovery stopping before commit of transaction 341315, time 2026-07-26 08:58:45.530354+00
LOG:  redo done at 0/BB000F00
LOG:  last completed transaction was at log time 2026-07-26 08:58:43.4289+00
LOG:  selected new timeline ID: 2
```

**Das ist der Nachweis, und er ist exakt:** die Wiederherstellung hielt
**vor** dem Commit von Marker B und **nach** Marker A. Abstand zwischen
Zielzeitpunkt und letzter übernommener Transaktion: **49,8 ms**. Das ist die
erreichte Genauigkeit einer Zeitpunkt-Wiederherstellung in dieser Umgebung.

Zusätzlich: die Integritätsprüfung im PITR-Cluster meldete **0 Befunde** – der
alte Stand ist strukturell vollständig, nicht nur „irgendwie lesbar".

### Ein Befund über die Prüflogik selbst

Der erste PITR-Lauf endete mit „NICHT VERIFIZIERT", weil der Zeilenvergleich
eine Abweichung fand (`organisationen: quelle 7, ziel 6`). Diese Abweichung war
**das gewünschte Ergebnis** – genau der nicht nachgespielte Marker B.

Die Bewertung war also falsch herum: sie hätte einen korrekten PITR-Lauf als
Fehlschlag gewertet und einen Lauf, der den Zielzeitpunkt **ignoriert** und
alles nachspielt, als Erfolg. Korrigiert: bei `--pitr` entscheidet die
**Struktur** über die Verifikation, die Zeilendifferenz wird als *erwartet*
protokolliert. Bei einer logischen Wiederherstellung bleibt Gleichheit
Pflicht. Der Unterschied steht als Begründung im Skript.

### Eine Eigenheit, die einen echten Ernstfall gekostet hätte

Der PITR-Cluster startete zunächst **nicht**:

```
postgres: could not access the server configuration file
          ".../restore/pitr-26438/postgresql.conf": No such file or directory
```

Auf Debian/Ubuntu liegen `postgresql.conf`, `pg_hba.conf` und `pg_ident.conf`
unter `/etc/postgresql/<ver>/<cluster>/` und damit **nicht** im
Datenverzeichnis – eine Basissicherung enthält sie folglich nicht. `restore-verify.sh`
kopiert sie jetzt und kommentiert dabei `include_dir`, `data_directory`,
`hba_file`, `ident_file` und `external_pid_file` aus. Das `include_dir` ist der
wichtigste Teil: sonst würde der Wiederherstellungscluster die
`archive_command`-Zeile erben und in **dasselbe WAL-Archiv schreiben**, aus dem
er gerade liest.

Genau das ist der Wert eines ausgeführten Wiederherstellungstests: dieser
Stolperstein wäre in einer Doku nie aufgefallen und hätte im Ernstfall Minuten
oder Stunden gekostet.

---

## 5. RPO und RTO – getrennt für Pilot und Produktion

§14 verlangt beides getrennt. Die Pilotzahlen sind **gemessen**, die
Produktionszahlen sind **Ziele** unter Voraussetzungen, die hier fehlen.

### RPO (maximal tolerierter Datenverlust)

| | Pilot (ein Standort, ein Server) | Produktion (Ziel) |
|---|---|---|
| **RPO-Zusage** | **≤ 5 Minuten** | **≤ 1 Minute** |
| Mechanismus | WAL-Archiv, `archive_timeout = 60s` | zusätzlich synchrone Replikation zu einem Standby |
| **gemessen** | Zielgenauigkeit **49,8 ms**, Archivintervall 60 s | – |
| Worst Case | letzte, noch nicht archivierte Minute | Verlust nur bei gleichzeitigem Ausfall beider Standorte |
| Ohne WAL-Archiv (nur tägliche logische Sicherung) | **bis 24 h** | – |
| **Was fehlt** | Archiv liegt auf DERSELBEN Platte wie die Datenbank | Offsite-Ziel + Standby ([Abschnitt 7](#abschnitt-7)) |

Warum Pilot 5 und nicht 1 Minute: mit dem Archiv auf derselben Maschine ist die
Minutengenauigkeit gegen **Datenfehler** echt, gegen **Maschinenverlust** aber
null. Eine „≤ 1 Minute"-Zusage wäre in diesem Aufbau eine Behauptung. 5 Minuten
ist der Wert, der auch eine kurze Archivstörung überlebt.

### RTO (maximal tolerierte Ausfalldauer)

| | Pilot | Produktion (Ziel) |
|---|---|---|
| **RTO-Zusage** | **≤ 4 Stunden** | **≤ 30 Minuten** |
| **gemessene technische Anteile** | logisch **1,5 s** · PITR **2,2 s** (16 MB) | – |
| Prozessanteile (Schätzung, **nicht** gemessen) | Erkennen 15 min · Entscheiden 30 min · Ausführen < 5 min · Prüfen 30 min · fachliche Abnahme 60 min | Automatik übernimmt Erkennen + Umschalten |
| Skalierung | die gemessene Zeit gilt für 16 MB; bei 10 GB ist mit ~10–20 Min. für den logischen Restore zu rechnen (**extrapoliert, nicht gemessen**) | dito |
| **Was fehlt** | kein Standby, kein Failover, keine Automatik – jeder Schritt ist manuell | Standby + Failover-Automatik + geübter Ablauf |

**Die technische Wiederherstellung ist NICHT der Engpass.** Sie dauerte
Sekunden. Die 4 Stunden bestehen fast vollständig aus Entscheiden, Prüfen und
fachlicher Abnahme – und aus dem Umstand, dass niemand diesen Ablauf je geübt
hat. Das ist die ehrliche Begründung für die Zahl, und sie ist der Grund,
warum sie ohne eine Übung nicht kleiner werden darf.

---

## 6. §14-Anforderungen: Punkt für Punkt

| §14-Anforderung | Status | Nachweis |
|---|---|---|
| Verschlüsselte automatische Sicherungen | **teilweise** | Verschlüsselung **ausgeführt** (AES-256, Abschnitt 2); „automatisch" braucht den Cron-/systemd-Eintrag → `docs/recovery-runbook.md` Abschnitt 9. Der **Scheduler** für die Anwendungsjobs ist verdrahtet (§15), die Sicherung selbst ist ein Betriebsteil und kein Anwendungsjob. |
| Zeitpunkt-Wiederherstellung (PITR) | **ausgeführt** | Abschnitt 4, Genauigkeit 49,8 ms |
| Getrennter Speicherort | **NICHT erfüllt** | `/var/backups/fahrschul` liegt auf derselben Maschine. Abschnitt 7. |
| **Wiederherstellungstest in isolierter Umgebung** | **ausgeführt, 2×** | Abschnitt 3 (isolierte DB) + Abschnitt 4 (zweiter Cluster, eigener Port) |
| Expand-Contract-Migrationen | **verifiziert** | Wächter über **alle** Migrationen ab 0007 (`deployment.test.ts`); Phase 3 prüfte nur 0009 |
| Datenintegritätsprüfungen | **ausgeführt + getestet** | `checkDatabaseIntegrity`, 4 Ebenen, 6 Tests |
| Verbindungspooling | **teilweise** | `postgres.js`-Pool je Prozess; PgBouncer ist Abschnitt 7 |
| Zeitlimits | **gesetzt** | `statement_timeout = 60s`, `lock_timeout = 15s`, `idle_in_transaction_session_timeout = 120s` – auf der **Anwendungsrolle**, damit Migrationen und `pg_dump` nicht getroffen werden |
| Überwachung von Locks und langsamen Abfragen | **gesetzt** | `log_min_duration_statement = 500ms`, `log_lock_waits`, `deadlock_timeout = 1s`, `log_checkpoints`, `track_io_timing`; Abfragen im Runbook Abschnitt 10 |
| Hochverfügbarkeit / Failover | **NICHT erfüllt** | kein Standby, kein Failover. Abschnitt 7. |
| RPO/RTO dokumentiert | **erfüllt** | Abschnitt 5, getrennt für Pilot und Produktion |

---

## <a id="abschnitt-7"></a>7. Was NICHT ausgeführt ist – und warum

Kein Punkt hier hat eine Zahl, weil keiner gelaufen ist.

1. **Kein getrennter Speicherort.** Alles liegt unter `/var/backups/fahrschul`
   auf derselben Maschine wie die Datenbank. Das schützt gegen Datenfehler und
   Fehlbedienung, **nicht** gegen den Verlust der Maschine. Es gibt in dieser
   Umgebung keinen Objektspeicher und keinen zweiten Host.
   **Vor Go-Live zwingend.**
2. **Kein Secret-Store.** Der Sicherungsschlüssel ist eine Datei (Modus 0400)
   **neben** den Sicherungen. Wer die Sicherung stiehlt, stiehlt den Schlüssel.
   **Vor Go-Live zwingend.**
3. **Keine Replikation, kein Failover.** `wal_level = replica` und
   `max_wal_senders = 10` sind gesetzt, ein Streaming-Standby ist damit
   *vorbereitet* – aber nicht eingerichtet und nicht erprobt. Die Datenbank ist
   ein Single Point of Failure.
4. **Kein automatischer Sicherungsplan.** Die Skripte laufen von Hand. Der
   Zeitplan aus dem Runbook (täglich/wöchentlich/fortlaufend) ist eine Vorgabe,
   kein aktiver Eintrag.
5. **Kein Test gegen Produktionsdatenmengen.** 16 MB. Die Zeiten aus
   Abschnitt 1 sind für diese Größe gemessen; die Extrapolation auf 10 GB in
   Abschnitt 5 ist eine Rechnung, keine Messung.
6. **Kein Aufbewahrungs-/Löschlauf.** `pg_archivecleanup` ist nicht
   eingerichtet; das WAL-Archiv wuchs in dieser Sitzung auf 288 MB und würde
   unbegrenzt weiterwachsen.
7. **Kein Test mit echten personenbezogenen Daten** und keine DSGVO-Prüfung
   der Aufbewahrung (30 Tage/4 Wochen sind gesetzt, aber fachlich nicht
   abgenommen).

---

## 8. Reproduktion

```bash
# Voraussetzung einmalig: WAL-Archivierung
sudo cp docs/../etc/50-fahrschul-pitr.conf /etc/postgresql/16/main/conf.d/   # Inhalt: Runbook Abschnitt 6.3
sudo pg_ctlcluster 16 main restart

export DATABASE_URL=postgres://fahrschul:…@localhost:5432/fahrschul_dev
export BACKUP_KEY_FILE=/var/backups/fahrschul/backup.key

BACKUP_LABEL=$(date -u +%Y%m%dT%H%M%SZ)-logical scripts/backup.sh logical
scripts/restore-verify.sh <label>

BACKUP_LABEL=$(date -u +%Y%m%dT%H%M%SZ)-physical scripts/backup.sh physical
scripts/restore-verify.sh <label> --pitr '<ISO-Zeitpunkt>'
```

Der Integritätsbericht je Lauf liegt als JSON unter
`/var/backups/fahrschul/restore/<label>.verify.json` und in
`backup_runs.verify_details`.

---

## 9. Das §15-Tor: ausgeführt, nicht beschrieben

Gegen den **echten** Migrationsläufer mit einer temporären Sondendatei
(danach entfernt, `schema_migrations` zurückgesetzt):

| Lauf | Umgebung | Ergebnis |
|---|---|---|
| 1 | ohne alles | `DestructiveMigrationBlocked`, `reason: 'no_approval'` |
| 2 | `MIGRATION_APPROVED_BY` gesetzt | `reason: 'no_backup_ref'` |
| 3 | + `MIGRATION_BACKUP_REF` auf ein **unverifiziertes** Backup | `reason: 'backup_not_verified'` |
| 4 | + Backup mit `verified_at` | `Angewendete Migrationen: 9999_gate_probe.sql` |

Erkannt wird `drop table`, `drop column`, `drop schema`, `drop database`,
`rename column`, `rename to`, `alter column … type`, `set not null`,
`truncate` – nicht erkannt (bewusst) `drop trigger`/`drop function` mit
anschließendem `create` und `drop index if exists`, weil das der normale Weg
ist, eine Definition zu ersetzen, und weil ein Index keine Daten trägt.
Muster in Kommentaren zählen nicht (getestet).

**Das betrifft konkret die CONTRACT-Phase**: das Entfernen der
Alt-Statusspalten (§10) wartet auf genau dieses Tor und ist noch nicht
geschrieben.
