# Abschluss-Releaseprüfung (PROMPT 5) – Unabhängige Review

Datum dieser Sitzung: 2026-07-23. Branch `claude/driving-school-admin-tcz2cx`,
Basis-Commit `4d58946`. Reviewer-Rolle: unabhängiger Release Manager /
Security Reviewer / Fahrschul-Fachexperte. Diese Prüfung wurde **nicht** von
den Autoren der Prompts 0-4 durchgeführt; alle Zahlen unten wurden in dieser
Sitzung selbst reproduziert, nicht aus den Abschluss-QA-Dokumenten
übernommen.

## 1. Reproduzierte Testevidenz

Umgebung: lokale PostgreSQL-16-Instanz (bereits im Sandbox-Image installiert
und laufend, `pg_lsclusters` zeigt `16/main online`), Datenbanken
`fahrschul_dev`/`fahrschul_test` bereits vorhanden und migriert. Kein
Docker/CI-Postgres in dieser Sitzung verfügbar (identische Einschränkung wie
in allen fünf Prompts).

```
pnpm install --frozen-lockfile   # bereits aktuell, kein Neu-Resolve nötig
pnpm -r typecheck                # 16/16 Pakete fehlerfrei (kein einziger Fehler)
pnpm --filter @fahrschul/database migrate  # "Keine neuen Migrationen. Schema ist aktuell." (idempotent bestätigt)
pnpm -r test
```

Tatsächlich in dieser Sitzung beobachtete Ergebnisse (nicht aus den
QA-Dokumenten kopiert):

| Paket | Tests | Ergebnis |
|---|---:|---|
| `apps/api` | 110 | ✅ alle grün (8 Testdateien: migrations, auth, roles, booking-conflict, office, student-app, instructor, finance) |
| `apps/student` | 24 | ✅ alle grün |
| `apps/office` | 1 | ✅ grün (Layout-Test; keine weiteren Component-Tests) |
| `apps/instructor` | 9 | ✅ alle grün |
| `apps/finance` | 0 | kein eigenes Test-File (nur Build/Typecheck) |
| `packages/finance-core` | 29 | ✅ alle grün |
| `packages/permissions` | 12 | ✅ alle grün |
| `packages/scheduling` | 18 | ✅ alle grün |
| `packages/matching` | 6 | ✅ alle grün |
| `packages/auth` | 6 | ✅ alle grün |
| `packages/domain` | 6 | ✅ alle grün |
| `packages/integrations` | 2 | ✅ alle grün |

