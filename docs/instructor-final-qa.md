# Fahrlehrer-App – Abschluss-QA (Prompt 3)

Diese Sitzung hat `apps/instructor` vom Health-Check-Platzhalter (Prompt 0)
in eine echte, gegen `apps/api` arbeitende Fahrlehrer-App überführt und dafür
`apps/api`/`packages/domain`/`packages/database`/`packages/permissions`
gezielt erweitert sowie zwei neue Mock-Integrationsadapter
(`packages/integrations` transcription/ai-suggestions) eingeführt.
`fahrlehrer.html` wurde ausschließlich als UX-/Fachlogik-Referenz gelesen
(Tagesplan-Layout, Call/Nav-Links, "Heute krank"-Panik-Button-Idee,
Fahrstil-Bewertung bei Bestätigung), nicht als Code-Basis – seine
localStorage-Wahrheit und das hartcodierte `INSTRUCTORS`-Array wurden
**nicht** übernommen.

## Was gebaut wurde

### Datenmodell (`packages/database/migrations/0005_instructor.sql`)

- `terminbuchungen` um den Stunde-starten/beenden-Lebenszyklus erweitert:
  `gestartet_at`, `beendet_at`, `tatsaechliche_dauer_minuten`, `kurznotiz`,
  `naechstes_ziel`, `schuelerfeedback`, `verspaetung_minuten`. Status nimmt
  zusätzlich `gestartet`/`abgeschlossen`/`no_show` an (keine CHECK-
  Constraint auf `status` seit Prompt 0, daher keine Migration dafür nötig).
- Neue Tabelle `kompetenzbeobachtungen` (Kompetenzraster: 15 Felder ×
  5 Status, `beobachtung`-Freitext, Datum, Fahrlehrer, optional
  Termin-Referenz).
- Neue Tabelle `sprachprotokolle` (Sprachprotokoll/Voice-Log) mit
  getrennten `intern_zusammenfassung`/`schuelerseitig_zusammenfassung`-
  Spalten, `sprachprotokoll_status` (`aufnahme`→`transkribiert`→`entwurf`→
  `bestaetigt`) und `gespiegeltes_feedback_id` (Referenz auf die beim
  Bestätigen erzeugte `fahrstunden_feedback`-Zeile).
- `fahrzeugmaengel` (Prompt 2) um Quick-Check-Felder erweitert:
  `gemeldet_von_benutzer_id`, `kilometerstand`, `tank_ladung_prozent`,
  `warnleuchten`, `schweregrad`, `einsatzbereit`, `foto_referenz`,
  `sprachnotiz_referenz`, `geroutet_an` – **kein Duplikat-Tabelle**, die
  Fahrlehrer-App ist bewusst nur die Melde-Seite, Büro/Fuhrpark (Prompt 4)
  bleibt die Auflösungs-Seite.

### Domain (`packages/domain/src/instructor.ts`)

- `KOMPETENZFELDER` (15 Felder wörtlich aus der Aufgabenstellung) und
  `KOMPETENZSTATUS` (`neu`/`in_uebung`/`zunehmend_sicher`/`stabil`/
  `erneut_pruefen`) – bewusst **keine** Diagnose-/Charakter-/Motivations-/
  Intelligenz-Werte im Enum, das ist die inhaltliche Formvorgabe technisch
  durchgesetzt: es gibt schlicht kein Feld, das damit befüllt werden könnte.
- `lessonCompletionInputSchema`: alle 8 Schritte als **Pflichtfelder** (kein
  `.optional()`), `bestaetigung` muss `z.literal(true)` sein – ein
  unvollständiges Payload wird von Zod an der Route-Grenze abgelehnt,
  **bevor** die Transaktion überhaupt beginnt.
- `sprachprotokollSchema`, `fahrzeugMangelDetailSchema`.
- `EVENT_TYPES` um `lesson.started`, `vehicle_issue.reported`,
  `voice_log.confirmed`, `competency.observed` ergänzt (das Event-Log selbst
  ist Prompt 0, `buildEventRow` akzeptiert ohnehin freie Strings – die
  Ergänzung ist Dokumentationswert, kein technisches Erfordernis).
- `pruefungspipeline.ts` (Prompt 2) **unverändert wiederverwendet** –
  Fahrlehrer-Go ist der bestehende `fahrlehrer_go`-Übergang, apps/instructor
  ruft denselben `POST /pruefungen/:id/transition`-Endpunkt auf, keine
  eigene Logik.

