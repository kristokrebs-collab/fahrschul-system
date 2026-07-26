# Wiederanlauf- und Wiederherstellungshandbuch (PROMPT -1 §14 + §15)

Stand: Phase 4. Branch `claude/driving-school-admin-tcz2cx`.

Dieses Dokument ist für den **Ernstfall** geschrieben, nicht zum Lesen davor:
kurze Schritte, exakte Befehle, klare Abbruchbedingungen. Was *warum* so gebaut
ist, steht in `docs/sync-architecture.md`, `docs/failure-modes.md` und
`docs/security-architecture.md`. Was tatsächlich **ausgeführt und gemessen**
wurde, steht in `docs/backup-restore-report.md` und `docs/chaos-test-report.md`.

**Ehrlichkeitshinweis vorweg.** Es gibt für dieses System noch keinen
Produktivbetrieb. Jeder Befehl unten ist in dieser Sandbox gegen eine echte
PostgreSQL-16-Instanz gelaufen (Nachweis: `docs/backup-restore-report.md`), aber
kein Schritt ist je gegen echte Infrastruktur mit echten Nutzerdaten gelaufen.
Alles, was zusätzliche Infrastruktur braucht (zweiter Host, Objektspeicher,
Secret-Store, Orchestrator), ist als **[BRAUCHT INFRASTRUKTUR]** markiert und
ausdrücklich **nicht** erprobt.

---

## 0. Die erste Entscheidung: welcher Fall liegt vor?

