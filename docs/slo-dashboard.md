# Service-Level-Ziele (PROMPT -1 §21)

Stand: 2026-07-26, Phase 4. Branch `claude/driving-school-admin-tcz2cx`.

§21 verlangt Ziele, die **definiert UND gemessen** sind, und verbietet
ausdrücklich unrealistische Zusagen. Dieses Dokument trennt deshalb strikt drei
Dinge, die gern vermischt werden:

| Kennzeichnung | Bedeutung |
|---|---|
| **GEMESSEN** | In dieser Sitzung gegen den echten Server ermittelt. Zahl und Methode stehen dabei. |
| **KONFIGURIERT** | Ein Wert, der aus der Konfiguration folgt und durch eine Sonde nur bestätigt wurde. Keine Messgröße. |
| **BRAUCHT TELEMETRIE** | Ohne Produktionsbetrieb nicht ermittelbar. Ziel und Messvorschrift stehen da, eine Zahl **nicht**. |

**Es gibt hier keine 100-%-Zusage.** Jedes Verfügbarkeitsziel hat ein
Fehlerbudget, jedes Latenzziel ist ein Perzentil, und jede Zahl aus dieser
Sandbox ist als Untergrenze der Serverarbeit gekennzeichnet – nicht als
Vorhersage der Nutzererfahrung.

---

## 0. Messumgebung – die Grenze der Aussagekraft

| | |
|---|---|
| Datenbank | PostgreSQL 16.13, **auf derselben Maschine** wie die Anwendung |
| Node | v22.22.2, 4 CPUs |
| Datenbankgröße | 16 MB |
| Netz | localhost, **keine** Netzlatenz, **kein** TLS |
| Fremdverkehr | keiner |
| Werkzeug | `scripts/slo-measure.mjs` – echter `buildApp`-Server auf einem Port, gemessen über `fetch` |
| Stichprobe | 200 Anfragen je Leseendpunkt, 120 Buchungen, 20 Reconnect-Läufe |

**Was das bedeutet:** die Latenzzahlen sind die **Serverarbeit** und damit eine
untere Schranke. In Produktion kommen hinzu: TLS-Handshake, echte Netzlatenz
(bei Mobilfunk 30–150 ms), Loadbalancer, DNS und konkurrierender Verkehr. Eine
Zahl von 3 ms hier heißt nicht, dass ein Fahrlehrer 3 ms wartet.

**Warum `app.inject()` nicht benutzt wurde:** es überspringt den HTTP-Stack und
damit genau den Teil, der Latenz erzeugt. Gemessen wird über `fetch` gegen einen
lauschenden Port – dieselbe Strecke, die ein Browser nimmt.

**Warum die Ratenbegrenzung für die Latenzmessung weit gestellt war:** mit den
Produktionsvorgaben (`write`: 5/s) laufen 120 Buchungen in Folge in HTTP 429.
Eine 429 wird im `onRequest`-Hook ohne Datenbankarbeit abgewiesen und ist
deshalb **schneller** als eine echte Buchung – sie hätte die Zahlen
verschönert. Die Kontingente selbst stehen getrennt in Abschnitt 5.

---

## 1. Die neun Ziele auf einen Blick

| # | §21-Ziel | Ziel Pilot | Ziel Produktion | Gemessen | Status |
|---|---|---|---|---|---|
| 1 | Verfügbarkeit Kern-API | 99,0 % / Monat | 99,5 % / Monat | – | **BRAUCHT TELEMETRIE** |
| 2 | p95-Latenz Lesen | ≤ 300 ms | ≤ 200 ms | **≤ 13,5 ms** | **GEMESSEN**, Ziel weit übererfüllt |
| 3 | p95-Latenz Schreiben (Buchung) | ≤ 800 ms | ≤ 500 ms | **13,99 ms** | **GEMESSEN** |
| 4 | max. Synchronisationsverzögerung | ≤ 30 s | ≤ 10 s | **p95 3,29 s** | **GEMESSEN** (Aufbau siehe 3.1) |
| 5 | max. Warteschlangenverzögerung | ≤ 15 min | ≤ 5 min | **p95 232 ms** + Takt | **GEMESSEN** |
| 6 | Buchungsfehlerquote (technisch) | ≤ 0,5 % | ≤ 0,1 % | **0,000 %** (0/120) | **GEMESSEN** |
| 7 | RPO | ≤ 5 min | ≤ 1 min | Genauigkeit **49,8 ms** | **GEMESSEN**, siehe `backup-restore-report.md` |
| 8 | RTO | ≤ 4 h | ≤ 30 min | technisch **1,5–2,2 s** | **teilweise GEMESSEN** |
| 9 | Erholung nach Reconnect | ≤ 10 s | ≤ 5 s | **p95 4,59 ms** serverseitig | **GEMESSEN** (Client-Anteil: siehe 3.3) |

