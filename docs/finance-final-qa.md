# apps/finance – Final QA (PROMPT 4)

Datum dieser Sitzung: 2026-07-23. Branch `claude/driving-school-admin-tcz2cx`.

## Was gebaut wurde

### Neues Package `packages/finance-core` (reine, unit-getestete Logik)

- `bank-matching.ts`: 5-stufige Bankabgleich-Kaskade (Rechnungsnummer →
  strukturierte Referenz → Name+Betrag+Zeitraum → Teil-/Sammelzahlung →
  manuell), Konfidenzstufen `sicher`/`wahrscheinlich`/`unklar`/`konflikt`.
  **Nur `sicher` ist `autoBuchbar`** — durch Tests erzwungen (`bank-matching.test.ts`,
  15 Tests), inkl. Teilzahlung, Überzahlung, Sammelzahlung, Rücklastschrift,
  Gutschrift, doppelte Zahlung/Dublette, abweichender Zahler (Firmenkunde),
  Bar/Karte, Mehrdeutigkeit → Konflikt.
- `umsatz-erkennung.ts`: strikte Trennung erbrachte Leistung / fakturierter
  Umsatz / Zahlungseingang / Forderung, Brutto/Netto, Periodenabgrenzung
  (5 Tests, inkl. explizitem Test, dass eine Leistung im Juni und die
  zugehörige Rechnung im Juli in unterschiedliche Perioden fallen).
- `fahrzeug-wirtschaftlichkeit.ts`: Fahrzeug-Vollkostenrechnung (Fix-/
  variable/Vollkosten, Kosten/Stunde, Kosten/km, Ausfallkosten,
  Deckungsbeitrag I) — reine Formeln, 3 Tests.
- `forecast.ts`: linearer Trend (kleinste Quadrate) über historische
  Perioden + Szenario-Deltas, Horizonte 4 Wochen/12 Wochen/Jahresende,
  konservativ/Basis/optimistisch mit R²-basiertem Unsicherheitsband — 6 Tests.
- **29/29 Tests grün** (`pnpm --filter @fahrschul/finance-core test`).

### Datenbank (`packages/database/migrations/0006_finance.sql`)

- `standorte`: Bad Hersfeld ergänzt (bislang nur Fulda geseedet, beide sind
  laut Aufgabenstellung "confirmed Standorte").
- `rechnungen`: `steuersatz`, `netto_cent` (nullable, siehe Begründung
  unten), `leistungszeitraum_von/bis`, `rechnungsnummer` (unique).
- `zahlungen`: `zahlungsart`, `banktransaktion_id`.
- Neue Tabelle `banktransaktionen`: Persistenz für den Mock-Bank-Feed +
  Matching-Ergebnis (Konfidenz/Grund/Aufteilung/Status/`auto_gebucht`).
- Neue Tabelle `produkte`: konfigurierbare Produkt-/Preisliste (B/BF17/B197,
  BE/B96, Motorrad/A, C/CE/C1/C1E, D/DE, BKF, Grundqualifikation, Simulator,
  Handicap, ASF/FES, Erste Hilfe, Unternehmerprüfung als *Code-Werte*,
  keine hartkodierten Preise — die Preise selbst kommen ausschließlich aus
  DB-Zeilen).
- `fahrzeuge`: Wirtschaftlichkeits-/Stammdatenfelder ergänzt
  (Kilometerstand, Finanzierungsart, Leasingrate/-ende, Versicherung/Steuer
  pro Jahr, nächste Inspektion/HU, `fahrzeug_status`) — Getriebe und
  Handicap-Ausstattung existierten bereits aus Prompt 2 und wurden bewusst
  NICHT dupliziert.
- Neue Tabellen `fahrzeugkosten`, `fahrzeugausfalltage`.
- Neue Tabelle `finanz_exporte`: Export-Audit (Format, Bericht, Parameter,
  gehashter Download-Token, Ablaufzeit, Downloadzeitpunkt).
