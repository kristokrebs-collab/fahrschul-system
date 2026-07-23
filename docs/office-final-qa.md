# Büro-Zentrale – Abschluss-QA (Prompt 2)

Diese Sitzung hat `apps/office` vom Health-Check-Platzhalter (Prompt 0) in
eine echte, gegen `apps/api` arbeitende Büro-Zentrale überführt und dafür
`apps/api`/`packages/domain`/`packages/database`/`packages/permissions`/
`packages/scheduling` gezielt erweitert sowie ein neues Paket
`packages/matching` eingeführt. `dashboard.html` wurde ausschließlich als
UX-/Fachlogik-Referenz gelesen (Layout-Prinzip, Farbsystem), nicht als
Code-Basis – seine PIN-Auth, sein localStorage-Zustand und seine
dreifach duplizierten Fahrlehrerlisten wurden **nicht** übernommen.

## Was gebaut wurde

### Datenmodell (`packages/database/migrations/0004_office.sql`)

Neue Tabellen: `raeume`, `simulatorgeraete`, `fahrzeugmaengel`,
`arbeitszeitregeln`, `leads`, `nachrichten_vorlagen`, `nachrichten`,
`pruefungen`, `storno_events`, `storno_angebote`. Neue Spalten:
`fahrzeuge.handicap_ausstattung`/`automatik`, `ausbildungen.handicap_bedarf`,
`terminangebote`/`terminbuchungen.raum_id`/`simulatorgeraet_id`. Migration
läuft sauber gegen eine leere DB und ist idempotent (zweiter Lauf wendet
nichts an, siehe `migrations.test.ts`).

### Harte Matching-Regeln (`packages/scheduling/src/rules.ts`)

`checkBookingConflicts` wurde um die in Prompt 0/1 fehlenden harten Regeln
erweitert: **Schüler frei** (`STUDENT_DOUBLE_BOOKED`), **Raum/Simulator
frei** (`ROOM_DOUBLE_BOOKED`/`SIMULATOR_DOUBLE_BOOKED`), **Fahrzeug
einsatzbereit** (`VEHICLE_NOT_READY`, gesetzt durch Fahrzeugmangel-Meldung),
**Automatik/Schaltung** (`GEARBOX_MISMATCH`), **Handicap-Ausstattung**
(`HANDICAP_EQUIPMENT_MISSING`), **Pause/Arbeitszeit** (`MIN_BREAK_VIOLATED`,
Mindestabstand zwischen zwei Fahrten desselben Fahrlehrers) und
**Ausbildungsreihenfolge** (`TRAINING_ORDER_VIOLATED`, Sonderfahrt erst nach
einer Mindestzahl Übungsstunden). Alle sind in `apps/api/src/services/
booking.ts` (`performBooking`) verdrahtet – **derselbe** Transaktions-Pfad,
den Prompt 0/1 für `POST /appointments` und `POST /appointment-offers/:id/
accept` nutzen, jetzt auch von Storno-Retter genutzt
(`services/storno-retter.ts`). Die zwei fachlich unbestätigten Konstanten
(Mindestpause, Mindest-Übungsstunden vor Sonderfahrt) sind als
`UNBESTAETIGT_*`-Konstanten im Code markiert, siehe
`docs/fachliche-bestaetigungen.md` Punkte 7 und 9.

### Optimierung/Scoring (`packages/matching`, neues Paket)