### Backend (`apps/api/src/routes/instructor.ts`, `services/instructor-lesson.ts`)

- `GET /instructor/heute`: eigene Termine des Tages, live aus
  `terminbuchungen` + Schüler/Fahrzeug/Raum/Simulator-Join – **kein**
  lokaler Cache als Quelle der Wahrheit.
- `GET /instructor/schueler` (own scope, abgeleitet aus vorhandenen
  Buchungen) + `GET /instructor/schueler/:id/briefing`: liest
  ausschließlich bereits bestehende Trainings-Fortschrittsdaten
  (`fahrstunden_feedback`/`ausbildungen`/`pruefungsfreigaben`/
  `kompetenzbeobachtungen`) – **dieselben** Tabellen, die apps/student und
  apps/office nutzen, kein Fork des Modells. Liefert exakt die fünf
  geforderten Blöcke ("Heute üben wir", "Darauf achten", letzter
  Fortschritt, offene Lernziele, Fahrzeugbedarf + nächster formaler
  Schritt).
- `POST /instructor/lessons/:id/start` /
  `services/instructor-lesson.ts#startLesson`: echte serverseitige Prüfung
  (Termin gehört dem Fahrlehrer, nicht storniert/bereits gestartet/
  abgeschlossen, Fahrzeug einsatzbereit, kein zweiter gleichzeitig
  laufender Termin desselben Fahrlehrers) – **kein** Client-Gate.
- `POST /instructor/lessons/:id/complete` /
  `#completeLesson`: setzt `status="abgeschlossen"`, schreibt die
  Kompetenzbeobachtungen aus Schritt 4 in `kompetenzbeobachtungen` und
  emittiert `lesson.completed` **nur**, wenn der Termin zuvor gestartet war
  UND das Payload vollständig war (Zod-Validierung an der Route-Grenze,
  siehe Test unten).
- `POST /instructor/lessons/:id/no-show`, `/verspaetung`.
- Sprachprotokoll: `POST /instructor/voice-logs` (ruft Mock-
  Transkriptions- + Mock-KI-Vorschlags-Adapter auf),
  `PATCH /instructor/voice-logs/:id` (Fahrlehrer bearbeitet, verweigert
  nach Bestätigung), `POST /instructor/voice-logs/:id/confirm` (spiegelt
  **erst hier** `schuelerseitigZusammenfassung`/`naechstesZiel` in eine
  neue `fahrstunden_feedback`-Zeile mit `releasedFields:
  ["workOn","nextGoal"]` – **derselbe** Split-Mechanismus wie Prompt 1
  (`internalNotes` bleibt außerhalb der freigegebenen Spalten, siehe
  `apps/api/src/routes/feedback.ts`), plus `GET /instructor/voice-logs`.
- Fahrzeug: `POST /instructor/vehicle-issues` (erweiterte
  `fahrzeugmaengel`-Zeile; bei `einsatzbereit=false` wird
  `fahrzeuge.status="wartung"` gesetzt – dieselbe harte Regel
  `VEHICLE_NOT_READY` aus Prompt 2 blockiert danach sofort neue Buchungen),
  `GET /instructor/vehicle-issues/mine`.
- `GET /instructor/arbeitszeit`: Plan (aus Prompt 2s `arbeitszeitregeln`)
  vs. Ist (Summe eigener Buchungen heute) – rein lesende eigene Sicht,
  keine Rangliste.
- `POST /auth/logout-all` (`apps/api/src/routes/auth.ts`): löscht **alle**
  Sessions des eingeloggten Benutzers, nicht nur die aktuelle
  (Prompt 0 hatte nur Einzel-Session-Logout) – nötig für "remote logout
  (session invalidation)" aus der Testliste.

Alle Endpunkte sind `own`-scoped über `getOwnFahrlehrerId` (nicht nur über
die Permission-Matrix) geprüft – ein Fahrlehrer kann keinen fremden Termin
starten/beenden oder das Briefing eines Schülers lesen, mit dem er nie
gebucht war (getestet, siehe unten).

### Mock-Integrationen (`packages/integrations/src/transcription`,
`.../ai-suggestions`)

Gleiches Muster wie Prompt 0/1 (`malware-scan`, `notifications`):
`MockTranscriptionAdapter` gibt das Diktat unverändert als "Transkript"
zurück, `MockAiSuggestionAdapter` spiegelt es als
"Zusammenfassungsvorschlag". **GAP** (siehe docs/integration-gaps.md): kein
echter Speech-to-Text-/LLM-Anbieter in dieser Sandbox – klar im Code
kommentiert, `assertMockOnly` verhindert eine fälschliche "Live"-Behauptung.

