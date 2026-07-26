# Chaos- und Wiederanlauftestbericht + verbindliches Release-Gate (PROMPT -1 §20 + §22)

Datum: 2026-07-26. Branch `claude/driving-school-admin-tcz2cx`, Phase 4.

Verfasser: **Chaos-Test-Lead und unabhängiger Release-Reviewer**. Die Phasen 1–3
wurden **nicht** von diesem Reviewer gebaut. Der Maßstab ist der der früheren
unabhängigen Prüfung (`docs/final-release-report.md`): **jede Aussage nennt die
Datei und den Test, die sie belegen; was nicht selbst reproduziert wurde, stützt
kein positives Urteil.**

Kein Szenario gilt als bestanden, weil darüber nachgedacht wurde.

---

## 0. Reproduzierte Testevidenz

Umgebung: lokale PostgreSQL 16.13 (im Sandbox-Image, `16/main online`),
Datenbanken `fahrschul_dev`/`fahrschul_test`. Kein Docker (Registry durch
Egress-Policy blockiert, unverändert seit Prompt 0).

```
pnpm -r typecheck     -> 17/17 Pakete fehlerfrei
pnpm -r test          -> siehe Tabelle
```

| Paket | Tests | Ergebnis |
|---|---:|---|
| `apps/api` | 557 | alle grün (24 Dateien) |
| `packages/sync` | 63 | grün |
| `apps/student` | 53 | grün |
| `packages/finance` | 29 | grün |
| `packages/integrations` | 21 | grün |
| `packages/domain` | 19 | grün |
| `packages/scheduling` | 18 | grün |
| `packages/permissions` | 12 | grün |
| `apps/instructor` | 9 | grün |
| `packages/auth` | 6 | grün |
| `packages/matching` | 6 | grün |
| `apps/office` | 1 | grün |

**Summe: 794 Tests, 794 grün, 0 rot, 0 übersprungen** (Basis Phase 3: 667;
Phase 4 ergänzt 127). Vom Reviewer selbst reproduziert, nicht aus einem
QA-Dokument übernommen.

**Zur Flakiness-Frage.** Phase 3 meldete zwei Flakes unter CPU-Konkurrenz, wenn
zwei vitest-Prozesse dieselbe Testdatenbank teilen, plus einen UI-Timing-Flake
in `apps/student/src/state/syncUi.test.tsx`. In dieser Sitzung: **kein einziger
Flake**, weder im vollen Lauf noch in **zwei aufeinanderfolgenden** Läufen von
`chaos.test.ts` (79/79, dann wieder 79/79). Die Ursache der Phase-3-Flakes ist
plausibel benannt und vermeidbar: `apps/api/vitest.config.ts` setzt
`fileParallelism: false`, aber das gilt nur **innerhalb** eines Pakets – zwei
gleichzeitig laufende `pnpm --filter`-Prozesse gegen dieselbe Testdatenbank
leeren sich gegenseitig die Tabellen. Das ist eine Eigenschaft des
Aufruf-Musters, kein Fehler im Code, und ein `pnpm -r test`-Lauf hat sie nicht.

**Änderungen an bestehenden Tests: keine.** Phase 4 hat **keine** Zusicherung
eines der 667 Tests verändert, entfernt oder abgeschwächt. Alle 126 neuen Tests
liegen in vier neuen Dateien plus zwei Ergänzungen (127 Tests):

| Datei | neu | Zweck |
|---|---:|---|
| `apps/api/src/__tests__/chaos.test.ts` | 79 | §20, die achtzehn Szenarien |
| `apps/api/src/__tests__/deployment.test.ts` | 31 | §15 Scheduler, Bereitschaft, Deployment-ID, Migrationstor |
| `apps/student/src/state/degradedBanner.test.tsx` | 16 | §18-Anzeige gerendert (schließt Phase-3-Lücke 5) |
| `apps/api/src/__tests__/code-guards.test.ts` | +1 | neuer Wächter gegen `sql.raw(` mit Interpolation |

---

## 1. Die achtzehn Szenarien

**Legende.** **PASS** = alle Anteile, die in dieser Umgebung ausführbar sind,
laufen als Test und sind grün. **TEILWEISE** = die serverseitige/logische Hälfte
ist getestet, ein benannter Anteil bleibt unausgeführt. **UNAUSGEFÜHRT** würde
bedeuten: nur Code gelesen – **das kommt in dieser Tabelle nicht vor.**

Alle Testnamen unten sind wörtlich; `chaos.test.ts` =
`apps/api/src/__tests__/chaos.test.ts`.

### 1 · Netzabbruch nach Klick auf „Termin annehmen" — **TEILWEISE**

**Erwartung:** der Klick hat gewirkt oder nicht; der Client darf nicht raten und
nicht blind erneut senden. Ein Wiederholversuch mit demselben Schlüssel darf nie
eine zweite Buchung erzeugen.

