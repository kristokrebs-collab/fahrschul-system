# Synchronisations-, Ausfall- und Sicherheitsarchitektur

Das gemeinsame Dokument zu `PROMPT -1`. Es wächst mit den Phasen:
**Phase 1 (Zuverlässigkeitskern)** unten zuerst, danach
**Phase 2 (Echtzeit-Synchronisation und Client-Synchronisationszustände)**.

---

# Teil 1 – Phase 1: Zuverlässigkeitskern

Dieser Teil beschreibt, was in **Phase 1** von `PROMPT -1`
(„Verbindliche Synchronisations-, Ausfall- und Sicherheitsarchitektur")
tatsächlich gebaut wurde: **§1–§5, §10, §13, §19** sowie die **Serverseite von
§9**. Es ist bewusst auf diesen Umfang begrenzt. Was zu welcher späteren Phase
gehört, steht am Ende unter *Abgrenzung*.

Alle Aussagen hier sind durch Tests belegt (`apps/api/src/__tests__/`,
`packages/domain/src/__tests__/`). Wo eine Anforderung **nicht** oder nur
teilweise erfüllt ist, steht das unter *Bekannte Lücken* – nicht versteckt im
Fließtext.

Migration: `packages/database/migrations/0007_reliability_core.sql`
(rein additiv, expand-contract, siehe §14-Hinweis unten).

---

## §1 Grundhaltung: wo die Wahrheit liegt

| Ebene | Rolle |
| --- | --- |
| **PostgreSQL** | einzige Quelle der Wahrheit. Jede Invariante, die man als Constraint/Trigger ausdrücken kann, IST einer. |
| `packages/domain` | reine, DB-unabhängige Fachlogik (State Machines, Pipeline, Retry-Politik) – unit-testbar, und **Spiegelbild** der DB-Regeln, nicht ihr Ersatz. |
| `apps/api` | Autorisierung, Transaktionsgrenzen, Übersetzung von DB-Fehlern in verwertbare HTTP-Antworten. |
| `apps/{student,office,instructor,finance}` | Anzeige + Eingabe. Enthält **keine** Regel, die nicht serverseitig ebenfalls gilt. |

Leitregel dieser Phase: **eine Regel, die nur im Anwendungscode steht, gilt
nicht.** Deshalb sind sämtliche §3-Invarianten in `invariants.test.ts` mit
**Roh-SQL** gegen die Datenbank geprüft, nicht über die API – ein Bug, eine
neue Route oder ein Datenbank-Skript kann sie nicht umgehen.

---

## §2 Idempotenz für jeden kritischen Schreibvorgang

**Ein** Mechanismus, kein Sonderweg pro Route:
`apps/api/src/lib/idempotency.ts` + Tabelle `idempotency_keys`
(`operation`, `key`, `benutzer_id`, `request_hash`, `response_status`,
`response_body`, `expires_at`; unique auf `(operation, key)`).

### Ablauf (alles in EINER Transaktion)

1. Reservierung per `INSERT … ON CONFLICT DO NOTHING`. Gewinnt der Insert,
   gehört die Ausführung uns. Eine parallele zweite Anfrage blockiert am
   Unique-Index bis zum Commit/Rollback und sieht danach den Endzustand.
2. Verliert der Insert → vorhandene Zeile lesen:
   - **gleicher Hash + `completed`** → gespeicherte Antwort wird
     zurückgegeben, der Handler läuft **nicht** erneut.
   - **abweichender Hash** → **HTTP 409** `idempotency_key_conflict`.
   - **gleicher Hash + `in_progress`** → HTTP 409 `idempotency_in_progress`.
   - **abgelaufen** → Zeile wird übernommen, Ausführung wie neu.
3. Nach Erfolg wird das Ergebnis in derselben Transaktion gespeichert →
   Ergebnis und fachliche Änderung sind atomar.

**Dokumentierte Wahl: 409, nicht 422.** Ein wiederverwendeter Schlüssel mit
anderem Inhalt ist kein Validierungsfehler des Bodys, sondern ein Konflikt mit
einer bereits verbuchten Anfrage – dieselbe Semantik wie alle anderen
Konfliktantworten des Systems, und §9 klassifiziert 409 als *dauerhaft*
(kein Auto-Retry).

**Nur erfolgreiche (2xx) Ergebnisse werden gespeichert.** Schlägt der Handler
fachlich fehl, rollt die Reservierung mit zurück – der Client darf denselben
Schlüssel nach Behebung erneut verwenden. Ein Retry darf keinen alten Fehler
einfrieren.

**Hash-Bildung.** SHA-256 über `operation + target + kanonisierter Body`.
Kanonisierung sortiert Objekt-Schlüssel (andere JSON-Reihenfolge ⇒ **kein**
falscher Konflikt) und entfernt `idempotencyKey` selbst. Beim Dokumentupload
geht der SHA-256 des **Dateiinhalts** in den Hash ein – derselbe Schlüssel mit
anderer Datei ist ein Konflikt.

### Die neun mandatierten Operationen

| # | Operation | Route | Schlüssel |
| --- | --- | --- | --- |
| 1 | Terminangebot annehmen | `POST /appointment-offers/:id/accept` | **Pflicht** |
| 2 | Termin buchen | `POST /appointments` | optional-aber-wirksam |
| 3 | Termin stornieren | `POST /appointments/:id/cancel` *(neu)* | **Pflicht** |
| 4 | Fahrstunde abschließen | `POST /instructor/lessons/:id/complete` | optional-aber-wirksam |
| 5 | Rechnung erzeugen | `POST /invoices` *(neu)* | **Pflicht** |
| 6 | Zahlung zuordnen | `POST /finance/bank/:id/resolve` | optional-aber-wirksam |
| 7 | Dokument einreichen | `POST /documents` | optional-aber-wirksam |
| 8 | Prüfung freigeben/anmelden | `POST /pruefungen/:id/transition` | optional-aber-wirksam |
| 9 | Fahrzeug blockieren | `POST /resources/fahrzeuge/:id/block` *(neu)* | **Pflicht** |
| 10 | Nachricht versenden | `POST /communication/send` | optional-aber-wirksam |

Schlüsselquelle: Header `Idempotency-Key` **oder** Body-Feld
`idempotencyKey` (rückwärtskompatibel).

> **Bewusste, begrenzte Abweichung.** Bei den drei in dieser Phase **neu**
> eingeführten Endpunkten (3, 5, 9) und bei dem, der ihn schon vorher verlangte
> (1), ist der Schlüssel **verpflichtend**. Bei den übrigen ist er
> *optional-aber-wirksam*: wird er gesendet, gilt die volle §2-Semantik; wird
> er weggelassen, verhält sich der Endpunkt wie bisher. Grund: ein Pflichtfeld
> auf `POST /appointments`, `/documents`, `/communication/send`,
> `/instructor/lessons/:id/complete`, `/pruefungen/:id/transition` und
> `/finance/bank/:id/resolve` wäre ein **brechender API-Wechsel für vier
> bereits ausgelieferte Frontends**, was §14 (rückwärtskompatibler Rollout)
> widerspricht. Der doppelte Vollzug ist in diesen Fällen zusätzlich durch
> DB-Invarianten ausgeschlossen (EXCLUDE-Constraints, Unique-Indizes,
> `FS001`/`FS003`/`FS005`) – Idempotenz ist dort Komfort, nicht die letzte
> Verteidigungslinie.
> **Seam für Phase 2:** `IDEMPOTENT_OPERATIONS` in
> `apps/api/src/lib/idempotency.ts` ist die einzige Stelle, an der die
> Pflicht-Liste hängt. Sobald die Client-Offline-Outbox (§6–§8) Schlüssel
> unbedingt mitsendet, wird die Pflicht dort auf alle zehn erweitert.

### Verhältnis zur alten, scheduling-spezifischen Idempotenz

`terminbuchungen.idempotency_key` (unique, Migration 0001) **bleibt** – aber
nicht als zweiter, konkurrierender Mechanismus, sondern als **DB-seitige
Zweitsperre**: sie verhindert eine doppelte Buchung selbst dann, wenn der
generische Speicher geleert wurde. Maßgeblich (Antwortwiedergabe,
Konflikterkennung, Ablauf) ist ausschließlich `idempotency_keys`; alle fünf
früheren Aufrufstellen (`booking.ts`, `storno-retter.ts`, `appointments.ts`,
`appointment-offers.ts`, `flex.ts`) laufen jetzt darüber.

Eine sichtbare Folge, die man kennen muss: nach **Ablauf** eines
Idempotenzschlüssels für eine Buchung greift weiterhin die Zweitsperre auf
`terminbuchungen.idempotency_key`. Der Ablauftest in `idempotency.test.ts` ist
deshalb an „Nachricht versenden" geführt, wo es keine Zweitsperre gibt.

Aufräumen abgelaufener Schlüssel: Job `idempotency.cleanup` (§13).

---

## §3 DB-Invarianten

Alle mit eigenem SQLSTATE, damit `apps/api` sie präzise in HTTP übersetzt
(`apps/api/src/lib/state-machine.ts`, `sendBusinessConstraintError`).

| SQLSTATE | Invariante | Umsetzung | HTTP |
| --- | --- | --- | --- |
| `FS001` | Eine Fahrstunde kann nur **einmal** endgültig abgeschlossen werden | Trigger `fs_lesson_completed_once`: nach `status='abgeschlossen'` + `beendet_at` sind Abschlussfelder eingefroren, Zurücksetzen verboten (Storno bleibt erlaubt) | 409 `lesson_already_completed` |
| `23505` | Keine doppelte Rechnung für dieselbe Leistung | `rechnungspositionen.leistung_terminbuchung_id` / `leistung_ref` + partielle Unique-Indizes `… where storniert = false`; Trigger `fs_rechnung_storno_propagiert` setzt `storniert` bei Rechnungsstorno | 409 `duplicate_invoice_for_leistung` |
| `FS003` | Eine Banktransaktion kann nicht mehrfach vollständig zugeordnet werden | (a) Aus `matched` führt nur `reversed` heraus; (b) Trigger `fs_banktransaktion_summe` verbietet eine weitere Zahlung auf `matched` **und** ein Überbuchen der Summe | 409 `banktransaktion_already_matched` |
| `FS004` | Prüfung nur mit gültiger Freigabekette anmeldbar | Trigger `fs_pruefung_freigabekette`: (a) Pipeline-Reihenfolge als DB-Allow-List (`pruefung_transitions`), (b) `termin_angefragt`+ verlangt `pruefungsfreigaben.status='freigegeben'` **und** `buerofreigabe_status='freigegeben'` | 409 `exam_clearance_chain_missing` |
| `FS005` | Ein gesperrtes Fahrzeug kann nicht verplant werden | Trigger auf `terminbuchungen` **und** `terminangebote`: Insert bzw. Änderung von Fahrzeug/Zeitraum prüft `fahrzeuge.status = 'verfuegbar'` | 409 `vehicle_blocked` |
| `FS006` | Dokumentstatus `verified`/`rejected` nur mit Prüfprotokoll | Trigger `fs_dokument_pruefprotokoll_pflicht` verlangt `pruefprotokoll` + `geprueft_durch_benutzer_id` | 409 `document_review_protocol_required` |
| `FS007` | Dokumentstatus folgt der erlaubten State Machine | Allow-List-Tabelle `state_machine_transitions` + Trigger (siehe §10) | 409 `invalid_state_transition` |

Wichtig für `FS004`: der Trigger **verweigert nur**, er erteilt niemals eine
Freigabe. Das Non-Negotiable „keine automatische Prüfungsfreigabe" bleibt
unangetastet.

Wichtig für `FS005`: die **umgekehrte** Richtung ist absichtlich **erlaubt** –
ein Fahrzeug mit Zukunftsterminen darf gesperrt werden. Das automatische
Stornieren dieser Termine wäre eine riskante Reparatur; sie wird stattdessen
als §19-Befund berichtet.

### Geld

Bereits vor dieser Phase durchgehend **Integer-Cent** (`*_cent`). **Verifiziert
und testgesichert** (`invariants.test.ts`): keine einzige Spalte mit
`double precision`, `real` oder `money` im gesamten Schema; jede `*_cent`-Spalte
ist `integer`; `numeric` existiert ausschließlich für Nicht-Geldgrößen
(`steuersatz`, Arbeitszeitstunden). §3s Geldanforderung war erfüllt und ist es
weiterhin.

---

## §4 Optimistische Sperren

Vorher existierten `version`-Spalten, aber **niemand las sie**. Jetzt:

- **Fortschreibung im Trigger** (`fs_bump_version`) auf 13 Tabellen: jedes
  `UPDATE` – auch Roh-SQL – erhöht `version` und setzt `updated_at`. Kein
  Codepfad kann die Erkennung umgehen.
- **Client sendet die gelesene Version**: Body-Feld `expectedVersion` **oder**
  Header `If-Match: W/"<version>"`. Jede Antwort auf einen versionierten
  Datensatz trägt `ETag` (+ `Last-Modified`).
- **Konflikt = HTTP 409** mit maschinenlesbarer Antwort:

```json
{
  "error": "version_conflict",
  "expectedVersion": 3,
  "currentVersion": 5,
  "current": { "...": "vollständiger Serverzustand" },
  "conflictFields": ["endzeit"],
  "message": "…"
}
```

- **HTTP 428** `precondition_required`, wenn eine Operation die Version
  **verlangt** und keine kam.

| Entität | Endpunkt | Version |
| --- | --- | --- |
| Verfügbarkeit | `PATCH /availability/:id` *(Route neu)* | Pflicht |
| Termine | `POST /appointments/:id/cancel` *(neu)* | Pflicht |
| Fahrstundenfeedback | `PATCH /feedback/:id` *(neu)*, `PATCH /feedback/:id/self-assessment` | Pflicht / geprüft-wenn-gesendet |
| Dokumentprüfung | `POST /documents/:id/review` | geprüft-wenn-gesendet |
| Rechnungen | `PATCH /invoices/:id` *(neu)* | Pflicht |
| Fahrzeugstatus | `PATCH /resources/fahrzeuge/:id` *(neu)*, `POST …/block` *(neu)* | Pflicht |

„geprüft-wenn-gesendet" gilt bei den beiden Endpunkten mit Altaufrufern
(Dokumentprüfung aus `apps/office`, Selbsteinschätzung aus `apps/student`):
wird eine Version gesendet, wird sie **hart** geprüft; fehlt sie, gilt wie
bisher „letzter Schreibvorgang gewinnt". Auch hier ist der Grund §14
(kein brechender Wechsel für ausgelieferte Frontends), und auch hier ist der
Umschaltpunkt eine Zeile (`readExpectedVersion` → `requireExpectedVersion`),
die Phase 2 mit dem Client-Sync gemeinsam umlegt.

**Seam für Phase 2:** `conflictFields` + `current` sind absichtlich so
geformt, dass der Client daraus direkt eine Diff-Ansicht bauen kann, ohne
erneut zu fragen.

**Verfügbarkeit war eine echte Lücke:** `verfuegbarkeiten` existierte seit
Prompt 0 als Tabelle, hatte aber **keinen Schreibpfad**. Ohne Endpunkt wäre
§4 für diese Entität nicht nachweisbar erfüllbar gewesen, deshalb ist
`apps/api/src/routes/availability.ts` neu (mit own-Scope-Prüfung:
`availability:write:own` nur eigene, Büro über `availability:write:any` fremde).

---

## §5 Transaktionaler Outbox + Consumer-Inbox

### Das verbotene Muster ist strukturell ausgeschlossen

Bestehend war: Audit-Ereignis via `buildEventRow()` **in derselben Transaktion**
wie die fachliche Änderung – also schon atomar, aber ohne Zustellseite. Statt
alle ~40 Aufrufstellen anzufassen, erzeugt jetzt ein **Trigger** die
Outbox-Zeile:

```
audit_events  --[AFTER INSERT: fs_audit_event_to_outbox]-->  event_outbox
```

Damit gilt: **es existiert kein Codepfad, der eine fachliche Änderung
committen kann, ohne die zugehörige Outbox-Zeile mitzucommitten.**
Nachgewiesen in `outbox.test.ts`: bei Rollback der Geschäftstransaktion gibt es
weder Audit- noch Outbox-Zeile.

Gefiltert wird über `event_schema_versions`: nur eingetragene, **fachliche**
Ereignistypen werden zugestellt; reine Sicherheits-Audits (`login`, `logout`)
bleiben ausschließlich in `audit_events`.

Konkret entfernt wurde das verbotene Muster in
`POST /communication/send`: vorher wurde die Nachricht in die DB geschrieben
und **danach** im selben Request versendet – schlug der Versand fehl oder starb
der Prozess dazwischen, war er unwiederbringlich verloren. Jetzt landet die
Nachricht atomar mit ihrem Ereignis in der Warteschlange; der Versand ist ein
wiederholbarer Job. Ein Sofortversuch nach dem Commit bleibt als
Latenz-Optimierung, ist aber **nicht** die Zustellgarantie.

### Zustellung

`apps/api/src/workers/outbox.ts`

- **Lease statt Löschen**: `claimOutboxBatch` setzt `status='in_flight'`,
  `lease_owner`, `lease_expires_at`, erhöht `attempts`; `FOR UPDATE SKIP
  LOCKED` erlaubt mehrere Worker parallel.
- **Absturz-Wiederaufnahme**: `recoverExpiredOutboxLeases()` gibt Zeilen mit
  abgelaufenem Lease frei; wird bei **jedem** Durchlauf zuerst aufgerufen.
- **Dedup = Inbox**: `event_inbox` mit unique `(consumer, event_id)`. Der
  Insert ist die Reservierung; verliert er, war das Ereignis schon verarbeitet
  → Duplikat ignoriert. Zustellung ist *at-least-once*, Verarbeitung damit
  effektiv *exactly-once*.
- **Cursor**: `event_cursors` je Konsument (`last_seq` über
  `event_outbox.seq bigserial`) für Wiederaufnahme ohne Inbox-Scan.
- **Fehlerbehandlung** nach §9 (unten): transient → Backoff; dauerhaft oder
  erschöpft → `status='dead'` + `dead_letters` + Alarm.

### Konsumenten (`apps/api/src/workers/consumers.ts`)

| Konsument | Interessiert an | Wirkung |
| --- | --- | --- |
| `notifications` | 12 fachliche Typen | legt Nachrichten in `nachrichten` (Status `warteschlange`); Versand ist Job |
| `projection` | `lesson.offer.created` | schaltet das Angebot `sent → delivered` (persistierter Folgezustand) |
| `integration-sync` | `*` | protokolliert, was an ein Zielsystem ginge (**mock**, siehe *Bekannte Lücken*) |

### Ereignisversionierung / Rückwärtskompatibilität

`event_outbox.event_version` wird aus `event_schema_versions` gestempelt. Regel:

- Ein Konsument deklariert `maxEventVersion` und **muss** alle Versionen
  ≤ dieser Zahl verarbeiten (getestet: Konsument v3 verarbeitet Ereignis v1).
- Eine **zu neue** Version wird **nicht stillschweigend verworfen**, sondern
  landet in der Dead-Letter-Queue – lieber ein Alarm als Datenverlust.
- Neue Felder gehören additiv in `payload`; eine Versionserhöhung ist nur bei
  brechenden Änderungen nötig.

---

## §9 (Serverseite) Retry, Backoff, Dead-Letter-Queue

`packages/events/src/retry.ts` – **absichtlich ohne Node-/DB-Abhängigkeiten**,
damit Phase 2 dieselbe Politik im Browser nutzt.

**Transient (Retry erlaubt):** `TIMEOUT`, `RATE_LIMITED` (429), `NETWORK`,
`SERVER_UNAVAILABLE` (500/502/503/504), `SERIALIZATION_FAILURE` (40001/40P01),
`LEASE_LOST`.

**Dauerhaft (NIEMALS Auto-Retry):** `VALIDATION` (400/422), `PERMISSION`
(401/403), `BUSINESS_CONFLICT` (409, **alle** `FS00x`), `EXPIRED_OFFER` (410),
`STALE_VERSION` (412/428), `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`,
`UNKNOWN_PERMANENT`.

Ein **unklassifizierter** Fehler gilt konservativ als dauerhaft – lieber ein
Mensch schaut hin, als dass etwas endlos wiederholt wird.

**Backoff:** exponentiell (`base·2^(n-1)`), Jitter ±30 %, Cap 5 min, `maxAttempts`
je Job/Ereignis. Eine einzige Funktion (`decideRetry`) entscheidet für
Outbox-Worker **und** Job-Runner – kein Auseinanderlaufen.

**Dead-Letter-Queue** `dead_letters`: `source` (`job`|`outbox`), `source_id`,
`kind`, `payload`, `attempts`, `error_class`, `last_error`, `audit_kontext`
(Grund, Korrelations-ID, Aggregat), `alarm_emitted_at`, `resumed_*`.

**Alarm-Hook:** `apps/api/src/workers/alarm.ts`, austauschbarer Sink.
**Manueller Wiederaufnahmepfad:** `POST /ops/dead-letters/:id/resume` –
erzeugt bei Jobs einen **neuen** Job (die Fehlerhistorie bleibt erhalten), bei
Outbox-Ereignissen wird die Zeile auf `pending` zurückgesetzt; die Inbox
verhindert doppelte Verarbeitung. Eine zweite Wiederaufnahme wird mit 409
abgelehnt.

---

## §10 Vier persistierte State Machines

Zustandsmengen **wörtlich** wie spezifiziert (zeichengenau getestet in
`packages/domain/src/__tests__/statemachines.test.ts`):

- **Terminangebot** — `created, sent, delivered, accepted, booking_pending, confirmed, rejected, expired, cancelled, failed_review`
- **Dokument** — `uploaded, quarantined, scanning, submitted, in_review, verified, rejected, expired, deleted`
- **Zahlung** — `imported, matching, suggested, review_required, matched, partially_matched, reversed, failed`
- **Fahrzeugmangel** — `reported, triaged, vehicle_blocked, replacement_pending, resolved, reopened`

### Die vier Pflichten

| Pflicht | Umsetzung |
| --- | --- |
| **Allow-listed** | `STATE_TRANSITIONS` (`packages/domain`) **und** Tabelle `state_machine_transitions`; ein Test vergleicht beide Richtungen 1:1, damit sie nicht auseinanderlaufen. Verstoß = `FS007`. |
| **Validiert** | Rolle/Eigentum/Frist in der Route; Zustandslogik im Trigger. |
| **Auditiert** | `state_transitions` wird **per Trigger** geschrieben – auch bei Roh-SQL. Akteur/Grund kommen aus Sitzungsvariablen (`fahrschul.akteur_benutzer_id`, `fahrschul.transition_grund`), gesetzt von `setTransitionContext()`. Zusätzlich ein `audit_events`-Ereignis → Outbox. `created_at` nutzt `clock_timestamp()`, damit mehrere Übergänge in **einer** Transaktion geordnet bleiben. |
| **Resumable** | Der Zustand steht **ausschließlich** in der Entitätsspalte, nie im Prozessspeicher. Getestet mit einer frischen App-Instanz („Neustart"). Mehrschrittprozesse laufen als Jobs, nicht als lange Requests: der Angebotsablauf ist ein Job, `sent → delivered` kommt aus dem Outbox-Worker. |

### Zustandsabbildung (Datenmigration + Expand-Contract)

Die neuen Spalten (`terminangebote.angebot_status`,
`dokumente.dokument_status`, `banktransaktionen.zahlung_status`,
`fahrzeugmaengel.mangel_status`) sind die **Quelle der Wahrheit**. Die alten
`status`-Spalten bleiben und werden per Trigger **bidirektional** synchron
gehalten: neuer Code schreibt die neue Spalte (Alt-Spalte wird abgeleitet),
Alt-Code schreibt `status` (neue Spalte wird nachgezogen, **mit**
Allow-List-Prüfung). Bestandsdaten wurden in der Migration umgeschrieben.

| Maschine | neuer Zustand → Alt-`status` |
| --- | --- |
| Terminangebot | `created/sent/delivered → offen` · `accepted/booking_pending/confirmed → gebucht` · `rejected → abgelehnt` · `expired → abgelaufen` · `cancelled → storniert` · `failed_review → pruefung_erforderlich` |
| Dokument | `uploaded → hochgeladen` · `quarantined → quarantaene` · `scanning → pruefung_laeuft` · `submitted → eingereicht` · `in_review → in_pruefung` · `verified → geprueft` · `rejected → abgelehnt` · `expired → abgelaufen` · `deleted → geloescht` |
| Zahlung | `imported/matching/suggested/review_required/partially_matched → offen` · `matched → gebucht` · `reversed/failed → abgelehnt` |
| Fahrzeugmangel | `resolved → behoben` · alle übrigen → `offen` |

Technischer Hinweis: die neuen Spalten haben den DB-Default `'__legacy__'` als
**Sentinel**. Nur so kann der `BEFORE`-Trigger unterscheiden, ob ein Schreiber
die neue Spalte gesetzt hat oder ein Alt-Pfad nur `status` kennt. Der Sentinel
wird nie persistiert (der Trigger ersetzt ihn, bevor die CHECK-Constraint
greift). Im Drizzle-Schema steht aus Typkomfort ein anderer `.default(...)`;
maßgeblich ist die DDL.

**CONTRACT-Phase (Entfernen der Alt-Spalten) ist NICHT Teil dieser Migration**
– bewusst, weil vier Frontends die Alt-Spalten noch lesen.

### Zwei Anmerkungen zur Auslegung

1. **„Zahlung" sitzt auf `banktransaktionen`, nicht auf `zahlungen`.** Die
   Zustandsmenge (`imported → matching → suggested/review_required → matched/
   partially_matched → reversed`) beschreibt den **Zahlungseingangs-Lebenszyklus**:
   Import aus dem Bankfeed, Matching-Kaskade, Zuordnung, Rücklastschrift.
   Genau das trägt `banktransaktionen` (inkl. `aufteilung`, `rechnung_ids`,
   `ist_ruecklastschrift_von`). `zahlungen`-Zeilen sind die **resultierenden
   Zuordnungen**. Eine zweite State Machine auf `zahlungen` wäre der
   konkurrierende Mechanismus, der ausdrücklich vermieden werden soll.
2. **`sent → accepted` ist erlaubt** (nicht nur `delivered → accepted`), weil
   ein Schüler ein Angebot per Poll findet, bevor die Zustellbestätigung
   eintrifft. `delivered` ist die Bestätigung des Zustellwegs, keine
   Vorbedingung der Annahme.

Flex- und Storno-Angebote (`flex_angebote`, `storno_angebote`) behalten ihre
eigenen, älteren Statusmengen und laufen über den Angebotsablauf-Job mit –
absichtlich **keine** fünfte State Machine, §10 nennt genau vier. Der
zugrundeliegende `terminangebote`-Zustand ist auch bei Flex derselbe.

---

## §13 Absturzsicherheit für Worker und Jobs

Tabelle `jobs` + `apps/api/src/workers/job-store.ts`, `runner.ts`.

| Anforderung | Umsetzung |
| --- | --- |
| Lease/Lock + Ablauf | `lease_owner`, `lease_expires_at`; Beanspruchen per `FOR UPDATE SKIP LOCKED` |
| Re-Claim nach Absturz | `recoverExpiredJobLeases()`: abgelaufener Lease **oder** überschrittene `max_runtime_seconds` → zurück auf `pending` (mit Backoff); `attempts` wird **nicht** zurückgesetzt, damit ein Dauerhänger irgendwann in der DLQ landet |
| Heartbeat | `heartbeatJob(id, owner)` verlängert den Lease; nur der besitzende Worker darf das |
| Max-Laufzeit | `max_runtime_seconds` je Job; Überschreitung = transienter Fehler |
| Idempotente Einplanung | `dedupe_key` + partieller Unique-Index über offene Jobs |
| Idempotente Ausführung | Handler filtern auf offene Zustände; State-Machine-No-Ops; Inbox-Dedup |
| Ergebnis/Fehler gespeichert | `result`, `last_error`, `error_class`, `started_at`, `finished_at` |
| DLQ + Alarm + Wiederaufnahme | siehe §9 |

### Job-Arten

| Job-Typ | Zweck |
| --- | --- |
| `notifications.dispatch` | Warteschlange versenden |
| `bank.import` | `imported → matching → matched/suggested/review_required`; **nur `konfidenz='sicher'`** wird automatisch gebucht |
| `document.review` | `uploaded → scanning → submitted` bzw. `quarantined`; setzt abgelaufene Dokumente auf `expired`. **Verifiziert nie automatisch** (`FS006` verlangt ein Prüfprotokoll) |
| `reporting.daily` | Tageskennzahlen als Job-Ergebnis |
| `integration.sync` | treibt den `integration-sync`-Konsumenten (mock) |
| `reminders.dispatch` | Erinnerungen für Termine in 24–48 h, duplikatfrei |
| `appointment_offer.expire` | **Ablauf von Terminangeboten** |
| `consistency.check` | §19 |
| `idempotency.cleanup` | §2 |
| `outbox.dispatch` | §5 |

**Zum Angebotsablauf – geprüft, wie gefordert:** das war vorher **kein Job**.
`GET /appointment-offers` filterte abgelaufene Angebote nur beim **Lesen**
heraus; `flex_angebote`/`storno_angebote` blieben für immer `offen`. Damit war
der Ablauf nicht persistiert, nicht auditiert und nach einem Neustart nicht
wiederaufnehmbar. Jetzt ist er ein echter, allow-listeter, auditierter
Zustandsübergang mit Ereignis (`lesson.offer.expired`).

Der Runner ist bewusst eine „einen Durchlauf"-Funktion (`runJobsOnce` /
`runWorkersOnce`) statt einer Endlosschleife im HTTP-Prozess: deterministisch
testbar (Absturz = Durchlauf abbrechen) und von außen treibbar.
`startWorkerLoop` gibt es für den Serverbetrieb (`buildApp({ startWorkers: true })`,
Standard **aus**). `scheduleRecurringJobs()` plant die wiederkehrenden Jobs
idempotent je Zeitfenster ein – die **Cron-/Scheduler-Verdrahtung selbst ist
§15 und damit Phase 4**.

Was der Runner **nicht** kann: einen laufenden Job aktiv abbrechen. Ein Hänger
wird über Lease-Ablauf + Max-Laufzeit erkannt und neu beansprucht.

---

## §19 Täglicher Konsistenzcheck

`apps/api/src/services/consistency-check.ts`, Tabellen
`consistency_check_runs` + `consistency_findings`.
Lauffähig als Job `consistency.check` **und** über
`POST /ops/consistency/run`.

Alle elf geforderten Prüfungen, jede mit eigenem Test, der eine echte
Inkonsistenz erzeugt:

1. `termin_ohne_gueltige_referenz` — Termin ohne gültigen/aktiven Schüler, Fahrlehrer oder Fahrzeug
2. `terminueberschneidung` — Überschneidungen (Neuentstehung durch EXCLUDE-Constraints ausgeschlossen; Befund = Altdaten)
3. `bestaetigtes_angebot_ohne_termin`
4. `leistung_ohne_rechnung`
5. `doppelte_rechnung_fuer_leistung`
6. `zahlung_ueber_restbetrag`
7. `blockiertes_fahrzeug_mit_zukunftstermin`
8. `pruefungsstatus_ohne_freigabe`
9. `dokumentstatus_ohne_pruefprotokoll`
10. `verwaiste_uploads`
11. `unverarbeitete_ereignisse`

**Non-Negotiable, testgesichert:** riskante Reparaturen sind
**ausschließlich Vorschläge**. Die Datei enthält keinen einzigen
`UPDATE`/`DELETE` auf fachliche Daten; `vorschlag_angewendet` bleibt `false`
und **es gibt keinen Codepfad und keinen Endpunkt, der ihn setzt** (ein Test
prüft, dass plausible „apply"-Routen 404 liefern). Bei kritischen Befunden
feuert der Alarm-Hook.

Jeder Befund trägt `schweregrad`, `vorschlag`, `vorschlag_riskant` und den
vollen Abfragekontext. Eine fehlerhafte Einzelprüfung bricht den Bericht nicht
ab, sondern erscheint als `fehlerhaftePruefungen` – eine Lücke wird benannt,
nicht verschluckt.

---

## Betriebsoberfläche (`/ops/*`)

Nötig, weil §13/§19 **lauffähige** Jobs und nachvollziehbare Ergebnisse fordern
und ein reiner Cron-Eintrag in dieser Umgebung nicht prüfbar wäre.

| Route | Zweck |
| --- | --- |
| `GET /ops/outbox` · `POST /ops/outbox/dispatch` | Outbox-Zustand / Zustellung anstoßen |
| `GET /ops/jobs` · `POST /ops/jobs` · `POST /ops/jobs/run` · `POST /ops/jobs/schedule-recurring` | Jobs |
| `POST /ops/workers/run` | kombinierter Durchlauf (auch für Phase-4-Chaos-Szenarien) |
| `GET /ops/dead-letters` · `POST /ops/dead-letters/:id/resume` | DLQ |
| `GET /ops/consistency/catalog` · `POST /ops/consistency/run` · `GET /ops/consistency/runs[/:id]` | §19 |

Berechtigungen: neu `ops:reliability:read` und `ops:jobs:manage`, vergeben an
**`systemdienst`** und **`geschaeftsfuehrung`**. Die Antworten enthalten
ausschließlich technische IDs, Zustände und Fehlertexte – **keine
Schüler-Stammdaten**, damit „systemdienst hat keinen Zugriff auf
Schülerdaten" gültig bleibt (eigener Test).

---

## §14-Hinweis: Migration ist expand-contract

`0007_reliability_core.sql` ist **rein additiv**: keine Spalte wird
umbenannt, umtypisiert oder entfernt. Alle vier Frontends lesen ihre
gewohnten Spalten unverändert weiter, während der neue Code die
State-Machine-Spalten schreibt. Die Migration ist idempotent im Sinne des
Migrationsläufers (ein zweiter Lauf wendet nichts an – bestehender Test).
Die Ausführung von Backup/Restore selbst ist §14 und damit **Phase 4**.

---

## Bekannte Lücken dieser Phase

- **Idempotenzschlüssel nicht überall Pflicht** — sechs der zehn Operationen
  akzeptieren ihn, verlangen ihn aber nicht (Begründung + Umschaltpunkt siehe
  §2). Genauso bei §4 für zwei Endpunkte mit Altaufrufern.
  > **In Phase 2 GESCHLOSSEN (Idempotenz-Teil):** alle zehn Operationen
  > verlangen den Schlüssel jetzt, weil alle vier Frontends ihn senden – siehe
  > Teil 2, „§2-Nachtrag". Der §4-Teil bleibt offen (Begründung dort).
- **Externe Integrationen bleiben `mock`** (unverändert, siehe
  `docs/integration-gaps.md`). Konkrete Folge: der Mock-Bankfeed liefert eine
  **leere** Fixture, daher kann `POST /finance/bank/sync` in dieser Umgebung
  keine Transaktion erzeugen; die automatische Matching-Kaskade ist über den
  Job `bank.import` getestet, die manuelle Zuordnung über
  `POST /finance/bank/:id/resolve`.
- **Alarmierung hat keinen echten Kanal** — `alarm.ts` schreibt strukturiert
  auf stderr und sammelt Alarme im Prozess (testbar). Der echte
  Adapter ist §16 und damit Phase 3.
- **Kein Scheduler verdrahtet** — `scheduleRecurringJobs()` existiert und ist
  getestet, der Cron-Eintrag ist §15 (Phase 4).
- **Kein aktives Abbrechen hängender Jobs** — nur Lease-Ablauf + Re-Claim.
- **`packages/events` hat kein eigenes Test-Setup** — die Tests der
  Retry-Politik liegen deshalb in `apps/api/src/__tests__/retry-policy.test.ts`
  und importieren über die Paketgrenze `@fahrschul/events`. Inhaltlich
  vollständig, organisatorisch nicht am Ort des Codes.
- **CONTRACT-Phase der Alt-Statusspalten offen** (bewusst, siehe §10).

---

## Abgrenzung: was welche Phase besitzt

| Abschnitt | Phase |
| --- | --- |
| §1–§5, §9 (Server), §10, §13, §19 | **Phase 1 – dieses Dokument** |
| §6 Realtime, §7 Client-Sync-Zustände, §8 Client-Offline-Outbox, §9 (Client) | Phase 2 – **erledigt, siehe Teil 2** |
| §11 Circuit Breaker, §12 Upload-Quarantäne-Härtung, §16 Observability, §17 Rate-Limiting/CSRF/CSP/Step-up, §18 Degraded-Operation-UX | Phase 3 |
| §14 Backup/Restore-Ausführung, §15 Deployment, §20 die 18 Chaos-Szenarien, §21 SLOs, §22 die sieben Dokumente + Release-Gate-Verdikt | Phase 4 |

Seams, die Phase 1 dafür hinterlässt:

- `packages/events/src/retry.ts` — Retry-Politik, browserfähig (Phase 2, §9-Client)
- Konfliktantwort mit `current` + `conflictFields` (Phase 2, §7-Diff-Ansicht)
- `IDEMPOTENT_OPERATIONS` als einziger Umschaltpunkt für die Pflicht-Liste (Phase 2)
- `event_outbox` + `event_cursors` als Quelle für Push/Realtime (Phase 2, §6)
- `alarm.ts` `setAlarmSink()` (Phase 3, §16)
- `dokument`-Zustand `quarantined` existiert samt Übergängen; sein echter
  Produzent ist die Upload-Härtung (Phase 3, §12)
- `runIntegrationSync` als Einhängepunkt für den Circuit Breaker (Phase 3, §11)
- `POST /ops/workers/run` + `scheduleRecurringJobs()` (Phase 4, §15/§20)
- `consistency_check_runs`/`findings`, `openDeadLetterCount()`,
  Outbox-Statusverteilung als Messgrößen (Phase 4, §21-SLOs)

---

## Testabdeckung der Phase 1

| Datei | Umfang |
| --- | --- |
| `packages/domain/src/__tests__/statemachines.test.ts` | §10 Zustandsmengen zeichengenau, Allow-Lists, Erreichbarkeit |
| `apps/api/src/__tests__/retry-policy.test.ts` | §9 Klassifikation, Backoff/Jitter/Cap, Retry-Entscheidung |
| `apps/api/src/__tests__/idempotency.test.ts` | §2, alle zehn Operationen, drei Semantiken je Operation, Ablauf + Cleanup |
| `apps/api/src/__tests__/invariants.test.ts` | §3 alle Invarianten via **Roh-SQL** + HTTP-Übersetzung, Integer-Cent-Nachweis |
| `apps/api/src/__tests__/optimistic-concurrency.test.ts` | §4 alle sechs Entitäten, Konflikt trägt Serverzustand, `If-Match`, 428, Versions-Trigger |
| `apps/api/src/__tests__/outbox.test.ts` | §5 Atomarität + Rollback, Dedup, Cursor, **Absturz-Wiederaufnahme**, Versionierung, DLQ + Alarm + Wiederaufnahme |
| `apps/api/src/__tests__/jobs.test.ts` | §13 Lease/Re-Claim/Heartbeat/Max-Laufzeit, dedupe, §9-Politik, alle sieben Job-Arten lauffähig |
| `apps/api/src/__tests__/state-machines.test.ts` | §10 DB-Constraints, auditierte Ketten, Legacy-Kompatibilität, Wiederaufnahme nach „Neustart" |
| `apps/api/src/__tests__/consistency-check.test.ts` | §19 alle elf Prüfungen, „nur Vorschläge", Job + Ops-Route |

---

# Teil 2 – Phase 2: Echtzeit-Synchronisation und Client-Synchronisationszustände

Ab hier beschreibt dieses Dokument, was in **Phase 2** gebaut wurde:
die **Anzeigehälfte von §1**, **§6**, **§7**, **§8** und die **Clientseite von
§9**. Phase 1 (oben) bleibt unverändert gültig; Phase 2 baut ausschließlich auf
ihren Seams auf und hat keine ihrer Zusagen aufgeweicht.

Migration: `packages/database/migrations/0008_realtime_sync.sql`
(rein additiv, expand-contract – kein bestehender Spaltenname/Typ wird
geändert, keine bestehende Tabelle angefasst).

Neues Paket: `packages/sync` (`@fahrschul/sync`) – der rahmenlose
Client-Synchronisationskern. Neue geteilte React-Verdrahtung in
`packages/ui` (`SyncProvider`, `SyncStatusBar`, `SyncBadge`,
`PendingOperations`).

Alle Aussagen hier sind durch Tests belegt
(`apps/api/src/__tests__/realtime.test.ts`,
`packages/sync/src/__tests__/*`, `apps/student/src/state/syncUi.test.tsx`).
Was **nicht** oder nur teilweise erfüllt ist, steht unter
*Bekannte Lücken der Phase 2* – nicht versteckt im Fließtext.

---

## §1 (Anzeigehälfte) Der Client zeigt, wie alt sein Wissen ist

Phase 1 hat die Datenbank zur einzigen Wahrheit gemacht. Das war die eine
Hälfte der Regel. Die andere: **ein Stand, dessen Alter man nicht sieht, wird
für Wahrheit gehalten.** Genau daraus entstehen die Fehler, die PROMPT -1
verhindern will – jemand entscheidet auf einem zwei Minuten alten Plan und
erzeugt eine Doppelbelegung.

### Was jetzt sichtbar ist

`SyncStatusBar` (in allen vier Apps über jeder Ansicht) zeigt vier Angaben:

| Angabe | Quelle |
| --- | --- |
| **Synchronisationsstatus** | einer der neun §7-Zustände, zusammengefasst nach Dringlichkeit (`queueSummary`) |
| **Datenalter** | `describeDataAge(lastFreshAt)` – Zeit seit dem letzten **bestätigten** Serverstand. Ein Treffer aus dem Cache zählt bewusst NICHT als frisch. |
| **Offline-Status** | `navigator.onLine` + Kanalmodus (`stream` / `polling` / `down`) |
| **offene lokale Entwürfe** | Anzahl aus der Vorgangsliste |

Zusätzlich, weil es sonst niemand merkt: ein **nicht schreibbarer**
`localStorage` (Privatmodus, voller Speicher) wird gemeldet. Ohne diesen
Hinweis glaubt ein Fahrlehrer, sein Bericht sei gesichert.

### Cache-Einträge sind Kopien, keine Wahrheit

Jeder Eintrag trägt jetzt drei Pflichtangaben statt einer:

```ts
interface CacheEntry<T> {
  data: T;
  fetchedAt: string;              // Zeitstempel
  version: string | null;         // ETag des Servers  (NEU)
  source: "server" | "cache";     // Quelle            (NEU)
}
```

`readCacheEntry` setzt `source` **immer** auf `"cache"` – ein gelesener Eintrag
kann sich nicht als frisch ausgeben. `version` ist zugleich die Grundlage, um
beim Schreiben `If-Match` mitzusenden (§4).

Unverändert gilt: der Cache ist ein **Lese-Fallback**, nie Quelle der Wahrheit
und nie Grundlage eines Schreibvorgangs.

**Zustand `stale` schlägt `synced`:** ist der angezeigte Stand älter als
`STALE_AFTER_MS` (5 min), zeigt die Statuszeile `stale`, auch wenn keine
Vorgänge offen sind. Ein veralteter Stand darf nicht „Aktuell" heißen.

---

## §6 Echtzeit-Synchronisation

### Der geforderte Ablauf – und wo er im Code steht

```
Server committet die fachliche Änderung
  └─ audit_events-Trigger  ─► event_outbox            (Phase 1, unverändert)
       └─ Outbox-Worker ─► Konsument `realtime-fanout` (apps/api/src/workers/consumers.ts)
            └─ realtime_deliveries: NUR event_id + event_type + grobes data_type
                 └─ GET /sync/stream (SSE) bzw. GET /sync/changes (Polling)
                      └─ Client erhöht `revisionOf(thema)`
                           └─ useApiGet lädt über den normalen, AUTORISIERTEN GET neu
                                └─ UI zeigt Serverzustand
```

**Der Kanal reitet auf der Phase-1-Outbox, er ist kein zweiter Zustellpfad.**
Damit gelten alle Phase-1-Garantien weiter: Die Zustellzeile kann nur
entstehen, wenn das Outbox-Ereignis committet ist (also die fachliche
Änderung); `event_inbox` verhindert doppelte Ausführung des Fanouts; ein
Absturz wird über den Lease wiederaufgenommen; ein dauerhafter Fehler landet in
der Dead-Letter-Queue statt verloren zu gehen.

### Transportwahl: SSE, nicht WebSocket

Vier Gründe, dokumentiert in `apps/api/src/routes/sync.ts`:

1. **Der Kanal ist einseitig.** Er überträgt nur „etwas hat sich geändert".
   Alles Schreibende läuft über die bestehenden, autorisierten, idempotenten
   HTTP-Routen. Der Hauptvorteil von WebSocket – Vollduplex – ist hier ohne
   Nutzen, sein Preis (eigenes Framing, eigenes Reconnect-/Heartbeat-Protokoll,
   eigene Autorisierung beim Upgrade, Abhängigkeit `@fastify/websocket`) fällt
   trotzdem an.
2. **Sitzung.** Die Anmeldung läuft über ein httpOnly-Cookie. Ein normaler GET
   trägt es mit `credentials: 'include'` / `withCredentials: true`; ein
   WebSocket-Upgrade kann keine eigenen Header setzen und verleitet zu
   Token-in-Query-String – das wäre eine **Verschlechterung** der
   Sicherheitslage (Token in Logs, Referrern, Proxy-Historie).
3. **Netzwerkpfad.** Ein langlebiger GET passiert Proxies, die
   `Upgrade: websocket` blockieren. Zusammen mit dem Polling-Fallback gibt es
   zwei Wege über gewöhnliches HTTP.
4. **Wiederaufnahme ist im Protokoll.** `id:` im Ereignis, `Last-Event-ID`
   beim Reconnect, `retry:` für den Reconnect-Abstand – genau die von §6
   geforderte Semantik, ohne sie selbst zu erfinden.

Der Preis ist bekannt und akzeptiert: SSE ist Text-only, hat in HTTP/1.1 ein
Verbindungslimit von 6 je Origin und nimmt keine Client-Nachrichten an. Für
einen Änderungs-Ticker ist das irrelevant.

### Autorisierung je Abonnent – der eigentliche Leckpfad

Ein Kanal, der `event_outbox` einfach weiterreicht, ist ein Informationsleck:
**schon die reine Existenz einer Ereignis-ID verrät, dass es einen Datensatz
gibt, den der Abonnent nicht lesen darf.** („Schüler A erfährt, dass gerade
gebucht wurde.") Deshalb zwei Schichten:

**Schicht 1 – Fach-Zielgruppen = Autorisierungsregel.**
`resolveAudience` (`apps/api/src/services/realtime-audience.ts`) löst je
Aggregat aus den **Fachtabellen** auf, wer es sehen darf:

| Aggregat | Zielgruppen |
| --- | --- |
| `terminbuchung` | Schüler, Fahrlehrer, Büro (Standort), GF |
| `terminangebot` | Fahrlehrer, Büro, **alle Schüler des Standorts**, GF – ein offenes Angebot ist ein Pool (`GET /appointment-offers` liefert es jedem Angemeldeten), „alle Schüler des Standorts" ist also eine **Einschränkung** des Leserechts, keine Ausweitung |
| `dokument`, `rechnung`, `pruefung`, `pruefungsfreigabe`, `fahrstunden_feedback` | betroffener Schüler + Büro/GF (+ Fahrlehrer bei Feedback/Prüfung) |
| `banktransaktion` | **nur** Finanzen + GF – Bankdaten sind nicht schülersichtbar, auch nicht als „es hat sich etwas geändert" |
| `kompetenzbeobachtung` | Fahrlehrer + Büro/GF, **nicht** der Schüler (`competency:read:own` hat nur der Fahrlehrer) |
| `sprachprotokoll` | **ausschließlich** der eigene Fahrlehrer – interne Rohdokumentation |
| `storno_event` | nur die Schüler, die tatsächlich ein Storno-Angebot erhalten haben (nicht der ganze Standort) |
| `fahrzeug`, `fahrzeugmangel` | Büro + Fahrlehrer des Standorts + GF (+ Melder) |
| unbekanntes Aggregat | **fail closed**: nur Büro (Standort) + GF + Akteur |

`systemdienst` wird **nie** als fachlicher Empfänger aufgelöst – das
Non-Negotiable „systemdienst hat keinen Zugriff auf Schülerdaten" gilt auch für
das Metadatum „bei Schüler X hat sich etwas geändert". Ein Test prüft es.

Ein weiterer Test prüft, dass **jeder** in `event_schema_versions` eingetragene
Ereignistyp ein Thema hat – damit ein neu hinzugefügter Ereignistyp nicht
stillschweigend ohne Realtime-Zustellung bleibt und nicht in die
fail-closed-Regel rutscht.

**Schicht 2 – Zustelladresse = konkreter Benutzer.**
`expandAudienceToBenutzer` löst die Zielgruppen auf `benutzer:<id>` auf.
`realtime_deliveries.audience_key` ist **immer** eine Benutzer-ID; ein Abonnent
liest ausschließlich seine eigene Zeile, gebildet aus der serverseitig
geladenen Sitzung. Ein Test zeigt: ein manipulierter Query-Parameter
(`?audienceKey=…&benutzerId=…`) ändert nichts.

### Der Cursor leckt kein Volumen

`event_outbox.seq` ist eine **globale** Sequenz. Als Client-Cursor hätte sie
über ihre Lücken verraten, wie viele Ereignisse anderer Nutzer dazwischen
lagen – eine echte, wenn auch schwache Informationspreisgabe.
`realtime_deliveries.audience_seq` ist deshalb eine **dichte Folge je
Empfänger** (1, 2, 3, …), vergeben über `realtime_audience_counters` per
`insert … on conflict do update set next_seq = next_seq + 1 returning`.

Das löst zwei Probleme mit einer Entscheidung:

- **Kein Volumen-Leck.** Ein Schüler sieht 1, 2, 3 – nicht 5, 91, 204.
- **Exakte Lückenerkennung.** Fehlt eine Nummer, fehlt ein Ereignis.

Der Grund für die *zweite* Schicht der Adressierung ist genau dieser Cursor:
läge die Zeile auf `standort:X:buero`, hätte jeder Abonnent einen **Vektor**
aus Cursorn (einen je Zielgruppe) statt einer Zahl – fehleranfällig und schwer
wiederaufzunehmen.

### Nutzlast: keine

Eine Zustellzeile hat genau acht Spalten: `id`, `audience_key`,
`audience_seq`, `event_id`, `event_type`, `data_type`, `standort_id`,
`created_at`. **Kein `payload`.** Ein Test prüft die Spaltenliste gegen
`information_schema` und zusätzlich, dass keine Fach-ID (Schüler-, Fahrlehrer-,
Fahrzeug-ID) in einer Zeile vorkommt.

`data_type` ist ein grobes Thema aus einer geschlossenen Liste von 18
(`termine`, `angebote`, `dokumente`, `rechnungen`, `zahlungen`, `pruefung`,
`feedback`, `fahrzeuge`, `maengel`, `verfuegbarkeit`, `wunschzeiten`,
`nachrichten`, `leads`, `schueler`, `kompetenzen`, `sprachprotokolle`, `flex`,
`exporte`) – nie eine Datensatz-Kennung.

### Endpunkte

| Route | Zweck |
| --- | --- |
| `GET /sync/stream` | SSE. Nachrichten: `hello`, `resync`, `change`, `heartbeat`. Cursor aus `?cursor=` **oder** `Last-Event-ID`. |
| `GET /sync/changes?cursor=&limit=` | **Polling-Fallback** – derselbe Lesepfad (`readChanges`), nur ohne langlebige Verbindung |
| `GET /sync/cursor` | Startpunkt „ab jetzt" + Betriebsparameter + Serverzeit |
| `GET /sync/operations/:operation/:key` | §7: offenen Vorgang über den Idempotenzschlüssel auflösen |

Intervalle (1 s Poll, 15 s Heartbeat) sind **Betreiber**-Parameter
(`buildApp({ realtime })`), bewusst **nicht** vom Client steuerbar – das wäre
ein Lasthebel.

### Vollsynchronisation: drei Auslöser

`readChanges` ordnet eine Vollsynchronisation an, wenn ein Replay nicht
korrekt möglich ist – ein **unvollständiges** Replay wäre schlimmer als ein
sauberer Neuaufbau:

| Grund | Bedingung |
| --- | --- |
| `gap_too_large` | `latest - cursor > MAX_REPLAY_EVENTS` (500) – z. B. eine Woche offline |
| `cursor_pruned` | der Cursor liegt unter dem ältesten noch vorhandenen (Job `realtime.prune` hat aufgeräumt). Gilt auch für Cursor 0: beginnt die Folge nicht bei 1, ist ein Replay unvollständig. |
| `cursor_ahead_of_server` | der Cursor liegt VOR dem Serverstand – der Client hat eine fremde/ältere Datenbank gesehen (z. B. nach einem Restore) und ist nicht vertrauenswürdig |

Aufbewahrung: Job `realtime.prune` (7 Tage, in `scheduleRecurringJobs`
eingeplant) löscht alte Zeilen, **setzt den Zähler aber nicht zurück** – sonst
würde ein Client mit gespeichertem hohem Cursor Ereignisse überspringen.
Getestet.

### Der Client nimmt NICHTS an

`RealtimeEngine` (`packages/sync/src/realtime.ts`) leitet aus einer Meldung
ausschließlich ab: „Thema X könnte veraltet sein – lade es neu." Es gibt
**keinen** Codepfad, der Daten aus einer Kanalnachricht in den Zustand
schreibt. Daraus folgt Zeile für Zeile:

| Störung | Warum harmlos | Test |
| --- | --- | --- |
| **Ereignis verloren** | dichter Cursor macht die Lücke erkennbar; Heartbeat-Totmann entdeckt einen toten Kanal; **jedes** Verbinden löst zusätzlich `onResync` aus („zwischen Verbindungsende und -aufbau kann etwas passiert sein, das kein Ereignis mehr erreichen konnte") | ✓ |
| **Ereignis doppelt** | `seenEventIds` filtert (persistent, überlebt einen Neustart) UND ein doppeltes Neuladen hat dasselbe Ergebnis. Der Cursor rückt trotzdem vor, damit ein wiederholt geliefertes Ereignis den Fortschritt nicht blockiert. | ✓ |
| **Ereignis vertauscht** | der Cursor geht nur **vorwärts** (`Math.max`); ein Nachzügler invalidiert sein Thema trotzdem – ein Refetch zu viel ist harmlos, ein Refetch zu wenig nicht. Es gibt kein inkrementelles Anwenden von Deltas, das Reihenfolge bräuchte. | ✓ |
| **Kanal ganz weg** | nach `maxStreamFailures` (3) Umschaltung auf Polling. Ein Proxy, der SSE blockiert, wird nicht durch Wiederholen freundlicher. | ✓ |
| **offline** | zählt **nicht** als Kanalfehler (verbraucht keine Stream-Versuche) | ✓ |

Reconnect-Backoff nutzt `computeBackoffMs` aus `packages/events` – **kein
zweites Backoff-Gesetz im Projekt.**

**SEAM Phase 3 (§18 Degraded-Operation-UX):** `RealtimeStatus.mode`
(`"stream" | "polling" | "down"`) ist nach außen gegeben. Der eingeschränkte
Betrieb braucht keinen neuen Mechanismus, nur eine Anzeige – die Statuszeile
zeigt „Aktualisierung im Rückfallmodus" bereits heute.

---

## §7 Die neun Client-Synchronisationszustände

Zustandsmenge **wörtlich** wie spezifiziert, als Daten in
`packages/domain/src/sync.ts` und zeichengenau getestet:

`synced` · `local_draft` · `queued` · `syncing` · `retrying` · `conflict` ·
`failed` · `offline` · `stale`

Jeder Zustand hat eine Beschriftung (`packages/sync/src/labels.ts`) – ein
Zustand, den niemand sieht, ist kein Zustand. Zwei Beschriftungen sind
besonders geprüft:

- **`syncing` heißt „Wird übertragen", nicht „gespeichert".** Ein Test prüft,
  dass die Beschriftung das Wort „gespeichert" nicht enthält und die
  Einstufung nicht `ok` ist.
- **Unbekannter Ausgang heißt „Status wird geprüft"** – wörtlich aus §7. Diese
  Beschriftung **überschreibt jede andere**: `syncStateLabel(state, {
  outcomeUnknown: true })` liefert für **alle neun** Zustände denselben Text.
  Getestet.

### Eine Vorgangsliste für §7 und §8

`packages/sync/src/queue.ts` hält **eine** persistente Liste für beides:
Entwürfe (§8) und kritische Vorgänge (§7). Zwei getrennte Listen wären zwei
Fehlerquellen – beide brauchen dieselben acht §8-Pflichtfelder und dieselben
neun Zustände.

### Die fünf harten Regeln

| Regel | Umsetzung | Test |
| --- | --- | --- |
| **Erfolg nur nach Serverbestätigung** | `status` wird ausschließlich bei `result.ok` (2xx) auf `synced` gesetzt. Es gibt keinen optimistischen Pfad. | ✓ |
| **Unbekannter Ausgang ist NIE Erfolg** | `outcomeUnknown` → „Status wird geprüft", aufgelöst nur durch eine **Serverantwort** über den Idempotenzschlüssel | ✓ |
| **Kritische Konflikte NICHT automatisch auflösen** | 409/412/428/410 → Zustand `conflict` + Prüf-Warteschlange (`reviewQueue`). `processQueue` rührt `conflict` nicht an. | ✓ |
| **Nicht-kritische Fehlschläge: wiederholen ODER verwerfen** | `retryEntry` / `discardEntry`; ein **kritischer** Vorgang mit unbekanntem Ausgang braucht `force` (`CriticalDiscardError`) – sonst verschwindet eine möglicherweise gebuchte Zahlung aus der Ansicht, ohne aus der Welt zu sein | ✓ |
| **Nichts wird still verworfen** | erschöpfte Versuche enden in `failed` **mit** letztem Fehler, Fehlerklasse, Versuchszähler und Zeitstempeln + manuellem Wiederaufnahmepfad | ✓ |

Die Konfliktantwort wird direkt aus Phase 1s §4-Seam gefüllt:
`currentVersion`, `conflictFields` und der vollständige `current`-Zustand
landen in `ConflictInfo` und werden in `PendingOperations` angezeigt – eine
Diff-Ansicht ohne erneute Nachfrage, genau wie von Phase 1 vorgesehen.

### Entwürfe liegen verschlüsselt

AES-256-GCM (WebCrypto), 256-Bit-Schlüssel **je Gerät und Benutzer**, frischer
96-Bit-IV je Datensatz. Ein Test schreibt einen Entwurf mit einem markanten
Satz und prüft, dass er im rohen Speicher **nicht** vorkommt, mit dem
richtigen Schlüssel aber wieder lesbar ist.

**Bedrohungsmodell, ehrlich:**

- **Geschützt gegen:** Einblick in `localStorage` über die
  Entwicklerwerkzeuge auf einem geteilten Gerät, Profil-/Backup-Kopien der
  Browserdaten, versehentliches Mitschreiben des Speichers in Fehlerberichten
  oder Support-Exporten.
- **NICHT geschützt gegen:** einen Angreifer, der auf diesem Origin
  JavaScript ausführen kann (XSS). Er kann den Schlüssel genauso lesen wie die
  App. Das ist keine Schwäche dieser Umsetzung, sondern eine Eigenschaft jeder
  rein clientseitigen Verschlüsselung ohne zweiten Faktor. Wer etwas anderes
  behauptet, beschreibt die Lage falsch.
- **SEAM Phase 3 (§17 Step-up-Auth):** `deriveKeyFromPassphrase` (PBKDF2,
  210 000 Iterationen) existiert und ist testbar, aber **absichtlich nicht
  verdrahtet** – ohne Step-up-Authentisierung gäbe es keine Eingabe, aus der
  abzuleiten wäre, und die Funktion wäre nur Theater.

Nützlicher Nebeneffekt der Benutzerbindung: **Abmelden löscht wirksam.**
`forgetDraftKey` macht zurückgebliebene Entwürfe kryptografisch unlesbar, auch
wenn eine Zeile physisch übrig bleibt. Und ein Entwurf eines **anderen**
Benutzers auf demselben Gerät ist nicht entschlüsselbar – `attemptEntry`
erkennt das als `identity_mismatch` und **sendet ihn niemals**.

### Auflösung offener Vorgänge nach einem Neustart

Genau das, wofür Phase 1s Idempotenzspeicher gebaut wurde.
`resolvePendingAfterRestart` läuft beim App-Start, **bevor** irgendetwas
erneut gesendet wird, und fragt `GET /sync/operations/:operation/:key`:

| Antwort | Bedeutung | Clientzustand |
| --- | --- | --- |
| `completed` | hat gewirkt; gespeicherte Antwort liegt bei | `synced` (nachträglich bestätigt) |
| `in_progress` | eine Anfrage mit diesem Schlüssel läuft noch | `syncing` + „Status wird geprüft" |
| `unknown` | kein Eintrag. Weil `runIdempotent` die Reservierung bei Fehlern MIT zurückrollt und nur 2xx speichert: hat **nicht** gewirkt | `queued` – **derselbe** Schlüssel wird erneut gesendet |

Ein fremder Schlüssel wird als `404 not_found` behandelt, nicht als 403 – eine
403 würde seine Existenz bestätigen. Nur die zehn §2-Operationen sind
abfragbar (kein freies Sondieren). Beides getestet.

---

## §8 Offline-Outbox

### Die acht Pflichtfelder

Jeder Eintrag trägt sie, ein Test prüft alle acht einzeln:

| §8-Feld | Feld in `SyncQueueEntry` |
| --- | --- |
| Operation-ID | `operationId` |
| Erstellzeit | `createdAt` |
| Benutzer + Device-ID | `benutzerId`, `deviceId` |
| Schema-Version | `schemaVersion` (`DRAFT_SCHEMA_VERSION`) |
| Request-Hash | `requestHash` (SHA-256, **identische Kanonisierung** wie `apps/api/src/lib/idempotency.ts`) |
| Retry-Zähler | `retryCount` |
| letzter Fehler | `lastError` |

Die Kanonisierung ist absichtlich zeichengleich mit dem Server (Schlüssel
sortiert, `idempotencyKey` entfernt, `Date` als ISO). Nur dann bedeutet
„gleicher Hash" auf beiden Seiten dasselbe – und nur dann kann der Client
erkennen, dass ein gespeicherter Vorgang mit **geänderter** Nutzlast
serverseitig ein `409 idempotency_key_conflict` wäre. Deshalb bekommt eine
geänderte Entwurfs-Nutzlast einen **neuen** Schlüssel (`updateDraftPayload`).

### Was offline erlaubt ist – als Daten, nicht als Kommentar

Bisher stand die Regel in `apps/student` und `apps/instructor` je als Kommentar
über einem `apiMutate` ohne Offline-Fallback, und in `apps/office`/
`apps/finance` **überhaupt nicht** – dort gab es keinen Offline-Pfad, aber
„nicht vorhanden" ist keine geprüfte Zusage. Jetzt liegt der Vertrag einmal in
`packages/sync/src/mutations.ts` und gilt für alle vier Apps:

**Erlaubt offline, nur als Entwurf:** `verfuegbarkeit_entwurf`,
`fahrstundenbericht_entwurf`, `fahrzeugmangel_entwurf`,
`schueler_selbsteinschaetzung`.

**Nicht offline abschließbar:** Terminbuchung, Terminstorno, Prüfung-Go,
Zahlung, Rechnung, Fahrzeugblockierung, Dokumentverifizierung – jeweils mit
benannter Operation im Fehler (`OfflineNotAllowedError.operation`).

`assertOfflineAllowed` arbeitet **fail closed**: alles, was nicht ausdrücklich
als Entwurf erlaubt ist, ist offline verboten. Ein neu hinzugefügter Endpunkt
ist damit standardmäßig gesperrt und nicht versehentlich offen. Getestet.

Zusätzlich kann ein kritischer Vorgang offline **gar nicht erst angelegt**
werden (`createCriticalOperation` wirft) – es gibt kein stilles Queuing einer
Buchung oder eines Stornos.

### Nach der Wiederverbindung – Reihenfolge ist nicht beliebig

`reconcileAfterReconnect`:

1. **Identität erneut prüfen.** Ist ein anderer Benutzer angemeldet, wird
   **kein** Entwurf gesendet; alle offenen Einträge werden `stale` mit
   `identity_mismatch`. Ein Fahrstundenbericht von Fahrlehrer A darf nicht
   unter der Identität von Fahrlehrer B im System landen. Ein solcher Eintrag
   ist auch **nicht** per „trotzdem senden" bestätigbar.
2. **Veraltete Entwürfe erkennen.** Zwei Gründe: `schemaVersion` passt nicht
   mehr (`schema_version`) **oder** der Entwurf ist älter als sieben Tage
   (`draft_too_old`). Beides → `stale` + Bestätigungspflicht.
3. **Konflikte sichtbar machen.** Hat sich der zugrundeliegende Datensatz
   bewegt (`currentVersion !== baseVersion`), ist es ein `conflict` mit
   `record_moved_on` – nicht ein Überschreiben.
4. **Erst dann senden** – idempotent, mit dem **ursprünglichen** Schlüssel.

### Der Sieben-Tage-Fall, explizit getestet

Ein Entwurf, der vor acht Tagen entstand:

- wird als `stale` / `draft_too_old` erkannt,
- **nicht gelöscht** – der verschlüsselte Inhalt bleibt erhalten und lesbar,
- **nicht gesendet** – `processQueue` überspringt ihn,
- erscheint in der Prüf-Warteschlange,
- und geht nach **ausdrücklicher** Bestätigung (`confirmStaleEntry`) mit
  **demselben** Idempotenzschlüssel raus.

---

## §9 (Clientseite) Wiederverwendung, kein zweites Regelwerk

`packages/sync/src/retry-client.ts` importiert `classifyError`,
`computeBackoffMs`, `decideRetry` und `isTransient` **unverändert** aus
`packages/events/src/retry.js` – genau dafür hat Phase 1 diese Datei node- und
DB-frei gehalten. Server und Client können nicht auseinanderlaufen: dieselbe
Klassifikation, dieselbe Backoff-Kurve, derselbe Jitter.

Ergänzt wird nur, was auf dem Server keine Rolle spielte:

1. **`Retry-After` hat Vorrang** vor der eigenen Backoff-Kurve – Sekunden
   **und** HTTP-Datum, gekappt bei 24 h. Ein kaputter Header führt **nicht** zu
   einem absurden Wartewert, sondern fällt auf den Backoff zurück. Getestet.
2. **Der mehrdeutige Browserfall.** `fetch` unterscheidet nicht zwischen „nie
   abgesendet" und „abgesendet, Antwort verloren". Der Client entscheidet
   konservativ: war der Browser **vor** dem Senden offline, war es sicher
   nichts (`outcomeUnknown: false`); brach die Verbindung **im Flug** ab, ist
   der Ausgang **unbekannt** (`outcomeUnknown: true`) → „Status wird geprüft".

Client-Obergrenze ist 60 s (Server: 5 min) und `maxAttempts: 6` – ein Mensch
wartet, ein Worker nicht.

**Nie automatisch wiederholt** (unverändert §9): 400/422 Validierung,
401/403 Berechtigung, 409 fachlicher Konflikt (alle `FS00x`), 410 abgelaufenes
Angebot, 412/428 veraltete Version. Eine **mehrdeutige Zahlungszuordnung**
kommt als 409 und ist damit `BUSINESS_CONFLICT` – sie geht in die
Prüf-Warteschlange, wird nicht wiederholt. Alle acht Fälle einzeln getestet.

**Bei Erschöpfung:** `exhausted: true` (unterscheidbar von „von Anfang an
dauerhaft"), Zustand `failed` **mit vollem Kontext**, manueller
Wiederaufnahmepfad. Nichts wird still verworfen.

---

## §2-Nachtrag: Phase 1s Lücke Nr. 1 ist geschlossen

Phase 1 konnte den Idempotenzschlüssel nur bei **vier** der zehn Operationen
verpflichtend machen; die übrigen sechs wurden von vier ausgelieferten
Frontends ohne Schlüssel aufgerufen, und ein Pflichtfeld wäre ein brechender
API-Wechsel gewesen (§14). Sie hinterließ `IDEMPOTENT_OPERATIONS` als
Umschaltpunkt.

**Diese Bedingung ist aufgelöst.** Alle vier Client-Bibliotheken senden den
Header `Idempotency-Key` jetzt bei **jeder** Mutation – kritische Vorgänge mit
dem Schlüssel aus der persistenten Vorgangsliste (überlebt einen Neustart),
alles andere mit einem je Aufruf erzeugten. Damit gilt:

| Operation | Phase 1 | Phase 2 |
| --- | --- | --- |
| `appointment-offers.accept` | Pflicht | Pflicht |
| `appointments.cancel` | Pflicht | Pflicht |
| `invoices.create` | Pflicht | Pflicht |
| `resources.fahrzeuge.block` | Pflicht | Pflicht |
| `appointments.create` | optional | **Pflicht** |
| `instructor.lessons.complete` | optional | **Pflicht** |
| `finance.bank.resolve` | optional | **Pflicht** |
| `documents.submit` | optional | **Pflicht** |
| `pruefungen.transition` | optional | **Pflicht** |
| `communication.send` | optional | **Pflicht** |

Ein Umschaltpunkt, wie hinterlassen: `IDEMPOTENCY_MANDATORY` in
`apps/api/src/lib/idempotency.ts`, gelesen über `requireIdempotencyKeyFor`.
Alle zehn Aufrufstellen gehen darüber; es gibt keine zweite Liste. Die
Alt-Pfade „ohne Schlüssel wie früher" wurden **entfernt**, nicht totgelegt –
kein unerreichbarer Code.

Der gewonnene Wert: Idempotenz ist jetzt eine **Zusage des Endpunkts** und
nicht mehr eine Höflichkeit des Aufrufers. Ein Skript oder Integrationspartner
kann `POST /appointments` nicht mehr ohne Schlüssel aufrufen und damit die
Doppelvollzug-Erkennung umgehen.

Nebenbei verbessert: die Prüfung steht jetzt **vor** Rollen-, Eigentums- und
Body-Prüfung. Beim Dokumentupload steht sie direkt nach dem Multipart-Rahmen
und **vor** MIME-Prüfung, Größenprüfung, Malware-Scan und Ablage; früher geht
nicht, weil der Schlüssel rückwärtskompatibel auch aus dem Formularfeld
`idempotencyKey` kommen darf und das erst dann lesbar ist.

**§4 wurde NICHT mit umgeschaltet.** Die beiden „geprüft-wenn-gesendet"-
Endpunkte (`POST /documents/:id/review`, `PATCH /feedback/:id/self-assessment`)
verlangen die Version weiterhin nicht. Begründung unter *Bekannte Lücken*.

---

## Non-Negotiables: nach Phase 2 erneut geprüft

| Zusage | Status |
| --- | --- |
| Postgres-EXCLUDE-Constraint gegen Doppelbuchung | unverändert; `booking-conflict.test.ts` grün, auch mit frischen Idempotenzschlüsseln (ein zweiter Versuch mit **anderem** Schlüssel läuft weiterhin bis zum Constraint) |
| Phase-1-Invarianten und Trigger | unverändert; `invariants.test.ts` / `state-machines.test.ts` grün |
| Serverseitige Autorisierung bei jedem Request | unverändert. Der Kanal fügt **keinen** neuen Datenpfad hinzu: er trägt keine Nutzlast, und jeder Refetch läuft durch die bestehende Autorisierung |
| Redaktionsvertrag interne Notizen | **erneut geprüft auf dem neuen Pfad**: der Kanal meldet nur `dataType: "feedback"`; ein Test legt Feedback mit markierter interner Notiz an und prüft, dass sie weder in `realtime_deliveries`, noch im Outbox-Ereignis, noch in `GET /feedback/mine` erscheint (inkl. nicht freigegebener Felder). Sprachprotokolle erreichen ausschließlich ihren Fahrlehrer |
| `fahrlehrer_go`-Rollenbeschränkung | unverändert serverseitig; `office.test.ts` grün. `apps/office` sendet den Übergang jetzt idempotent, die Rollenprüfung bleibt unangetastet |
| „nur `sicher` bucht automatisch" | unverändert; `finance.test.ts` grün. Der Bankabgleich ist clientseitig als kritisch + offline-verboten eingestuft |
| keine automatische Prüfungsfreigabe | unverändert |
| kein localStorage als fachliche Wahrheit | verschärft: Cache-Einträge tragen Quelle und Version und geben sich nicht als frisch aus; Entwürfe sind verschlüsselte **Kopien** mit Serverbestätigungspflicht |
| eingefrorene Prototyp-Dateien | unangetastet |

---

## Bekannte Lücken der Phase 2

- **§4 ist nicht mit umgeschaltet.** `POST /documents/:id/review` und
  `PATCH /feedback/:id/self-assessment` prüfen `expectedVersion` weiterhin nur,
  **wenn** er gesendet wird. Die Clients senden ihn inzwischen (der Transport
  setzt `If-Match`, wenn eine gelesene Version vorliegt) – aber nicht immer:
  die betroffenen Listenendpunkte (`GET /heute/queue`, `GET /feedback/mine`)
  liefern **keinen** `ETag` je Datensatz, also hat der Client dort keine
  Version zu senden. Eine Pflicht wäre damit ein 428 für einen korrekt
  gebauten Client. **Umschaltpunkt bleibt** `readExpectedVersion` →
  `requireExpectedVersion`; die Voraussetzung ist, dass die Listenendpunkte die
  Version je Zeile mitliefern. Das ist eine API-Erweiterung, nicht eine
  Client-Änderung, und war nicht Teil dieses Auftrags.
- **Der Realtime-Kanal hängt am Outbox-Worker.** Läuft er nicht, entstehen
  keine Zustellzeilen und der Client bleibt beim `resync`-bei-Verbinden plus
  seinem eigenen Refetch. Das ist korrekt (kein falscher Zustand), aber die
  Latenz ist dann die des Workers. Der **Cron-Eintrag ist §15 und damit
  Phase 4** – `buildApp({ startWorkers: true })` existiert, ein Scheduler
  nicht.
- **Zielgruppen werden zum Ereigniszeitpunkt aufgelöst.** Wechselt später die
  Zuordnung (Schüler bekommt einen anderen Fahrlehrer), kann eine bereits
  geschriebene Zustellzeile veraltet sein. Der Schaden ist auf „weiß, dass sich
  etwas geändert hat" begrenzt, weil die Zeile keine Nutzlast trägt und der
  Refetch normal autorisiert wird – aber es ist eine bewusste Näherung, keine
  exakte Zusage.
- **Kein Server-Push ohne offene Verbindung.** Es gibt keine Web-Push-/
  Service-Worker-Integration; eine geschlossene App erfährt nichts, bis sie
  wieder öffnet (dann läuft `resync`). Web-Push wäre §16/§17-Terrain (Keys,
  Consent) und ist nicht Teil von §6.
- **Entwurfsverschlüsselung schützt nicht gegen XSS** – siehe Bedrohungsmodell
  oben. Der Seam für §17 ist vorhanden, aber nicht verdrahtet.
- **`GET /sync/operations` kann Endpunkte ohne §2-Operation nicht auflösen.**
  Für z. B. `POST /instructor/lessons/:id/start` gibt es keinen
  Idempotenzspeicher; ein unbekannter Ausgang bleibt dort ehrlich unbekannt
  (`failed` + „bitte Fachzustand prüfen") statt automatisch wiederholt zu
  werden. Getestet. Die Behebung wäre eine Erweiterung der §2-Liste – eine
  fachliche Entscheidung, nicht eine technische.
- **`packages/sync` testet die HTTP-Transporte nicht end-to-end.**
  `createHttpSyncTransport` / `createHttpRealtimeTransport` sind dünne
  Adapter über `fetch`/`EventSource` und werden über injizierte Transporte
  umgangen; die Logik dahinter ist vollständig getestet, die Adapter selbst
  nur über die vier App-Builds und den echten SSE-Test in `apps/api`.
- **Keine Ende-zu-Ende-Prüfung Browser → SSE → UI.** Der Serverkanal ist gegen
  einen echten Listener getestet, der Client gegen einen bösartigen
  Fake-Transport. Die Verbindung beider im echten Browser ist ein
  Playwright-Szenario und gehört zu den Chaos-Tests der Phase 4 (§20).

---

## Was Phase 3 und Phase 4 von hier übernehmen

Seams, die Phase 2 hinterlässt:

- **`RealtimeStatus.mode` + `GET /sync/changes`** – der Mechanismus für §18
  (Degraded-Operation-UX, Phase 3). Kein Umbau nötig, nur Anzeige und
  Funktionsabschaltung.
- **`SyncStatusBar` / `SyncBadge` / `PendingOperations`** (`packages/ui`) – die
  Stellen, an denen §18 seine „eingeschränkter Betrieb"-Hinweise unterbringt.
- **`deriveKeyFromPassphrase`** (`packages/sync/src/crypto.ts`) – Einhängepunkt
  für §17 Step-up-Auth: Entwurfsschlüssel per Benutzereingabe wrappen.
- **`GET /sync/stream` als langlebige Verbindung** – §17 (Rate-Limiting) muss
  sie ausdrücklich anders behandeln als normale Requests, und §16
  (Observability) hat hier eine natürliche Metrik (offene Streams,
  Cursor-Rückstand je Abonnent, `resync`-Rate).
- **`realtime_deliveries` + `realtime_audience_counters`** – Messgrößen für
  §21-SLOs (Phase 4): Zustell-Latenz = `created_at` minus
  `event_outbox.created_at`, Rückstand = `latestCursor` minus
  Client-Cursor.
- **`Job realtime.prune`** – in `scheduleRecurringJobs` eingeplant, wartet auf
  den Scheduler aus §15 (Phase 4).
- **Der Client als Chaos-Ziel:** `RealtimeTransport` und `SyncTransport` sind
  Schnittstellen. Die 18 Chaos-Szenarien aus §20 (Phase 4) können darüber
  Paketverlust, Duplikate, Vertauschung und Totalausfall einspeisen, ohne
  Produktionscode zu ändern.
- **`__tests__/realtime.test.ts` + `POST /ops/workers/run`** – treiben den
  Fanout deterministisch, brauchbar für §20.

### Abgrenzung (aktualisiert)

| Abschnitt | Phase |
| --- | --- |
| §1 (DB als Wahrheit), §2–§5, §9 (Server), §10, §13, §19 | Phase 1 |
| §1 (Anzeigehälfte), §6, §7, §8, §9 (Client), §2-Pflicht vollständig | **Phase 2 – dieser Teil** |
| §11 Circuit Breaker, §12 Upload-Quarantäne-Härtung, §16 Observability, §17 Rate-Limiting/CSRF/CSP/Step-up, §18 Degraded-Operation-UX | Phase 3 |
| §14 Backup/Restore-Ausführung, §15 Deployment/Scheduler, §20 die 18 Chaos-Szenarien, §21 SLOs, §22 die sieben Dokumente + Release-Gate-Verdikt | Phase 4 |

---

## Testabdeckung der Phase 2

| Datei | Umfang | Tests |
| --- | --- | --- |
| `apps/api/src/__tests__/realtime.test.ts` | §6 Serverseite: Ablauf Commit→Outbox→Kanal, keine Nutzlast (Spaltenprüfung), Zielgruppenauflösung, Schüler-Isolation, Standorttrennung, `systemdienst` ohne Fachzustellung, Sprachprotokoll nur an den Fahrlehrer, Redaktionsvertrag, Cursor-Wiederaufnahme, `hasMore`, alle drei Vollsynchronisationsgründe, doppelter Fanout ohne Lücke, Polling-Fallback, **echter SSE-Listener** (`text/event-stream`, `hello`, `change` mit `id:`, `heartbeat`, `Last-Event-ID`), `GET /sync/operations` (alle drei Antworten + fremder Schlüssel + Sondierschutz), Aufbewahrungsjob | 28 |
| `packages/sync/src/__tests__/realtime.test.ts` | §6 Clientseite gegen einen absichtlich bösartigen Transport: verlorene, doppelte und vertauschte Ereignisse, Duplikaterkennung über Neustart, Heartbeat-Totmann, Reconnect mit Cursor, alle Vollsynchronisationswege, Umschaltung auf Polling, blockierter Stream, offline zählt nicht als Fehler, `retryStream`, `stop()` | 18 |
| `packages/sync/src/__tests__/queue.test.ts` | §7/§8: acht Pflichtfelder, Klartext-Gegenprobe der Verschlüsselung, Identitätswechsel, Entwurfs-Whitelist, kein Offline-Anlegen kritischer Vorgänge, Erfolg nur nach 2xx, Schlüsselstabilität über Retries, `If-Match`, unbekannter Ausgang, Verwerfschutz, Konflikt in die Prüf-Warteschlange, Backoff-Respekt, alle drei Neustart-Auflösungen, Endpunkt ohne §2-Operation, **sieben Tage offline**, Schema-Version, `record_moved_on`, Zusammenfassungs-Rangfolge | 28 |
| `packages/sync/src/__tests__/states-and-retry.test.ts` | §7 Zustandsmenge zeichengenau + Beschriftungen, „Status wird geprüft" für alle neun, §9 transient/dauerhaft je HTTP-Status, `Retry-After` (Sekunden + Datum + kaputt), Erschöpfung, §8 Offline-Vertrag (erlaubt/verboten/fail closed), Auflösung der zehn Operationen, §1 Datenalter + Cache-Quelle | 17 |
| `apps/student/src/state/syncUi.test.tsx` | §1/§7 in der UI (RTL): vier Angaben in der Statuszeile, Entwurf sichtbar, Offline sichtbar, Konflikt mit Serverangaben und ohne Auto-Auflösung, „Status wird geprüft" statt Erfolg, Verwerfschutz mit Bestätigung, Fehlschlag mit vollem Kontext + beide Aktionen, Aufräumen erst nach Bestätigung, offline verbotener Vorgang wird nicht angelegt, §6 Revision nur für das gemeldete Thema | 10 |
| `apps/api/src/__tests__/idempotency.test.ts` (erweitert) | §2-Pflicht für alle zehn, sechs zuvor optionale Endpunkte, Multipart-Upload vor Dateiverarbeitung, Positivfall | +4 |
| `apps/student/src/api/client.test.ts` (erweitert) | §8 Vertrag benennt die verbotene Operation, Entwurfs-Endpunkt scheitert nur am Netz, §2 Schlüssel immer gesetzt, §4 `If-Match` | +4 |

**Gesamt Phase 2: 108 neue Tests.** Workspace: **487** (vorher 379),
17 Pakete typecheck-sauber (vorher 16 – `packages/sync` ist neu).

---
---

# Teil 3 – Phase 3: Defense in Depth, Beobachtbarkeit, degradierter Betrieb

Phase 3 besitzt §11, §12, §16, §17 und §18. Die ausführliche Darstellung liegt
in zwei eigenen Dokumenten, weil §22 sie einzeln verlangt:

- **`docs/security-architecture.md`** – §17 wie implementiert, Bedrohungsmodell,
  die Step-up-Aktionsliste, Secret-Rotation, Abhängigkeitsscan (Ergebnis
  unverändert), und was Mock ist.
- **`docs/failure-modes.md`** – §11 und §18 wie implementiert: jeder
  Ausfallmodus mit Erkennung, degradiertem Verhalten und Rückkehrpfad,
  einschließlich der Runbooks, auf die der Alarmkatalog verweist.

Dieser Teil hält nur fest, **was Phase 3 an dem ändert, was Teil 1 und 2
beschreiben** – und was Phase 4 von hier übernimmt.

## Was sich an Teil 1 und Teil 2 geändert hat

### §4 ist jetzt VOLLSTÄNDIG verpflichtend – Phase 2s Lücke ist geschlossen

Teil 2 hielt fest: „§4 ist nicht mit umgeschaltet", weil
`GET /heute/queue` (real: `GET /office/heute`) und `GET /feedback/mine` keine
Version je Datensatz lieferten – eine Pflicht wäre ein 428 für einen korrekt
gebauten Client gewesen. Die Voraussetzung ist erfüllt:

| Endpunkt | Was neu ist |
| --- | --- |
| `GET /office/heute` | Jeder Queue-Eintrag trägt `version` **und** `etag` (`W/"<n>"`) des referenzierten Datensatzes. `null`, wenn die Entität keine Versionsspalte hat (`lead`, `nachricht`) – eine ehrliche Angabe, kein Fehler; für diese Entitäten fordert §4 keine Version. |
| `GET /feedback/mine` | `version`, `updatedAt` und `etag` je Zeile. `internalNotes` bleibt aus der Spaltenauswahl – der Redaktionsvertrag ist unangetastet und wird zusätzlich statisch geprüft (`code-guards.test.ts`). |
| `GET /documents/mine`, `GET /documents` (neu, Büro) | `etag` je Zeile. |

Damit sind **beide** Umschaltpunkte umgelegt:

| Endpunkt | Vorher | Jetzt |
| --- | --- | --- |
| `POST /documents/:id/review` | geprüft-wenn-gesendet | **`requireExpectedVersion` – Pflicht** |
| `PATCH /feedback/:id/self-assessment` | geprüft-wenn-gesendet | **`requireExpectedVersion` – Pflicht**, mit versionsgebundenem `UPDATE … WHERE version = ?` und 409 samt Serverzustand |

Neu hinzugekommen und von Anfang an Pflicht: `PATCH /users/:id/role`.
`readExpectedVersion` existiert weiter, wird in `apps/api/src/routes` aber
nirgends mehr **allein** benutzt.

**Folge für bestehende Tests:** vier Tests senden jetzt eine Version
(`office.test.ts`, `optimistic-concurrency.test.ts`, `state-machines.test.ts`,
`student-app.test.ts`). Jede Änderung ist an der Stelle kommentiert; keine
Zusicherung wurde entfernt – im Gegenteil, zwei Tests prüfen jetzt
zusätzlich, dass die Liste die Version überhaupt mitliefert.

### §16: die Korrelations-ID beginnt jetzt beim Client, nicht bei der Audit-Zeile

Phase 1 hatte `correlation_id` in `audit_events`, `event_outbox` und `jobs` samt
DB-Trigger, der sie weiterträgt. Was fehlte, war die erste Stufe:
`buildEventRow` erzeugte eine **frische** UUID, weil kein Aufrufer eine mitgab.
Jede Audit-Zeile war damit ihr eigener Vorgang.

Phase 3 schließt das ohne 60 Aufrufstellen anzufassen:

- `packages/events/src/index.ts` hat einen **Anbieter-Einhängepunkt**
  (`setAmbientCorrelationProvider`). `buildEventRow` benutzt
  `input.correlationId ?? ambient ?? randomUUID()` – explizit gesetzte IDs
  behalten Vorrang.
- `apps/api/src/lib/correlation-context.ts` füllt ihn über
  `AsyncLocalStorage`; der `onRequest`-Hook betritt den Kontext.
- Ein vom Client gelieferter `X-Correlation-Id` wird übernommen, **wenn** er
  eine UUID ist (sonst wäre er Log-Injection und ein DB-Typfehler), und in der
  Antwort zurückgegeben.

Getestet als Kette: Anfrage-Header → `audit_events.correlation_id` →
`event_outbox.correlation_id` → `realtime_deliveries` (über den Fremdschlüssel).
`packages/events` bleibt browserfähig – der Anbieter ist ein Funktionszeiger,
keine `node:async_hooks`-Abhängigkeit.

### §12: der Zustand `quarantined` hat endlich einen Produzenten

Teil 1 notierte: „`dokument`-Zustand `quarantined` existiert samt Übergängen;
sein echter Produzent ist die Upload-Härtung (Phase 3)." Er existiert:
**jeder** Upload geht `uploaded → quarantined`, und nur
`services/document-pipeline.ts` bringt ihn weiter. Vorher ging der Upload direkt
nach `submitted`, und der Zustand war unerreichbar.

Neue Invariante **FS009** (Migration 0009): `verified` verlangt
`scan_status = 'sauber'`. Als Trigger, nicht als CHECK – damit der SQLSTATE
zur bestehenden `BUSINESS_SQLSTATE`-Klassifikation passt und die
Reihenfolge nach FS007/FS006 stimmt (der Aufrufer bekommt weiterhin den
spezifischsten Fehler).

**Folge für bestehende Tests:** drei Tests setzen jetzt `scan_status = 'sauber'`
beim Anlegen eines Fixture-Dokuments, und `consistency-check.test.ts`
deaktiviert für seine absichtliche Zustandsmanipulation einen zweiten Trigger.
Auch das ist je Stelle kommentiert.

### §2/§3: ein gefundener Fehler – Deadlock statt Konfliktantwort

Beim Härten des Nebenläufigkeitsverhaltens ist ein **seit Phase 1 bestehender
Fehler** aufgefallen, der nichts mit Phase 3 zu tun hat, aber eine
Non-Negotiable-Zusage betraf:

`terminbuchungen` trägt ZWEI GiST-EXCLUDE-Constraints (Fahrlehrer und
Fahrzeug). Kollidieren zwei gleichzeitige Einfügungen in **beiden**, kann
PostgreSQL einen echten **Deadlock (40P01)** melden statt der erwarteten
Constraint-Verletzung (23P01) – A wartet in Index 1 auf B, B in Index 2 auf A.
Der Verlierer bekam dann **HTTP 500 statt 409**. Gemessen: **9–10 von 50**
gleichzeitigen Doppelbuchungsversuchen; gegen den Stand von Commit `1db1118`
reproduziert. Unauffällig war er nur, weil der bestehende Race-Test genau EINEN
Versuch macht.

Behoben in `lib/idempotency.ts`: ein Serialisierungsfehler (40001/40P01) wird
bis zu viermal wiederholt. Ein Deadlock-Opfer wird von PostgreSQL vollständig
zurückgerollt – auch die Idempotenzreservierung –, ein Wiederholversuch ist
daher sicher und trifft den bereits committeten Gewinner, der dann saubere
23P01 → 409 liefert. Die Klassifikation kommt aus
`packages/events/src/retry.ts` (`SERIALIZATION_FAILURE`), der Backoff aus
`computeBackoffMs` – **keine zweite Retry-Politik**. Die Behebung sitzt am
§2-Choke-Point und gilt damit für alle zehn kritischen Operationen, nicht nur
für die Buchung.

Nachweis: `booking-conflict.test.ts`, „bleibt über 20 Runden gleichzeitiger
Doppelbuchung deterministisch". 20 × 2 Anfragen, Ergebnis exakt
`{201: 20, 409: 20}`.

### §11: `runIntegrationSync` war der angekündigte Einhängepunkt

Teil 1 nannte ihn so. Phase 3 legt sich nicht nur um diesen einen Aufruf,
sondern um **jeden** ausgehenden Aufruf – über `runBuffered`, das Zeitlimit,
Breaker, Retry, ausgehende Idempotenz, Puffer und Fehlerwarteschlange in einem
Ergebnistyp zusammenfasst, der eine falsche Erfolgsmeldung nicht zulässt.

### `alarm.ts` hat den echten Sink bekommen (Teil 1, §16-Übergabe)

Aus dem einen festen stderr-Sink ist eine **Sink-Kette** geworden: stderr
(bleibt, funktioniert überall) + strukturierte §16-Logzeile + Kennzahl
(`fahrschul_alarms_total`) + ein Webhook-Sink als dokumentierter
Konfigurations-Seam (`ALARM_WEBHOOK_URL`, standardmäßig **nicht** registriert –
kein Kanal in dieser Umgebung). Dazu der **Alarmkatalog** als Code: zehn
Alarmarten mit Schwelle, Kennzahl, Zuständigem, Runbook-Anker und Eskalation,
abrufbar über `GET /ops/alerts/catalog`. Ein Sink darf niemals werfen
(`emitAlarm` fängt pro Sink) – eine ausgefallene Alarmierung darf kein
Fachvorgang kippen.

### §17: die Entwurfsverschlüsselung hat ihre Gegenmaßnahme bekommen

Teil 2s Lücke „Entwurfsverschlüsselung schützt nicht gegen XSS – der Seam für
§17 ist vorhanden, aber nicht verdrahtet" ist geschlossen: eine CSP ohne
`unsafe-inline`/`unsafe-eval` für Skripte, als HTTP-Kopfzeile **und** als
`<meta>` in allen vier `index.html`. Die Kompatibilität ist gegen die
tatsächlich gebauten `dist/index.html` geprüft (nur externe Modul-Skripte),
nicht vermutet.

`deriveKeyFromPassphrase` (Teil 2s zweiter §17-Seam) bleibt **unbenutzt**:
Step-up ist an der Sitzung verankert, nicht am Entwurfsschlüssel. Ein
passphrasengeschützter Entwurfsschlüssel hätte bedeutet, dass ein Fahrlehrer
seine Notizen nach jedem Neustart nur mit einer zusätzlichen Eingabe
wiederbekommt – das wäre Reibung ohne Sicherheitsgewinn, solange die CSP die
XSS-Tür schließt. Bewusst offen gelassen, nicht vergessen.

### Der SSE-Stream hat seine eigene Rate-Limit-Politik

Teil 2s Übergabe verlangte, dass §17 den langlebigen Stream „ausdrücklich
anders behandelt". `policyForRequest` bildet `/sync/stream` auf die Politik
`stream` ab (0,5/s, Stoß 12) – begrenzt wird der **Verbindungsaufbau**, nicht
der Datenfluss. Getestet.

## Neue Tabellen (Migration 0009, expand-contract)

| Tabelle / Spalte | Zweck |
| --- | --- |
| `audit_events.chain_seq/prev_hash/row_hash` + 2 Trigger | §17 append-only + Hash-Kette |
| `auth_throttle` | §17 Brute-Force-Zustand, persistiert |
| `sessions.step_up_verified_at/step_up_scope` | §17 Step-up |
| `dokumente.checksum_sha256/groesse_bytes/deklarierter_mime_typ/erkannter_mime_typ/quarantaene_grund/freigegeben_at` | §12 |
| `upload_sessions` | §12 wiederaufnehmbare Uploads |
| `integration_health` | §11 Breaker-Zustand + letzter Erfolg |
| `integration_outbound_calls` | §11 Puffer + Fehlerwarteschlange |
| Trigger `dokumente_c_scan_pflicht_trg` (FS009) | §12/§3 |

Ein Wächtertest prüft, dass 0009 **kein** `DROP COLUMN`, `DROP TABLE`, `RENAME`
und kein `SET NOT NULL` enthält – expand-contract ist damit nicht nur behauptet.

## Non-Negotiables: nach Phase 3 erneut geprüft

| Zusage | Status | Nachweis |
| --- | --- | --- |
| `EXCLUDE`-Constraint gegen Doppelbuchung | unangetastet | statischer Wächter + `booking-conflict.test.ts` unverändert grün |
| Phase-1-Invarianten/Trigger/State Machines | unangetastet, **um FS009 erweitert** | `invariants.test.ts`, `state-machines.test.ts` |
| Phase-2 SSE-Autorisierung + dichter Cursor | unangetastet | `realtime.test.ts` (28 Tests) unverändert grün |
| §2 Pflicht für alle zehn Operationen | unangetastet | statischer Wächter (`IDEMPOTENCY_MANDATORY` = 10 × `true`) |
| Serverseitige Autorisierung auf jedem Request | **verstärkt** | Wächter: jede Schreibroute hat `requireAuth`; neu: Standortfilter in `GET /documents`, `POST /documents/:id/review`, `GET /users` |
| Redaktionsvertrag der Fahrlehrer-Notizen | unangetastet, **auf Logs/Metriken ausgeweitet** | `internalNotes`/`pruefprotokoll` auf der Redaktionsliste; `/metrics` enthält sie nicht (getestet) |
| `fahrlehrer_go` nur durch Rolle `fahrlehrer` | unangetastet | statischer Wächter über `PRUEFUNG_TRANSITIONS` |
| nur `sicher` bucht automatisch | unangetastet | statischer Wächter |
| keine automatische Prüfungsfreigabe | unangetastet | statischer Wächter (kein `to: "fahrlehrer_go"` im Servercode) |
| frozen Prototyp-Dateien | unangetastet | Wächter: kein `PROMPT -1` in den sieben Dateien |

## Was Phase 4 von hier übernimmt

- **`GET /metrics`** (Prometheus-Textformat) – die Messgrundlage für §21-SLOs.
  Latenzhistogramm, Fehlerquote je Statusklasse, `sync_delay_seconds`,
  `dead_letters_open`, Warteschlangentiefen, Breaker-Zustände.
- **`GET /ops/alerts/catalog`** – Schwelle, Zuständiger, Runbook, Eskalation
  maschinenlesbar. §21 kann daraus SLOs ableiten, ohne sie neu zu erfinden.
- **`GET /health/deep`** – ein Aufruf, der den Gesamtzustand samt
  Integrationen liefert. Für die Chaos-Szenarien der ideale Beobachtungspunkt.
- **`POST /ops/audit/verify`** – Chaos-Szenarien, die Daten manipulieren, können
  damit prüfen, ob die Spur intakt ist.
- **`POST /ops/integrations/:integration/breaker`** – ein Ausfall ist für §20
  deterministisch **herstellbar**, ohne Produktionscode zu ändern.
- **`buildTestApp({ rateLimit, bruteForce, integrations })`** – die
  Chaos-Tests laufen gegen einen tatsächlich ratenbegrenzten Server mit weiten
  Kontingenten (`TEST_RATE_LIMIT`), können aber jederzeit enge Werte setzen.
- **`stepUp(app, cookie, …)`** in den Testhelfern – jedes Szenario, das eine
  Step-up-Aktion braucht, ist eine Zeile.
- **Offene Bedingung für das Release-Gate:** zwei Produktionsabhängigkeiten mit
  Advisories (`drizzle-orm` high, `react-router` moderate ×2), im aktuellen Code
  nicht ausnutzbar, Behebung nur per Major-Aktualisierung. Details und
  Bewertung in `docs/security-architecture.md`, Abschnitt 11. **Das gehört in
  die Bedingungsliste, nicht in einen stillen Fix.**

### Abgrenzung (aktualisiert)

| Abschnitt | Phase |
| --- | --- |
| §1 (DB als Wahrheit), §2–§5, §9 (Server), §10, §13, §19 | Phase 1 |
| §1 (Anzeigehälfte), §6, §7, §8, §9 (Client) | Phase 2 |
| §11, §12, §16, §17, §18, §4-Pflicht vollständig | **Phase 3 – dieser Teil** |
| §14 Backup/PITR/Restore, §15 Deployment/Scheduler, §20 die 18 Chaos-Szenarien, §21 SLOs, §22 die sieben Dokumente + Release-Gate-Verdikt | Phase 4 |

## Testabdeckung der Phase 3

| Datei | Umfang | Tests |
| --- | --- | --- |
| `apps/api/src/__tests__/security.test.ts` | §17: Rate Limiting (IP-Dimension mit `Retry-After`, Kontodimension, eigene Stream-Politik, legitimer Zehnfach-Stoß, Abschaltbarkeit), Brute-Force (progressive Verzögerung, Kontosperre, kein Enumerationsorakel, Erfolg löscht den Zähler, Entsperrpfad mit Rollen- und Step-up-Prüfung samt Audit ohne Klartext-E-Mail), CSRF (fremder Origin, `Sec-Fetch-Site: cross-site`, erlaubter Origin, Double-Submit, fremdsitzungsgebundener Token, Cookie/Header-Abweichung, GET-Ausnahme, `logout-all` entzieht), CSP (kein `unsafe-inline`/`unsafe-eval`, Style-Attribut vs. Style-Element, Vite-Kompatibilität, `<meta>`-Variante, Kopfzeilen auf Fehlerantworten, HSTS nur bei HTTPS, `no-referrer`, `no-store`), Step-up (die sieben Aktionen, Passwort+TOTP, Fahrzeug entsperren vs. sperren, Prüfungs-Übersteuerung vs. reguläre Freigabe, sensibler vs. aggregierter Export, TTL, enger Geltungsbereich, Rollenänderung mit allen sechs Schranken), Cookie-Flags, **Mandantentrennung** (Schüler B sieht/ändert nichts von A, fremder Standort sieht nichts), manipulationssicheres Audit (FS008 für UPDATE/DELETE, intakte Kette, erkannte Inhaltsmanipulation, erkannte Löschung, Ops-Route mit Rechteprüfung), sensible Exporte (Ablauf 410, keine öffentliche Route), Least Privilege | 52 |
| `apps/api/src/__tests__/observability.test.ts` | §16: alle Pflichtfelder der Logzeile, keine rohe Benutzer-ID/E-Mail, stabile Pseudonymisierung, Fehlercode, Korrelations-ID (Übernahme, Verwerfen ungültiger Werte, **ganze Kette bis `realtime_deliveries`**), Tracing (Spanne, Fehlerstatus), Redaktion (Feldnamen, IBAN in Freitext, Buffer, **adversarial: Dokument-Upload, abgewiesene Datei, Bankimport**, `details`), Kennzahlen (Fehlerquote je Statusklasse, Latenzhistogramm, ID-freies Routen-Label, fehlgeschlagene Logins, Buchungskonflikte, Scanfehler, Rate-Limit, DB-Verbindungen/Warteschlangen/Dead Letters/Sync-Verzögerung, SSE-Verbindungen, `/metrics`-Format mit allen Namen, Token-Schutz, **kein Personenbezug in Labels**, geschlossene Label-Menge), Alarmierung (Katalogvollständigkeit, Ops-Route, Sink-Kette überlebt kaputten Sink, Schwere aus dem Katalog, Alarmkennzahl, Webhook-Seam wirft nie, keine Registrierung ohne URL) | 35 |
| `apps/api/src/__tests__/uploads.test.ts` | §12: Magic-Byte-Erkennung, benannte gefährliche Typen, **Datei die über ihren Typ lügt**, nicht erlaubter behaupteter Typ, leer/zu groß, Prüfsumme gespeichert und geprüft, Quarantäne-zuerst-Kette, Scanner schlägt an, Büro kann Quarantäne nicht freigeben (+ FS009 per Roh-SQL), signierter Zugriff (nur für Freigegebenes, **A-Signatur nutzt B nicht**, Ablauf 410, manipuliert 403, ohne Sitzung 401, auditiert ohne Inhalt, zweckgebunden, Quarantäne 409), resumable (Zusammensetzen, Fortschritt, idempotentes Teilstück, Konflikt, Lücke, Größenüberschreitung, Magic Bytes am Ende, Prüfsumme, fremde Sitzung, zweites `complete`, Aufräumen, abgelaufene Sitzung), kein Inhalt in der DB, §2 unverändert, Re-Upload-Härtung | 33 |
| `apps/api/src/__tests__/degraded.test.ts` | §11: Puffern ohne Erfolgsmeldung, automatische Wiederaufnahme mit demselben Schlüssel, bekannter Schlüssel ohne zweiten Aufruf, Fehlerwarteschlange + Alarm, manuelle Wiederaufnahme auditiert, Persistenz über den „Neustart", Kennzahlen, Ops-Route über alle zehn. §18: alle **fünf** Szenarien (Realtime aus, Benachrichtigungen aus, Fahrschulverwaltung aus inkl. Doppelimport-Schutz und Quelle-der-Wahrheit-Regel, Bank aus mit `veraltet`/kein Block, Scanner aus mit Quarantäne/Retry/nicht in der Büro-Queue) + `/health/deep` als gemeinsame Anzeige | 21 |
| `apps/api/src/__tests__/code-guards.test.ts` | §16/§17-Wächter: jeder Runbook-Anker des Alarmkatalogs löst auf, die beiden §22-Dokumente existieren; : kein `.unsafe(`, keine SQL-Verkettung, kein `eval`/`Function`/`child_process`, kein TLS-Abschalter; Validierungsabdeckung **aller** Schreibrouten mit geschlossener Body-freier Liste (die selbst geprüft wird); `requireAuth` auf jeder Schreibroute; Redaktionsvertrag statisch; Non-Negotiables statisch (EXCLUDE, expand-contract in 0009, §2-Pflicht, keine automatische Freigabe, nur `sicher` bucht, `fahrlehrer_go`, frozen Dateien) | 19 |
| `apps/api/src/__tests__/booking-conflict.test.ts` (erweitert) | **20 Runden** gleichzeitiger Doppelbuchung – deckt einen seit Phase 1 bestehenden Fehler ab (zwei GiST-EXCLUDE-Constraints können statt 23P01 einen **Deadlock** 40P01 melden; der Verlierer bekam dann HTTP 500 statt 409, in 9–10 von 50 Durchläufen). Behoben durch bounded Retry auf Serialisierungsfehler in `lib/idempotency.ts` – Klassifikation und Backoff aus §9, keine zweite Politik. | +1 |
| `packages/integrations/src/resilience.test.ts` | §11-Mechanik ohne DB: geschlossen bleibt geschlossen, Öffnen nach Schwelle + Kurzschluss, `half_open` mit **genau einer** Sondierung, Erholung, erneutes Öffnen mit verdoppelter Zeit, Zeitlimit, dauerhafte Fehler öffnen nicht, Rate Limit ist keine Störung, `Retry-After` (Sekunden + Datum), geteilte §9-Politik, Schlüsseldurchleitung, Zustandswechsel-Haken, Fehlerwarteschlange erst nach Erschöpfung, manuelles Öffnen/Schließen, `withTimeout` ohne unbehandelten Fehler; Registry (ein Wächter je Integration, alle zehn mit Zeitlimit, Schnappschuss mit `mock`) | 19 |

**Gesamt Phase 3: 180 neue Tests.** Workspace: **667** (vorher 487),
17 Pakete typecheck-sauber, alle vier Apps `vite build` sauber (die CSP im
`<meta>`-Tag überlebt den Build und die Ausgabe enthält weiterhin **kein**
Inline-Skript).
