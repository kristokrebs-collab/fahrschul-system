# Ausfallverhalten und degradierter Betrieb (PROMPT -1 §11 + §18)

Stand: Phase 3. Branch `claude/driving-school-admin-tcz2cx`.

Dieses Dokument beschreibt für **jeden Ausfallmodus**: wie er **erkannt** wird,
wie sich das System dann **verhält**, und auf welchem **Weg es zurückkommt** –
automatisch und manuell. Alles hier ist implementiert und getestet; was Mock
ist, steht als Mock da.

Begleitdokumente: `docs/security-architecture.md` (§17),
`docs/sync-architecture.md` (§1–§10, §13, §19),
`docs/integration-gaps.md` (kein echter Anbieter in dieser Umgebung).

---

## 1. Die Grundhaltung in vier Sätzen

1. **Der Kern hängt an nichts Externem.** Termine, Ausbildung, Dokumente,
   Rechnungen leben in Postgres. Fällt jede externe Schnittstelle aus, bleibt
   die Fahrschule arbeitsfähig.
2. **Ein Ausfall verliert nichts.** Was nach außen gehen sollte, liegt in
   `integration_outbound_calls` – mit dem Idempotenzschlüssel, mit dem es
   später zugestellt wird.
3. **Es gibt keine falsche Erfolgsmeldung.** `runBuffered` liefert genau drei
   Ergebnisse: `zugestellt`, `gepuffert`, `endgueltig_fehlgeschlagen`. Der
   Rückgabetyp lässt „gesendet" ohne Zustellung nicht zu.