**Ergebnis:** vier Tests grün (`chaos.test.ts`, „Szenario 1"):
`A: Anfrage kam an und wirkte – der Ausgang ist als completed samt gespeicherter Antwort auflösbar`,
`B: Anfrage kam NICHT an – unknown, und derselbe Schlüssel darf gefahrlos erneut gesendet werden`,
`C: der Wiederholversuch nach dem Abbruch erzeugt KEINE zweite Buchung`,
`D: ein FREMDER Schlüssel ist 404, nicht 403`.
Clientseite: `packages/sync/src/__tests__/queue.test.ts` —
`ein unbekannter Ausgang wird NIE als Erfolg gezeigt, sondern als 'Status wird geprüft'`,
`ein kritischer Vorgang mit unbekanntem Ausgang kann nicht stillschweigend verworfen werden`,
plus alle drei Neustart-Auflösungen (`completed`/`unknown`/`in_progress`).

**Unausgeführt:** der echte Netzabbruch **im Browser** (Verbindung mitten im
`fetch` kappen und die UI beobachten). Braucht Playwright → Abschnitt 3.

### 2 · Denselben Request zehnmal senden — **PASS**

**Erwartung:** genau eine Wirkung, neun Wiedergaben, kein 5xx, kein 429 (zehn
Aufrufe sind ein legitimer Stoß).

**Ergebnis:** vier Tests grün:
`zehn SEQUENZIELLE identische Annahmen: eine Buchung, neun Wiedergaben, kein 429`
(genau 1× 201 + 9× 200),
`zehn PARALLELE identische Annahmen: genau eine Wirkung, nie zwei Buchungen`,
`zehnmal POST /appointments mit demselben Schlüssel: eine Buchung`,
`derselbe Schlüssel mit ABWEICHENDEM Inhalt ist 409 – kein stiller Ersatz der Anfrage`.
Läuft gegen einen **tatsächlich ratenbegrenzten** Server (`TEST_RATE_LIMIT`,
weite Kontingente) – nicht gegen einen abgeschalteten.

### 3 · Zwei Schüler nehmen denselben Slot gleichzeitig an — **PASS** ⭐

**Die wichtigste Regression des Projekts.** Phase 3 fand: zwei
GiST-EXCLUDE-Constraints auf `terminbuchungen` können bei kollidierenden
gleichzeitigen Einfügungen einen **Deadlock (40P01)** statt der
Constraint-Verletzung (23P01) erzeugen – der Verlierer bekam **HTTP 500 statt
409**, in 9–10 von 50 Läufen. Behoben durch bounded Retry auf
Serialisierungsfehler in `lib/idempotency.ts`.

**Vom Reviewer selbst nachgeprüft, aus dem Blickwinkel, den §20 wörtlich nennt**
(zwei **verschiedene** Schüler, zwei Angebote, dieselbe Ressource – nicht zwei
Anfragen desselben Fahrlehrers wie im Phase-3-Test):

| Test | Runden | Ergebnis |
|---|---|---|
| `chaos.test.ts` „20 Runden, zwei verschiedene Schüler, ein Slot: exakt ein Gewinner je Runde, NIE ein 5xx" | 20 | **exakt `{201: 20, 409: 20}`** |
| `booking-conflict.test.ts` „bleibt über 20 Runden gleichzeitiger Doppelbuchung deterministisch" (Phase-3-Test, hier erneut gelaufen) | 20 | **exakt `{201: 20, 409: 20}`** |
| `chaos.test.ts` Szenario 14 „ZWEI Instanzen gleichzeitig" | 5 | **exakt `{201: 5, 409: 5}`** |

Zusätzlich: `der Verlierer bekommt eine FACHLICHE Konfliktantwort, keinen
technischen Fehler` (prüft, dass in der Antwort **kein** `40P01`/`deadlock`
steht) und `die beiden EXCLUDE-Constraints existieren und sind wirklich vom Typ
EXCLUDE` (`contype = 'x'`, nicht ein gleichnamiger Unique-Index).

**Der Fix hält. 90 gleichzeitige Buchungsversuche über drei Tests, 0 × 5xx.**

### 4 · Zwei Büro-Mitarbeiter ändern denselben Termin — **PASS**

**Erwartung (§4):** der zweite Schreiber verliert **sichtbar** – 409
`version_conflict` mit vollem Serverzustand und `conflictFields`. Kein „letzter
gewinnt".

**Ergebnis:** vier Tests grün mit **zwei verschiedenen** Büro-Konten:
`der zweite Schreiber mit veralteter Version bekommt 409 samt Serverzustand und conflictFields`,
`zwei GLEICHZEITIGE Änderungen mit derselben gelesenen Version: genau eine gewinnt`,
`eine Änderung OHNE Version ist 428 – die Pflicht ist eine Zusage des Endpunkts`,
`zwei gleichzeitige STORNI desselben Termins: einer wirkt, der andere wird abgewiesen`
(genau ein Storno, kein 5xx).

### 5 · Serverabsturz nach DB-Commit, aber vor HTTP-Antwort — **PASS**

**Erwartung:** genau der Fall, für den Phase 1s Idempotenzspeicher und Phase 2s
`GET /sync/operations/:op/:key` existieren.

**Ergebnis:** der Absturz ist **echt nachgestellt**, nicht simuliert – Instanz A
führt aus und wird **geschlossen**, die Auflösung läuft über eine **neu gebaute**
Instanz B:
`der Ausgang ist nach einem Prozesswechsel auflösbar – nichts liegt im Prozessspeicher`
(B liefert `completed` mit der gespeicherten Antwort; ein Wiederholversuch auf B
gibt 200, nicht 201; genau eine Buchung).
Dazu die Gegenprobe:
`ein Absturz VOR dem Commit lässt nichts Halbes zurück – der Schlüssel bleibt unknown`
(die Idempotenzreservierung rollt **mit** zurück – nur so ist „unknown = hat
nicht gewirkt" wahr) und
`die Audit- und Outbox-Zeile ist mit dem Fachvorgang committet – Rollback lässt beides weg`.

### 6 · Workerabsturz während einer Benachrichtigung — **PASS**

**Erwartung:** nichts verloren, nichts doppelt.

**Ergebnis:** der Absturz ist echt: `claimOutboxBatch` beansprucht, dann **kein**
`complete`/`fail` – exakt der Zustand eines gestorbenen Workers.
`ein Ereignis, das ein gestorbener Worker beansprucht hatte, wird wieder freigegeben und EINMAL zugestellt`
prüft die ganze Kette: ein anderer Worker kann es **nicht** stehlen, solange der
Lease gilt; nach Lease-Ablauf gibt `recoverExpiredOutboxLeases` es frei; die
Zustellung erzeugt **genau eine** Nachricht; ein **zweiter** Lauf verdoppelt
nichts (Inbox-Dedup, `event_inbox` unverändert).
Plus `der Absturz beeinflusst den FACHZUSTAND nicht – die Buchung war und bleibt gültig`.

### 7 · WebSocket/SSE verliert Ereignisse — **TEILWEISE**

**Erwartung:** der Kanal ist eine Benachrichtigung, keine Datenquelle. Verlorene
Meldungen holt der Cursor **lückenlos** nach.

**Ergebnis:** fünf Tests grün:
`Ereignisse, die während der Trennung entstanden, kommen per Cursor VOLLSTÄNDIG nach`
(fünf Ereignisse während der „Trennung"; die Sequenznummern sind **lückenlos**
aufsteigend geprüft – Differenz exakt 1),
`ein zweites Abrufen mit dem FORTGESCHRIEBENEN Cursor liefert nichts doppelt`,
`ein zu ALTER Cursor verlangt eine Vollsynchronisation statt still Lücken zu lassen`,
`der Kanal trägt KEINE Nutzlast – ein Leck über den Kanal ist strukturell unmöglich`
(Spaltenprüfung auf `realtime_deliveries`: kein `payload`, kein `body`),
`ohne laufenden Worker gibt es keine Zustellzeilen – aber Schreibvorgänge funktionieren unverändert`.
Clientseite: `packages/sync/src/__tests__/realtime.test.ts` —
`eine Lücke im dichten Cursor führt zur Neuladung – kein stiller Datenverlust`,
`bleibt der Heartbeat aus, gilt der Kanal als tot und wird neu aufgebaut`,
`nach maxStreamFailures wird auf Polling umgeschaltet und der Zustand konvergiert`,
`ein Cursor VOR dem Serverstand (z. B. nach Restore) führt zur Vollsynchronisation`.

**Unausgeführt:** Browser → echte `EventSource` → UI. Der Serverkanal ist gegen
einen echten SSE-Listener getestet (`realtime.test.ts`, Phase 2), der Client
gegen einen bösartigen Fake-Transport – die Verbindung beider im Browser fehlt.

### 8 · Ereignis kommt doppelt oder falsch sortiert — **PASS**

**Erwartung:** Zustellung *at-least-once*, Verarbeitung effektiv
*exactly-once*; falsche Reihenfolge bricht nichts.

**Ergebnis:** drei Tests grün:
`DOPPELTE Zustellung: der Konsument verarbeitet genau einmal (Inbox-Dedup)`
(Ereignisse werden **zwangsweise** auf `pending` zurückgesetzt und erneut
zugestellt – Nachrichten- und Inbox-Zahlen bleiben identisch),
`VERTAUSCHTE Reihenfolge: das spätere Ereignis zuerst zugestellt bricht nichts`
(das späteste Ereignis wird zuerst zugestellt, die anderen „geparkt" und danach
nachgezogen; am Ende alles `delivered`, **kein** Duplikat in der Inbox),
`der Zustand liegt in der ENTITÄT, nicht im Ereignisverlauf – deshalb ist die Reihenfolge unkritisch`.
Clientseite: `dieselbe Ereignis-ID zweimal wirkt genau einmal`,
`Duplikaterkennung überlebt einen Neustart`,
`der Cursor geht nur vorwärts, ein Nachzügler invalidiert trotzdem sein Thema`.

### 9 · Externe API 30 Minuten offline — **PASS**

**Erwartung (§11/§18):** kein Verlust, **keine falsche Erfolgsmeldung**, Kern
arbeitet, nach der Rückkehr genau eine Zustellung mit **demselben** Schlüssel.

**Ergebnis:** fünf Tests grün. Der Ausfall ist über
`POST /ops/integrations/:integration/breaker` deterministisch **hergestellt** –
ohne Produktionscode zu ändern:
`Nachrichten werden GEPUFFERT und ausdrücklich nicht als gesendet gemeldet`
(`zustellung: "wartet_auf_externe_synchronisation"`, Nachrichtenstatus bleibt
`warteschlange` – **nicht** `gesendet`, **nicht** `fehlgeschlagen`),
`der Fachkern arbeitet während des Ausfalls unverändert weiter` (Buchung gelingt,
`/health/deep` bleibt **200** mit `eingeschraenkt`),
`nach der Rückkehr stellt die Wiederaufnahme mit DEMSELBEN Schlüssel genau einmal zu`,
`ein bekannter ausgehender Schlüssel löst KEINEN zweiten Anbieteraufruf aus`
(Unique-Index, nicht Anwendungslogik),
`30 Minuten Ausfall erzeugen keine Dead Letter im FACHKERN – nur Puffer in der Integration`.

Die 30 Minuten sind **gestellt statt gewartet**: `resumeBufferedCalls` nimmt
bewusst nur **fällige** Einträge (`next_attempt_at <= now`), damit ein sofortiger
Wiederholversuch kein Sondierungssturm auf ein gerade ausgefallenes System wird.
Der Test setzt die Fälligkeit – ein Lauf ohne diesen Schritt würde nichts finden,
und das wäre kein Fehler des Systems.

**Anbieter bleiben Mock** (`docs/integration-gaps.md`). Getestet ist der
**Ausfallpfad**, nicht der Anbieter.

### 10 · Datenbankverbindung unterbrochen — **PASS**

**Erwartung (§1):** die Datenbank IST die Wahrheit – ohne sie ist die Instanz
nutzlos, und das muss sie **sagen**.

**Ergebnis:** vier Tests grün gegen eine Instanz mit unerreichbarer Datenbank:
`/health/deep meldet 503 und benennt die Datenbank als Ursache`,
`ein Schreibvorgang liefert einen FEHLER, niemals einen falschen Erfolg`
(kein 200, **kein Cookie**),
`/health/live bleibt 200 – Liveness darf keinen Ausfall verstärken`
(dazu `/health/ready` = 503),
`nach der Rückkehr arbeitet alles weiter – offene Vorgänge sind auflösbar`.
Ergänzend `deployment.test.ts`:
`GET /health/live fasst die Datenbank NICHT an (kein Ausfallverstärker)`.

### 11 · App sieben Tage offline — **TEILWEISE**

**Erwartung:** nichts still senden, nichts still verwerfen.

**Ergebnis Clientseite** (`packages/sync/src/__tests__/queue.test.ts`):
`SIEBEN TAGE OFFLINE: ein alter Entwurf wird als veraltet erkannt, NICHT verworfen und NICHT still gesendet`
— `stale`/`draft_too_old`, verschlüsselter Inhalt erhalten, `processQueue`
überspringt ihn, er erscheint in der Prüf-Warteschlange und geht erst nach
**ausdrücklicher** Bestätigung mit **demselben** Schlüssel raus. Dazu
`eine veraltete Schema-Version macht den Entwurf stale` und
`hat sich der zugrundeliegende Datensatz bewegt, ist es ein sichtbarer Konflikt statt eines Überschreibens`.

**Ergebnis Serverseite** (`chaos.test.ts`), vier Tests grün, darunter
`ein Angebot, das während der Offline-Zeit ABGELAUFEN ist, wird nicht still gebucht` und
`ein Datensatz, der sich in der Zwischenzeit BEWEGT hat, erzeugt 409 statt Überschreiben`.

> **BEFUND (aus dieser Phase, kein stiller Fix).** Die Idempotenz-Frist beträgt
> **24 Stunden** (`IDEMPOTENCY_TTL_MS`), das Offline-Fenster des Clients
> **sieben Tage**. Ein Vorgang, der so lange im Gerät lag, trifft auf einen
> **abgelaufenen** Schlüssel und wird serverseitig wie eine neue Anfrage
> behandelt. Festgehalten im Test
> `BEFUND: die Idempotenz-Frist (24 h) ist KÜRZER als das Offline-Fenster des Clients (7 Tage)`
> und `ein ABGELAUFENER Schlüssel wird als unknown gemeldet – nicht als completed`.
>
> **Warum das kein Blocker ist:** offline dürfen ausschließlich die **vier
> Entwurfsarten** angelegt werden (Verfügbarkeit, Fahrstundenbericht,
> Fahrzeugmangel, Selbsteinschätzung) – das sind Aktualisierungen, keine
> Neuanlagen, eine Doppelausführung erzeugt dort keinen zweiten Datensatz. Die
> **zehn kritischen** Operationen können offline **gar nicht** angelegt werden
> (`createCriticalOperation` wirft, `assertOfflineAllowed` ist fail closed).
> **Warum es trotzdem in die Bedingungsliste gehört:** die §2-Zusage deckt das
> Offline-Fenster nicht vollständig ab, und die Entscheidung „TTL auf 8 Tage
> anheben" ist eine Abwägung (Tabellengröße, Aufbewahrung
> personenbezogener Nutzlasten) und keine technische Kleinigkeit → Bedingung C4.

**Unausgeführt:** sieben Tage mit einer **geschlossenen** App im Browser
(Service-Worker-/Speicherverhalten über echte Neustarts). Es gibt zudem
**kein Web-Push** – eine geschlossene App erfährt nichts, bis sie wieder öffnet
(unverändert aus Phase 2).

### 12 · Falsche Geräteuhr — **PASS**

**Erwartung:** **keine** fachliche Entscheidung hängt an der Uhr des Geräts.

**Ergebnis:** fünf Tests grün:
`ein Angebot mit serverseitig abgelaufener Frist wird abgewiesen – egal was das Gerät glaubt`,
`Start- und Endzeit einer Fahrstunde setzt der SERVER, nicht der Client`
(ein Gerät schickt `gestartetAt: 2001-01-01` mit; gespeichert wird Serverzeit
innerhalb der letzten Minute),
`kein Endpunkt akzeptiert ein Feld, das die Serveruhr überschreibt (statischer Wächter)`
(scannt **alle** Routendateien nach `now|serverTime|currentTime|jetzt|beendetAt|…: z.` – 0 Treffer),
`Sitzungsablauf und Idempotenzfrist rechnen mit Serverzeit (DB-Default now())`,
`mehrere Übergänge in EINER Transaktion bleiben geordnet (clock_timestamp, nicht now())`.

**Klarstellung zu einer Doku-Aussage.** `docs/sync-architecture.md` §10 sagt,
`state_transitions.created_at` nutze `clock_timestamp()`. Der **Spaltendefault**
ist `now()`; maßgeblich ist `clock_timestamp()`, das der Trigger
`fs_assert_transition` explizit übergibt (Migration 0007, Zeile 494). Die
Doku-Aussage ist damit **sachlich richtig**, aber an einer Stelle nachprüfbar
missverständlich. Der Test prüft jetzt beides: die Funktionsdefinition **und**
den beobachtbaren Effekt (verschiedene, aufsteigende Zeitstempel).

**Was der Client sehr wohl darf:** Zeiten als **Daten** senden – ein Terminfenster
ist ein Datum. Die Grenze ist: keine Frist-, Ablauf- oder Reihenfolgeentscheidung
fällt mit einer Clientzeit.

### 13 · Uploadabbruch bei 80 Prozent — **TEILWEISE**

**Erwartung (§12):** nichts halb Gespeichertes gilt als Dokument; der Client
erfährt **genau**, welche Teilstücke fehlen; die Wiederaufnahme erzeugt **ein**
Dokument.

**Ergebnis:** sechs Tests grün mit echten 5 Teilstücken, davon 4 gesendet:
`bei 80 % (4 von 5 Teilen) gibt es KEIN Dokument und der Abschluss wird abgewiesen`
(`vorhandeneIndizes = [0,1,2,3]`, `complete` = 4xx, 0 Dokumente),
`die Wiederaufnahme schickt NUR das fehlende Teil und erzeugt genau EIN Dokument`
(die Sitzung liegt in der **Datenbank**, nicht im Prozessspeicher – ein Neustart
verliert sie nicht),
`ein zweiter Abschluss derselben Sitzung erzeugt kein zweites Dokument`
(idempotent: dasselbe Dokument, nicht ein Fehler – ein wiederholtes `complete`
nach einem Verbindungsabbruch ist der Normalfall),
`ein bei 80 % wiederaufgenommenes Teil mit FALSCHEM Inhalt bricht die Prüfsumme, nicht die Datenbank`,
`ein endgültig abgebrochener Upload wird aufgeräumt, ohne ein Dokument zu hinterlassen`,
`der einteilige Upload (POST /documents) landet zuerst in QUARANTÄNE, nie direkt geprüft`.

**Unausgeführt:** der Abbruch im **Browser** (Datei-Dialog, `XHR`-Abbruch,
Verbindungswechsel WLAN→Mobilfunk mitten im Upload).

### 14 · Deployment während einer laufenden Buchung — **PASS**

**Erwartung:** zwei Fassungen laufen kurzzeitig parallel; der laufende Vorgang
geht nicht verloren und wirkt nicht doppelt; die neue Instanz nimmt keinen
Verkehr an, bevor ihr Schema passt.

**Ergebnis:** fünf Tests grün als **echter Zweiinstanzbetrieb** gegen dieselbe
Datenbank – nicht simuliert:
`ein auf Instanz A begonnener Vorgang ist auf Instanz B abschließbar und wirkt genau einmal`
(A führt aus, A wird **geschlossen** wie vom Orchestrator, der Client wiederholt
gegen B → 200 mit derselben Buchungs-ID, genau eine Buchung),
`ZWEI Instanzen gleichzeitig können den Slot nicht doppelt vergeben`
(5 Runden, exakt `{201: 5, 409: 5}` – der Constraint entscheidet, nicht der Prozess),
`die neue Instanz nimmt keinen Verkehr an, solange Migrationen fehlen`
(`/health/ready` = 503, `grund: "migrationen_ausstehend"`).

> **BEFUND (bekannt, hier erstmals BEWIESEN).**
> `BEFUND (bekannt, hier BEWIESEN): das Rate-Limit ist PRO PROZESS, nicht global`
> — bei Kontingent 2 ist der dritte Versuch auf Instanz A eine 429, derselbe
> Aufrufer auf Instanz B aber wieder frei. Die Lücke ist damit nicht mehr eine
> Aussage in einem Dokument, sondern ein Test.
>
> Und die Gegenprobe, die sie erträglich macht:
> `der Brute-Force-Schutz hängt NICHT am Prozessspeicher – er ist DB-persistiert`
> — nach zwei Fehlversuchen auf A ist der dritte **auf B** eine 429. Die
> **Sicherheits**aussage ist instanzübergreifend, nur die **Last**begrenzung
> nicht. → Bedingung C2.

### 15 · Backup in isolierter Umgebung wiederherstellen — **PASS** (ausgeführt)

Vollständig in `docs/backup-restore-report.md`. Zusammenfassung:

| Vorgang | Ergebnis |
|---|---|
| Logische Sicherung, AES-256 verschlüsselt | 614 kB, 298 ms |
| Restore in **isolierte** Datenbank + Integritätsprüfung | **VERIFIZIERT**, 0 Befunde, 0 Zeilenabweichungen, 1518 ms |
| Physische Basissicherung, verschlüsselt | 66 MB, 2414 ms |
| **PITR in einen ZWEITEN Cluster** (eigener Port 5433) | **VERIFIZIERT**, 2171 ms |
| PITR-Genauigkeit | Marker A vorhanden, Marker B korrekt **nicht** nachgespielt; Abstand zum Zielzeitpunkt **49,8 ms** |

Die Prüfung selbst ist getestet (sechs Tests, `chaos.test.ts` Szenario 15) –
darunter, dass sie einen **deaktivierten** Invarianten-Trigger und eine
**referenzielle Waise** als kritischen Befund erkennt. Ein `pg_restore`-Exitcode
0 belegt nichts.

**Unausgeführt:** Wiederherstellung auf einem **anderen Host** und aus einem
**getrennten Speicherort**. Beides braucht Infrastruktur, die es hier nicht gibt
→ Bedingung B1.

### 16 · Schüler versucht fremde IDs — **PASS**

**Erwartung:** serverseitige Autorisierung an **jedem** Zugriff. Kein 200 mit
fremden Daten, kein 5xx, und wo eine 403 die Existenz bestätigen würde, eine 404.

**Ergebnis:** drei Tests grün. Der Kern ist ein Durchlauf über **zehn**
Zugriffswege in einem Test: fremdes Dokument lesen, fremden Dokumentinhalt
abrufen, fremdes Angebot annehmen, fremden Termin stornieren, **fremden
Idempotenzschlüssel auflösen**, fremde Upload-Sitzung lesen, fremde
Upload-Sitzung beschreiben, fremde Dokumentprüfung, Ops-Route,
**Rollenänderung** — jeder Zugriff muss 4xx sein, **nie** 2xx und **nie** 5xx.
Danach wird geprüft, dass die Daten von Schüler A unverändert sind.
Dazu `die Liste des Schülers B enthält kein Objekt von A (kein Filter-Bypass über Listen)`
und `eine erfundene UUID ist 404, keine 500 – und verrät nichts über den Bestand`.

### 17 · Mitarbeiterrolle wird in aktiver Sitzung entzogen — **PASS**

**Erwartung:** Rechte werden bei **jedem** Request neu bewertet, nicht bei der
Anmeldung.

**Ergebnis:** fünf Tests grün:
`die Rolle wird MITTEN in der Sitzung neu bewertet – dieselbe Sitzung bekommt danach 403`
(vorher `GET /office/heute` = 200, Rolle geändert, **derselbe Cookie ohne
Neuanmeldung** = 403),
`ein GESPERRTES Konto verliert die Sitzung sofort (401, nicht 403)`,
`PATCH /users/:id/role beendet ZUSÄTZLICH alle Sitzungen des Betroffenen`
(zwei parallele Sitzungen, **beide** danach 401),
`es gibt kein Rollenfeld in der Sitzung – die Rolle KANN nicht veralten`
(struktureller Beweis: `sessions` hat weder `rolle` noch `role` noch
`permissions`),
`der Entzug wirkt auch auf einer ANDEREN Instanz sofort (kein prozesslokaler Rechte-Cache)`.

Der Mechanismus, vom Reviewer im Code nachgelesen: `createSessionLoader`
(`apps/api/src/middleware/auth.ts`) liest Rolle **und** Kontostatus per JOIN aus
`benutzer` – es gibt kein JWT und kein Rollenfeld in der Sitzung, das eine alte
Rolle konservieren könnte.

### 18 · Zahlung wird nach Zuordnung zurückgebucht — **PASS**

**Erwartung (§3 FS003 + §10):** eine zugeordnete Zahlung ist nicht mehr frei
verfügbar; der einzige Ausgang aus `matched` ist `reversed`; die Rückbuchung löst
**keine** automatische Sperre und **keine** Mahnung aus.

**Ergebnis:** sechs Tests grün:
`die Zuordnung setzt matched – und eine ZWEITE Zuordnung derselben Transaktion wird abgewiesen (FS003)`
(auch per **Roh-SQL** – die Regel liegt in der Datenbank),
`aus matched führt AUSSCHLIESSLICH reversed heraus (Roh-SQL, nicht nur Anwendungscode)`
(fünf verbotene Ziele einzeln geprüft; die Alt-Spalte wird per Trigger auf
`abgelehnt` mitgezogen – expand-contract),
`die Rückbuchung ist auditiert und als Zustandsübergang protokolliert`
(`matched->reversed` in `state_transitions`, per Trigger auch bei Roh-SQL),
`eine Rücklastschrift wird NIE automatisch verbucht – sie geht in die Prüf-Warteschlange`
(`konfidenz: "unklar"`, `autoBuchbar: false` – Non-Negotiable „nur `sicher`
bucht automatisch" hält),
`nach der Rückbuchung wird NICHT automatisch gesperrt oder gemahnt`
(Jobdurchlauf danach: `ausbildungen.status` unverändert, Termine bestehen),
`reversed -> matching ist erlaubt: eine erneut eingehende Zahlung kann wieder verarbeitet werden`.

### Querschnitt

`kein Chaos-Szenario hat einen Dead Letter im Fachkern hinterlassen` (0 offene
Dead Letters nach allen 79 Tests) und
`die sieben eingefrorenen Prototyp-Dateien sind unangetastet` (kein `PROMPT -1`
in `app.html`, `dashboard.html`, `fahrlehrer.html`, `cockpit-pro.html`,
`website.html`, `server.py`, `sync-data.json`; `react-zentrale/` existiert
unverändert).

### Bilanz

| Bewertung | Anzahl | Szenarien |
|---|---:|---|
| **PASS** | 14 | 2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 15, 16, 17, 18 |
| **TEILWEISE** (benannter Browseranteil offen) | 4 | 1, 7, 11, 13 |
| **UNAUSGEFÜHRT** | 0 | – |

---

## 2. Gefundene Fehler und Befunde

### 2.1 BEFUND (behoben): zeichenkettengebautes SQL in `claimJobs` — Phase 1d

`apps/api/src/workers/job-store.ts` baute die `in (…)`-Liste der Job-Typen als
**Zeichenkette** mit handgeschriebenem Quote-Escaping und übergab sie an
`sql.raw(...)`:

```ts
sql` and job_type in ${sql.raw(`(${jobTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")})`)}`
```

Die Werte kommen aus dem Body von `POST /ops/jobs/run`
(`jobTypes: z.array(z.string().min(1))` – beliebige Zeichenketten). Damit gab es
einen Eingabekanal in einen **unparametrisierten** SQL-Text.

**Schwere: mittel, nicht kritisch.** Der Endpunkt verlangt `ops:jobs:manage`
(nur `systemdienst` und `geschaeftsfuehrung`), und das Verdoppeln einfacher
Anführungszeichen ist bei `standard_conforming_strings = on` (Postgres-Standard)
die korrekte Maskierung. Es war also nicht trivial ausnutzbar – aber es war
genau das Muster, das dieses Projekt als Non-Negotiable ausschließt, an einer
Stelle mit Geld- und Betriebsbezug.

**Der zweite, schlimmere Teil des Befunds:** der Wächtertest in
`code-guards.test.ts`, der genau das verhindern soll, hat es **nicht bemerkt**.
Seine Regel lässt Zeilen durch, die das Präfix ``sql` `` enthalten (weil ein
getaggtes Template parametrisiert ist) – und diese Zeile enthält es. `sql.raw()`
ist aber das Gegenteil eines getaggten Templates. Damit war
`docs/security-architecture.md` §11 („kein SQL-Schlüsselwort in einem verketteten
String") in dieser Form **nicht zutreffend**.

**Behoben:** `claimJobs` parametrisiert über `sql.join` (jeder Typ ein
Bindeparameter), Verhalten unverändert (23/23 `jobs.test.ts` weiter grün). Neuer
Wächter: `sql.raw(` darf kein `${…}` und keine Verkettung enthalten – gegen das
alte Muster verifiziert (wird geflaggt). `docs/security-architecture.md` §11 ist
korrigiert.

### 2.2 BEFUND (behoben): `GET /health/ready` war 27× zu teuer — Phase 4, eigene Arbeit

Die erste Fassung öffnete **je Aufruf zwei neue Postgres-Verbindungen**.
Gemessen: p50 **25,01 ms**, p95 30,07 ms – der langsamste Endpunkt des Systems.
Eine Probe im Sekundentakt hätte den Verbindungsaufbau zur häufigsten
Datenbankoperation gemacht. Nach der Behebung (bestehender Pool +
Cache **nur** für das gute Ergebnis): p50 **0,92 ms**.
Details: `docs/slo-dashboard.md` Abschnitt 2.

### 2.3 BEFUND (behoben): die PITR-Bewertung hatte das falsche Vorzeichen

`restore-verify.sh` verlangte auch bei `--pitr` gleiche Zeilenzahlen. Ein
korrekter PITR-Lauf wäre damit „nicht verifiziert" gewesen, ein Lauf, der den
Zielzeitpunkt **ignoriert**, „verifiziert". Korrigiert: bei PITR entscheidet die
**Struktur**, die Zeilendifferenz wird als erwartet protokolliert.

### 2.4 BEFUND (offen, Bedingung C4): Idempotenzfrist 24 h < Offline-Fenster 7 Tage

Siehe Szenario 11. Kein Blocker (offline nur Entwürfe, kritische Operationen
offline gar nicht anlegbar), aber die §2-Zusage deckt das Offline-Fenster nicht
vollständig ab.

### 2.5 BEFUND (offen, Bedingung C2): Rate-Limit pro Prozess

Bekannt aus Phase 3, in Szenario 14 **bewiesen**. Der Brute-Force-Schutz ist
davon nicht betroffen (DB-persistiert, ebenfalls bewiesen).

### 2.6 Präzisierung, kein Fehler: `state_transitions.created_at`

Siehe Szenario 12. Die Doku-Aussage ist sachlich richtig; der Spaltendefault
ist `now()`, maßgeblich ist `clock_timestamp()` im Trigger.

### 2.7 §15-Verdrahtung fehlte tatsächlich — von allen drei Phasen verschoben

`scheduleRecurringJobs()` war getestet, aber `server.ts` setzte
`startWorkers` **nicht**. In einem echten Serverprozess lief damit **kein
einziger** wiederkehrender Job: keine Outbox-Zustellung, kein Angebotsablauf,
keine Wiederaufnahme gepufferter Aufrufe, kein Konsistenzcheck, keine
Audit-Kettenprüfung, kein Aufräumen. Die „automatische Wiederaufnahme" in
`docs/failure-modes.md` war so automatisch wie ein Mensch, der
`POST /ops/workers/run` drückt. **Behoben** (§15, Abschnitt 4 unten).

### 2.8 Unabhängig nachgeprüfte Phase-3-Bewertungen

| Phase-3-Aussage | Nachprüfung des Reviewers | Ergebnis |
|---|---|---|
| „neun Advisories in sechs Paketen" | Abhängigkeitsscan eigenständig wiederholt (189 Versionen aus `pnpm-lock.yaml` gegen die npm-Bulk-API, HTTP 200) | **bestätigt: exakt 9 in 6** |
| `drizzle-orm` „nicht ausnutzbar, alle Bezeichner statisch" | Suche nach `sql.identifier`, `getTableName`, dynamischer Schemazugriff, variablen `.from()/.into()`-Argumenten | **bestätigt**: kein Treffer; alle 300+ Aufrufe nutzen statische Schema-Importe. **Aber:** die begleitende Wächter-Aussage war überzogen (siehe 2.1) |
| `react-router` Open Redirect „alle Ziele statisch" | alle 28 `navigate(`/`<Link>`-Stellen geprüft | **im Ergebnis bestätigt, in der Begründung zu grob**: vier Ziele sind interpoliert. Drei setzen eine **Server-UUID in einen festen Pfadpräfix** (`/schueler/${s.id}`), was die Backslash-Klasse nicht erlaubt; das vierte (`<Link to={priority.actionTo}>`) bezieht seinen Wert aus **sieben hartkodierten Literalen** in `useHeutePriorities.ts`. Kein Nutzereingabewert erreicht ein Navigationsziel. |
| `vitest` critical „nur `--ui`" | `vitest --ui` im Repo gesucht | **bestätigt**: kein Treffer, alle Skripte nutzen `vitest run`; devDependency |
| `vite`/`esbuild` „nur Entwicklungsserver" | – | **bestätigt** (ausgeliefert werden statische Dateien) |
| „`/health/deep` liefert 503 nur bei unerreichbarer Datenbank" | eigener Test mit offenem Breaker | **bestätigt**: 200 + `eingeschraenkt` bei Integrationsausfall, 503 nur bei DB |
| „Rate-Limit-Zähler pro Prozess" | eigener Zweiinstanztest | **bestätigt und bewiesen** |
| „expand-contract in 0009" | Wächter auf **alle** Migrationen ab 0007 erweitert | **bestätigt** für 0007–0010 |

---

## 3. Was unausgeführt bleibt – und warum

### Playwright: in dieser Sitzung erneut versucht, erneut blockiert

Nicht aus früheren Sitzungen übernommen, sondern selbst geprüft:

```
$ npx playwright install chromium
Downloading Chrome for Testing 151.0.7922.34 from https://cdn.playwright.dev/…
Error: Download failed: server returned code 403
       body 'request rejected: host not permitted'
Failed to install browsers
```

Auch kein Systembrowser als Ausweg: `chromium`, `chromium-browser`,
`google-chrome`, `google-chrome-stable`, `firefox` — **alle nicht vorhanden**,
`/root/.cache/ms-playwright` leer.

**Damit bleibt unausgeführt:**

1. Echter Netzabbruch im Browser (Szenario 1).
2. Browser → echte `EventSource` → UI (Szenario 7).
3. Sieben Tage mit **geschlossener** App, echtes Speicherverhalten (Szenario 11).
4. Uploadabbruch im Datei-Dialog, Netzwechsel im Flug (Szenario 13).
5. **CSP im Browser.** Die Politik ist gegen die gebauten `dist/index.html`
   geprüft (keine Inline-Skripte) und die vier Builds sind sauber – aber
   **kein Browser hat sie je durchgesetzt**. Ob die Anwendung unter der CSP
   tatsächlich funktioniert, ist damit unbelegt. Phase-3-Lücke 5 bleibt
   **offen**.
6. Screenreader, echte Viewports (360–1440 px), echte Rendering-Tests.

**Teilweise geschlossen:** die §18-Anzeige ist jetzt **gerendert** getestet
(jsdom + Testing Library, 16 Tests in
`apps/student/src/state/degradedBanner.test.tsx`), abgefragt über Rollen und
Text statt über CSS-Klassen. Das schließt Phase-3-Lücke 5 aus
`docs/failure-modes.md` (Rendering-Test) – **nicht** die Browserfrage.

### Weiteres Unausgeführtes

| Was | Warum |
|---|---|
| Offsite-Sicherung, Secret-Store, Standby/Failover | keine Infrastruktur (`docs/backup-restore-report.md` Abschnitt 7) |
| Verfügbarkeitsmessung | braucht Zeit und externe Sonden |
| RTO in der Praxis | braucht eine **geübte** Wiederherstellung |
| Jede echte Anbieterintegration | alle zehn sind Mock (`docs/integration-gaps.md`) |
| `docker compose up` | Registry blockiert, unverändert seit Prompt 0 |
| PgBouncer im Transaktionsmodus | nicht eingerichtet; Verträglichkeit im Runbook geprüft, nicht getestet |
| Automatischer Rollback | Auslösung definiert und ablesbar, Ausführung braucht einen Orchestrator |

---

## 4. §15 Sichere Deployments – Prüfung

| §15-Anforderung | Status | Nachweis |
|---|---|---|
| Staging vor Produktion | **dokumentiert** | `docs/recovery-runbook.md` 8.1. Kein Staging vorhanden. |
| Feature-Flags | **vorhanden, verifiziert** | `feature_flags` aus Prompt 1, `getFlagState` fällt auf **`hidden`** zurück (fail closed), standortweise überschreibbar |
| Rückwärtskompatible Migrationen | **verifiziert, verschärft** | Wächter jetzt über **alle** Migrationen ab 0007 (Phase 3: nur 0009); 0010 rein additiv |
| Bereitschafts-/Lebendprüfung | **neu, getestet** | `/health/live` (kein I/O), `/health/ready` (DB + Migrationsstand); `/health/deep` unverändert 200 bei Integrationsausfall – nachgeprüft |
| Rolling/Blue-Green | **teilweise** | Der Code trägt es: Zweiinstanzbetrieb getestet (Szenario 14), Readiness hält Verkehr zurück. Der Orchestrator fehlt. |
| Automatischer Rollback bei kritischen Fehlern | **teilweise** | Auslöseschwellen vollständig definiert und aus `GET /metrics` ablesbar (Runbook 8.3); die Ausführung braucht einen Orchestrator → Bedingung B4 |
| Keine zerstörende Migration ohne Backup und Freigabe | **erfüllt, ausgeführt** | Tor im Läufer: `MIGRATION_APPROVED_BY` **und** ein `backup_runs`-Eintrag **mit** `verified_at`. Gegen den echten Läufer 3× geblockt, 1× durchgelassen (`backup-restore-report.md` Abschnitt 9) |
| Deployment-ID in Logs und Fehlerberichten | **erfüllt, getestet** | `deploymentId`/`instanceId`/`releaseChannel` an **jeder** Logzeile, `x-deployment-id` auf **jeder** Antwort (auch 401), und im **neuen** globalen Fehlerbehandler (vorher gab es keinen) |
| **Scheduler-Verdrahtung** | **erfüllt** (war offen) | `workers/scheduler.ts`: zwei Takte (Arbeit 5 s, Einplanung 60 s), Jitter, Fehlerisolierung, Alarm `scheduler_stalled`; `worker.ts` als getrennter Prozess; `RUN_WORKERS`; `GET /ops/scheduler`. 8 Tests in `deployment.test.ts` |

**Zur CONTRACT-Phase:** Phase 1 hat die Alt-Statusspalten bewusst stehen
gelassen. Ihr Entfernen ist die **erste zerstörende Migration** dieses Projekts
und wartet auf genau dieses Tor. Sie ist **nicht geschrieben** und darf erst
geschrieben werden, wenn kein Leser mehr existiert.

**Zu `system.security_flag.change` (Phase-3-Lücke 7):** die Step-up-Aktion ist
definiert, hat aber keinen Endpunkt. **Entscheidung des Reviewers: die Definition
bleibt und wird dokumentiert, nicht entfernt.** Begründung: `feature_flags`
existiert und ist über `POST /flags` schaltbar; sobald ein Flag mit
Sicherheitswirkung dazukommt (z. B. „Zwei-Augen-Prinzip bei der Prüfungsfreigabe
aus" – Punkt 11 in `docs/fachliche-bestaetigungen.md`), ist die Aktion die
richtige Absicherung. Sie zu entfernen und später neu einzuführen wäre teurer als
sie zu behalten; sie ist typgeprüft, kostet nichts und ist als „vorbereitet, kein
Endpunkt" ausgewiesen. **Kein Endpunkt darf sie stillschweigend beanspruchen** –
sie ist keine Berechtigung, sondern eine Anforderung an einen künftigen Endpunkt.

---

## 5. §22 Das verbindliche Release-Gate – dreizehn Punkte

Jeder Punkt vom Reviewer **selbst** gegen Code und Tests geprüft.

| # | Gate-Punkt | Verdikt | Nachweis |
|---|---|---|---|
| 1 | **Idempotenz für kritische Schreibvorgänge** | **PASS** | `IDEMPOTENCY_MANDATORY` = 10 × `true`, statischer Wächter; `idempotency.test.ts` (alle zehn Operationen, drei Semantiken je Operation); Szenarien 1, 2, 5, 14. Der §2-Choke-Point trägt zusätzlich den Deadlock-Retry. **Grenze:** TTL 24 h < Offline-Fenster 7 Tage → C4 |
| 2 | **DB-Constraints gegen Doppelbuchung** | **PASS** | Zwei GiST-EXCLUDE-Constraints, Typ `contype = 'x'` geprüft; 90 gleichzeitige Buchungsversuche über drei Tests, **0 × 5xx**; die Integritätsprüfung führt sie als Pflicht-Constraints und meldet ihr Fehlen als **kritisch** |
| 3 | **Transaktionaler Outbox** | **PASS** | Trigger `audit_events_outbox_trg`: es gibt keinen Codepfad, der fachlich committen kann, ohne die Outbox-Zeile mitzucommitten. `outbox.test.ts` (Rollback lässt beides weg); Szenario 5 selbst nachgeprüft |
| 4 | **Consumer-Inbox und Deduplizierung** | **PASS** | `event_inbox` unique `(consumer, event_id)`; Szenario 8: erzwungene Doppelzustellung ändert Nachrichten- und Inbox-Zahlen **nicht**; vertauschte Reihenfolge erzeugt kein Duplikat |
| 5 | **Retry und Dead-Letter-Queue** | **PASS** | **Eine** Politik (`packages/events/src/retry.ts`) für Outbox, Jobs, Integrationen und Client; `dead_letters` + Alarm + manuelle Wiederaufnahme (zweite Wiederaufnahme = 409); Szenario 6 (Lease-Ablauf → Re-Claim → genau eine Zustellung) |
| 6 | **Persistierte Workflow-State-Machines** | **PASS** | Vier Maschinen, Zustandsmengen zeichengenau; Allow-List **in Code UND DB**, ein Test vergleicht beide Richtungen; Übergänge per **Trigger** auditiert – auch bei Roh-SQL (in Szenario 18 selbst nachgeprüft: `matched->reversed` erscheint in `state_transitions`) |
| 7 | **Offline-Konfliktbehandlung** | **PASS** | `assertOfflineAllowed` fail closed (vier Entwurfsarten erlaubt, zehn kritische verboten); 409 `version_conflict` mit Serverzustand und `conflictFields`; `record_moved_on`, `draft_too_old`, `identity_mismatch`; Szenarien 4, 11 |
| 8 | **Erfolgreicher Backup- und Wiederherstellungstest** | **PASS** | **Ausgeführt, zweifach:** logisch in eine isolierte DB (1518 ms) und PITR in einen zweiten Cluster (2171 ms), beide **VERIFIZIERT**, PITR-Genauigkeit 49,8 ms. Die Prüfung ist selbst getestet. **Grenze:** kein getrennter Speicherort, kein anderer Host → B1 |
| 9 | **Monitoring und Alarmierung** | **PARTIAL** | **Vorhanden:** 20 Kennzahlen im Prometheus-Format mit geschlossener Labelmenge, Alarmkatalog als Code (**11** Arten inkl. neu `scheduler_stalled`) mit Schwelle, Zuständigem, Runbook-Anker und Eskalation; jeder Anker löst auf (Wächtertest). **Fehlt:** ein Scraper, ein Dashboard und ein **Alarmkanal** – `ALARM_WEBHOOK_URL` ist ein Konfigurations-Seam, standardmäßig **nicht** registriert. Ein Alarm, den niemand empfängt, ist kein Alarm → B3 |
| 10 | **Rechte- und Sicherheitstests** | **PASS** | `security.test.ts` (52), `roles.test.ts`, `code-guards.test.ts` (20); Szenario 16 (zehn Zugriffswege, alle 4xx) und Szenario 17 (Rechteentzug mitten in der Sitzung, instanzübergreifend). Alle Non-Negotiables statisch bewacht |
| 11 | **Chaos-/Absturz-Wiederanlauftests** | **PASS** | 79 Tests, 18 Szenarien, 14 PASS / 4 TEILWEISE / **0 unausgeführt**; Abstürze **echt** nachgestellt (Instanz geschlossen, Lease verwaist), nicht simuliert. Browseranteile benannt → B2 |
| 12 | **Dokumentierte RPO/RTO** | **PASS** | `docs/slo-dashboard.md` + `backup-restore-report.md` Abschnitt 5, **getrennt** für Pilot und Produktion, mit gemessenen technischen Anteilen und ausgewiesenen Schätzungen |
| 13 | **Rollback-Plan** | **PARTIAL** | **Vorhanden:** Reihenfolge, Auslöseschwellen (aus `GET /metrics` ablesbar), Rollback-Ablauf, `deployments` mit `destructive`/`backup_ref`/`rolled_back_at`/`rollback_reason` (CHECK erzwingt einen Grund), und die Regel „war der Schritt zerstörend, ist ein Code-Rollback **nicht** ausreichend". **Fehlt:** die **Ausführung** – kein Orchestrator, kein Artefaktregister, kein geübter Rollback → B4 |

**Bilanz: 11 × PASS, 2 × PARTIAL, 0 × FAIL.** Beide PARTIAL scheitern nicht am
Code, sondern an fehlender Betriebsinfrastruktur (Alarmkanal/Scraper,
Orchestrator).

---

## 6. Verdikt und Bedingungen

Das Fundament ist belastbar und **belegt**: 793 grüne Tests (vom Reviewer
reproduziert), 18 Chaos-Szenarien ohne einen einzigen unausgeführten Fall, ein
zweifach ausgeführter Wiederherstellungstest samt PITR mit
Millisekunden-Genauigkeit, gemessene SLOs gegen den echten HTTP-Stack, und die
wichtigste Regression des Projekts (Deadlock statt Konfliktantwort) über 90
gleichzeitige Buchungsversuche ohne ein einziges 5xx bestätigt.

Dem stehen Lücken gegenüber, die **keine** Engineering-Mängel sind, aber echte
Betriebsvoraussetzungen: keine Infrastruktur (Offsite, Secret-Store, Standby,
Orchestrator, Alarmkanal), kein Browser über die gesamte Projektlaufzeit, zehn
Mock-Integrationen und vierzehn fachlich unbestätigte Regeln, die **bereits
wirksam** sind.

### <a id="verdikt"></a>RELIABILITY FOUNDATION CONDITIONAL

Kein `READY`: dafür fehlen ein Alarmkanal, ein Rollback-Weg, ein getrennter
Sicherungsort und jede Browserevidenz — und vierzehn wirksame Fachregeln sind
unbestätigt.
Kein `BLOCKED`: es wurde in dieser Prüfung **kein** Fall gefunden, in dem das
System Daten verliert, doppelt vollzieht, einen falschen Erfolg meldet oder eine
Autorisierung umgehen lässt. Der eine gefundene Codefehler (2.1) ist behoben,
getestet und durch einen Wächter gegen Rückfall gesichert.

### A · Vor jedem Betrieb mit echten Nutzerdaten (blockierend)

| | Bedingung | Wer entscheidet |
|---|---|---|
| **A1** | **Getrennter Sicherungsort + Secret-Store.** Sicherungen liegen heute neben der Datenbank, der Schlüssel neben den Sicherungen. Ziel auf einem anderen Host/Anbieter, Schlüssel in einen Secret-Store, getrennte Zugangsdaten (die Anwendung darf Sicherungen nicht löschen können). | Betrieb + Geschäftsführung |
| **A2** | **Ein Alarmkanal.** `ALARM_WEBHOOK_URL` setzen und eine Zustellung **belegen**. Alle elf Alarmarten sind definiert und feuern; empfangen wird nichts. | Betrieb |
| **A3** | **Genau ein Prozess mit Scheduler**, verifiziert per `GET /ops/scheduler` und `fahrschul_scheduler_last_tick_age_seconds`. Ohne Takt läuft keine Zustellung, kein Angebotsablauf, keine Wiederaufnahme — und die anderen Alarme schweigen fälschlich. | Betrieb |
| **A4** | **Die 14 Punkte in `docs/fachliche-bestaetigungen.md` bestätigen oder korrigieren.** Alle offen, alle **bereits wirksam** (die 15-Minuten-Pausenregel blockiert heute Buchungen). Besonders: Prüfungsreife-Gewichtung, Sonderfahrt-Mindeststunden, Vier-Augen-Prinzip bei der Prüfungsfreigabe (vorbereitet, **nicht erzwungen**), Storno-/Ausfallgebühren. | **Fahrschule Krebs** |
| **A5** | **Echter Sandbox-Test je Integration** vor jedem Umschalten von `mock` auf `sandbox`/`live` — Bank/FinTS, E-Mail/SMS/Push, Zahlungsauslösung, **Malware-Scan**, Dokumentenspeicher. `assertMockOnly` verhindert heute ein Versehen; der AV-Scanner ist `mock-always-clean`, und ohne echten Scanner darf kein Dokument als geprüft gelten. | Betrieb + Geschäftsführung |
| **A6** | **`METRICS_TOKEN` setzen** und `/metrics` ins interne Netz legen. Ohne Token ist der Endpunkt offen (nur Aggregate, aber Betriebsvolumen ist ein Geschäftsgeheimnis). | Betrieb |
| **A7** | **TLS + `COOKIE_SECURE=true`.** HSTS und die Cookie-Flags schalten korrekt um, sobald HTTPS gemeldet wird — es wird hier nur nie gemeldet. | Betrieb |

### B · Vor Produktivbetrieb, nicht vor einem Pilot (hoch)

| | Bedingung | Wer entscheidet |
|---|---|---|
| **B1** | **Wiederherstellung auf einem ANDEREN Host** aus dem getrennten Speicherort, mit gemessener Zeit. Der Test hier lief auf derselben Maschine. | Betrieb |
| **B2** | **Ein vollständiger Playwright-Lauf** (vier Apps, kritische Flows, 360–1440 px) **plus** die CSP im Browser und mindestens ein Screenreader-Durchlauf. In sieben Sitzungen ist **nie** ein Browser gelaufen; in dieser wurde es erneut versucht und war erneut blockiert (Abschnitt 3). Damit sind die Browseranteile von Szenario 1, 7, 11, 13 und Phase-3-Lücke 5 offen. | Entwicklung |
| **B3** | **Scraper + Dashboard.** Format und Katalog sind da, der Sammler nicht. Gate-Punkt 9 wird erst damit PASS. | Betrieb |
| **B4** | **Rollback erproben.** Schwellen und Ablauf sind definiert, die Ausführung braucht einen Orchestrator und ein Artefaktregister. Gate-Punkt 13 wird erst damit PASS. | Betrieb |
| **B5** | **Standby + Failover.** Die Datenbank ist ein Single Point of Failure. `wal_level`/`max_wal_senders` sind vorbereitet, nichts ist eingerichtet oder geübt. | Betrieb |
| **B6** | **Aufbewahrung einrichten** (`pg_archivecleanup`). Das WAL-Archiv wuchs in einer Sitzung auf 288 MB und würde unbegrenzt weiterwachsen. | Betrieb |
| **B7** | **Gemeinsamer Rate-Limit-Speicher (Redis)** vor dem Mehrinstanzbetrieb. `RateLimitStore` ist der Einhängepunkt. Der Brute-Force-Schutz ist davon **nicht** betroffen (bewiesen, Szenario 14). | Betrieb |

### C · Geplant abarbeiten (mittel)

| | Bedingung | Wer entscheidet |
|---|---|---|
| **C1** | **Neun Abhängigkeits-Advisories in sechs Paketen** (`drizzle-orm` high, `react-router`/`react-router-dom` moderate ×3, `vitest` critical, `vite` high+moderate ×2, `esbuild` moderate). Vom Reviewer eigenständig reproduziert (exakt 9 in 6) und die Bewertungen einzeln nachgeprüft (Abschnitt 2.8): **keines im aktuellen Code ausnutzbar**. **Erforderliche Handlung:** Major-Aktualisierung von `drizzle-orm` (0.36 → ≥ 0.45.2) und React Router (6 → 7) als **eigener** Vorgang mit vollem Testlauf, plus Toolchain-Aktualisierung für `vite`/`esbuild`/`vitest`. **Nicht** in einer Sicherheits- oder Chaosphase. Zusätzliche Bedingung: **vor** der Einführung dynamischer Navigationsziele muss React Router 7 da sein. Entscheidung: **Entwicklung + Geschäftsführung** (Terminrisiko gegen Restrisiko). |
| **C2** | Rate-Limit pro Prozess dokumentieren, bis B7 erledigt ist. Bewiesen in Szenario 14. |
| **C3** | `pnpm audit` funktionsfähig machen (Proxy liefert gzip, pnpm 10.9.0 dekomprimiert nicht; `npm audit` scheitert am fehlenden `package-lock.json`). Bis dahin ist der Scan manuell — `scripts/`-taugliches Vorgehen ist in `docs/security-architecture.md` §11 dokumentiert und wurde hier reproduziert. |
| **C4** | Idempotenz-TTL (24 h) gegen das Offline-Fenster (7 Tage) entscheiden: TTL anheben **oder** die Grenze bewusst festschreiben. Abwägung: Tabellengröße und Aufbewahrung personenbezogener Nutzlasten gegen Wiederholsicherheit. Entscheidung: **Entwicklung + Datenschutz**. |
| **C5** | **Kernfluss 4** (Fahrzeugmangel → Finance-Flottenansicht) mit einem echten Cross-App-Integrationstest belegen. Aus der Prompt-5-Review **weiterhin offen** — Phase 4 hat ihn nicht geschlossen. |
| **C6** | Funktionslücken aus `docs/final-release-report.md` §6 Punkt 7 (Matching nicht angebunden, Forecast-API, `GET /office/dokumente`, PDF/CSV/XLSX-Export, Seed-Abdeckung) schließen **oder** bewusst aus dem Go-Live-Scope nehmen. **Offen.** |
| **C7** | `docker compose up` einmal in einer Umgebung mit Registry-Zugang verifizieren. **Offen seit Prompt 0.** |
| **C8** | Überlappende Secret-Rotation für `SESSION_SECRET` (heute Bruchrotation). Bewusst offen aus Phase 3. |
| **C9** | Hash-Kette des Audits ist ein **Baum**, nicht eine Linie: das Löschen eines Blattes ist ohne Trigger nicht erkennbar. Bewusst offen aus Phase 3. |
| **C10** | `system.security_flag.change` behalten und dokumentiert lassen (Entscheidung in Abschnitt 4). Bei der ersten Nutzung einen Endpunkt ergänzen. |

**Keine dieser Bedingungen deutet auf einen Architektur- oder Sicherheitsfehler
hin.** Sie sind Betriebsvoraussetzungen, Testabdeckung außerhalb der
Sandbox-Möglichkeiten und fachliche Abnahme — nicht Mängel der
Kern-Engineering-Qualität.