Reine, unit-getestete `scoreCandidate()`/`rankCandidates()`-Funktionen für
die 13 geforderten Kriterien (Prüfungstermin, Fahrlehrerkontinuität,
Lernziel, Schülerwunsch, Leerfahrt, Standortcluster, faire Verteilung,
Lernabstand, Krebs Flex, Annahmewahrscheinlichkeit, Fahrzeugauslastung,
Deckungsbeitrag, Überstundenvermeidung), die AUSSCHLIESSLICH bereits hart
geprüfte Kandidaten bewerten – kein eigener Konfliktcheck, keine Black Box:
jedes Ergebnis liefert `score`, `reasons`, `downsides`, `dataAsOf`. Die
Gewichtung ist als `UNBESTAETIGT_MATCHING_WEIGHTS`-Konstante markiert
(fachlich nicht bestätigt, analog zur Prüfungsreife-Gewichtung aus Prompt 1).
Storno-Retter nutzt aktuell nur `computeCandidates()` (ungewichtete Liste,
Büro wählt manuell) – die Anbindung von `rankCandidates()` an echte
Signal-Daten (Wunschzeiten, Lernziel-Status, …) für einen automatisch
sortierten Vorschlag ist **nicht** Teil dieser Sitzung (siehe "Bekannte
Lücken" unten).

### Prüfungs-Pipeline (`packages/domain/src/pruefungspipeline.ts`)

Explizite State Machine mit 9 Zuständen und einer Kantenliste
(`PRUEFUNG_TRANSITIONS`), die für jeden Übergang die erlaubten Akteursrollen
trägt. `fahrlehrer_go` ist ausschließlich für Rolle `fahrlehrer` erlaubt,
alle anderen Übergänge für `buero`. `apps/api/src/routes/exam-pipeline.ts`
prüft zweistufig: zuerst die Permission-Matrix
(`exam:pipeline:advance`, Büro **und** Fahrlehrer), dann transition-spezifisch
per `assertTransitionAllowed` – ein Büro-Akteur mit der Permission bekommt
für den Übergang nach `fahrlehrer_go` trotzdem 403. Jeder Übergang wird
auditiert (`pruefungen.transition`, mit optionalem Grund).

### Storno-Retter (`apps/api/src/services/storno-retter.ts`)

Alle 11 Schritte aus der Aufgabenstellung als benannte Funktionen
(`raiseStornoEvent`, `computeCandidates`, `sendStornoOffers`,
`expireStornoOffer`, `acceptStornoOffer`), verdrahtet in
`apps/api/src/routes/storno.ts`. Race-Schutz: `acceptStornoOffer` sperrt die
`storno_events`-Zeile per `SELECT ... FOR UPDATE`, bevor der Status geprüft
wird – zwei parallele Annahmen (auch für UNTERSCHIEDLICHE Angebote
desselben Events im Broadcast-Modus) serialisieren sich auf dieser
Zeilensperre; die zweite sieht garantiert den bereits aktualisierten Status
und wird abgelehnt. Getestet mit einem echten `Promise.all`-Parallel-Test
(zwei unterschiedliche Schüler, zwei unterschiedliche Angebote desselben
Events) – siehe unten. Gerettete Minuten/Umsatz werden gemessen und
gespeichert; der Umsatz-pro-Minute-Wert ist eine `UNBESTAETIGT_*`-Konstante.
Schritt 9 ("alle Apps aktualisieren") ist eine dokumentierte Lücke – kein
Push-Kanal in dieser Umgebung, betroffene Datensätze sind aber sofort per
Poll/Refresh sichtbar (siehe docs/integration-gaps.md).

### Büro-Zentrale-API (`apps/api/src/routes/office-dashboard.ts`,
`resources.ts`, `leads.ts`, `communication.ts`)

- `GET /office/heute`: Heute-Queue in den drei geforderten Buckets, jeder
  Eintrag mit Grund/Priorität/Frist/Verantwortlicher/Aktion + Referenz auf
  den Quelldatensatz. Drei Buckets (Ressourcenkonflikt als eigene Prüfung,
  Kapazitätsengpass, Firmenkunden) sind fachlich nicht als eigene Entität
  modelliert und werden bewusst NICHT mit einer erfundenen Zahl gefüllt –
  die Response trägt dafür ein `hinweis`-Feld.
- `GET /office/planung`: exakte Terminbuchungen im gewählten Zeitraum.
- `GET /office/schueler` (paginiert) + `GET /office/schueler/:id`
  (Schüler-360, Header ausschließlich nächstes Ziel/Blocker/nächster
  Termin/empfohlene Aktion, Rest der Seite mit vollständiger Akte).