**Summe: 223 automatisierte Tests, 223 grün, 0 rot, 0 übersprungen.** Dies
deckt sich mit den in `docs/finance-final-qa.md` behaupteten Summen — die
Zahlen wurden hier unabhängig reproduziert (voller `pnpm -r test`-Lauf,
Terminal-Output archiviert in dieser Session), nicht nur übernommen. Die
kritischen Race-Tests (`booking-conflict.test.ts` "allows two concurrent
requests for the same slot and rejects exactly one" und
`office.test.ts` "RACE: two simultaneous acceptances for offers of the same
storno event yield exactly one winner") liefen tatsächlich mit und sind
grün — siehe Abschnitt 2, Kernfluss 2.

Keine Testdatei wurde in dieser Sitzung übersprungen (`--passWithNoTests`
greift nur für `packages/database`, das keine eigenen Unit-Tests hat und
über `apps/api` mitgetestet wird — wie bereits in Prompt 0 dokumentiert).

## 2. Kernfluss-Prüfung

### Kernfluss 1 — Lead → Schüler → Matching → Buchung → Feedback → Rechnung → KPI

Verifiziert per Code-Lesen entlang der Kette:
- `apps/api/src/routes/leads.ts` (Prompt 2): Lead-CRUD + Konvertierung legt
  einen echten `schueler`-Datensatz in derselben Tabelle an, die
  `apps/student`/`apps/office`/`apps/instructor` nutzen (kein Fork).
- Terminangebot/Annahme läuft über denselben `performBooking`-Transaktionspfad
  wie in Prompt 0 (`apps/api/src/services/booking.ts`), verifiziert per Grep:
  `booking.ts` wird sowohl von `appointment-offers.ts` (Schüler-Annahme) als
  auch von `storno.ts` (Storno-Retter) importiert — ein einziger, nicht
  duplizierter Konfliktprüfpfad.
- Fahrlehrer-Briefing (`apps/api/src/routes/instructor.ts`,
  `GET /instructor/schueler/:id/briefing`) liest ausdrücklich
  `fahrstunden_feedback`/`ausbildungen`/`pruefungsfreigaben`/
  `kompetenzbeobachtungen` — dieselben Tabellen wie apps/student/office.
- Stunde-beenden schreibt `kompetenzbeobachtungen` + emittiert
  `lesson.completed` (bestätigt durch grünen Test
  `instructor.test.ts` "completes a lesson … persists Kompetenzraster
  observations").
- Feedback-Split (`internalNotes` vs. `schuelerseitig`) ist derselbe
  Mechanismus wie Prompt 1 (`apps/api/src/routes/feedback.ts`), per Volltext-
  String-Suche im Test verifiziert, dass interne Notizen nie im
  Schüler-Response auftauchen (`instructor.test.ts`,
  `student-app.test.ts`).
- Finance-KPIs (`apps/api/src/routes/finance.ts`, `GET /finance/kpis`)
  aggregieren direkt aus `rechnungen`/`zahlungen`/`terminbuchungen` — **kein**
  separates Finanz-Datenmodell, sondern echte SQL-Aggregate über dieselben
  Tabellen, in die Prompt 0-3 schreiben. Bestätigt durch Grep: `fahrzeuge.
  status`/`fahrzeug_status` wird in `finance.ts`, `instructor.ts`,
  `resources.ts` (office) UND `booking.ts` gemeinsam verwendet — ein Beleg,
  dass die vier Apps auf einem gemeinsamen Datenmodell arbeiten, nicht auf
  vier getrennten.

**Ergebnis: PASS** — die Kette ist durchgängig, kein Bruch zwischen den
Datenmodellen der vier Apps gefunden.

### Kernfluss 2 — Storno-Retter Race-Sicherheit

`apps/api/src/__tests__/office.test.ts`, Test "RACE: two simultaneous
acceptances for offers of the same storno event yield exactly one winner"
(Zeile ~449 ff.) wurde in dieser Sitzung selbst erneut ausgeführt (Teil des
vollen `office.test.ts`-Laufs, 28/28 grün). Code-Inspektion bestätigt: der
Test ist **real**, kein Mock — er erzeugt einen dritten echten
Schüler-Datensatz per Rohinsert, ruft `app.inject` (Fastify-HTTP-Layer, kein
Funktionsaufruf-Bypass) zweimal parallel via `Promise.all` gegen zwei
**unterschiedliche** Storno-Angebote desselben Events auf und prüft
anschließend per Rohabfrage gegen die echte Postgres-Instanz, dass genau eine
nicht-stornierte Buchung für den Slot existiert. Race-Schutz erfolgt laut
`docs/office-final-qa.md` über `SELECT ... FOR UPDATE` auf der
`storno_events`-Zeile — plausibel, da der Test tatsächlich `[201, 409]`
statt `[201, 201]` liefert, was ohne eine Row-Lock-Serialisierung nicht
zuverlässig reproduzierbar wäre.

**Ergebnis: PASS**, mit einer Einschränkung: der Test lief nur ein einziges
Mal in dieser Sitzung (kein wiederholter Stress-Lauf über z. B. 50 Iterationen
zur Ausschließung von Flakiness). Für Produktionsvertrauen wäre ein
Wiederholungslauf (z. B. in CI, 20-50× hintereinander) sinnvoll, bevor "race
condition never happens" als endgültig belegt gilt.

### Kernfluss 3 — Dokumentupload → Ablehnung → Reupload → Verifikation → Heute-Blocker

Code-Verifikation: `apps/student/src/state/useHeutePriorities.ts`
implementiert exakt die 7-Schritt-Priorität aus der Aufgabenstellung als
reine Funktion. **Schritt 2 (nach Prüfungsfreigabe-Blocker) ist der
Dokument-Blocker**: `input.documents.find((d) => d.status === "abgelehnt")`
— ein abgelehntes Dokument erzeugt zuverlässig `kind: "document_rejected"`
mit Handlungsaufforderung "Erneut hochladen" → `/mehr/dokumente`. Das ist
durch `apps/student/src/state/useHeutePriorities.test.ts` (7 Tests, alle
grün in dieser Sitzung) abgedeckt, inkl. Prioritätsreihenfolge. Der
Ablehnung→Reupload→Verifikations-Zyklus selbst (Büro-seitig) ist über
`apps/api/src/__tests__/student-app.test.ts` ("Re-Upload mit erhaltener
Verkettung `ersetztVonDokumentId`") und `office.test.ts` ("Dokumentprüfung:
Akzeptieren verändert Status UND verschwindet aus der Heute-Queue") getestet
— beide liefen grün mit.

**Ergebnis: PASS** — die Kette ist nicht nur behauptet, sondern per
Code-Pfad und Tests nachvollzogen.

### Kernfluss 4 — Fahrzeugmangel → Blockade → Umbuchung → Flottenansicht

Grep über `apps/api/src` bestätigt, dass `fahrzeuge.status`/
`fahrzeug_status` in **vier** unabhängigen Routendateien referenziert wird:
`instructor.ts` (Mangelmeldung setzt `status='wartung'`), `booking.ts`
(harte Regel `VEHICLE_NOT_READY` blockiert neue Buchungen), `resources.ts`
(Büro-Ressourcenverwaltung/Heute-Queue) und `finance.ts`
(`GET /finance/fleet` Statusverteilung). Test-Beleg: `instructor.test.ts`
"an instructor-reported Mangel with einsatzbereit=false blocks new bookings
for that vehicle" (grün) beweist den Instructor→Büro/Scheduling-Übergang
konkret. Die Finance-Seite (`/finance/fleet`) liest denselben
`fahrzeug_status`, wurde aber in dieser Sitzung **nicht** durch einen
End-to-End-Test verifiziert, der eine Instructor-Mangelmeldung tatsächlich
bis in eine Finance-API-Antwort verfolgt (kein Test dieser Form existiert in
`finance.test.ts` — dort wird `/finance/fleet` nur isoliert getestet, ohne
vorherige Mangelmeldung durch einen Fahrlehrer).

**Ergebnis: PARTIAL PASS.** Die Datenmodell-Kopplung ist real (gleiche
Spalte, gleiche Tabelle, kein Fork), aber es fehlt ein tatsächlicher
Cross-App-Integrationstest, der beweist, dass ein Fahrlehrer-Mangelbericht
sichtbar in `/finance/fleet` erscheint — nur durch Code-Lesen plausibilisiert,
nicht durch einen eigenen Testlauf bewiesen. Dies ist eine dokumentierte
Lücke, kein Blocker (das Datenmodell macht eine falsche Anzeige
unwahrscheinlich, aber unbewiesen).

### Kernfluss 5 — Prüfungspipeline-Autorisierung

`packages/domain/src/pruefungspipeline.ts` implementiert eine explizite
State Machine mit Kantenliste + Rollenbeschränkung pro Übergang.
`apps/api/src/routes/exam-pipeline.ts` erzwingt **zweistufig**: zuerst
`requirePermission("exam:pipeline:advance")` (Middleware, Büro UND
Fahrlehrer haben diese Permission), danach `assertTransitionAllowed`
(transition-spezifisch, `fahrlehrer_go` NUR für Rolle `fahrlehrer`) — beide
Prüfungen sind im Code sichtbar (Zeilen 27-60 der Datei) und decken sich mit
den Testfällen: `office.test.ts` "Büro bekommt 403 `FORBIDDEN_ROLE` für
fahrlehrer_go", `instructor.test.ts` "wrong role (buero) is rejected … even
from the instructor route surface" — beide liefen grün. `packages/domain`
hat zusätzlich 6/6 eigene Unit-Tests für die State Machine selbst
(Happy-Path, ungültiger Sprung, Rollenverletzung).

**Ergebnis: PASS** — echte, doppelte serverseitige Durchsetzung an jedem
Übergang, nicht nur bei einem einzelnen Schritt.

### Kernfluss 6 — Bankabgleich (eindeutig → mehrdeutig → Rücklastschrift)

`packages/finance-core/src/bank-matching.ts` implementiert die 5-stufige
Kaskade; 15 Tests in `bank-matching.test.ts` (alle grün, reproduziert)
decken exakt die geforderten Fälle ab: eindeutiger Treffer (`sicher`, einzig
`autoBuchbar`), Teilzahlung/Überzahlung/Sammelzahlung/abweichender
Zahler (`wahrscheinlich`), Rücklastschrift/Gutschrift (`unklar`), doppelte
Zahlung/mehrdeutiger Treffer (`konflikt`). API-Ebene
(`apps/api/src/__tests__/finance.test.ts`) bestätigt end-to-end gegen den
Mock-Feed, dass ausschließlich `sicher`-Treffer automatisch gebucht werden
und alles andere in der Review-Queue landet (`status='offen'`) — grün
reproduziert.

**Ergebnis: PASS.**

## 3. Sicherheitsprüfung (Code-Ebene, nicht nur Doku)

- **Schüler-Isolation**: `student-app.test.ts` enthält einen Test, dass ein
  Schüler nie die Dokumente eines anderen Schülers sieht — grün. Own-Scope
  wird zusätzlich zur Permission-Matrix serverseitig geprüft (laut
  `docs/role-permission-matrix.md`, per Stichprobe in `instructor.ts`
  bestätigt: `getOwnFahrlehrerId`-Scoping vor jedem Datenzugriff).
- **Rollen-Grenzen**: durchgängig getestet — Instructor-, Finance- und
  Office-only-Endpunkte liefern 403 (nicht 500/200) für falsche Rollen, 401
  für unauthentifiziert. Reproduziert über alle vier Testdateien.
- **Remote Logout**: `POST /auth/logout-all` invalidiert **beide** parallel
  erzeugten Sessions eines Nutzers — Test "logout-all invalidates every
  session for the user, not just the current one" lief grün mit
  (`instructor.test.ts`). Tatsächlich verifiziert per `GET /me` mit beiden
  Cookies nach dem Logout (beide 401).
- **Rate Limiting: NICHT implementiert.** `docs/security-risks.md` listet
  dies 2026 als kritischen Prototyp-Gap (`/sync/*` ohne Rate Limit). In
  dieser Sitzung wurde `apps/api/package.json` und der gesamte
  `apps/api/src`-Baum nach `rate-limit`/`rateLimit`/`@fastify/rate-limit`
  durchsucht: **kein Treffer**. Kein einziger der fünf Prompts hat Rate
  Limiting nachgerüstet — es ist weder in den Abhängigkeiten noch im Code
  vorhanden. Dies ist ein **echter, unadressierter Gap**, nicht nur
  dokumentiert und dann erledigt — er wurde in keinem der QA-Dokumente 0-4
  als "erledigt" behauptet, aber auch nirgends als offen aufgeführt außer im
  ursprünglichen Prototyp-Audit. **Muss vor Produktivbetrieb behoben
  werden** (z. B. `@fastify/rate-limit` auf `/auth/login`, `/appointments`,
  Export-Endpunkten).
- **SQL-Injection**: Grep über `apps/api/src` und `packages/database/src`
  nach String-Konkatenation in SQL (`sql.unsafe`, Template-Literal-Queries
  außerhalb von Drizzle/`postgres`-Tagged-Templates) ergab **keinen
  Treffer**. Alle DB-Zugriffe laufen über Drizzle-ORM-Query-Builder oder die
  `postgres`-Bibliothek mit Tagged Templates (automatisch parametrisiert),
  auch im Storno-Retter-Race-Test (`sql\`insert into … values
  (${var})\``) — das ist die sichere Tagged-Template-Form, keine
  String-Interpolation.
- **Secrets/Geheimnisse**: `.env` ist in `.gitignore` gelistet (bestätigt),
  `.env.example` enthält ausschließlich Platzhalterwerte
  (`fahrschul_dev_pw`, `change-me-in-real-env-min-32-chars-long`) — keine
  echten Zugangsdaten. `git log --all -- .env` liefert **keine Treffer** —
  `.env` wurde nie committet. Kein weiterer Treffer für offensichtliche
  Credential-Dateien im Repo-Root.
- **Session/MFA**: Passwort-Hashing mit scrypt (versioniertes Format),
  TOTP-MFA für Mitarbeitendenrollen verpflichtend (Login ohne
  abgeschlossenes Setup wird abgelehnt — grüner Test `auth.test.ts`
  "rejects staff (buero) login without completed MFA setup"), Sessions als
  gehashtes Zufallstoken (kein JWT).
- **Upload-Validierung**: Dokument-Upload lehnt nicht unterstützte/zu große
  Dateien VOR Speicherung ab (laut `docs/student-app-final-qa.md`, per
  vorhandenem Test in `student-app.test.ts` plausibilisiert — in dieser
  Sitzung nicht erneut isoliert nachgestellt, aber Teil des grünen
  Gesamtlaufs).
- **Export-Autorisierung** (Finance): signierter, session-gebundener
  Download-Token (SHA-256-Hash in DB, 15 Min gültig), fremder Nutzer erhält
  403, falscher Token 404, jeder Request/Download auditiert — vier separate
  grüne Tests in `finance.test.ts` reproduziert.
- **Audit-Trail**: `audit_events`-Einträge für Buchung, Storno-Schritte,
  Prüfungspipeline-Übergänge, Exportanfragen/-downloads — durchgängig in den
  Tests gegengeprüft (z. B. `audit.actions).toContain("storno.accepted")`).

## 4. Geräte/A11y-Spot-Check

Stichprobenhaft gelesen: `apps/student/src/components/BottomNav.tsx`-Test
(`accessible name` je Tab, Icons `aria-hidden`), `Tacho.test.tsx`
(`role="img"` mit Textalternative, `prefers-reduced-motion` deaktiviert die
Nadel-Animation), `apps/instructor`'s `DriveLock.test.tsx`/
`RequireUnlocked.test.tsx` (0 `<input>`/`<textarea>` im Sperr-Zustand, 0
Nav-Links im DOM — nicht nur CSS-versteckt). Diese Assertions sind
plausibel und bestehen tatsächlich (Teil des grünen Testlaufs). Stylesheets
nutzen laut Code-Review durchgehend relative Einheiten/Flexbox/Grid mit
Breakpoints (768px/900px je App).

**Klarstellung, keine Beschönigung**: Es hat in diesem gesamten Projekt
(Prompt 0 bis 5) **kein einziger echter Browser-/Screenreader-/
Playwright-Lauf** stattgefunden. `npx playwright install chromium` scheiterte
in jeder Sitzung am Egress-Block der Sandbox (`cdn.playwright.dev` nicht
erreichbar — von mir in dieser Sitzung nicht erneut versucht, da der Befund
in vier aufeinanderfolgenden Sitzungen bereits konsistent reproduziert
wurde und sich an der Sandbox-Policy nichts geändert hat). Alle
Responsive-/A11y-Aussagen beruhen auf Code-Review und
Testing-Library-Rollenabfragen (jsdom), nicht auf echtem Rendering in
echten Browsern auf echten Viewports, und nicht auf echten
Screenreadern. Dies ist ein **echter, stehender Gap**, keine übertriebene
Vorsicht — er muss vor Produktivbetrieb geschlossen werden.

## 5. Was in dieser Sitzung NICHT zusätzlich verifiziert wurde

- Kein neuer Stresstest für den Storno-Race über mehrere Wiederholungen
  hinaus geschrieben (Kernfluss 2 lief nur einmal in dieser Sitzung, ist
  aber deterministisch DB-constraint-gesichert, kein reiner Zufallstest).
- Kein neuer Integrationstest für Kernfluss 4 (Instructor-Mangel →
  Finance-Fleet-Sichtbarkeit) geschrieben — als offener Punkt dokumentiert
  statt selbst geschlossen (Review-Scope, kein Feature-Bau).
- Keine Ausführung von Playwright (siehe oben, konsistent mit allen
  Vorgänger-Sitzungen).

## 6. Blocker für echten Produktivbetrieb (nicht Blocker für diese Sitzung)

1. **Kein echtes Browser-/Screenreader-/E2E-Testing** — Playwright wurde nie
   ausgeführt, in keiner der fünf Sitzungen. Muss in einer Umgebung mit
   Netzwerkzugriff auf `cdn.playwright.dev` (oder lokal gehostete
   Browser-Binaries) nachgeholt werden, inkl. echter Viewport-Screenshots
   (360-1440px) und mindestens eines echten Screenreader-Durchlaufs (NVDA/
   VoiceOver) für die kritischsten Flows (Login, Buchung, Stunde beenden,
   Dokument-Upload).
2. **Kein Rate Limiting** — in keinem der fünf Prompts implementiert, trotz
   ursprünglicher Non-Negotiable-Erwähnung im Prototyp-Audit. Muss vor
   Go-Live ergänzt werden (mindestens Login, Terminbuchung, Exports).
3. **Alle externen Integrationen sind Mock-only**: Bank-Feed (FinTS/EBICS),
   E-Mail/SMS/Push, Zahlungsauslösung, Malware-Scan, Speech-to-Text/KI-
   Vorschläge, Dokumentenspeicher (S3-kompatibel), Kalender, CRM. Keine
   davon wurde je gegen einen echten Anbieter getestet — die Adapter-Grenzen
   sind sauber gezogen, aber inhaltlich ungetestet.
4. **Kein Postgres in CI/Docker in dieser Sandbox** — alle Tests liefen
   gegen eine bereits vorhandene, lokal im Sandbox-Image vorinstallierte
   Postgres-16-Instanz, nicht gegen `docker-compose.yml` (Registry-Zugriff
   in jeder der 6 Sitzungen durch Egress-Policy blockiert). Die
   Docker-Compose-Konfiguration selbst wurde nie tatsächlich mit einem
   `docker pull` verifiziert.
5. **Zahlreiche unbestätigte Fachregeln** (siehe
   `docs/fachliche-bestaetigungen.md`, 14 Punkte, alle weiterhin offen):
   u. a. Prüfungsreife-Gewichtung, Mindestpause zwischen Fahrten (15 Min),
   Mindest-Übungsstunden vor Sonderfahrt (5), Matching-Kriterien-Gewichtung,
   Vier-Augen-Prinzip bei Prüfungsfreigabe (technisch vorbereitet, aber
   **nicht erzwungen**), Krebs-Flex-Fairnessregel, Kostenstellenzuordnung
   für ein vollständiges Finanzergebnis. Keine davon darf stillschweigend
   als Endregel gelten — alle sind im Code als `UNBESTAETIGT_*` markiert,
   aber sie sind aktiv im Betrieb wirksam (z. B. blockiert die
   15-Minuten-Pausenregel tatsächlich Buchungen), bis die Fahrschule Krebs
   sie bestätigt oder korrigiert.
6. **Kernfluss 4 (Fahrzeugmangel → Finance-Flottenansicht)** ist nur per
   Datenmodell-Kopplung plausibilisiert, nicht durch einen eigenen
   Cross-App-Integrationstest bewiesen (siehe Abschnitt 2).
7. **Bekannte funktionale Lücken** aus den QA-Dokumenten, die weiterhin
   offen sind: `packages/matching`s `rankCandidates()` nicht an
   Storno-Retter/Planung angebunden, Fahrlehrerauslastungs-Detailkarte und
   Forecast-API-Endpunkt in Finance nicht fertig verdrahtet, kein
   `GET /office/dokumente`-Übersichtsendpunkt, kein PDF/CSV/XLSX-Renderer
   für Exports (nur JSON), Seed-Skript deckt Leads/Räume/Prüfungen/
   Storno/Kompetenzraster/Produkte/Fahrzeugkosten nicht ab.
8. **Kein wiederholter Stresstest der Race-Conditions** über den
   Einzellauf in dieser Sitzung hinaus.

## 7. Gesamtbewertung

Das technische Fundament ist solide und real belegt: serverseitige
Konfliktprüfung mit DB-EXCLUDE-Constraint (nicht nur Anwendungscode),
echte Rollenmiddleware mit doppelter Prüfung bei der Prüfungspipeline,
sauber getrennte Datenschichten ohne SQL-Injection-Muster, kein
localStorage-Auth, kein PIN-Gate, keine hartkodierten Stammdaten/Preise,
223/223 automatisierte Tests grün (in dieser Sitzung selbst reproduziert,
inklusive der beiden kritischen Race-Tests gegen eine echte
Postgres-Instanz). Die vier Apps arbeiten nachweislich auf einem
gemeinsamen Datenmodell, keine isolierten Silos.

Dem stehen jedoch mehrere strukturelle, nicht triviale Lücken gegenüber, die
laut der Vorgabe *"Keine Einsatzbereitschaft ohne echte Testevidenz"* eine
uneingeschränkte GO-Freigabe verbieten: null echte Browser-/A11y-Testläufe
über sechs Sitzungen hinweg, fehlendes Rate Limiting, ausschließlich
Mock-Integrationen für jeden externen Anbieter, und eine zweistellige Zahl
fachlich unbestätigter, aber im Betrieb bereits wirksamer Geschäftsregeln.
Keine dieser Lücken widerlegt die Qualität der Kernengineering-Arbeit — sie
begrenzen nur, wofür bereits *echte* Evidenz vorliegt.

## Verdikt

**CONDITIONAL GO**

Bedingungen vor echtem Produktivbetrieb mit echten Nutzerdaten, in
Prioritätsreihenfolge:

1. Rate Limiting auf Login/Buchung/Export-Endpunkten ergänzen und testen.
   > **NACHTRAG (PROMPT -1, Phase 3, 2026-07-26): ERLEDIGT.** Token-Bucket je
   > IP **und** je Konto mit `Retry-After`, eigener Politik für den
   > SSE-Stream, vollständig konfigurierbar
   > (`apps/api/src/lib/rate-limit.ts`), plus persistenter Brute-Force-Schutz
   > auf der Anmeldung mit Entsperrpfad (`apps/api/src/lib/brute-force.ts`).
   > 52 Tests in `apps/api/src/__tests__/security.test.ts`. Begründung,
   > Grenzen und Runbooks: `docs/security-architecture.md` Abschnitte 2 und 3.
   > **Neue offene Bedingung aus derselben Phase:** zwei
   > Produktionsabhängigkeiten mit Advisories (`drizzle-orm` high,
   > `react-router` moderate) – im aktuellen Code nicht ausnutzbar, Behebung
   > nur per Major-Aktualisierung; siehe `docs/security-architecture.md`
   > Abschnitt 11.
2. Mindestens einen vollständigen Playwright-Lauf (alle vier Apps, kritische
   Flows, Viewports 360-1440px) in einer Umgebung mit Netzwerkzugriff
   durchführen; mindestens einen manuellen Screenreader-Durchlauf für Login/
   Buchung/Dokument-Upload/Stunde-beenden.
3. Vor Live-Schaltung jeder externen Integration (Bank/FinTS, E-Mail/SMS/
   Push, Zahlungsauslösung, Malware-Scan, Dokumentenspeicher) einen echten
   Sandbox-Test gegen den jeweiligen Anbieter durchführen — kein Adapter
   darf ohne diesen Nachweis von `mock` auf `live` umgeschaltet werden.
4. Die 14 Punkte in `docs/fachliche-bestaetigungen.md` von der Fahrschule
   Krebs bestätigen oder korrigieren lassen, bevor die aktuell wirksamen
   Platzhalterregeln (insbesondere Pausenregel, Sonderfahrt-Mindeststunden,
   Prüfungsreife-Gewichtung, Vier-Augen-Prinzip) als fachlich verbindlich
   gelten.
5. Docker-Registry-Zugriff einmalig in einer Umgebung mit Netzwerkfreigabe
   verifizieren (`docker-compose.yml` wurde nie tatsächlich mit `docker
   pull` getestet).
6. Kernfluss 4 (Fahrzeugmangel → Finance-Flottenansicht) mit einem echten
   Cross-App-Integrationstest statt nur Datenmodell-Plausibilisierung
   belegen.
7. Die in Abschnitt 6, Punkt 7 gelisteten bekannten Funktionslücken
   schließen oder bewusst für den Go-Live-Scope zurückstellen (explizite
   Produktentscheidung, kein stillschweigendes "fertig").

Keine dieser Bedingungen deutet auf einen grundlegenden Architektur- oder
Sicherheitsfehler hin — sie sind Lücken in *Testabdeckung außerhalb der
Sandbox-Möglichkeiten* und in *fachlicher Abnahme*, nicht in der
Kern-Engineering-Qualität. Ein NO-GO wäre angesichts der soliden, tatsächlich
reproduzierten Testevidenz für Auth, Konfliktfreiheit, Rollenmodell und die
sechs Kernflüsse nicht gerechtfertigt.

---

# NACHTRAG (PROMPT -1, Phase 4, 2026-07-26): die sieben Bedingungen erneut bewertet

Dieser Bericht entstand am **2026-07-23** auf Commit `4d58946` – also **vor**
`PROMPT -1` und damit vor den vier Phasen (Zuverlässigkeitskern,
Echtzeitsynchronisation, Defense in Depth, Chaos/Wiederherstellung/Deployment).
Sein CONDITIONAL GO ist deshalb überholt: die Zahlen (223 Tests) und mehrere
Feststellungen („kein Rate Limiting") sind nicht mehr der Stand.

Dieser Nachtrag ordnet die sieben Bedingungen aus §7 neu ein. Er ist vom
**Phase-4-Reviewer** verfasst, der weder die Prompts 0–4 noch die Phasen 1–3
gebaut hat, und der alle Zahlen unten in seiner Sitzung selbst reproduziert hat.
Das vollständige, aktuelle Verdikt steht in **`docs/chaos-test-report.md`,
Abschnitt 6** – dieser Nachtrag ersetzt es nicht, er verbindet nur die alte
Bedingungsliste mit der neuen.

## Aktueller Stand statt der alten Zahlen

| | Prompt-5-Review (2026-07-23) | Phase 4 (2026-07-26) |
|---|---:|---:|
| Automatisierte Tests | 223 | **794** |
| Pakete typecheck-sauber | 16 | **17** |
| Migrationen | 0006 | **0010** |
| Chaos-/Wiederanlaufszenarien | 0 | **18** (14 PASS, 4 TEILWEISE, 0 unausgeführt) |
| Ausgeführter Wiederherstellungstest | nein | **ja, zweifach** (logisch + PITR) |
| Gemessene SLOs | keine | **p95 je Endpunkt, Sync-/Warteschlangenverzögerung, Fehlerquote** |

## Die sieben Bedingungen

| # | Bedingung aus §7 | Status | Begründung |
|---|---|---|---|
| **1** | Rate Limiting auf Login/Buchung/Export ergänzen und testen | **GESCHLOSSEN** (mit Einschränkung) | Von Phase 3 gebaut (Token-Bucket je IP **und** Konto, eigene Politik für den SSE-Stream, `Retry-After`, plus DB-persistenter Brute-Force-Schutz), 52 Tests. **Vom Phase-4-Reviewer nachgeprüft und in einer Hinsicht verschärft:** die bekannte Einschränkung „Zähler pro Prozess" ist jetzt **bewiesen** (`chaos.test.ts` Szenario 14) – und im Gegentest, dass der Brute-Force-Schutz das **nicht** ist. Die Sicherheitsaussage ist instanzübergreifend, die Lastbegrenzung nicht → neue Bedingung **B7**. |
| **2** | Mindestens ein vollständiger Playwright-Lauf + ein Screenreader-Durchlauf | **OFFEN** | In Phase 4 **erneut selbst versucht**: `npx playwright install chromium` → HTTP 403 „host not permitted" für `cdn.playwright.dev`; zusätzlich ist **kein** Systembrowser installiert (`chromium`, `google-chrome`, `firefox` – alle fehlen). In sieben Sitzungen ist nie ein Browser gelaufen. **Teilweise gemildert:** die §18-Anzeige ist jetzt gerendert getestet (16 Tests, jsdom + Testing Library, Abfrage über Rollen und Text). **Nicht** gemildert: CSP im Browser, Screenreader, Viewports, und die Browseranteile der Szenarien 1, 7, 11, 13 → **B2**. |
| **3** | Echter Sandbox-Test je externer Integration vor dem Umschalten auf `live` | **OFFEN, unverändert** | Alle zehn Integrationen sind Mock. Phase 3 hat Zeitlimit, Circuit Breaker, Retry, ausgehende Idempotenz, Puffer und Fehlerwarteschlange darum gebaut und gegen **absichtlich fehlerhafte** Adapter getestet; Phase 4 hat den 30-Minuten-Ausfall als Szenario 9 nachgestellt. Getestet ist damit der **Ausfallpfad**, nicht der Anbieter. `assertMockOnly` verhindert ein Versehen → **A5**. |
| **4** | Die 14 Punkte in `docs/fachliche-bestaetigungen.md` bestätigen lassen | **OFFEN, unverändert – und weiterhin wirksam** | Keiner der 14 Punkte ist abgenommen. Sie sind im Code als unbestätigt markiert, aber **aktiv**: die 15-Minuten-Pausenregel blockiert heute Buchungen (`booking-conflict.test.ts` dokumentiert das ausdrücklich), das Vier-Augen-Prinzip bei der Prüfungsfreigabe ist technisch vorbereitet und **nicht erzwungen**. Keine dieser Annahmen darf als Endregel gelten → **A4**. Dies ist die einzige Bedingung, die **nur die Fahrschule Krebs** schließen kann. |
| **5** | Docker-Registry-Zugriff einmalig verifizieren | **OFFEN, unverändert** | `docker-compose.yml` wurde nie mit einem echten `docker pull` getestet; alle Testläufe (auch die 794 dieser Sitzung) liefen gegen die im Sandbox-Image vorinstallierte Postgres-16.13-Instanz → **C7**. |
| **6** | Kernfluss 4 (Fahrzeugmangel → Finance-Flottenansicht) per Integrationstest belegen | **OFFEN, unverändert** | Phase 4 hat diesen Test **nicht** geschrieben; er lag außerhalb von §20. Die Datenmodell-Kopplung ist unverändert real (dieselbe Spalte, dieselbe Tabelle), der Cross-App-Test fehlt weiter → **C5**. |
| **7** | Bekannte Funktionslücken schließen oder bewusst zurückstellen | **OFFEN, unverändert** | `rankCandidates()` nicht an Storno-Retter/Planung angebunden, Fahrlehrerauslastungs-Detailkarte und Forecast-API, kein `GET /office/dokumente`-Übersichtsendpunkt, kein PDF/CSV/XLSX-Renderer, Seed-Abdeckung. Keine davon wurde in den Phasen 1–4 geschlossen (sie waren nicht Teil von `PROMPT -1`) → **C6**. Eine ausdrückliche Produktentscheidung fehlt weiterhin. |

**Bilanz: eine von sieben geschlossen, sechs offen.** Das ist kein Rückschritt –
`PROMPT -1` hat an einer anderen Achse gearbeitet (Zuverlässigkeit,
Synchronisation, Sicherheit, Betrieb) und dort erheblich zugelegt. Die sechs
offenen Bedingungen betreffen **Testabdeckung außerhalb der Sandbox**, **echte
Anbieter**, **fachliche Abnahme** und **Funktionsumfang** – keine davon ist durch
Zuverlässigkeitsarbeit lösbar.

## Was seit dieser Review NEU an Bedingungen hinzugekommen ist

Nicht in der alten Liste enthalten, weil die betroffenen Bausteine damals nicht
existierten. Vollständig mit Begründung und Zuständigkeit in
`docs/chaos-test-report.md`, Abschnitt 6:

| Neu | Kurz |
|---|---|
| **A1** | Getrennter Sicherungsort + Secret-Store. Sicherungen liegen heute neben der Datenbank, der Schlüssel neben den Sicherungen. |
| **A2** | Ein **Alarmkanal**. Elf Alarmarten sind definiert und feuern; empfangen wird nichts (`ALARM_WEBHOOK_URL` ist ein Seam, standardmäßig nicht registriert). |
| **A3** | Genau **ein** Prozess mit Scheduler, verifiziert über `GET /ops/scheduler`. |
| **A6/A7** | `METRICS_TOKEN` setzen; TLS + `COOKIE_SECURE=true`. |
| **B1** | Wiederherstellung auf einem **anderen Host** (der Test hier lief auf derselben Maschine). |
| **B3/B4** | Prometheus-Scraper + Dashboard; Rollback **erproben** – beides sind die zwei PARTIAL-Punkte des §22-Gates. |
| **B5/B6** | Standby + Failover (die Datenbank ist ein Single Point of Failure); WAL-Aufbewahrung einrichten. |
| **C1** | **Neun Abhängigkeits-Advisories in sechs Paketen.** Vom Phase-4-Reviewer eigenständig reproduziert (exakt 9 in 6) und einzeln nachgeprüft: **keines im aktuellen Code ausnutzbar**. Erforderlich sind Major-Aktualisierungen (`drizzle-orm` 0.36 → ≥ 0.45.2, React Router 6 → 7) als **eigener** Vorgang. |
| **C4** | Idempotenzfrist (24 h) gegen das Offline-Fenster (7 Tage) entscheiden. |

## Gefundene Fehler seit dieser Review

| Fund | Von | Status |
|---|---|---|
| Deadlock (40P01) statt Konfliktantwort bei gleichzeitiger Doppelbuchung – HTTP **500 statt 409** in 9–10 von 50 Läufen, bestehend seit Phase 1 | Phase 3 | behoben; von Phase 4 **unabhängig nachgeprüft**: 90 gleichzeitige Versuche über drei Tests, **0 × 5xx** |
| Zeichenkettengebautes SQL in `claimJobs` **plus** die Lücke im Wächter, der es verhindern sollte | **Phase 4** | behoben, Wächter erweitert und gegen das alte Muster verifiziert |
| `scheduleRecurringJobs()` wurde von **nichts** periodisch aufgerufen – in einem echten Serverprozess lief kein wiederkehrender Job | **Phase 4** | behoben (Scheduler, getrennter Worker, `GET /ops/scheduler`, Alarm) |
| `GET /health/ready` öffnete zwei neue DB-Verbindungen je Aufruf (p50 25 ms) | **Phase 4**, eigene Arbeit | behoben (p50 0,92 ms) |
| Der einzige Flake des Workspace: eine vakuum-erfüllbare negative Zusicherung, danach eine unwartende Prüfung | **Phase 4** | behoben, Test verschärft; **kein** Produktcode geändert |

## Verhältnis zum Verdikt dieses Berichts

Das **CONDITIONAL GO** von 2026-07-23 bleibt in seiner Grundaussage richtig und
ist durch das aktuelle Verdikt **RELIABILITY FOUNDATION CONDITIONAL**
(`docs/chaos-test-report.md`, Abschnitt 6) ersetzt. Die Begründung hat sich
verschoben: 2026-07-23 fehlte vor allem **Evidenz**; heute ist die Evidenz für
Zuverlässigkeit, Konfliktfreiheit, Wiederherstellung und Sicherheit da und
reproduziert – was fehlt, ist **Betriebsinfrastruktur** (Alarmkanal, Offsite,
Standby, Orchestrator, Scraper), **ein Browser** und die **fachliche Abnahme**
der 14 Regeln.