- Migration lief sauber gegen eine echte lokale Postgres-Instanz
  (`fahrschul_dev` und `fahrschul_test`), idempotent (zweiter Lauf wendet 0
  neue Migrationen an — bestehender `migrations.test.ts` deckt das ab und
  ist weiterhin grün).

### API (`apps/api/src/routes/finance.ts`, `apps/api/src/app.ts`)

- `GET /finance/kpis` — die 7 Kern-Karten (Leistung/Umsatz,
  Deckungsbeitrag/Ergebnis, Liquidität, Fahrlehrerauslastung,
  Fahrzeugauslastung, offene Forderungen, Forecast-Verweis) + Storno-Retter-
  Erfolgsrate, aus echten Postgres-Aggregaten (kein hartkodierter Wert).
- `POST /finance/bank/sync` — ruft den Mock-Bank-Feed-Adapter ab (bereits
  aus Prompt 0/`packages/integrations/src/bank`), matcht gegen offene
  Rechnungen via `packages/finance-core`, persistiert jede Transaktion,
  bucht **ausschließlich** `sicher`-Treffer automatisch, alles andere landet
  mit `status = 'offen'` in der Review-Queue.
- `GET /finance/bank/queue`, `POST /finance/bank/:id/resolve` — Review-Queue
  lesen/manuell auflösen (Rolle `finanzen`, `bank:reconcile`).
- `GET/POST /finance/produkte` — Preisliste lesen (`finance:cockpit:read`)
  bzw. pflegen (`products:manage`, nur Rolle `finanzen`).
- `GET /finance/fleet` — Fahrzeugliste + offene Mängel je Fahrzeug.
- `POST /finance/exports`, `GET /finance/exports/:id/download` —
  signierter, session-gebundener Download-Token (sha256-Hash in der DB, roher
  Token nur im Response/Query, 15 Minuten gültig, an den anfordernden
  Benutzer gebunden), **kein öffentlicher/statischer Downloadpfad**, jeder
  Request/Download wird in `audit_events` protokolliert.
- `GET /finance/data-quality` — Issue-Queue (unmatched Banktransaktionen,
  Fahrzeuge ohne Kostendaten, Rechnungen ohne Rechnungsnummer).

### Berechtigungen (`packages/permissions/src/matrix.ts`)

- Neue Permissions: `finance:cockpit:read`, `finance:invoices:read:any`,
  `fleet:economics:manage`, `products:manage`, `finance:export`,
  `finance:data_quality:read`.
- Rolle `finanzen`: erhält alle neuen Permissions inkl. `products:manage`,
  `fleet:economics:manage`.
- Rolle `geschaeftsfuehrung`: erhält Cockpit-/Export-/Datenqualitäts-
  Leserechte (**Lücke aus Prompt 0 geschlossen** — die Rolle existierte,
  hatte aber noch keine Finance-View-Rechte), bewusst **ohne**
  `bank:reconcile` und **ohne** `products:manage` (Bankabgleich-
  Arbeitsschritt und Preispflege bleiben bei `finanzen`).
- `matrix.test.ts` (bestehend, Prompt 0) bleibt unverändert grün.

### apps/finance (React/Vite, ersetzt den `/health`-Platzhalter)

- Login (gleiches Session-/MFA-Muster wie `apps/office`), Ein-Seiten-
  Cockpit (`Cockpit.tsx`): 7 KPI-Karten mit Datenqualitäts-Badge,
  Bankabgleich-Review-Queue-Tabelle mit "Mock-Feed abrufen"-Button,
  Datenqualitäts-Issue-Tabelle, Export-Button.
- Rollen-Client-Gate (`finanzen`/`geschaeftsfuehrung`) — **nur UX**, die
  eigentliche Autorisierung ist ausschließlich serverseitig.