| Beobachtung | Fall | Abschnitt |
|---|---|---|
| `GET /health/live` antwortet nicht | Prozess tot | [1](#p1) |
| `/health/live` 200, `/health/ready` 503, Grund `datenbank_nicht_erreichbar` | Datenbank weg | [2](#p2) |
| `/health/ready` 503, Grund `migrationen_ausstehend` | Rollout unvollständig | [3](#p3) |
| `/health/deep` 200, Status `eingeschraenkt` | externe Schnittstelle | `docs/failure-modes.md` |
| Warteschlangen wachsen, nichts wird zugestellt | Scheduler steht | [4](#runbook-scheduler-steht) |
| Daten fehlen oder sind falsch, Ursache unklar | **erst §19-Befund prüfen, nicht wiederherstellen** | [5](#p5) |
| Daten sind nachweislich zerstört/gelöscht | Wiederherstellung | [6](#p6) |

> **Die wichtigste Regel dieses Dokuments:** eine Wiederherstellung ist der
> **letzte** Schritt, nicht der erste. Sie verwirft alles, was nach dem
> Konsistenzpunkt passiert ist. Bei Unklarheit gilt Abschnitt 5 (befunden),
> nicht Abschnitt 6 (wiederherstellen).

---

## <a id="p1"></a>1. Prozess tot

1. `GET /health/live` – keine Antwort ⇒ Prozess neu starten.
2. Nach dem Start: `GET /health/ready` **muss** 200 liefern. Tut es das nicht,
   weiter mit Abschnitt 2 oder 3 – **nicht** in einer Neustartschleife lassen.
3. `GET /ops/scheduler` prüfen: fährt irgendein Prozess einen Takt? Wenn
   `aktiv: false` **und** kein getrennter Worker läuft, Abschnitt 4.

**Kein Datenverlust erwartbar.** Jeder Fachvorgang ist committet oder gar nicht
passiert (§2/§5). Offene Vorgänge lösen die Clients über
`GET /sync/operations/:operation/:key` auf – sie wiederholen nicht blind.

---

## <a id="p2"></a>2. Datenbank nicht erreichbar

**Nicht** die Anwendungsinstanzen neu starten. `GET /health/live` bleibt
absichtlich 200, damit ein Orchestrator sie **nicht** tötet – eine
Neustartwelle würde die zurückkommende Datenbank mit Kaltstarts überfahren.

1. Instanzen aus dem Loadbalancer nehmen (das tut `/health/ready` = 503 von
   selbst).
2. Datenbank prüfen: `pg_isready`, Log (`/var/log/postgresql/`), Plattenplatz
   (`df -h`), Verbindungsanzahl:
   ```sql
   select count(*), state from pg_stat_activity group by state;
   select * from pg_stat_activity where wait_event_type = 'Lock';
   ```
3. Datenbank zurück ⇒ `GET /health/ready` wird von selbst 200. Nichts weiter zu
   tun: die Clients zeigen währenddessen ihren letzten Stand **mit Altersangabe**
   und verweigern kritische Schreibvorgänge (§8, fail closed).
4. Danach **einmal** prüfen, ob etwas hängen geblieben ist:
   ```
   GET /ops/outbox          # viele `in_flight` mit abgelaufenem Lease?
   GET /ops/jobs?status=in_progress
   POST /ops/workers/run    # einen Durchlauf von Hand treiben
   ```

**Wenn die Datenbank nicht zurückkommt:** Abschnitt 6.

---

## <a id="p3"></a>3. Bereitschaft meldet `migrationen_ausstehend`

Die Instanz trägt ein Artefakt, dessen Schema noch nicht angewendet ist. Das ist
**kein Fehler**, sondern die gewollte Reihenfolge: erst Migration (expand), dann
Instanzen.

```bash
pnpm --filter @fahrschul/database migrate
```

Danach wird `/health/ready` ohne Zutun 200.

**Ist die Migration zerstörend**, wird der Läufer sie **verweigern** – siehe
Abschnitt 7. Das ist beabsichtigt.

---

## <a id="runbook-scheduler-steht"></a>4. Scheduler steht (Alarm `scheduler_stalled`)

Der gefährlichste Zustand, weil er **still** ist: alle anderen Alarme setzen
voraus, dass wiederkehrende Jobs laufen. Steht der Takt, schweigen sie
fälschlich – eine leere Dead-Letter-Queue bedeutet dann nicht „alles gut",
sondern „es wurde nie zugestellt".

### Erkennung

| Signal | Bedeutung |
|---|---|
| `GET /ops/scheduler` → `aktiv: false`, `konfiguriert: false` | dieser Prozess fährt bewusst keinen Takt. **Fährt ein anderer?** |
| `aktiv: true`, aber `takte.arbeit.alterSekunden` > 60 | der Takt hängt (nicht: fehlt) |
| `aufeinanderfolgendeFehler` ≥ 5 | Alarm `scheduler_stalled` ist gefeuert |
| `fahrschul_scheduler_last_tick_age_seconds` steigt monoton | dito, aus Prometheus |
| `fahrschul_outbox_depth{status="pending"}` steigt monoton | Folge, nicht Ursache |

### Sofortmaßnahme (überbrückt, behebt nicht)

```bash
curl -X POST $API/ops/jobs/schedule-recurring -b "$COOKIE" -H 'x-csrf-token: …'
curl -X POST $API/ops/workers/run            -b "$COOKIE" -H 'x-csrf-token: …'
```

Beides ist idempotent und darf beliebig oft laufen. Danach sinkt
`fahrschul_outbox_depth`.

### Ursache beheben

1. **Läuft überhaupt ein Prozess mit Takt?** Genau einer soll es sein:
   * Pilot: der API-Prozess selbst mit `RUN_WORKERS=1`.
   * Mehrinstanzbetrieb: der getrennte Worker
     (`pnpm --filter @fahrschul/api start:worker`).
   Läuft **keiner**, ist das die Ursache – und sie ist eine
   Konfigurations-, keine Codefrage.
2. **`letzterFehler` in `GET /ops/scheduler` lesen.** Ein
   Datenbankverbindungsfehler ⇒ Abschnitt 2. Alles andere ⇒ Log nach
   `operation: "scheduler.work"` / `"scheduler.schedule"` filtern.
3. Der Scheduler **stirbt nicht** an einem Fehler (jeder Takt ist einzeln
   umschlossen). Ein Prozess, der weder tickt noch Fehler meldet, ist tot ⇒
   Abschnitt 1.

**Eskalation:** sofort an die Geschäftsführung, weil dieser Alarm die übrigen
Alarme entwertet. **Kein Datenverlust:** die Outbox ist die Zustellseite, nicht
die Wahrheit (§5); alles Fachliche ist committet.

### Betriebseinheiten [BRAUCHT INFRASTRUKTUR]

Drei Wege, alle gleichwertig; **genau einer** soll aktiv sein.

**(a) Im API-Prozess (Pilot):**
```
RUN_WORKERS=1
WORKER_INTERVAL_MS=5000
SCHEDULER_INTERVAL_MS=60000
```

**(b) Getrennter Worker (Mehrinstanzbetrieb), systemd:**
```ini
[Unit]
Description=Fahrschule Krebs – Worker (PROMPT -1 §13/§15)
After=network-online.target

[Service]
Type=simple
User=fahrschul
WorkingDirectory=/opt/fahrschul
EnvironmentFile=/etc/fahrschul/api.env
# RUN_WORKERS wird hier NICHT gebraucht: worker.js startet den Takt immer.
ExecStart=/usr/bin/node dist/worker.js
Restart=always
RestartSec=5
# Der Takt ist der Herzschlag des Systems – ein stiller Tod ist der schlimmste
# Fall, deshalb aggressiver Neustart und Watchdog über die Logzeile
# `operation: "scheduler.work"`.

[Install]
WantedBy=multi-user.target
```

**(c) Cron (kleinste Variante, ohne Worker-Prozess):**
```cron
# Arbeitstakt jede Minute, Einplanung alle 5 Minuten. Gröber als (a)/(b) –
# die Sync-Verzögerung steigt dann auf bis zu 60 s (siehe docs/slo-dashboard.md).
* * * * *  curl -sf -X POST http://127.0.0.1:4000/ops/workers/run -H "Authorization: …" >/dev/null
*/5 * * * * curl -sf -X POST http://127.0.0.1:4000/ops/jobs/schedule-recurring -H "Authorization: …" >/dev/null
```
> Achtung bei (c): die `/ops/*`-Routen verlangen eine **Sitzung** mit
> `ops:jobs:manage`, kein Bearer-Token. Für einen Cron-Aufruf braucht es
> deshalb entweder ein Dienstkonto mit gespeichertem Cookie oder – besser –
> Variante (a)/(b). (c) ist der Notnagel, nicht die Empfehlung.

---

## <a id="p5"></a>5. Daten sehen falsch aus, Ursache unklar

**Nicht wiederherstellen.** Zuerst befunden:

1. `POST /ops/consistency/run`, dann `GET /ops/consistency/runs/:id`. Elf
   Prüfungen, jede mit Befund, Schweregrad und Vorschlag (§19).
2. `POST /ops/audit/verify` – ist die Hash-Kette des Audit-Logs intakt? Ein
   Befund hier bedeutet **Manipulationsverdacht**, nicht Datenverlust:
   `docs/security-architecture.md`, Abschnitt 8.
3. `GET /ops/dead-letters` – blockiert ein Ereignis die Zustellung?
4. Korrektur **ausschließlich über die regulären Endpunkte** (auditiert,
   versioniert). Nie per Roh-SQL: die Invarianten FS001–FS009 und die
   Versionstrigger sind der Grund, warum die Daten überhaupt konsistent sind.

**Riskante Reparaturvorschläge werden NIE automatisch angewendet** – es gibt
keinen Endpunkt dafür (Phase-1-Zusage, testgesichert).

---

## <a id="p6"></a>6. Wiederherstellung

### 6.0 Vorher: die drei Fragen

| Frage | Warum sie zuerst kommt |
|---|---|
| **Auf welchen Zeitpunkt?** | Alles danach ist verloren. Der Zeitpunkt bestimmt den Schaden. |
| **Reicht ein Teil?** | Eine einzelne gelöschte Tabelle stellt man aus einem logischen Dump in eine **Nebendatenbank** wieder her und kopiert die Zeilen – nicht durch Zurückrollen des Ganzen. |
| **Wer entscheidet?** | Geschäftsführung. Eine Wiederherstellung verwirft Arbeitszeit von Menschen. |

### 6.1 Welche Sicherungen gibt es?

```sql
select label, kind, status, verified_at, consistent_at,
       pg_size_pretty(size_bytes) as groesse, restore_duration_ms
  from backup_runs
 where status = 'erfolgreich'
 order by started_at desc limit 20;
```

**Nur `verified_at is not null` zählt.** Alles andere ist eine Datei, von der
niemand weiß, ob sie sich zurückspielen lässt.

### 6.2 Logische Wiederherstellung in eine isolierte Datenbank (der Normalfall)

Der Weg für „einzelne Tabelle/Zeilen zurückholen" **und** für jeden
Wiederherstellungstest. Er berührt die laufende Datenbank nicht.

```bash
export DATABASE_URL=postgres://…
export BACKUP_KEY_FILE=/etc/fahrschul/backup.key
scripts/restore-verify.sh <label>
```

Das Skript: Prüfsumme → entschlüsseln → `pg_restore` in eine **neue** Datenbank
→ `checkDatabaseIntegrity` (Migrationsstand, Tabellen, Constraints, Trigger,
referenzielle Waisen) → Zeilenvergleich → Aufräumen → bei Erfolg
`backup_runs.verified_at` setzen.

**Wichtig:** `pg_restore` läuft ohne `--disable-triggers`. Genau das würde die
Invarianten aushebeln – und die Integritätsprüfung meldet einen deaktivierten
Trigger als **kritischen** Befund (getestet, Szenario 15).

### 6.3 Zeitpunkt-Wiederherstellung (PITR)

Für „die Datenbank ist zerstört" oder „ein fehlerhafter Massenschreibvorgang um
14:03".

```bash
scripts/restore-verify.sh <physisches-label> --pitr '2026-07-26 14:02:00+00'
```

Startet aus der Basissicherung einen **zweiten** Cluster auf einem eigenen Port,
spielt die archivierten WAL-Segmente bis zum Zielzeitpunkt nach und prüft
dieselbe Integrität.

Voraussetzungen (in `/etc/postgresql/16/main/conf.d/50-fahrschul-pitr.conf`):
```
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/backups/fahrschul/wal/%f && cp %p /var/backups/fahrschul/wal/%f'
archive_timeout = 60s
```

Der **RPO** hängt genau an diesen zwei Zeilen: `archive_timeout = 60s` heißt, im
schlechtesten Fall ist die letzte Minute Schreibarbeit nicht archiviert.

**Übernahme in den Produktivbetrieb [BRAUCHT INFRASTRUKTUR]:** der
wiederhergestellte Cluster wird zum neuen Primär, indem `DATABASE_URL` auf ihn
zeigt. Zuvor **zwingend**: alte Instanzen stoppen (kein Zwei-Schreiber-Betrieb),
`GET /health/ready` auf dem neuen Ziel prüfen, `POST /ops/consistency/run` laufen
lassen, `POST /ops/audit/verify` prüfen.

### 6.4 Nach jeder Wiederherstellung – die Pflichtliste

1. `GET /health/ready` → 200.
2. `POST /ops/consistency/run` → Befunde bewerten. **Erwartbar** sind
   `bestaetigtes_angebot_ohne_termin` und `unverarbeitete_ereignisse`: der
   Zeitpunkt kann mitten in einem Mehrschrittvorgang liegen.
3. `POST /ops/audit/verify` → Kette intakt? Ein Bruch **an der Schnittstelle**
   des Wiederherstellungszeitpunkts ist erklärbar, ein Bruch mitten in der
   Historie nicht.
4. `POST /ops/workers/run` – die Outbox nachholen lassen.
5. **Die Clients:** ein Cursor, der neuer ist als der Serverstand (genau der
   Fall nach PITR), führt zu `resyncRequired: 'cursor_ahead_of_server'` →
   Vollsynchronisation. Kein Datenverlust auf der Clientseite, kein Zutun nötig.
   Getestet (`packages/sync`: „ein Cursor VOR dem Serverstand (z. B. nach
   Restore) führt zur Vollsynchronisation").
6. **Sitzungen:** wiederhergestellte `sessions`-Zeilen sind gültig, wenn sie
   nicht abgelaufen sind. Bei Manipulationsverdacht `POST /auth/logout-all` je
   betroffenem Konto.
7. Fachliche Abnahme durch das Büro, **bevor** wieder Verkehr auf die Instanz
   gelassen wird.

---

## 7. Zerstörende Migration (das §15-Tor)

Der Migrationsläufer **verweigert** eine Migration mit `drop table`,
`drop column`, `rename column`, `alter column … type`, `set not null` oder
`truncate`, solange nicht **beides** vorliegt:

| Voraussetzung | Umgebungsvariable | Geprüft gegen |
|---|---|---|
| Freigabe einer Person | `MIGRATION_APPROVED_BY` | nur Vorhandensein |
| **Verifiziertes** Backup | `MIGRATION_BACKUP_REF` | `backup_runs.label` **mit** `verified_at` |

Ablauf:

```bash
# 1. Sicherung erzeugen
BACKUP_LABEL=vor-contract-0011 scripts/backup.sh logical
# 2. Sicherung BEWEISEN (setzt verified_at)
scripts/restore-verify.sh vor-contract-0011
# 3. erst jetzt migrieren
MIGRATION_APPROVED_BY="M. Krebs (GF)" \
MIGRATION_BACKUP_REF=vor-contract-0011 \
  pnpm --filter @fahrschul/database migrate
```

Ein *behauptetes* Backup genügt nicht: fehlt der `backup_runs`-Eintrag oder ist
`verified_at` leer, bricht der Läufer mit `backup_not_found` bzw.
`backup_not_verified` ab. Eine per Hand als „verifiziert" markierte
**fehlgeschlagene** Sicherung verhindert zusätzlich eine CHECK-Constraint in der
Datenbank.

> **Konkret offen: die CONTRACT-Phase.** Phase 1 hat die Alt-Statusspalten
> (`terminangebote.status`, `dokumente.status`, `banktransaktionen.status`,
> `fahrzeugmaengel.status`) absichtlich **stehen gelassen**, weil vier Frontends
> sie lesen. Ihr Entfernen ist die erste zerstörende Migration dieses Projekts
> und wartet genau auf dieses Tor. Sie ist **nicht** geschrieben – und darf erst
> geschrieben werden, wenn kein Leser mehr existiert.

---

## 8. Deployment (§15)

### 8.1 Reihenfolge – nicht verhandelbar

```
1. Staging: identische Migration, identisches Artefakt, Smoke-Test        [BRAUCHT INFRASTRUKTUR]
2. Sicherung + Verifikation  (scripts/backup.sh + restore-verify.sh)
3. Migration (expand)        – rückwärtskompatibel, alte Fassung läuft weiter
4. Neue Instanzen hochfahren – /health/ready hält Verkehr zurück, bis Schema passt
5. Verkehr umschwenken       – rolling oder blue/green                   [BRAUCHT INFRASTRUKTUR]
6. Beobachten (siehe 8.3)
7. CONTRACT erst, wenn kein Leser der Alt-Spalten mehr existiert          → Abschnitt 7
```

### 8.2 Feature-Flags statt Verzweigungen

Der Mechanismus aus Prompt 1 bleibt: `feature_flags` (`hidden`/`beta`/`live`),
standortweise überschreibbar, **Standard `hidden` (fail closed)** – ein Schlüssel,
der fehlt, ist aus. Neue Fachfunktionen gehen als `hidden` in Produktion und
werden dort geschaltet, ohne ein zweites Artefakt.

### 8.3 Was nach dem Rollout beobachtet wird – und was einen Rollback auslöst

Deployment-ID ist in **jeder** Logzeile (`deploymentId`, `instanceId`,
`releaseChannel`), in **jeder** Antwort (`x-deployment-id`) und in **jedem**
Fehlerbericht. Damit ist die Zuordnung „Fehlerwelle ↔ Artefakt" möglich.

| Signal | Schwelle | Konsequenz |
|---|---|---|
| `/health/ready` einer neuen Instanz | nicht 200 nach 120 s | Instanz nicht in den Verkehr, Ursache prüfen |
| `fahrschul_http_requests_total{status="5xx"}` | > 1 % über 5 Min. | **Rollback** |
| `fahrschul_booking_conflicts_total{kind="internal"}` | > 0 | **Rollback** (409 sind normal, 5xx nie) |
| `fahrschul_dead_letters_open` | steigt nach dem Rollout | **Rollback** |
| `fahrschul_scheduler_last_tick_age_seconds` | > 60 s | Abschnitt 4, dann Rollback |
| `fahrschul_sync_delay_seconds` | > 120 s über 5 Min. | erst Abschnitt 4, dann Rollback |

**Automatischer Rollback [BRAUCHT INFRASTRUKTUR].** Die *Auslösung* ist hier
vollständig definiert (Schwellen oben, alle aus `GET /metrics` ablesbar), die
*Ausführung* gehört dem Orchestrator. Ohne einen solchen gibt es keinen
automatischen Rollback – nur einen manuellen mit derselben Entscheidungsgrundlage.
Das ist eine echte Lücke und steht so in `docs/chaos-test-report.md`.

### 8.4 Rollback

```
1. Verkehr auf die vorige Fassung schwenken (Artefakt bleibt vorgehalten)  [BRAUCHT INFRASTRUKTUR]
2. deployments-Zeile fortschreiben:
     update deployments set status='zurueckgerollt', rolled_back_at=now(),
            rollback_reason='…', rollback_to='<vorige deployment_id>'
      where deployment_id='<neu>';
3. Migration NICHT zurückrollen, solange sie additiv war (expand-contract:
   die alte Fassung liest ihre gewohnten Spalten weiter).
   War sie ZERSTÖREND, ist ein Code-Rollback NICHT ausreichend -> Abschnitt 6.
4. GET /health/ready auf allen Instanzen prüfen.
```

Genau deshalb trägt `deployments` die Spalten `destructive` und `backup_ref`: sie
beantworten „ist ein Code-Rollback hier überhaupt genug?" ohne Rätselraten.

---

## 9. Sicherungsplan

| Was | Wie oft | Aufbewahrung | RPO-Beitrag |
|---|---|---|---|
| Logisch (`pg_dump -Fc`, verschlüsselt) | täglich | 30 Tage | bis 24 h |
| Physisch (`pg_basebackup`, verschlüsselt) | wöchentlich | 4 Wochen | Basis für PITR |
| WAL-Archiv | fortlaufend, `archive_timeout = 60s` | bis 2 Basissicherungen zurück | **bis 60 s** |
| Wiederherstellungstest (`restore-verify.sh`) | **wöchentlich, verpflichtend** | Bericht 1 Jahr | – |

**Der Wiederherstellungstest ist Teil des Plans, nicht ein Extra.** Eine
Sicherung ohne `verified_at` ist für dieses System kein Nachweis (Abschnitt 7).

### Offsite [BRAUCHT INFRASTRUKTUR]

In dieser Umgebung liegt alles unter `/var/backups/fahrschul` – **auf derselben
Maschine wie die Datenbank**. Das schützt gegen Datenfehler, **nicht** gegen den
Verlust der Maschine. Für den Produktivbetrieb zwingend:

* Ziel auf einem **anderen** Host/Anbieter (S3-kompatibel mit
  Objektsperre/Versionierung),
* `archive_command`, das dorthin schreibt (oder `pg_receivewal` von dort ziehen),
* Sicherungsschlüssel in einem **Secret-Store**, nicht in einer Datei neben der
  Sicherung (dort liegt er heute – `BACKUP_KEY_FILE`, Modus 0400),
* getrennte Zugangsdaten: die Anwendung darf Sicherungen **nicht** löschen können.

---

## 10. Überwachung von Locks und langsamen Abfragen (§14)

Aktiv gesetzt (`conf.d/50-fahrschul-pitr.conf`):

```
log_min_duration_statement = 500ms
log_lock_waits = on
deadlock_timeout = 1s
log_checkpoints = on
log_autovacuum_min_duration = 0
log_temp_files = 0
track_io_timing = on
```

Zeitlimits auf der **Anwendungsrolle**, nicht global – global würde es auch
Migrationen, `pg_dump` und `pg_basebackup` treffen, also genau die Vorgänge, die
lange laufen dürfen:

```sql
alter role fahrschul set statement_timeout = '60s';
alter role fahrschul set lock_timeout = '15s';
alter role fahrschul set idle_in_transaction_session_timeout = '120s';
```

Bei Verdacht auf eine Sperre:

```sql
-- Wer wartet auf wen?
select w.pid as wartet, w.query as wartende_abfrage,
       b.pid as blockiert, b.query as blockierende_abfrage,
       now() - b.xact_start as blockiert_seit
  from pg_stat_activity w
  join pg_locks wl on wl.pid = w.pid and not wl.granted
  join pg_locks bl on bl.locktype = wl.locktype
                  and bl.database is not distinct from wl.database
                  and bl.relation is not distinct from wl.relation
                  and bl.granted
  join pg_stat_activity b on b.pid = bl.pid;

-- Langläufer
select pid, now() - query_start as dauer, state, left(query, 120)
  from pg_stat_activity
 where state <> 'idle' and now() - query_start > interval '5 seconds'
 order by dauer desc;
```

**Deadlock 40P01 ist hier normalerweise kein Vorfall.** Zwei GiST-EXCLUDE-
Constraints auf `terminbuchungen` können bei gleichzeitigen kollidierenden
Buchungen einen Deadlock erzeugen; `runIdempotent` wiederholt ihn bis zu viermal
und der Aufrufer bekommt die richtige fachliche Antwort (409). Ein Deadlock im
Log **ohne** begleitende 5xx ist erwartetes Verhalten. Erst ein 5xx auf
`POST /appointments` ist ein Vorfall (siehe `docs/chaos-test-report.md`,
Szenario 3).

### Verbindungspooling (§14)

* **Anwendungsseitig:** `postgres.js`-Pool je Prozess (`packages/database`),
  Vorgabe 10 Verbindungen; der Migrationsläufer nutzt bewusst `max: 1`.
* **[BRAUCHT INFRASTRUKTUR]** Ab mehreren Instanzen gehört ein
  **PgBouncer** (Transaktionsmodus) davor. Wichtig dabei: der
  Transaktionsmodus verträgt keine sitzungsgebundenen Konstrukte. Dieses System
  benutzt zwei – Sitzungsvariablen für den Übergangskontext
  (`fahrschul.akteur_benutzer_id`, `set_config`) und `LISTEN/NOTIFY`. Beide
  liegen **innerhalb** ihrer Transaktion bzw. werden nicht benutzt, deshalb ist
  der Transaktionsmodus tragfähig – das muss aber **vor** der Einführung
  geprüft werden, nicht danach.

### Hochverfügbarkeit [BRAUCHT INFRASTRUKTUR]

Es gibt in dieser Umgebung **keine** Replikation und **kein** Failover. `wal_level
= replica` und `max_wal_senders = 10` sind gesetzt, ein Streaming-Standby ist
damit *vorbereitet*, aber **nicht eingerichtet und nicht erprobt**. Für den
Produktivbetrieb: ein Standby am zweiten Standort, ein Failover-Verfahren
(Patroni oder managed) und ein **geübter** Failover-Test. Bis dahin ist die
Datenbank ein Single Point of Failure – so steht es auch im Release-Gate.

---

## 11. Kontakt und Zuständigkeit

| Fall | Zuständig | Eskalation |
|---|---|---|
| Prozess/Datenbank/Scheduler | Rolle `systemdienst` (Bereitschaft) | 30 Min. → Geschäftsführung |
| Externe Schnittstelle | `systemdienst` | 4 h → Geschäftsführung |
| Fachliche Befunde (§19) | Büro + `systemdienst` | täglicher Bericht |
| Wiederherstellungs**entscheidung** | **Geschäftsführung** | – |
| Zerstörende Migration | **Geschäftsführung** (`MIGRATION_APPROVED_BY`) | – |

Der maschinenlesbare Alarmkatalog mit Schwelle, Kennzahl, Zuständigem, Runbook
und Eskalation: `GET /ops/alerts/catalog`.