- `GET /office/auswertungen`: einfache KPI-Aggregation.
- `GET /office/audit`: Audit-Log, standortgescoped
  (`audit:read:office`, enger als `audit:read`).
- `resources.ts`: Räume/Simulatoren/Fahrzeugmängel/Arbeitszeitregeln.
  Fahrzeugmangel-Meldung setzt `fahrzeuge.status = 'wartung'`, wodurch die
  harte Regel `VEHICLE_NOT_READY` sofort greift.
- `leads.ts`: Lead-CRUD + Lead→Schüler-Konvertierung (legt echten
  `schueler`-Datensatz an, kein Login-Konto – Prompt 1 hat bewusst keinen
  Self-Signup).
- `communication.ts`: Vorlagen + Sende-Log über den Mock-
  Notifications-Adapter aus Prompt 0, mit echtem Status-Modell
  (`warteschlange`/`gesendet`/`fehlgeschlagen`).

### Neue Berechtigungen (`packages/permissions`)

`office:dashboard:read`, `leads:manage`, `messages:manage`,
`resources:manage`, `exam:pipeline:advance`, `storno:manage`,
`audit:read:office` – alle für Rolle `buero`, `exam:pipeline:advance`
zusätzlich für `fahrlehrer` (transition-spezifisch weiter eingeschränkt,
siehe oben). `docs/role-permission-matrix.md` wurde im selben Commit
aktualisiert.

### Frontend (`apps/office`)

React-Router-Shell mit Sidebar-Navigation (Card/List/Split-Layout-Sprache
aus `dashboard.html` portiert, Farbsystem aus `apps/student` wiederverwendet
für visuelle Konsistenz zwischen den Apps) und allen elf geforderten Tabs:
Heute (drei Buckets als Spalten), Planung (Zeitraum-Filter + Tabelle),
Schüler (paginierte Liste) + Schüler-360 (Header + Detailabschnitte),
Prüfungen (Pipeline-Board mit Übergangsbuttons, serverseitige 403 werden als
Fehlermeldung sichtbar statt den Button nur zu verstecken), Dokumente
(Akzeptieren/Ablehnen aus der Heute-Queue heraus), Zahlungen (read-only
KPI, kein Mutationsformular), Leads/CRM (anlegen + konvertieren),
Kommunikation (Vorlagen + Sende-Log), Ressourcen (Räume/Simulatoren/
Fahrzeugmängel/Arbeitszeitregeln als Anzeige), Auswertungen (KPI-Kacheln),
Audit (Tabelle). Session über httpOnly-Cookie (kein PIN-Gate, kein
localStorage-Zustand). `pnpm --filter @fahrschul/office build` läuft
fehlerfrei (Vite-Produktionsbuild, 189 KB JS gzip 60 KB).

## Tatsächlich ausgeführte Tests

```
pnpm -r typecheck   # 16/16 Workspace-Pakete fehlerfrei (inkl. apps/instructor/
                     # finance, die unverändert blieben und weiterhin bauen)
pnpm -r test
```

- `packages/scheduling` – **18/18 grün** (7 aus Prompt 0 weiterhin grün + 11
  neue: Schüler/Raum/Simulator-Konflikt, Fahrzeug nicht einsatzbereit,
  Getriebeart-Mismatch, Handicap-Ausstattung fehlt/vorhanden, Mindestpause
  verletzt/eingehalten, Ausbildungsreihenfolge verletzt/eingehalten)
- `packages/matching` – **6/6 grün** (starker vs. schwacher Kandidat,
  reasons/downsides-Zuordnung, `dataAsOf` wird durchgereicht statt
  verdeckt "jetzt" zu behaupten, Score bleibt in [0,100], Ranking sortiert
  korrekt + liefert Alternativen, leere Liste liefert `best: null`)