### Frontend (`apps/instructor`)

Fünf Tabs (Heute, Schüler, Dokumentieren, Fahrzeug, Mehr), Session über
httpOnly-Cookie (kein PIN-Gate, kein localStorage-Zustand als Wahrheit).
Farbsystem/Layout-Grundlage aus `apps/student` wiederverwendet für visuelle
Konsistenz zwischen den Apps.

- **Heute**: nächste Termine live aus `GET /instructor/heute`
  (Student/Klasse/Stundenart/Treffpunkt/Fahrzeug/Zeit/Status/Verspätung),
  "Stunde starten"-Button pro Termin.
- **Schülerbriefing** (`/schueler/:id/briefing`): alle fünf geforderten
  Blöcke, für ~15s-Lesbarkeit auf das Nötigste begrenzt.
- **Drive Lock Mode** (`state/DriveLockContext.tsx`,
  `components/RequireUnlocked.tsx`, `components/BottomNav.tsx`,
  `routes/DriveLock.tsx`): ein echter State-/Route-Guard-Modus, kein
  visueller Vorschlag. Sobald `lock()` aufgerufen wird (nach erfolgreichem
  `POST .../start`), rendert `BottomNav` **`null`** (keine `<a>`-Elemente
  mehr im DOM) und jede andere Route ist mit `RequireUnlocked` umschlossen,
  das bei aktivem Modus **immer** auf `/drivelock` umleitet. Nur
  `/drivelock` (Notfall-`tel:`-Link, Büro-`tel:`-Link, "Stunde beenden") und
  `/dokumentieren/beenden/:id` bleiben erreichbar – keine Texteingabe, keine
  Animation (CSS-Regel ergänzt), keine Sprachaufnahme in diesem Zustand.
- **Stunde beenden** (`routes/StundeBeenden.tsx`): Wizard mit den 8
  Schritten in fester Reihenfolge, "Weiter" ist erst aktiv, wenn das
  Pflichtfeld des aktuellen Schritts ausgefüllt ist (Client-UX); die
  tatsächliche, nicht umgehbare Durchsetzung bleibt serverseitig
  (`lessonCompletionInputSchema`). `unlock()` wird erst nach erfolgreichem
  Server-Submit aufgerufen.
- **Dokumentieren** (`routes/Dokumentieren.tsx`): Sprachprotokoll-Fluss
  1–7 (Aufnahme-Indikator → Original-Transkript sichtbar → KI-Vorschlag →
  Fahrlehrer bearbeitet intern/schülerseitig getrennt → bestätigt).
- **Fahrzeug** (`routes/Fahrzeug.tsx`): Quick-Check-Formular (Kilometer,
  Tank/Ladung, Warnleuchten, Schaden/Grund, Schweregrad,
  einsatzbereit-Checkbox, Routing Büro/Fuhrpark), Mangelentwurf offline
  speicherbar.
- **Mehr** (`routes/Mehr.tsx`): Arbeitszeit-Kachel (Plan vs. Ist, Warnung
  bei Überschreitung, keine Rangliste), "Abmelden"/"Überall abmelden".
- **Offline** (`api/cache.ts`): identisches Muster zu apps/student –
  GETs (Tagesplan/Briefing) fallen offline auf den zuletzt geladenen Stand
  zurück; zusätzlich `writeDraft`/`readDraft`/`clearDraft` für
  Berichtsentwurf (Stunde-beenden-Formular) und Mangelentwurf
  (Fahrzeug-Formular) – diese sind offline **entwerfbar**. Alle Mutationen
  (`apiMutate`, u. a. Stunde starten/beenden final, Fahrzeug-Mangel final,
  Prüfungs-Pipeline) haben **keinen** Offline-Fallback und liefern einen
  klaren `OfflineError`.

## Tatsächlich ausgeführte Tests

```
pnpm -r typecheck   # 16/16 Workspace-Pakete fehlerfrei
pnpm -r test
```

- `packages/domain` – **6/6 grün** (unverändert, Prüfungs-Pipeline weiterhin
  grün, `instructor.ts` fügt reine Zod-Schemas ohne eigene Testdatei hinzu –
  Abdeckung erfolgt über `apps/api/src/__tests__/instructor.test.ts`, das
  `lessonCompletionInputSchema` end-to-end prüft)