- Design-DNA konsistent mit `apps/office`/`apps/student`/`apps/instructor`
  (gleiche CSS-Variablen/Card-/Button-Primitives aus `packages/ui`, kein
  neues Farbsystem erfunden) — da kein `finanzen-1.html`-Referenzprototyp
  existiert (siehe docs/integration-gaps.md), wurde die UI direkt aus dem
  Domain-/KPI-Modell abgeleitet statt eines HTML-Ports.
- `pnpm --filter @fahrschul/finance build` und `typecheck` laufen sauber
  durch (Vite-Produktionsbuild, 162 kB JS gzip 52 kB).

## Tests

- `packages/finance-core`: **29/29** grün (Bankabgleich, Umsatzerkennung,
  Fahrzeugwirtschaftlichkeit, Forecast — siehe oben).
- `apps/api/src/__tests__/finance.test.ts`: **16/16** grün:
  - Rollenrechte: schueler/fahrlehrer/buero **403** vom Cockpit;
    buero **403** von `bank:reconcile` und `products:manage`, obwohl buero
    weiterhin sein bestehendes `invoices:read:own` (Prompt 2) behält —
    explizit gegengetestet, dass Prompt 4 buero NICHT zusätzlich
    `invoices:manage`/`finance:*` gegeben hat; `finanzen` und
    `geschaeftsfuehrung` bekommen Cockpit-Zugriff,
    **nur `finanzen`** darf den Bankabgleich ausführen.
  - Bankabgleich End-to-End gegen den Mock-Feed: Sync + Review-Queue enthält
    ausschließlich `status='offen'`/`autoGebucht=false`-Zeilen.
  - Datenqualitäts-Queue erkennt Rechnungen ohne Rechnungsnummer.
  - Export: 403 ohne `finance:export`, gültiger signierter Download-Token
    funktioniert, falscher Token → 404, Download durch einen anderen
    Finanz-Nutzer als den Anforderer → 403, jeder Request/Download erzeugt
    einen `audit_events`-Eintrag.
  - Große Datenmenge: 300 zusätzliche Rechnungen aggregieren korrekt und in
    < 5s.
- **Voller Workspace-Testlauf** (`pnpm -r test`, mit laufender lokaler
  Postgres-Instanz): **alle Suiten grün**, insgesamt
  `apps/api` 110/110, `apps/student` 24/24, `apps/office` 1/1 (Layout-Test),
  `apps/instructor` 9/9, `packages/finance-core` 29/29,
  `packages/permissions` 12/12, `packages/scheduling` 18/18,
  `packages/matching` 6/6, `packages/auth` 6/6, `packages/domain` 6/6,
  `packages/integrations` 2/2. Insbesondere bestätigt: **apps/students
  Rechnungsansicht** (`student-app.test.ts` "invoices (read-only)") und
  **apps/office's bestehende Payments-Ansicht** laufen unverändert weiter —
  keine versehentliche Rechteausweitung.
- `pnpm --filter @fahrschul/api typecheck`, `@fahrschul/database
  typecheck`, `@fahrschul/finance-core typecheck`, `@fahrschul/finance
  typecheck` — alle sauber.
- Migration 0006 wurde real gegen laufende Postgres-Instanzen
  (`fahrschul_dev`, `fahrschul_test`) angewendet, nicht nur gelesen.

### Playwright/Browser-E2E

`apps/finance/e2e/critical-flows.spec.ts` ist geschrieben (Login → Cockpit,
Rollen-Gate für Nicht-Finanz-Rollen, Bankabgleich-Sync, Export-Download),
aber **nicht ausgeführt** — `npx playwright install chromium` scheitert in
dieser Sandbox weiterhin mit "Download failure, code=1" (Egress-Policy
blockiert `cdn.playwright.dev`), verifiziert erneut am 2026-07-23 in dieser
Sitzung (identischer Befund wie Prompt 1-3, siehe
docs/student-app-final-qa.md, docs/instructor-final-qa.md).