- `packages/domain` – **6/6 grün** (Prüfungs-Pipeline: Büro-Übergang erlaubt,
  `fahrlehrer_go` erfordert Rolle Fahrlehrer und lehnt Büro/Schüler ab,
  ungültiger/übersprungener Übergang wird abgelehnt, vollständiger
  Happy-Path von `in_vorbereitung` bis `ergebnis_dokumentiert`)
- `packages/permissions` – **11/11 grün** (5 aus Prompt 0 + 6 neue: alle
  Büro-only-Berechtigungen NIE für Schüler/Fahrlehrer/Finanzen,
  `exam:pipeline:advance` für Büro UND Fahrlehrer, Finanzen bekommt keine
  Büro-Verwaltungsrechte)
- `apps/api` – **72/72 grün** (44 aus Prompt 0/1 weiterhin grün + 28 neue in
  `src/__tests__/office.test.ts`):
  - Rollen-Guard: Schüler UND Fahrlehrer bekommen 403 (nicht 500/200) auf
    allen Büro-only-Endpunkten, unauthentifiziert 401
  - Lead→Schüler: Anlegen, Konvertieren (legt echten Schüler-Datensatz an),
    zweite Konvertierung wird abgelehnt (409), beide Schritte auditiert
  - Dokumentprüfung: Akzeptieren verändert Status UND verschwindet aus der
    Heute-Queue
  - Harte Matching-Regeln (Ablehnung): falsche Fahrlehrer-Qualifikation,
    falsche Fahrzeugklasse, Raum-Konflikt (Standort/Ressourcenkonflikt),
    Pause/Arbeitszeit-Konflikt (Mindestabstand), Fahrzeug nicht
    einsatzbereit nach Ausfallmeldung (inkl. Sichtbarkeit in der
    Heute-Queue)
  - Krankheit/Ausfall: kranker Fahrlehrer erscheint im Sofort-Bucket
  - Storno-Retter: vollständiger Fluss (Storno→Slot sperren→Kandidaten→
    Broadcast-Angebote→erste gültige Annahme→übrige geschlossen→
    Minuten/Umsatz gemessen→auditiert) UND der kritische
    **Race-Test**: zwei parallele Annahmen unterschiedlicher Angebote
    desselben Events (`Promise.all`) ⇒ genau ein 201, ein 409, am Ende
    genau eine aktive Buchung in der DB
  - Prüfungs-Pipeline: Büro bekommt 403 für `fahrlehrer_go`
    (`FORBIDDEN_ROLE`), Fahrlehrer darf `fahrlehrer_go` setzen aber NICHT
    den nächsten Büro-only-Schritt, ungültiger Sprung liefert 409
    `INVALID_TRANSITION`, Schüler bekommt 403
  - Zahlungen: keine Mutationsroute für Büro (404, keine Route registriert)
  - Schüler-Liste/360: **105 zusätzlich geseedete Schüler** (107 gesamt)
    paginieren sauber (Seite 1 = 50 Einträge, `total` korrekt, Seite 3
    liefert den Rest), 360-Header enthält EXAKT die vier geforderten
    Felder
  - Audit: Büro-Buchung erzeugt ein audit_events-Ereignis mit korrekter
    `entitaet`/`entitaetId`, Fahrlehrer bekommt 403 auf
    `audit:read:office`
- `apps/student` – weiterhin **24/24 grün** (unverändert, nur durch die
  gemeinsamen Backend-Änderungen erneut mitgetestet, keine Regression)
- Zusätzlich manuell verifiziert: `pnpm --filter @fahrschul/office build`
  läuft fehlerfrei durch, `pnpm --filter @fahrschul/api dev` +
  `GET /health` antwortet 200, `POST /auth/login` mit falschem Passwort
  liefert `invalid_credentials` (echte DB-Verbindung, kein Mock).

## Nicht/nur eingeschränkt geprüft (ehrlich)