- `packages/permissions` – **12/12 grün** (11 aus Prompt 0-2 + 1 neuer Block:
  alle sieben Prompt-3-Berechtigungen NUR für `fahrlehrer`, nie für
  `schueler`/`buero`/`finanzen`)
- `packages/scheduling` – **18/18 grün** (unverändert – Prompt 3 fügt keine
  neue harte Regel hinzu, sondern nutzt `VEHICLE_NOT_READY` aus Prompt 2
  weiter)
- `packages/matching` – **6/6 grün** (unverändert)
- `apps/api` – **94/94 grün** (72 aus Prompt 0-2 weiterhin grün + 22 neue in
  `src/__tests__/instructor.test.ts`):
  - Rollen-Guard: Schüler bekommt 403 auf `/instructor/heute` (nicht
    500/200), unauthentifiziert 401
  - Heute zeigt live nur eigene Termine
  - Stunde starten: Erfolgsfall; Ablehnung bei fremdem Termin (403
    `NOT_OWN_BOOKING`); Ablehnung bei nicht einsatzbereitem Fahrzeug (409
    `VEHICLE_NOT_READY`); Ablehnung, wenn bereits eine andere Stunde läuft
    (409 `INSTRUCTOR_ALREADY_IN_LESSON`, echte Konflikterkennung)
  - Stunde beenden: unvollständiges Payload → 400, **kein** Event, Status
    bleibt `gestartet` (explizit per Query gegen `audit_events` geprüft);
    `bestaetigung=false` → 400; vollständiges Payload → 200,
    `lesson.completed`-Event **genau einmal**, Kompetenzbeobachtung
    persistiert; Beenden ohne vorheriges Starten → 409 `NOT_STARTED`
  - No-Show und Verspätung werden korrekt gesetzt
  - Sprachprotokoll: kompletter Fluss inkl. **Beweis**, dass der Schüler
    vor Bestätigung `feedback: []` sieht, nach Bestätigung nur
    `workOn`/`nextGoal` sieht und `internalNotes`/die interne
    Zusammenfassung **nirgends** in der Antwort auftaucht
    (`JSON.stringify`-Volltextcheck); erneutes Bearbeiten/Bestätigen eines
    bereits bestätigten Protokolls wird abgelehnt (409)
  - Fahrzeug: ein Fahrlehrer-Mangel mit `einsatzbereit=false` blockiert
    danach `POST /appointments` für dieses Fahrzeug (409, dieselbe harte
    Regel wie in Prompt 2 getestet); Schüler darf keinen Mangel melden
    (403)
  - Prüfungs-Go: Büro bekommt weiterhin 403 `FORBIDDEN_ROLE` für
    `fahrlehrer_go`, auch aus der Instructor-App-Perspektive getestet
    (derselbe Endpunkt, keine neue Lücke)
  - Arbeitszeit: liefert Plan/Ist für heute, keine Rangliste im Response
  - Remote-Logout: `logout-all` invalidiert **beide** parallel erzeugten
    Sessions eines Nutzers, nicht nur die aufrufende (`GET /me` liefert für
    beide Cookies danach 401)
  - Schülerbriefing: alle fünf geforderten Felder vorhanden;
    Own-Scope-Verletzung (Fahrlehrer fragt Briefing eines Schülers ab, mit
    dem er nie gebucht war) → 403
- `apps/instructor` (neu) – **9/9 grün** (Vitest + Testing Library, jsdom):
  - Drive Lock Mode: alle 5 Nav-Links im DOM, solange entsperrt; **0**
    Nav-Links im DOM, sobald gesperrt (nicht nur CSS-versteckt) – die
    geforderte "asserting other nav is unreachable while locked"-Prüfung
  - `RequireUnlocked`: normale Route rendert entsperrt; jede geschützte
    Route leitet gesperrt auf `/drivelock` um
  - `DriveLock`-Screen: genau Notfall/Büro/Stunde-beenden vorhanden, **0**
    `<input>`/`<textarea>`-Elemente im DOM (keine Texteingabe im Sperr-Modus)
  - Stunde beenden: Schritt 1 zuerst, "Weiter" bleibt deaktiviert bis das
    Pflichtfeld gefüllt ist, Schritt 2 zeigt noch keine späteren
    Felder (Reihenfolge wird eingehalten), Bestätigung ist der letzte
    Schritt
  - Stunde beenden Offline: Entwurf wird trotz `navigator.onLine=false`
    lokal persistiert (`localStorage`/`readDraft`)