---

## 2. Latenz je Endpunkt – GEMESSEN

Alle Werte in Millisekunden, n = 200 je Leseendpunkt, n = 120 für die Buchung.
**Alle Antworten waren 2xx** – die Perzentile enthalten keine schnellen
Fehlerantworten.

| Endpunkt | p50 | **p95** | p99 | max | Politik |
|---|---:|---:|---:|---:|---|
| `GET /health` | 0,88 | **1,30** | 2,66 | 4,18 | – |
| `GET /health/ready` | 0,92 | **1,23** | 1,39 | 4,49 | – |
| `GET /me` | 1,44 | **1,78** | 2,36 | 4,47 | read |
| `GET /sync/cursor` | 1,84 | **2,39** | 4,87 | 5,99 | read |
| `GET /documents/mine` | 2,40 | **3,12** | 5,65 | 5,89 | read |
| `GET /appointments/mine` | 2,52 | **3,27** | 5,46 | 5,60 | read |
| `GET /sync/changes` | 2,82 | **3,68** | 5,80 | 6,38 | read |
| `GET /metrics` | 4,23 | **5,77** | 7,27 | 9,37 | – |
| `GET /health/deep` | 5,16 | **7,18** | 8,17 | 8,72 | – |
| `GET /office/heute` | 9,01 | **13,46** | 17,20 | 25,59 | read |
| **`POST /appointments`** | 10,18 | **13,99** | 20,40 | 20,86 | write |

**Der langsamste Leseendpunkt ist `GET /office/heute`** (p95 13,5 ms) – die
Heute-Queue des Büros, die mehrere Aggregate zusammenzieht. Das ist der
Endpunkt, den man bei wachsender Datenmenge zuerst beobachten muss.

**`POST /appointments`** ist mit p95 14 ms der teuerste Vorgang. Er enthält:
Idempotenzreservierung, Konfliktprüfung, EXCLUDE-Constraints, Trigger für
Version/Audit/Outbox und den Ergebniseintrag – alles in **einer** Transaktion.
14 ms für diese Kette ist ein gutes Ergebnis; es zeigt, dass die
Zuverlässigkeitsmaschinerie aus Phase 1 nicht teuer ist.

### Ein Befund an der eigenen Phase-4-Arbeit

Die **erste** Fassung von `GET /health/ready` maß **p50 25,01 ms / p95 30,07 ms**
und war damit der langsamste Endpunkt des ganzen Systems – langsamer als jede
Fachabfrage. Ursache: sie öffnete **je Aufruf zwei neue Postgres-Verbindungen**
(eine für `select 1`, eine in `pendingMigrations`) und schloss sie wieder. Eine
Probe, die alle 5 Sekunden von n Instanzen läuft, hätte damit den
Verbindungsaufbau zur häufigsten Datenbankoperation des Systems gemacht.

Behoben: Roundtrip über den bestehenden Pool, Migrationsstand gecacht (30 s,
**nur** das Ergebnis „null offene Migrationen" – ein Befund `> 0` wird bei jedem
Aufruf neu geprüft, damit eine Instanz nach der Migration sofort wieder in den
Verkehr kommt).

Nach der Behebung: **p50 0,92 ms / p95 1,23 ms** – Faktor **27** schneller.
Gefunden **nur** durch die Messung; ein Test hätte es nicht gezeigt, weil er
korrekt war.