- **Playwright/Browser-E2E**: In dieser Sandbox weiterhin nicht ausführbar
  (`npx playwright install chromium` schlägt mit `403 request rejected:
  host not permitted` fehl, identisch zu Prompt 0/1 – siehe
  `docs/architecture-report.md`/`docs/student-app-final-qa.md`). Es wurden
  in dieser Sitzung **keine** Playwright-Specs für `apps/office` geschrieben
  (anders als Prompt 1, wo sie zumindest strukturell vorbereitet wurden) –
  das ist eine bewusste Priorisierung zugunsten der API-Integrationstests,
  die den serverseitigen Non-Negotiables (Matching, Storno-Retter,
  Autorisierung) direkt entsprechen. Ein echter Browser-Lauf gegen
  `apps/office` steht noch aus.
- **Viewport-Spot-Checks 1440/1024/768/390**: Das Stylesheet nutzt
  durchgehend Flexbox/Grid mit `auto-fit`/`minmax`, `max-width:100%` auf
  scrollenden Tabellen-Containern und einen Breakpoint bei 900px
  (Sidebar → horizontale Navigation). Das wurde durch Code-Review geprüft,
  NICHT durch echte Screenshots (kein Browser in dieser Sandbox verfügbar).
- **`packages/matching` `rankCandidates()` ist NICHT an Storno-Retter oder
  die Planung-UI angebunden** – nur `scoreCandidate`/`rankCandidates` selbst
  sind unit-getestet; die Storno-Kandidatenliste im Büro-UI ist aktuell
  unsortiert (Büro wählt die Empfänger manuell aus der Kandidatenliste).
  Eine Anbindung an echte Signaldaten (Wunschzeiten, Lernziel-Fortschritt,
  Fahrzeugauslastung) ist ein offener Punkt für eine Folge-Session.
- **Dokumente-Tab im Frontend** hat keinen eigenständigen `GET
  /documents/any`-Endpunkt zur Verfügung (apps/api registriert bewusst nur
  `documents:read:own`/`documents:read:any` für Schüler-Detailansichten,
  kein generischer "alle Dokumente"-Listenendpunkt) – die Büro-UI zeigt
  daher nur die IDs aus der Heute-Queue, kein vollständiges
  Dokumentenarchiv mit Dateiname/Typ/Vorschau. Für eine vollständige
  Dokumente-Übersicht fehlt noch `GET /office/dokumente`.
- **Kein Seed-Skript für Office-Demodaten**: `packages/database/src/seed.ts`
  wurde in dieser Sitzung nicht um Leads/Räume/Simulatoren/Prüfungen/
  Storno-Beispieldaten erweitert – die Tests seeden ihre eigenen Fixtures,
  ein `pnpm db:seed`-Lauf zeigt die neuen Bereiche daher leer.
- **Arbeitszeitregeln** sind reine Anzeige-/Warnkonfiguration ohne
  automatische Konfliktberechnung gegen tatsächliche Wochenarbeitszeit
  (kein Cron/Batch-Job, der die tatsächlich gebuchten Stunden je Fahrlehrer
  gegen `arbeitszeitregeln` aufsummiert und warnt) – das Datenmodell ist
  vorbereitet, die Auswertung fehlt.
- **Kapazitätsengpass/Ressourcenkonflikt/Firmenkunden** sind wie oben
  beschrieben fachlich nicht modelliert und daher NICHT in der Heute-Queue
  enthalten.

## Bewusste Vereinfachungen / offene fachliche Punkte (siehe docs/fachliche-bestaetigungen.md)

1. **Mindestpause zwischen zwei Fahrten (15 Minuten)** und **Mindestzahl
   Übungsstunden vor der ersten Sonderfahrt (5)** sind unbestätigte
   Platzhalter-Konstanten (`UNBESTAETIGT_*` in `packages/scheduling`) –
   Punkte 7 und 9 aus `docs/fachliche-bestaetigungen.md` bleiben offen.