4. **Nichts wird auf Basis veralteter Daten gesperrt.** Ein Ausfall führt zu
   einer Kennzeichnung („veraltet"), nie zu einer automatischen Blockade.

---

## 2. §11 – Was jede Integration bekommt

`packages/integrations/src/resilience.ts` (Mechanik) +
`apps/api/src/services/integrations.ts` (Wirkung). **Einmal** implementiert, für
alle zehn Integrationen – nicht zehnmal in zehn Adaptern.

| Gefordert | Umsetzung | Beweis |
|---|---|---|
| **Timeout** | `withTimeout` je Aufruf; Standardwerte je Integration (`DEFAULT_TIMEOUTS`: Push 5 s … Transkription 60 s) – unterschiedlich, weil die Aufgaben unterschiedlich sind | „erklärt einen hängenden Aufruf nach dem Zeitlimit zum TIMEOUT statt zu warten" |
| **Circuit Breaker** | `closed`/`open`/`half_open` mit echten Übergängen, persistiert in `integration_health` | sechs Tests, siehe Abschnitt 3 |
| **Retry-Regeln** | `decideRetry`/`classifyError` **unverändert** aus `packages/events/src/retry.ts` – keine dritte Politik | „wiederholt transiente Fehler nach der GETEILTEN §9-Politik" |
| **Idempotenzschlüssel ausgehend** | `CallOptions.idempotencyKey` ist **Pflicht**; Unique-Index `(integration, operation, idempotency_key)`; ein bekannter Schlüssel liefert das gespeicherte Ergebnis statt eines zweiten Aufrufs | „liefert bei einem BEKANNTEN Schlüssel das gespeicherte Ergebnis zurück statt erneut zu senden" |
| **Gesundheitsstatus** | `gesund` / `eingeschraenkt` / `ausgefallen`, abgeleitet aus Breaker + Rate-Limit + Fehlerwarteschlange; `GET /ops/integrations`, `GET /health/deep` | „meldet den Gesundheitsstatus aller zehn Integrationen" |
| **Letzte erfolgreiche Synchronisation** | `integration_health.last_success_at`, **persistiert** – überlebt den Neustart | „persistiert den Breaker-Zustand und den letzten Erfolg – ein Neustart lügt nicht" |
| **Fehlerwarteschlange** | `integration_outbound_calls.status = 'failed'`; `GET /ops/integrations/error-queue` | „verschiebt einen Aufruf nach Erschöpfung in die FEHLERWARTESCHLANGE und alarmiert" |
| **Rate-Limit-Behandlung** | HTTP 429 des Anbieters ist **kein** Breaker-Fehler: er setzt `rate_limited_until` aus dessen `Retry-After`; Aufrufe davor werden sofort abgewiesen | „behandelt ein Rate Limit des Anbieters als Wartezeit, NICHT als Ausfall" |
| **Klare sandbox/live-Kennzeichnung** | `integration_health.mode` (Constraint `mock|sandbox|live`), in jeder Ops-Antwort mitgeliefert; `assertMockOnly` wirft weiterhin für sandbox/live | „für alle Integrationen `mode === 'mock'`", plus Hinweistext in `GET /ops/integrations` |

### Die zehn Integrationen

`notifications`, `calendar`, `bank`, `storage`, `crm`, `malware-scan`,
`payments`, `transcription`, `ai-suggestions`, `fahrschulverwaltung`.
Ein Test prüft, dass **jede** ein Zeitlimit hat und dass die Namensliste und
die Zeitlimit-Tabelle deckungsgleich sind – eine neue Integration kann nicht
ohne Zeitlimit dazukommen.

---

## 3. Der Circuit Breaker im Detail

```
             failureThreshold aufeinanderfolgende TRANSIENTE Fehler
   closed  ─────────────────────────────────────────────────────►  open
      ▲                                                             │
      │  successThreshold Erfolge                    openMs abgelaufen
      │                                                             ▼
      └──────────────────────────  half_open  ◄────────────────────┘
                                       │
                                       │ ein Fehler in der Sondierung
                                       └──────────────────►  open (openMs ×2, gekappt)
```

Standard: `failureThreshold: 5`, `successThreshold: 2`, `openMs: 30 s`,
`maxOpenMs: 10 Min.`

**Eigenschaften, die getestet sind:**

- In `open` wird **kein** Aufruf versucht (`shortCircuited: true`, Klasse
  `SERVER_UNAVAILABLE` = transient → der Aufrufer puffert).
- In `half_open` geht **genau ein** Sondierungsaufruf durch; jeder parallele
  wird kurzgeschlossen („Sondierung läuft bereits"). Kein Sondierungssturm auf
  ein System, das gerade ausgefallen war.
- Eine fehlgeschlagene Sondierung **verdoppelt** die Öffnungszeit – ein
  dauerhaft toter Anbieter wird nicht im Sekundentakt angeklopft.
- **Dauerhafte** Fehler (400/403/422) öffnen den Breaker **nicht**. Sie sagen
  etwas über unsere Anfrage, nicht über die Gesundheit des Anbieters; ein
  einziger falscher Datensatz darf keine Integration abschalten.
- Der Zustandswechsel ist ein Ereignis: strukturierte Logzeile, Kennzahl
  `fahrschul_integration_breaker_transitions_total`, Alarm bei `→ open`.
- Manuell steuerbar: `POST /ops/integrations/:integration/breaker`
  (`{"aktion":"schliessen"|"oeffnen"}`) – der Betrieb muss beides können
  („der Anbieter ist wieder da, versuch es sofort" und „Wartungsfenster
  angekündigt, hör auf zu versuchen").

---

## 4. Der Puffer und die Fehlerwarteschlange

Jeder ausgehende Aufruf legt **vor** dem Versuch eine Zeile in
`integration_outbound_calls` an (`in_flight`). Sie ist der Beweis, dass der
Aufruf gewollt war – auch wenn der Prozess unmittelbar danach abstürzt.

| Ausgang | Status | Ergebnis für den Aufrufer | UI |
|---|---|---|---|
| Erfolg | `succeeded` + gespeichertes Ergebnis | `zugestellt` | normaler Erfolg |
| Transienter Fehler oder offener Breaker | `buffered`, `next_attempt_at = +30 s` | `gepuffert` | **„wartet auf externe Synchronisation"** |
| Dauerhafter Fehler | `failed` | `endgueltig_fehlgeschlagen` | „muss manuell nachgearbeitet werden" |
| Versuche erschöpft (`attempts >= max_attempts`, Standard 8) | `failed` + Alarm | `endgueltig_fehlgeschlagen` | dito |

**Wiederaufnahme, beide Wege (§11 verlangt beide):**

- **automatisch:** Job `integration.resume` (alle 5 Minuten in
  `scheduleRecurringJobs`) bzw. `POST /ops/integrations/resume`. Der Aufruf wird
  mit **demselben** Idempotenzschlüssel wiederholt – getestet.
- **manuell:** `POST /ops/integrations/error-queue/:id/resume`, optional mit
  `{"resetBreaker": true}`. Setzt `failed → buffered`, `attempts = 0`, und
  **auditiert** die Entscheidung (`integration.call.resumed`). Bewusst kein
  „alles automatisch reparieren": ein Mensch entscheidet, ob der Aufruf
  fachlich noch sinnvoll ist.

Aufräumen: `pruneOutboundCalls` entfernt erfolgreiche Zeilen älter als 30 Tage.

---

## 5. §18 – Die fünf Szenarien

Alle fünf sind in `apps/api/src/__tests__/degraded.test.ts` als eigene
Abschnitte geprüft.

### 5.1 Echtzeitkanal ausgefallen

| | |
|---|---|
| **Erkennung** | Client: `RealtimeStatus.mode` wechselt nach `maxStreamFailures` auf `polling`, nach Heartbeat-Totmann auf `down` (Phase 2). Server: `fahrschul_realtime_connections`, `fahrschul_sync_delay_seconds`, Alarm `sync_delay` bei > 120 s für > 5 Min. |
| **Verhalten** | **API und Polling arbeiten unverändert.** `GET /sync/changes` ist derselbe Lesepfad wie der Stream, nur ohne langlebige Verbindung – identische Konvergenz, höhere Latenz. Schreibvorgänge sind vom Kanal völlig unabhängig (getestet: Buchung ohne laufenden Worker). |
| **Was der Nutzer sieht** | `SyncStatusBar`: „Aktualisierung im Rückfallmodus" bzw. „keine Live-Verbindung". `DegradedBanner`: „Live-Aktualisierung – Rückfallmodus: die Anzeige aktualisiert sich verzögert. **Alle Aktionen funktionieren unverändert.**" |
| **Was NICHT passiert** | Keine Sperre, kein Fehlerzustand, keine 5xx. `GET /health/deep` bleibt 200 und meldet den Kern als nutzbar. |
| **Rückkehr** | Automatisch: der Client versucht den Stream weiter (`retryStream`), bei Erfolg `resync` mit Cursor. Ist der Cursor zu alt, `resyncRequired: 'cursor_pruned'` → Vollsynchronisation. Kein Datenverlust, weil eine Kanalmeldung nie eine Datenquelle war. |

### <a id="runbook-sync-verzoegerung"></a>Runbook: Sync-Verzögerung

1. Alarm `sync_delay` (Schwelle `fahrschul_sync_delay_seconds > 120` für > 5
   Min.). Zuständig: `systemdienst`.
2. `GET /ops/outbox` → Statusverteilung. Viele `pending` = der Outbox-Worker
   läuft nicht. Viele `in_flight` mit abgelaufenem Lease = ein Worker ist
   gestorben.
3. Läuft der Worker? In dieser Umgebung gibt es **keinen Scheduler**
   (§15, Phase 4): `POST /ops/workers/run` treibt einen Durchlauf von Hand.
4. `GET /ops/dead-letters` prüfen – ein blockierendes Ereignis kann die
   Zustellung stauen.
5. Eskalation nach 30 Min. an die Geschäftsführung. Kein Datenverlust: Clients
   fallen auf Polling zurück.

### 5.2 Benachrichtigungsdienst ausgefallen

| | |
|---|---|
| **Erkennung** | `runBuffered` liefert `gepuffert`; Breaker öffnet nach 5 Fehlern; Alarm `integration_breaker_open`; `fahrschul_integration_buffer_depth{integration="notifications"}` steigt. |
| **Verhalten** | **Der Termin bleibt gültig** (er ist längst committet). Die Nachricht bleibt in `nachrichten.status = 'warteschlange'` – ausdrücklich **nicht** `gesendet` und **nicht** `fehlgeschlagen`. `fehlgeschlagen` würde in der Heute-Queue des Büros als Handlungsbedarf erscheinen, obwohl der Job es selbst nachholt. |
| **Antwortvertrag** | `POST /communication/send` liefert `zustellung: "wartet_auf_externe_synchronisation"` **getrennt** vom fachlichen Zustand, plus Hinweistext. Das Feld existiert immer – die UI muss nicht raten. |
| **Was der Nutzer sieht** | `DegradedBanner`: „Benachrichtigungen (E-Mail/Push) – ausgefallen. Termine bleiben gültig. Benachrichtigungen warten auf externe Synchronisation und werden automatisch nachgesendet – **bitte NICHT als versendet behandeln.**" plus Anzahl der wartenden Vorgänge und Zeitpunkt der letzten erfolgreichen Synchronisation. |
| **Rückkehr** | Automatisch, zwei Wege: Job `notifications.dispatch` arbeitet die `warteschlange` ab; Job `integration.resume` stellt die gepufferten Aufrufe zu – mit demselben Idempotenzschlüssel (`nachricht:<id>`), also ohne Doppelversand. Getestet. |

### 5.3 Fahrschulverwaltungssoftware ausgefallen

| | |
|---|---|
| **Erkennung** | Breaker `fahrschulverwaltung` öffnet; `GET /ops/integrations` zeigt `ausgefallen` + `gepuffert > 0`. |
| **Quelle-der-Wahrheit-Regel** | **Diese Plattform ist die führende Quelle** für Termine, Ausbildung, Dokumente und Rechnungen (§1, Phase 1). Die externe Verwaltung ist ein **nachgelagertes Ziel**. Das ist nicht nur ein Satz, sondern an der Datenrichtung erkennbar: es gibt eine Tabelle für **ausgehende** Aufrufe (`integration_outbound_calls`) und **keinen** Pfad, über den ein externes System hier einen Fachzustand setzt. Ein Test prüft, dass genau diese zwei `integration*`-Tabellen existieren. |
| **Verhalten** | Die Plattform bucht, prüft und rechnet unverändert weiter. Getestet: Termin wird angelegt, während der Abgleich gepuffert ist. |
| **Kein Doppelimport** | Der Idempotenzschlüssel des Abrufs bindet ihn an sein **Zeitfenster** (`stammdaten:<ISO-Stunde>`). Zwei Wiederherstellungsversuche mit demselben Fensterschlüssel führen zu **einem** Import – getestet. Zusätzlich gilt weiterhin §2 für die zehn kritischen Operationen: ein wiederholter Import kann keine zweite Buchung erzeugen. |
| **Rückkehr** | Automatisch über `integration.resume`; manuell über die Fehlerwarteschlange. In dieser Umgebung liefert der Wiederaufnahmepfad für `fahrschulverwaltung` bewusst einen **transienten** Fehler („kein Zugang (mock)"), damit der Eintrag gepuffert bleibt statt fälschlich als erledigt zu verschwinden. |

### 5.4 Finanz-/Bankintegration ausgefallen

| | |
|---|---|
| **Erkennung** | Breaker `bank` öffnet; `POST /finance/bank/sync` erkennt es vor dem Abruf. |
| **Verhalten** | **HTTP 200**, nicht 5xx – fachlich ist nichts kaputt. Ein Fehlercode würde die Oberfläche in einen Fehlerzustand versetzen und einen Retry-Sturm auslösen. Antwort: `zahlungsstatus: "veraltet"`, `letzteErfolgreicheSynchronisation`, `integrationsstatus`, `autoGebucht: 0`. |
| **Kein automatischer Block** | Es wird **nichts** gebucht, **nichts** gemahnt, **nichts** gesperrt. Getestet: Ausbildung und Termine laufen weiter, `ausbildungen.status` bleibt unverändert. Der Hinweistext sagt es wörtlich: „Es erfolgt **KEINE automatische Sperre** und keine Mahnung auf Basis veralteter Daten." |
| **Was der Nutzer sieht** | `DegradedBanner` im Finanz-Cockpit: „Bankabgleich – ausgefallen. Ausbildung und Termine laufen normal weiter. **Zahlungsdaten sind VERALTET**; es werden keine Mahnungen und keine Sperren auf dieser Grundlage ausgelöst." plus Alter der letzten Synchronisation. |
| **Rückkehr** | Automatisch: Breaker sondiert nach `openMs`, `integration.resume` holt den gepufferten Abruf nach (derselbe Fensterschlüssel `bank-sync:<sinceIso>` → kein Doppelimport). Manuell: `POST /ops/integrations/bank/breaker` `{"aktion":"schliessen"}` und erneut `POST /finance/bank/sync`. |
| **Unverändert** | „Nur `konfidenz = 'sicher'` wird automatisch gebucht" bleibt in Kraft (Non-Negotiable, statisch geprüft). |

### 5.5 Dokumentscanner ausgefallen

| | |
|---|---|
| **Erkennung** | `releaseDocumentAfterScan` erhält keinen Scanstatus → `scannerAusgefallen: true`; Kennzahl `fahrschul_document_scan_failures_total{reason="scanner_unavailable"}`; Alarm `document_scan_unavailable`. |
| **Verhalten** | Der Upload wird **gespeichert** (nichts geht verloren), **bleibt in `quarantined`**, `scan_status = 'ausstehend'`, `geprueft = false`. Er wird **nie** als geprüft angezeigt. |
| **Warum nicht durchlassen** | „Fail open" wäre hier eine Sicherheitslücke. |
| **Warum nicht ablehnen** | Das wäre eine **falsche Aussage** über die Datei des Schülers. |
| **Doppelt abgesichert** | Anwendungsprüfung **und** DB-Invariante **FS009** (`verified` verlangt `scan_status = 'sauber'`). Selbst Roh-SQL kann ein ungescanntes Dokument nicht als geprüft speichern – getestet. |
| **Nicht sichtbar als Arbeit** | Ein Dokument in Quarantäne erscheint **nicht** in der Prüf-Warteschlange des Büros (`GET /office/heute`) – getestet. Das Büro soll nicht auf etwas warten, das es nicht freigeben darf. |
| **Nicht auslieferbar** | `GET /documents/:id/content` antwortet mit **409 `document_in_quarantine`**, auch mit gültiger Signatur. |
| **Was der Schüler sieht** | „Die Virenprüfung ist derzeit nicht erreichbar. Das Dokument ist gespeichert, bleibt aber in Quarantäne und wird automatisch erneut geprüft. **Es gilt NICHT als geprüft.**" |
| **Rückkehr** | Automatisch: `retryQuarantinedScans` (im Job `document.review`) scannt alles in Quarantäne erneut und gibt bei sauberem Ergebnis frei – getestet (`quarantined → scanning → submitted`). |

### <a id="runbook-dokumentscanner-aus"></a>Runbook: Dokumentscanner ausgefallen

1. Alarm `document_scan_unavailable`. Zuständig: `systemdienst`, fachliche
   Information an das Büro.
2. `GET /ops/integrations` → Zustand von `malware-scan`, Anzahl gepufferter
   Aufrufe.
3. Anzahl wartender Dokumente:
   `select count(*) from dokumente where dokument_status = 'quarantined'`.
4. Nach Behebung: `POST /ops/integrations/malware-scan/breaker`
   `{"aktion":"schliessen"}`, dann `POST /ops/jobs/run`
   `{"jobTypes":["document.review"]}`. Die Quarantäne läuft leer.
5. Eskalation nach 4 Stunden an das Büro: Schüler informieren, dass die Prüfung
   länger dauert. **Nie** manuell freigeben – FS009 verhindert es ohnehin.
6. **Erinnerung:** der Scanner ist in dieser Umgebung ein Mock
   (`mock-always-clean`). Ein echter AV-Anbieter ist Voraussetzung für den
   Produktivbetrieb (`docs/integration-gaps.md`).

---

## 6. Weitere Ausfallmodi (aus Phase 1, hier vollständig aufgeführt)

### <a id="runbook-dead-letter-queue"></a>Dead-Letter-Queue

| | |
|---|---|
| **Erkennung** | `fahrschul_dead_letters_open > 0`; Alarm `dead_letter` (kritisch) bei > 15 Min.; `GET /ops/dead-letters` |
| **Verhalten** | Die Zustellung des betroffenen Ereignisses stoppt. Die **Fachdaten bleiben konsistent** – die Outbox ist die Zustellseite, nicht die Wahrheit. |
| **Runbook** | 1. `GET /ops/dead-letters` → `source`, `error_class`, `last_error`, `audit_kontext`. 2. Ursache beheben. 3. `POST /ops/dead-letters/:id/resume` – legt einen neuen Job an, ändert **keinen** Fachzustand. 4. `POST /ops/workers/run`. 5. Erneut prüfen. |
| **Eskalation** | nach 30 Min. an die Geschäftsführung. Zuständig: `systemdienst` (Bereitschaft). |

### <a id="runbook-haengende-jobs"></a>Hängende Jobs

| | |
|---|---|
| **Erkennung** | `fahrschul_job_queue_depth{status="in_progress"}` bleibt stehen; Alarm `job_stuck` nach > 3 Wiederaufnahmen |
| **Verhalten** | Lease-Ablauf + Maximallaufzeit → der Job wird neu beansprucht (`recoverExpiredJobLeases`). Es gibt **kein** aktives Abbrechen (dokumentierte Phase-1-Grenze). Nach erschöpften Versuchen: Dead Letter. |
| **Runbook** | 1. `GET /ops/jobs?status=in_progress` → `attempts`, `lease_expires_at`, `last_error`. 2. Job-Typ bewerten: die betroffene Automatik läuft nicht, manuelle Arbeit bleibt möglich. 3. `POST /ops/jobs/run` treibt einen Durchlauf. 4. Bei einem dauerhaft hängenden Handler: Ursache im Code, nicht im Betrieb. |
| **Eskalation** | nach 60 Min. an die Geschäftsführung. |

### <a id="runbook-konsistenzbefunde"></a>Konsistenzbefunde (§19)

| | |
|---|---|
| **Erkennung** | Alarm `consistency_findings` bei einem Befund der Schwere „kritisch"; `GET /ops/consistency/runs` |
| **Verhalten** | Der Check **berichtet**. Riskante Reparaturen sind **ausschließlich Vorschläge**; es gibt keinen Endpunkt, der sie anwendet (Phase-1-Zusage, unverändert). |
| **Runbook** | 1. `GET /ops/consistency/runs/:id` → Befunde mit `entitaet`, `entitaetId`, `vorschlag`, `vorschlag_riskant`. 2. Fachliche Bewertung durch das Büro, technische durch `systemdienst`. 3. Korrektur über die **regulären** Endpunkte (auditiert, versioniert), nie per Roh-SQL. 4. Nächsten Lauf abwarten. |
| **Eskalation** | täglicher Bericht an die Geschäftsführung. |

### <a id="runbook-externe-schnittstelle-offen"></a>Externe Schnittstelle: Breaker offen

| | |
|---|---|
| **Erkennung** | `fahrschul_integration_breaker_open{integration} == 1` für > 5 Min.; Alarm `integration_breaker_open` |
| **Verhalten** | Aufrufe werden kurzgeschlossen (kein Aufruf geht nach draußen), Änderungen gepuffert, `/health/deep` meldet `eingeschraenkt`, die UI zeigt das Banner. Der Kern bleibt nutzbar. |
| **Runbook** | 1. `GET /ops/integrations` → `breakerState`, `openedAt`, `probeAfter`, `lastError`, `lastErrorClass`, `gepuffert`, `fehlerwarteschlange`. 2. `lastErrorClass` deuten: `TIMEOUT`/`NETWORK`/`SERVER_UNAVAILABLE` = Anbieterproblem; `RATE_LIMITED` = **kein** Ausfall, nur Wartezeit (der Breaker ist dann geschlossen und `rateLimitedUntil` gesetzt). 3. Anbieterstatus prüfen. 4. Nach Behebung: warten (Sondierung nach `probeAfter`) oder `POST /ops/integrations/:integration/breaker` `{"aktion":"schliessen"}`. 5. `POST /ops/integrations/resume` leert den Puffer. |
| **Eskalation** | nach 4 Stunden an die Geschäftsführung. |

### <a id="runbook-fehlerwarteschlange"></a>Fehlerwarteschlange ausgehender Aufrufe

| | |
|---|---|
| **Erkennung** | `fahrschul_integration_buffer_depth > 100` oder `status='failed'` > 0 für > 24 h; Alarm `integration_error_queue` |
| **Verhalten** | Nichts ist verloren; nichts wird automatisch wiederholt (die Versuche sind erschöpft oder der Fehler ist dauerhaft). |
| **Runbook** | 1. `GET /ops/integrations/error-queue?integration=…` → `operation`, `idempotency_key`, `payload`, `last_error_class`. 2. `last_error_class` deuten: `VALIDATION`/`PERMISSION` = **unser** Aufruf ist falsch (Code oder Daten korrigieren, dann wiederaufnehmen); alles andere = Anbieterseite. 3. Fachlich prüfen, ob der Aufruf **noch sinnvoll** ist (eine Terminerinnerung für einen vergangenen Termin ist es nicht). 4. `POST /ops/integrations/error-queue/:id/resume` (optional `resetBreaker`). Auditiert. 5. Nicht mehr sinnvolle Einträge bleiben als `failed` stehen – sie sind Nachweis, nicht Rückstand. |
| **Eskalation** | nach 24 Stunden an Büro (fachliche Nacharbeit) und Geschäftsführung. |

### Serialisierungsfehler / Deadlock in der Datenbank

| | |
|---|---|
| **Erkennung** | SQLSTATE 40001 (`serialization_failure`) oder 40P01 (`deadlock_detected`); §9 klassifiziert beide als `SERIALIZATION_FAILURE` = transient |
| **Verhalten** | `runIdempotent` wiederholt die **gesamte** Transaktion bis zu viermal mit kurzem, gejittertem Backoff. Ein Deadlock-Opfer wird von PostgreSQL vollständig zurückgerollt – auch die Idempotenzreservierung –, es bleibt nichts Halbes zurück. Der Wiederholversuch trifft den committeten Gewinner und liefert die richtige fachliche Antwort (z. B. 409 bei Doppelbuchung). |
| **Warum das nötig war** | Zwei GiST-EXCLUDE-Constraints auf `terminbuchungen` können bei gleichzeitigen kollidierenden Einfügungen einen Deadlock erzeugen. Ohne Wiederholung bekam der Verlierer HTTP 500 statt 409 – in 9–10 von 50 Durchläufen. Siehe `docs/sync-architecture.md`, Teil 3, „§2/§3". |
| **Rückkehr** | Automatisch innerhalb derselben Anfrage. Sind die vier Versuche erschöpft, wird der Fehler durchgereicht; §9 klassifiziert ihn als transient, der Client darf ihn mit demselben Idempotenzschlüssel wiederholen. |
| **Nachweis** | `booking-conflict.test.ts`, 20 Runden, Ergebnis exakt `{201: 20, 409: 20}` |

### Datenbank nicht erreichbar

| | |
|---|---|
| **Erkennung** | `GET /health/deep` → **503**, `datenbank: "nicht erreichbar"`; `fahrschul_db_connections` = -1 (Abfrage fehlgeschlagen) |
| **Verhalten** | Die Instanz ist nutzlos – §1: die Datenbank **ist** die Wahrheit. Dies ist der **einzige** Fall, in dem `/health/deep` 503 liefert und ein Loadbalancer die Instanz herausnehmen soll. |
| **Clientseite** | Die vier Apps zeigen ihren letzten Stand mit Altersangabe (§1) und verweigern kritische Schreibvorgänge (§8-Offline-Vertrag, fail closed). Entwürfe bleiben lokal verschlüsselt liegen. |
| **Rückkehr** | Sobald die Datenbank antwortet, arbeitet alles weiter. Die Clients lösen offene Vorgänge über `GET /sync/operations/:operation/:key` auf – kein blindes Wiederholen, kein falscher Erfolg. |
| **Wiederherstellung von Daten** | §14 (Backup/PITR/Restore) ist **Phase 4**. |

### Anmeldesperre, Rate-Limit-Flut, Audit-Manipulation

Siehe `docs/security-architecture.md`, Abschnitte 2, 3 und 8 (mit Runbooks).

---

## 7. Was der Nutzer sieht – die UI-Seite von §18

`packages/ui/src/DegradedBanner.tsx`, eingebaut in **alle vier** Apps
(`apps/student/src/App.tsx`, `apps/instructor/src/App.tsx`,
`apps/office/src/components/Layout.tsx`, `apps/finance/src/App.tsx`).

Vier Regeln:

1. **Der Kern wird nie als kaputt dargestellt.** „Eingeschränkter Betrieb",
   nicht „Störung", plus der Satz „Termine, Ausbildung und Dokumente
   funktionieren normal."
2. **Kein falscher Erfolg.** Was auf externe Synchronisation wartet, heißt so.
   `ExternalSyncPending` ist der Baustein für die Einzelanzeige.
3. **Nichts wird gesperrt, was ohne die Schnittstelle möglich ist.** Das Banner
   informiert; es schaltet nichts ab. Genau deshalb liefert `/health/deep` 200.
4. **Der Zeitpunkt der letzten erfolgreichen Synchronisation ist sichtbar** –
   sonst hält man veraltete Zahlungsdaten für aktuell.

Je Integration steht dort **nicht** „Dienst X offline", sondern was der Nutzer
trotzdem tun kann (`DEGRADED_HINTS`). Der Realtime-Teil kommt aus
`RealtimeStatus.mode` des Sync-Kerns, nicht vom Server – ein Client, der auf
Polling zurückgefallen ist, weiß das selbst am besten.

---

## 8. Ausfallmatrix auf einen Blick

| Ausfall | Kern nutzbar? | Verlust? | Falscher Erfolg möglich? | Automatische Rückkehr | Manuelle Rückkehr |
|---|---|---|---|---|---|
| Echtzeitkanal | **ja** | nein | nein | ja (Polling → Stream, `resync`) | Neuladen |
| Benachrichtigungen | **ja** | nein (Warteschlange + Puffer) | **nein** (`zustellung`-Feld) | ja (2 Jobs) | Fehlerwarteschlange |
| Fahrschulverwaltung | **ja** | nein (Puffer) | nein | ja (`integration.resume`) | Fehlerwarteschlange |
| Bank/Finanzen | **ja** | nein (Puffer) | nein (`zahlungsstatus: veraltet`) | ja (Breaker-Sondierung) | Breaker schließen + Sync |
| Dokumentscanner | **ja** (Upload wird gespeichert) | nein | **nein** (FS009 + Quarantäne) | ja (`document.review`) | Breaker schließen + Job |
| Outbox-Worker | **ja** | nein | nein | – (Worker starten) | `POST /ops/workers/run` |
| Dead Letter | **ja** | nein | nein | nein (bewusst) | `resume` |
| Datenbank | **nein** | – | nein | ja, sobald erreichbar | §14 (Phase 4) |

---

## 9. Bekannte Lücken dieser Phase (§11/§18)

1. **Kein echter Anbieter.** Zeitlimit, Breaker, Retry, Puffer,
   Fehlerwarteschlange, Gesundheitsstatus und alle fünf Degradationspfade sind
   echt und gegen **absichtlich fehlerhafte Adapter** getestet. Die Anbieter
   selbst sind Mocks (`docs/integration-gaps.md`). Ein `sandbox`/`live`-Test
   ist ohne Zugang nicht möglich, und `assertMockOnly` wirft weiterhin, damit
   niemand versehentlich eine Live-Schnittstelle behauptet.
2. **Kein Scheduler.** `integration.resume`, `uploads.cleanup`,
   `audit.verify` und `document.review` sind in `scheduleRecurringJobs`
   eingeplant und über `POST /ops/jobs/run` treibbar, aber der Cron-Eintrag ist
   §15 und damit **Phase 4**. Ohne ihn ist die „automatische" Wiederaufnahme
   nur so automatisch wie der Auslöser.
3. **Breaker-Zustand ist pro Prozess + persistiert, aber nicht koordiniert.**
   Bei mehreren API-Instanzen hat jede ihren eigenen In-Memory-Breaker;
   `integration_health` ist die gemeinsame **Sicht**, nicht die gemeinsame
   **Entscheidung**. Folge: n Instanzen sondieren bis zu n-mal statt einmal.
   Ehrlich benannt, für einen Einzelprozessbetrieb ohne Bedeutung.
4. **`GET /health/deep` liest den Zustand aus der Datenbank.** Ein Breaker, der
   in diesem Prozess gerade eben geöffnet hat, erscheint dort erst nach dem
   nächsten `persist()` – das ist derselbe Aufruf, also praktisch sofort, aber
   nicht transaktional garantiert.
5. **`DegradedBanner` ist nicht in einem Browser getestet.** Die Logik
   (Sichtbarkeit, Texte, Statusableitung) ist Code und typgeprüft, aber ein
   Rendering-Test steht aus – React-Testing-Library-Abdeckung für die vier
   Apps ist Phase-4-Terrain (§20).
6. **Kein Web-Push.** Eine geschlossene App erfährt nichts, bis sie wieder
   öffnet (dann `resync`). Unverändert aus Phase 2.
7. **`storage`-Ausfall ist nicht als eigener §18-Pfad getestet.** Die Mechanik
   (Breaker + Puffer) gilt für ihn wie für alle, und der `DEGRADED_HINTS`-Text
   existiert, aber es gibt kein eigenes Szenario dafür – §18 nennt fünf, und
   die fünf sind abgedeckt.