## Bewusste Vereinfachungen / offene Punkte

1. **Deckungsbeitrag/Ergebnis-Karte zeigt nur Deckungsbeitrag I** (Umsatz −
   variable Fahrzeugkosten), **kein** volles EBIT-Ergebnis — Personal-/
   Fixkostenumlage je Kostenstelle ist fachlich nicht bestätigt (siehe
   docs/kpi-woerterbuch.md, Abschnitt "Fachliche Bestätigungen
   ausstehend"). API markiert das Feld explizit mit `datenqualitaet:
   "teilweise"` statt eine erfundene Zahl auszugeben.
2. **Fahrlehrerauslastung-Karte ist ein Platzhalter/Verweis** auf
   `/finance/fahrlehrer` — die mix-bereinigte (Praxis/Theorie/Klassenmix/
   Standort/Teilzeit/Storno/Arbeitszeitwarnungen) Detailauswertung, die
   explizit "keine Rohrangliste" sein soll, ist **nicht** in dieser Sitzung
   fertig implementiert (Zeitbudget). Die Rohdaten (Arbeitszeit,
   Terminbuchungen, Storno-Events, Kompetenzraster) existieren bereits real
   aus Prompt 2/3 und sind über bestehende API-Routen erreichbar — die
   Aggregations-/Gewichtungslogik fehlt.
3. **Forecast-Logik ist vollständig implementiert und getestet**
   (`packages/finance-core/forecast.ts`, 6 Tests), aber **nicht** an einen
   eigenen `/finance/forecast`-API-Endpunkt oder eine Detail-UI
   angeschlossen — die Cockpit-Karte verweist nur darauf. Konkrete
   Szenario-Deltas (z. B. "was bringt eine zusätzliche gefüllte
   Fahrstunde/Tag in Euro") sind fachliche Eingaben, die noch von der
   Fahrschule Krebs kommen müssen.
4. **Fahrzeug-Vollkostenrechnung ist im Backend/Formel-Layer real und
   getestet**, aber im Cockpit noch nicht als eigene Detail-Tabelle je
   Fahrzeug gerendert (nur Statusverteilung + offene Mängel in
   `/finance/fleet`) — die Formel-Funktion ist einsatzbereit, sobald echte
   `fahrzeugkosten`-Zeilen erfasst werden (aktuell keine Seed-Daten dafür).
5. **Kein echter Beleg-/Rechnungs-PDF-Renderer**: `/finance/exports`
   liefert den auditierten, autorisierten Datensatz als JSON zurück statt
   ein echtes PDF/CSV/XLSX zu rendern (kein Rendering-Package in dieser
   Sandbox verdrahtet) — Auth-/Audit-Pfad ist vollständig und real, ein
   Renderer kann andocken ohne diesen Pfad zu ändern.
6. **Kein echter Bank-Feed**: `packages/integrations/src/bank` bleibt im
   `mock`-Modus (aus Prompt 0 übernommen, keine echte FinTS/EBICS-Anbindung
   in dieser Sandbox verfügbar). Die Matching-*Logik* selbst ist real,
   unit-getestet und DB-unabhängig aufrufbar — sie kann gegen einen echten
   Feed-Adapter laufen, sobald einer existiert.
7. **Produktliste ist strukturell vorhanden, aber ungeseedet**: Migration
   0006 legt die `produkte`-Tabelle an, es gibt aber keine Standard-
   Preiszeilen für B/BF17/etc. — Preise sind laut Non-Negotiable bewusst
   NICHT hartkodiert und müssen über `POST /finance/produkte` (Rolle
   `finanzen`) gepflegt werden.
8. `netto_cent` auf `rechnungen` ist bewusst **nullable** statt `NOT NULL`,
   damit bestehende Prompt-1..3-Testfixtures (Rohinserts ohne dieses Feld)
   unverändert funktionieren — die Anwendung berechnet Netto bei Bedarf aus
   Brutto (`nettoVonBrutto`), ein fehlender Wert ist also nie Datenverlust,
   nur ein Datenqualitäts-Signal.

## Mock-/Platzhalter-Integrationen (Ergänzung zu docs/integration-gaps.md)

- **Bank-Feed** (`packages/integrations/src/bank`): Mock-Adapter aus
  Prompt 0, unverändert — liefert eine feste Fixture-Liste, kein echter
  FinTS/EBICS-Zugang in dieser Sandbox.
- **Export-Rendering**: kein echter PDF/CSV/XLSX-Renderer, siehe Punkt 5
  oben.

## Fazit

**FINANCE CONDITIONAL**

Alle Non-Negotiables, die in dieser Sitzung geprüft werden konnten, sind
eingehalten und durch echte Tests belegt: strikte Trennung
Leistung/Umsatz/Zahlung/Forderung (nie konfliert, mit Periodenabgrenzungs-
Test), Brutto/Netto sauber getrennt, Bankabgleich-Kaskade mit
**ausschließlich `sicher` = automatisch buchbar** (durchgesetzt in Logik
UND API UND Test), keine hartkodierten Produktpreise (echte
`produkte`-Tabelle statt Array), Fahrzeug-Vollkostenrechnung als echte,
unit-getestete Formel statt hartkodierter Zahl, Geschäftsführung-Lücke aus
Prompt 0 (fehlende Finance-View-Rechte) geschlossen ohne ihr den
Bankabgleich-Arbeitsschritt selbst zu geben, Export ausschließlich über
signierten session-gebundenen Token mit vollständigem Audit-Log (getestet:
falscher Token, fremder Nutzer, Audit-Einträge), kein bestehender Prompt-1/2-
Testpfad (Student-Rechnungsansicht, Büro-Payments-Ansicht) beschädigt oder
unbeabsichtigt erweitert (voller Workspace-Testlauf grün).

Bedingungen, die vor einem echten Go-Live/einer Folge-Session geklärt bzw.
nachgeholt werden müssen (keine davon ist ein technischer Blocker für diese
Sitzung, aber keine gilt stillschweigend als "fertig"):

1. Die acht Punkte unter "Bewusste Vereinfachungen / offene Punkte" oben —
   insbesondere: volles Ergebnis (EBIT) statt nur Deckungsbeitrag I,
   Fahrlehrerauslastungs-Detailkarte, Forecast-API-Endpunkt +
   Szenario-Deltas, Fahrzeug-Kosten-Detailtabelle im Cockpit.
2. Playwright/Browser-E2E für `apps/finance` ist geschrieben, aber in
   dieser Sandbox nicht ausführbar (Egress-Block, erneut verifiziert
   2026-07-23) — muss in einer Umgebung mit Zugriff auf
   `cdn.playwright.dev` nachgeholt werden.
3. Kein echter Bank-Feed/FinTS-Zugang und kein echter PDF/CSV/XLSX-
   Renderer in dieser Sandbox — beide Integrationspunkte sind sauber
   gekapselt (Adapter-Pattern bzw. Auth-/Audit-Pfad), aber ungetestet
   gegen echte Fremdsysteme.
4. Die vier fachlichen Bestätigungsfragen in docs/kpi-woerterbuch.md
   (Kostenstellenzuordnung, Netto/Brutto bei Fahrzeugkosten,
   Forecast-Szenario-Deltas, Fahrlehrer-Gewichtungsformel) sind von der
   Fahrschule Krebs zu klären.
5. Keine Seed-Daten für `produkte`/`fahrzeugkosten`/`fahrzeugausfalltage` —
   `pnpm db:seed` deckt diese neuen Tabellen noch nicht ab, das Cockpit
   zeigt bei frisch geseedeten Testdaten entsprechend leere/Null-Werte für
   Produktliste und Fahrzeug-Vollkosten.