- `apps/student` – weiterhin **24/24 grün** (unverändert, nur durch die
  gemeinsamen Backend-/Domain-Änderungen erneut mitgetestet, keine
  Regression)
- `apps/office` – weiterhin grün (unverändert)
- `packages/auth`, `packages/integrations` – weiterhin grün (2 neue
  Integrations-Tests aus Prompt 0/1 unverändert, die neuen
  transcription/ai-suggestions-Adapter sind reine, ungetestete Mock-Klassen
  ohne eigene Verzweigungslogik – Abdeckung erfolgt indirekt über
  `instructor.test.ts`'s Sprachprotokoll-Flow)
- Zusätzlich manuell verifiziert: `pnpm --filter @fahrschul/instructor
  build` läuft fehlerfrei durch (Vite-Produktionsbuild, 251 KB JS gzip
  76 KB), `pnpm --filter @fahrschul/student build` und `pnpm --filter
  @fahrschul/office build` laufen nach den gemeinsamen Backend-Änderungen
  weiterhin fehlerfrei (Regressionscheck für die Non-Negotiable "run the
  full workspace test suite before finishing").

## Nicht/nur eingeschränkt geprüft (ehrlich)

- **Playwright/Browser-E2E**: In dieser Sandbox weiterhin nicht ausführbar
  (`npx playwright install chromium` schlägt am 2026-07-23 erneut mit
  "Download failure, code=1" fehl – dieselbe Egress-Policy wie in Prompt
  0-2). Es wurden Specs unter `apps/instructor/e2e/critical-flows.spec.ts`
  geschrieben (Login+Nav, Drive-Lock-Einstieg, Stunde-beenden-Einstieg,
  Viewport-Spot-Check 390/768/1024), aber **nicht ausgeführt**. Ein echter
  Browser-Lauf gegen `apps/instructor` steht noch aus.
- **Viewport-Spot-Checks 390/768/1024**: Wie bei apps/office nur per
  Code-Review geprüft (Flexbox/Grid, `max-width` in styles.css, Breakpoint
  bei 768px), **nicht** durch echte Screenshots.
- **Mock-Transkription/Mock-KI-Vorschläge**: Wie im Auftrag gefordert als
  austauschbare Adapter implementiert, aber **keine** echte Spracherkennung
  oder LLM-Anbindung – siehe docs/integration-gaps.md-Ergänzung unten. Die
  UI-/API-Flüsse sind end-to-end getestet, die inhaltliche Qualität einer
  echten Transkription/KI-Zusammenfassung ist damit **nicht** bewertet.
- **Kein separater Seed-Datensatz für Kompetenzraster/Sprachprotokolle**:
  `packages/database/src/seed.ts` wurde in dieser Sitzung nicht erweitert –
  die Tests seeden ihre eigenen Fixtures, ein `pnpm db:seed`-Lauf zeigt
  Kompetenzraster/Sprachprotokolle daher leer.
- **Arbeitszeit-Ansicht** liefert nur den heutigen Tag (kein Wochen-
  Aggregat), analog zur bewusst einfachen Arbeitszeitregel-Auswertung aus
  Prompt 2 (dort ebenfalls als offener Punkt dokumentiert).
- **`GET /instructor/schueler`** leitet "eigene Schüler" aus vorhandenen
  Buchungen ab (kein separates Zuordnungsmodell existiert in Prompt 0-2) –
  ein Schüler, mit dem der Fahrlehrer noch nie einen Termin hatte, taucht
  dort nicht auf, auch wenn er ihm z. B. büro-seitig bereits zugewiesen
  wäre. Diese Annahme ist nicht fachlich bestätigt.
- **Fotoreferenz/Sprachnotizreferenz in der Fahrzeug-Mangelmeldung** sind
  reine Text-Referenzfelder – kein echter Datei-/Audio-Upload für dieses
  Formular (im Unterschied zu Prompt 1s Dokument-Upload, das echten
  Multipart-Upload + Mock-Storage-Adapter nutzt). Für Fotos/Sprachnotizen
  am Fahrzeug wäre eine Anbindung an denselben `packages/integrations`
  Storage-Adapter wie bei Dokumenten ein sinnvoller Folgeschritt.

## Bewusste Vereinfachungen / offene fachliche Punkte

1. **Konflikterkennung beim Starten** prüft aktuell nur "läuft bereits eine
   andere Stunde desselben Fahrlehrers" und den Fahrzeugstatus – sie prüft
   NICHT erneut die vollen harten Regeln aus `packages/scheduling`
   (Getriebeart/Handicap/Raum/Simulator), weil die Buchung zum Zeitpunkt
   des Starts bereits existiert und bereits einmal geprüft wurde. Ob eine
   zwischenzeitliche Änderung (z. B. Handicap-Bedarf nachträglich
   geändert) erneut geprüft werden soll, ist fachlich nicht bestätigt.
2. **"Büro"-Rufnummer im Drive-Lock-Screen** ist ein Platzhalter
   (`tel:+490000000000`) – die echte Nummer der Fahrschule Krebs ist zu
   bestätigen.
3. **Sprachprotokoll-Kompetenzvorschläge** werden beim Bestätigen 1:1 als
   neue Kompetenzbeobachtungen übernommen, ohne erneute Fahrlehrer-
   Bestätigung PRO Feld (nur die eine Gesamt-Bestätigung in Schritt 6) –
   ob das granularer sein muss, ist fachlich nicht bestätigt.

## Mock-/Platzhalter-Integrationen (Ergänzung zu docs/integration-gaps.md)

- **Transkription** (`packages/integrations/src/transcription`): kein
  echter Speech-to-Text-Anbieter, Passthrough-Mock.
- **KI-Vorschläge** (`packages/integrations/src/ai-suggestions`): kein
  echter LLM-Anbieter, Echo-Mock. Liefert **nie** ein `fahrlehrer_go` oder
  eine Diagnose/Charakterbewertung – es gibt im Domain-Modell schlicht kein
  Feld dafür (`KOMPETENZSTATUS` enthält ausschließlich beobachtbare
  Fahrverhalten-Zustände).

## Fazit

**INSTRUCTOR CONDITIONAL**

Alle Non-Negotiables sind eingehalten und durch echte Tests belegt: keine
localStorage-Quelle der Wahrheit, kein hartcodiertes Fahrlehrer-Array,
**serverseitige Validierung für Stunde starten/beenden** (echte
Konflikterkennung, kein Client-Gate), Drive Lock Mode als echter
State-/Route-Guard (Nav-Links verschwinden aus dem DOM, nicht nur CSS-
versteckt, mit Test), verpflichtender geordneter 8-Schritt-Abschlussfluss
mit serverseitiger Ablehnung unvollständiger Submits (getestet), striktes
intern/schülerseitig-Split beim Sprachprotokoll identisch zum Prompt-1-
Kontrakt (mit Volltextcheck getestet, dass interne Notizen nie im
Schüler-Response auftauchen), Fahrlehrer-Go bleibt exakt die
Prompt-2-State-Machine ohne neue Umgehung, Fahrzeugausfall blockiert
nachweislich neue Buchungen desselben Fahrzeugs, Remote-Logout invalidiert
nachweislich alle Sessions.

Bedingungen, die vor einem echten Go-Live/einer Folge-Session geklärt
werden müssen (keine davon ist ein technischer Blocker für diese Sitzung,
aber keine gilt stillschweigend als "fertig"):

1. Playwright/Browser-E2E für `apps/instructor` ist geschrieben, aber in
   dieser Sandbox nicht ausführbar (Egress-Block) – inkl. echter
   Viewport-Screenshots für 390/768/1024, muss in einer Umgebung mit
   Zugriff auf `cdn.playwright.dev` nachgeholt werden.
2. Mock-Transkription/Mock-KI-Vorschläge sind austauschbare Platzhalter
   ohne echten Anbieter – inhaltliche Qualität einer echten
   Transkription/KI-Zusammenfassung ist ungetestet.
3. Kein Seed-Datensatz für Kompetenzraster/Sprachprotokolle/erweiterte
   Fahrzeugmängel – `pnpm db:seed` deckt diese Bereiche weiterhin nicht ab.
4. Die drei in "Bewusste Vereinfachungen" gelisteten fachlichen Annahmen
   (erneute Konfliktprüfung beim Starten, Büro-Rufnummer, granulare
   Sprachprotokoll-Bestätigung) sind von der Fahrschule Krebs zu bestätigen
   oder zu korrigieren.
5. `GET /instructor/schueler` leitet "eigene Schüler" aus Buchungshistorie
   ab, kein bestätigtes fachliches Zuordnungsmodell.
6. Wie in Prompt 0-2: alle externen Integrationen bleiben im `mock`-Modus.