---

## 3. Die Verzögerungen – GEMESSEN

### 3.1 Synchronisationsverzögerung: Commit → Zustellzeile

| | Wert |
|---|---|
| Stichprobe | 360 Zustellzeilen (120 Buchungen × 3 Empfängergruppen) |
| min | 1 339 ms |
| p50 | 2 317 ms |
| **p95** | **3 290 ms** |
| max | 3 412 ms |
| Zustellarbeit selbst | **4 ms** für alle 360 Zeilen in EINEM Worker-Durchlauf |

**Wie diese Zahl zu lesen ist – das ist wichtig.** Gemessen wurde von
`event_outbox.created_at` (Commit der Buchung) bis
`realtime_deliveries.created_at` (Zustellzeile). Die 120 Buchungen entstanden
über ~2,3 Sekunden, danach lief der Worker **einmal** und stellte alles zu. Die
gemessene Verzögerung ist deshalb im Wesentlichen **„wie lange lag dieses
Ereignis, bis der Worker lief"** – nicht „wie lange dauert die Zustellung". Die
Zustellung selbst dauerte 4 ms für 360 Zeilen.

**Die Verzögerung wird also vom Takt bestimmt, nicht von der Arbeit.** Daraus
folgt die Rechnung für den Betrieb:

```
Sync-Verzögerung ≈ Wartezeit auf den Arbeitstakt (≤ WORKER_INTERVAL_MS, Standard 5 s)
                 + Zustellarbeit (gemessen: vernachlässigbar)
                 + Weg zum Client (Stream: ≤ pollIntervalMs = 1 s; Polling-Rückfall: dessen Intervall)
```

Also **≈ 6 s im Normalbetrieb**, weit unter dem Pilotziel von 30 s. Mit dem
Cron-Notnagel (`* * * * *`, Runbook Abschnitt 4) wären es bis zu **61 s** – und
damit über dem Produktionsziel. Das ist der messbare Grund, warum in-process
oder ein getrennter Worker die Empfehlung ist und Cron nur der Notnagel.

> **Der Alarm `sync_delay` feuert bei `> 120 s über 5 Minuten`.** Das ist
> gegenüber dem Ziel (30 s) bewusst locker: er soll einen **stehenden Takt**
> melden, nicht eine langsame Minute. Für „Ziel verletzt" ist das Ziel
> zuständig, für „etwas ist kaputt" der Alarm.

### 3.2 Warteschlangenverzögerung: Job angelegt → Job beendet

| | Wert |
|---|---|
| Stichprobe | 14 Jobs (alle 14 wiederkehrenden Arten) |
| min | 31 ms |
| p50 | 206 ms |
| **p95** | **232 ms** |
| Gesamtabarbeitung | 245 ms für alle 14 |

Alle 14 wiederkehrenden Job-Arten liefen dabei tatsächlich:
`appointment_offer.expire`, `audit.verify`, `bank.import`,
`consistency.check`, `document.review`, `idempotency.cleanup`,
`integration.resume`, `integration.sync`, `notifications.dispatch`,
`outbox.dispatch`, `realtime.prune`, `reminders.dispatch`, `reporting.daily`,
`uploads.cleanup`.

Im Betrieb kommt die Wartezeit auf den nächsten Arbeitstakt hinzu (≤ 5 s), bei
Jobs mit eigenem Zeitfenster zusätzlich dessen Auflösung (5 Min. bzw. 1 Std.
bzw. 1 Tag – siehe `scheduleRecurringJobs`). Das Pilotziel von 15 Minuten hat
damit reichlich Luft; der begrenzende Faktor ist die **Einplanungsauflösung**,
nicht die Abarbeitung.

### 3.3 Erholung nach Reconnect

| | Wert |
|---|---|
| Stichprobe | 20 Aufholabfragen ab Cursor 0 |
| p50 | 3,11 ms |
| **p95** | **4,59 ms** |
| nachgeholt je Abruf | 100 Änderungen (das Seitenlimit) |

Das ist die **reine Serverzeit** der Aufholabfrage. Die vollständige Erholung im
Client umfasst zusätzlich:

* ggf. mehrere Seiten (`hasMore = true`, 100 Änderungen je Seite),
* je betroffenes Thema **einen** autorisierten GET (deren Latenz steht in
  Abschnitt 2),
* bei `resyncRequired` eine Vollsynchronisation statt eines Replays.

Bei einem Rückstand von 100 Änderungen über ~5 Themen ergibt das
**< 50 ms Serverarbeit** – das Ziel von 10 s ist mit sehr großem Abstand
erfüllt. Der Client-Anteil (Rendern, Speicher) ist hier **nicht** gemessen; er
gehört zu den Browsertests, die in dieser Umgebung nicht laufen.

---

## 4. Fehlerquote – GEMESSEN

| | Wert |
|---|---|
| Buchungsversuche | 120 |
| HTTP 201 (erfolgreich) | 120 |
| HTTP 409 (fachlicher Konflikt) | 0 |
| **HTTP 5xx (technischer Fehler)** | **0** |
| **technische Fehlerquote** | **0,000 %** |

**Die Unterscheidung ist die eigentliche Aussage.** Eine 409 ist **kein
Fehler**: sie ist die korrekte Antwort auf eine Doppelbuchung und §9 klassifiziert
sie als dauerhaft (kein Auto-Retry). Ein 5xx auf einer Buchung ist immer ein
Fehler. Die Grenze zählt, weil genau dort der Phase-3-Befund saß: zwei
GiST-EXCLUDE-Constraints konnten einen Deadlock (40P01) statt der
Constraint-Verletzung (23P01) erzeugen, und der Verlierer bekam **500 statt
409** – in 9–10 von 50 Läufen.

Zusätzliche Evidenz aus §20 (nicht aus diesem Messlauf):

| Test | Versuche | 5xx |
|---|---|---|
| `chaos.test.ts` Szenario 3, „20 Runden, zwei verschiedene Schüler" | 40 | **0** (exakt `{201: 20, 409: 20}`) |
| `booking-conflict.test.ts`, „20 Runden gleichzeitiger Doppelbuchung" | 40 | **0** (exakt `{201: 20, 409: 20}`) |
| `chaos.test.ts` Szenario 14, „ZWEI Instanzen gleichzeitig" | 10 | **0** (exakt `{201: 5, 409: 5}`) |

**Zusammen 210 Buchungsversuche über Messung und Chaos-Tests, 0 technische
Fehler.** Der Kennzahl-Zähler dafür existiert:
`fahrschul_booking_conflicts_total{kind=…}` trennt fachliche von internen
Konflikten – ein `kind="internal" > 0` ist in Produktion ein Rollback-Auslöser
(Runbook Abschnitt 8.3).

---

## 5. Durchsatzobergrenze – KONFIGURIERT, per Sonde bestätigt

Keine Messgröße, sondern eine Konfigurationsentscheidung. Bestätigt gegen eine
Instanz mit den **Produktionsvorgaben**:

| | Wert |
|---|---|
| Politik | `write`: 5 Anfragen/s, Stoß 60 |
| aufeinanderfolgende Schreibvorgänge bis zur ersten 429 | **62** |
| `Retry-After` in der 429 | `1` |

62 statt 60, weil während der Sonde ~0,4 s vergingen und Token nachfließen. Die
Sonde bestätigt damit die Konfiguration und nicht mehr.

| Politik | Rate/s | Stoß | Gilt für |
|---|---:|---:|---|
| `login` | 0,2 | 10 | `POST /auth/login` |
| `write` | 5 | 60 | alle Schreibrouten |
| `read` | 20 | 200 | Leserouten |
| `stream` | 0,5 | 12 | **Verbindungsaufbau** zu `/sync/stream` (nicht der Datenfluss) |
| `expensive` | 0,5 | 15 | Exporte, Ops-Läufe |