2. **Matching-Kriterien-Gewichtung** (`UNBESTAETIGT_MATCHING_WEIGHTS`) ist
   eine Annahme aus dieser Sitzung, keine bestätigte Fachregel – analog zu
   Punkt 5/6 (Prüfungsreife-Gewichtung aus Prompt 1).
3. **Umsatz pro gerettete Minute** (Storno-Retter-Kennzahl) ist ein
   unbestätigter Platzhalterwert.
4. **"Rückrufe"/"Simulator-/Theorieanfragen"** in der Heute-Queue sind
   Annäherungen aus vorhandenen Daten (Lead-Status `kontaktiert` bzw. offene
   Simulator-/Theorie-Terminangebote) – es gibt keine eigene
   "Rückruf-Anfrage"- oder "Anfrage"-Entität, das ist explizit im
   Code-Kommentar markiert.
5. **Handicap-Ausstattungs-Taxonomie** (freie String-Codes auf Fahrzeug und
   Ausbildung) ist nicht mit der Fahrschule abgestimmt.

## Mock-/Platzhalter-Integrationen (siehe docs/integration-gaps.md)

- **Kommunikation** nutzt weiterhin den Mock-Notifications-Adapter aus
  Prompt 0 (kein echter E-Mail/SMS/Push-Versand).
- **Storno-Retter Schritt 9 ("alle Apps aktualisieren")** hat keinen echten
  Push-Kanal – betroffene Apps sehen den neuen Stand beim nächsten
  Poll/Reload, nicht in Echtzeit.

## Fazit

**OFFICE CONDITIONAL**

Alle Non-Negotiables sind eingehalten und durch echte Tests belegt: keine
PIN-Auth, keine localStorage-Quelle der Wahrheit, keine dreifach
duplizierten Fahrlehrerlisten, **serverseitige Konfliktprüfung für jede
Terminbuchung** (jetzt mit Schüler/Raum/Simulator/Fahrzeugstatus/
Getriebeart/Handicap/Pause/Reihenfolge als zusätzliche harte Regeln, alle
in derselben Transaktion wie Prompt 0), Storno-Retter mit echtem,
getestetem Race-Schutz, Prüfungs-Pipeline mit transition-spezifischer
Autorisierung (nicht nur Permission-Matrix), Matching-Score ist eine
nachvollziehbare, unit-getestete Funktion mit Gründen/Nachteilen statt
einer Black Box.

Bedingungen, die vor einem echten Go-Live/einer Folge-Session geklärt
werden müssen (keine davon ist ein technischer Blocker für diese Sitzung,
aber keine gilt stillschweigend als "fertig"):

1. Playwright/Browser-E2E für `apps/office` ist weder geschrieben noch
   ausführbar in dieser Sandbox – muss in einer Umgebung mit Zugriff auf
   `cdn.playwright.dev` nachgeholt werden (inkl. echter Viewport-Screenshots
   für 1440/1024/768/390).
2. `packages/matching`s Ranking ist nicht an Storno-Retter/Planung
   angebunden (nur Kandidatenliste + manuelle Auswahl).
3. Kein eigenständiger Dokumente-Übersichts-Endpunkt für Büro
   (`GET /office/dokumente`), Arbeitszeit-Auswertung gegen echte
   Wochenstunden, Kapazitätsengpass/Ressourcenkonflikt/Firmenkunden-Buckets
   in der Heute-Queue.
4. Alle in "Bewusste Vereinfachungen" gelisteten fünf fachlichen Annahmen
   sind von der Fahrschule Krebs zu bestätigen oder zu korrigieren.
5. Kein Seed-Skript für Office-Demodaten (Leads/Räume/Prüfungen/Storno) –
   `pnpm db:seed` deckt weiterhin nur die Prompt-0/1-Kernentitäten ab.
6. Wie in Prompt 0/1: alle externen Integrationen bleiben im `mock`-Modus
   (Kommunikationskanäle, Storno-Retter-Push).