**Die Einschränkung, die dazugehört:** die Zähler liegen im **Prozessspeicher**.
Bei n Instanzen gilt das n-fache Kontingent. Das ist in
`chaos.test.ts` Szenario 14 **bewiesen**, nicht nur behauptet („BEFUND (bekannt,
hier BEWIESEN): das Rate-Limit ist PRO PROZESS, nicht global"). Der
Brute-Force-Schutz auf der Anmeldung hängt **nicht** daran – er ist
DB-persistiert, was derselbe Test zeigt. Damit ist die Sicherheitsaussage
instanzübergreifend, die Lastbegrenzung nicht.

---

## 6. Was Produktionstelemetrie braucht

| Ziel | Messvorschrift, sobald es Produktion gibt |
|---|---|
| **Verfügbarkeit** (99,0 % Pilot / 99,5 % Produktion) | Externe Sonde auf `GET /health/ready` im Minutentakt aus mindestens zwei Netzen. Verfügbarkeit = Anteil erfolgreicher Sonden. Fehlerbudget 99,0 % = **7,2 h/Monat**, 99,5 % = **3,6 h/Monat**. **Warum nicht 99,9 %:** ohne Standby, ohne Failover und ohne 24/7-Bereitschaft wäre das eine Zusage, die niemand halten kann (`backup-restore-report.md` Abschnitt 7). |
| Latenz in Produktion | `fahrschul_http_request_duration_seconds` (Histogramm, 11 Buckets) → `histogram_quantile(0.95, …)` je Route |
| Fehlerquote in Produktion | `fahrschul_http_requests_total{status="5xx"}` / gesamt, 5-Minuten-Fenster |
| Sync-Verzögerung in Produktion | `fahrschul_sync_delay_seconds` (Gauge, beim Scrape frisch aus der DB) |
| Warteschlangentiefe | `fahrschul_job_queue_depth{status}`, `fahrschul_outbox_depth{status}` |
| Scheduler lebt | `fahrschul_scheduler_last_tick_age_seconds` und `fahrschul_scheduler_ticks_total{result}` (**neu in Phase 4** – vorher gab es keine Kennzahl dafür, dass der Takt überhaupt läuft) |
| RTO in der Praxis | Zeit von Alarm bis „fachlich abgenommen" bei einer **geübten** Wiederherstellung. Bis dahin ist die 4-h-Zahl eine Schätzung mit gemessenem technischem Anteil. |
| Nutzerseitige Latenz | Browser-Telemetrie (Navigation Timing). Hier **nicht** vorhanden: es hat in diesem Projekt nie ein Browser gelaufen. |

**Was fehlt, um das abzulesen:** ein Prometheus-Scraper und ein Dashboard. Das
Format ist da (`GET /metrics`, Prometheus-Textformat, geschlossene Labelmenge,
`METRICS_TOKEN`), der Sammler nicht. Ein „Dashboard" im Sinne einer Oberfläche
existiert nicht – dieses Dokument ist seine Definition.

---

## 7. Ehrliche Gesamtbewertung

**Was belastbar ist:** Latenz, Fehlerquote, Warteschlangen- und
Synchronisationsverzögerung sind gemessen, mit genannter Methode und
Stichprobengröße, gegen den echten HTTP-Stack und echtes Postgres. Alle
gemessenen Ziele sind erfüllt, die meisten mit sehr großem Abstand. Die
Buchungsfehlerquote ist über 210 Versuche **null**.

**Was das nicht ist:** eine Aussage über die Nutzererfahrung. Keine Netzlatenz,
kein TLS, kein Fremdverkehr, 16 MB Daten, ein Prozess, vier CPUs. Der große
Abstand zu den Zielen ist Reserve für genau diese Faktoren – und die Reserve ist
nicht quantifiziert.

**Was gar nicht gemessen ist:** Verfügbarkeit (braucht Zeit und externe Sonden),
RTO in der Praxis (braucht eine geübte Wiederherstellung), und alles, was ein
Browser messen würde.

**Der wertvollste Ertrag dieser Messung** war nicht die Bestätigung der Ziele,
sondern der Befund über `GET /health/ready`: ein korrekt funktionierender,
getesteter Endpunkt, der 27-mal zu teuer war. Genau dafür verlangt §21
Messungen und nicht Zusicherungen.
