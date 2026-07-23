# Student App – Abschluss-QA (Prompt 1)

Diese Sitzung hat `apps/student` vom Health-Check-Platzhalter (Prompt 0) in
eine echte, gegen `apps/api` arbeitende Fahrschüler-App überführt und dafür
`apps/api`/`packages/domain`/`packages/database`/`packages/permissions`/
`packages/integrations` gezielt erweitert. `app.html` wurde ausschließlich
als UX-/Fachlogik-Referenz gelesen, nicht als Code-Basis – siehe
`docs/prototype-audit.md`.

## Was gebaut wurde

- **Backend-Erweiterungen** (`packages/domain/src/curriculum.ts`,
  `packages/database/migrations/0003_student_app.sql`,
  `apps/api/src/routes/{appointment-offers,student,exam,documents,feedback,
  invoices,learning,flags,flex}.ts`): Vorbesitz/Erweiterung/B197/Getriebeart
  auf `ausbildungen`, exakte Zeitfenster + Ablauf auf `terminangebote`,
  Wunschzeiten, Dokument-Ablehnung/-Gültigkeit/-Re-Upload-Kette + Mock-
  Malware-Scan, Fahrstundenfeedback mit serverseitig erzwungener
  Geheimhaltung interner Notizen, Prüfungsfreigabe (nur Fahrlehrer/Büro
  dürfen setzen), Rechnungspositionen, Feature-Flag-Mechanismus
  (hidden/pilot/live) für Krebs Flex.
- **Neue Berechtigungen** (`packages/permissions`): `appointments:accept:own`
  (bewusst getrennt von `appointments:create`), `exam:clearance:set`
  (nur Fahrlehrer/Büro), `feedback:read:own`/`feedback:manage:own`,
  `wunschzeiten:write:own`, `learning:read:own`, `flex:participate:own`,
  `exam:read:own` – `docs/role-permission-matrix.md` wurde im selben Commit
  aktualisiert.
- **Frontend** (`apps/student`): React-Router-Shell mit den fünf
  geforderten Tabs (Heute/Ausbildung/Termine/Lernen/Mehr), Session über
  httpOnly-Cookie (kein localStorage-Auth), dünner API-Client mit
  Offline-Lese-Cache (nur GET, niemals Schreib-Queue), Tacho-Gauge
  (gestalterisch aus `app.html` portiert, aber nur für eine einzelne
  faktische Quote genutzt, nie für eine zusammengesetzte
  "Prüfungsreife"-Kennzahl).
- `@fastify/cors` in `apps/api` ergänzt (fehlte in Prompt 0; ohne CORS+
  `credentials:true` hätte kein Browser-Frontend das Session-Cookie senden
  können).

## Tatsächlich ausgeführte Tests

```
pnpm -r typecheck   # 15/15 Workspace-Pakete fehlerfrei (inkl. apps/office/
                     # instructor/finance, die unverändert blieben)
pnpm -r test
```

- `apps/api` – **44/44 grün** (21 aus Prompt 0 weiterhin grün + 23 neue in
  `src/__tests__/student-app.test.ts`):
  - Onboarding/leere Kontostände (Schüler ohne Ausbildung/Termine/
    Dokumente/Rechnungen bekommt saubere Leerzustände, keine erfundenen
    Daten)
  - Rollen/Sichtbarkeit: Schüler kann keine Termine anlegen (nur annehmen),
    kann keine Prüfungsfreigabe setzen (403, serverseitig, nicht nur
    UI-Blende), Fahrlehrer kann `appointments:accept:own` nicht nutzen,
    ein Schüler sieht nie die Dokumente eines anderen Schülers
  - Wunschzeiten: Eintragen + Auslesen
  - Terminangebote: Liste mit Filtern, Annahme über den serverseitigen,
    race-sicheren Buchungsendpunkt, Idempotenz (gleicher Key ⇒ derselbe
    Datensatz), **zwei parallele Annahmen desselben Angebots durch zwei
    Schüler ⇒ genau eine Buchung (201/409)**, Ablauf wird abgelehnt (409
    `expired`), Ablehnen hält das Angebot für andere offen
  - Dokumente: Upload (multipart, kein Base64), Ablehnung mit Grund,
    Re-Upload mit erhaltener Verkettung (`ersetztVonDokumentId`),
    Ablehnung nicht unterstützter/zu großer Dateien VOR Speicherung
  - Rechnungen: read-only, Zahlungslink ist ein Mock, Rückfrage-Aktion
    funktioniert, ein erfundener Mutations-Request liefert 404 (keine
    Route)
  - PrüfungsReady: Antwort enthält nachweislich keine der Zeichenketten
    "score"/"prozent"/"wahrscheinlichkeit"/"percentage"; eine gesetzte
    Fahrlehrer-Freigabe erscheint für den Schüler nur lesend
  - Feedback: interne Notizen tauchen nachweislich NICHT in der
    schülerseitigen JSON-Antwort auf (String-Suche auf der Rohantwort),
    nicht freigegebene Felder sind `null`, obwohl gespeichert;
    Selbsteinschätzung kann gesetzt werden
  - Lerninhalte: Liste + "besucht"-Markierung
  - Krebs Flex: Default `hidden` blockiert Opt-in (403), im `pilot`-Zustand
    funktionieren Opt-in/Liste/Annahme/Metrik Ende-zu-Ende
- `apps/student` – **24/24 grün** (Vitest + Testing Library):
  `useHeutePriorities` (alle 7 Prioritätsstufen inkl. "alles im grünen
  Bereich"), Offline-Cache (schreibt/liest, betrifft nur unabhängige Keys),
  `apiGet`/`apiMutate` (Cache-Fallback nur bei GET, `apiMutate` wirft sofort
  `OfflineError` statt zu queuen), Tacho (Rolle `img` mit Textalternative,
  Nadel-Transition wird bei `prefers-reduced-motion` auf `none` gesetzt),
  BottomNav (alle fünf Tabs mit Accessible Name, Icons `aria-hidden`),
  Login (Labels über `<label for>`, kein Registrierungsformular, TOTP-Feld
  erscheint bei `mfa_setup_required`), PrüfungsReady (keine Buttons/Inputs
  im gerenderten DOM), Feedback (nicht freigegebenes Feld wird nicht
  angezeigt, kein "internal" im gerenderten Text).
- Manuell verifiziert: `pnpm --filter @fahrschul/api dev` +
  `pnpm --filter @fahrschul/student dev` gleichzeitig laufen lassen, echter
  Login gegen die geseedete Postgres-Dev-Datenbank per curl (`/auth/login`,
  `/me/schueler`, `/appointments/mine`, `/flags`), CORS-Preflight
  (`OPTIONS /auth/login` mit `Origin: http://localhost:5173`) liefert
  korrekt `access-control-allow-credentials: true`. `pnpm build` für
  `apps/student` läuft fehlerfrei durch (Vite-Produktionsbuild, 197 KB JS
  gzip 64 KB).

## Nicht/nur eingeschränkt geprüft (ehrlich, siehe unten für Status)

- **Playwright-E2E** (`apps/student/e2e/critical-flows.spec.ts`,
  `playwright.config.ts`, aufbauend auf `packages/testing`): geschrieben,
  aber in dieser Sandbox **nicht ausgeführt** – `npx playwright install
  chromium` schlägt mit `403 request rejected: host not permitted`
  (`cdn.playwright.dev`) fehl, analog zum Docker-Registry-Block aus
  Prompt 0. Die Specs sind strukturell korrekt (Selektoren decken sich mit
  den tatsächlich gerenderten Rollen/Labels aus den Komponenten), aber ohne
  Browser-Lauf keine harte Garantie.
- **Responsive 360/390/768/1024**: Das Stylesheet (`src/styles.css`) nutzt
  durchgehend relative Einheiten, Flexbox, `max-width` auf dem App-Shell und
  einen einzigen `min-width:768px`-Breakpoint; das wurde durch Code-Review
  geprüft, NICHT durch echtes Screenshot-/Visual-Testing (kein Browser in
  dieser Sandbox verfügbar, siehe oben).
- **Tastatur/Screenreader**: semantisches HTML (`<nav>`, `<label for>`,
  `<fieldset>/<legend>`, `role="alert"`/`role="status"`), Icon-Buttons mit
  `aria-label` – geprüft über Testing-Library-Rollenabfragen (s.o.), nicht
  über einen realen Screenreader.

## Bewusste Vereinfachungen / offene fachliche Punkte (siehe docs/fachliche-bestaetigungen.md)

1. **Mandatory-Drives-Mindestzahlen** sind nur für Klasse B hinterlegt
   (gesetzliche FahrSchAusbO-Werte: 5 Überland/4 Autobahn/3 Nacht), für
   andere Klassen wird explizit "nicht bestätigt" angezeigt statt eine Zahl
   zu erfinden (Punkt 2).
2. **Vorbesitz/Erweiterung-Anrechnung**: Felder sind modelliert
   (`vorbesitzKlasse`, `istErweiterung`), es gibt aber KEINE automatische
   Anrechnungslogik (z. B. reduzierte Pflichtstunden bei B→BE) – das ist in
   `docs/fachliche-bestaetigungen.md` Punkt 3 offen.
3. **Reihenfolge-Zwang der Ausbildungsschritte** ist NICHT erzwungen
   (Ausbildung-Tab ist eine Checkliste, kein Wizard mit Sperren) – Punkt 9
   ist offen.
4. **Krebs-Flex-Fairness/"Stunden gespart"-Metrik** ist eine bewusst
   simple, unbestätigte Platzhalterregel ("first come, race-sicher") –
   Punkt 8 ist offen.
5. **Vier-Augen-Prinzip Prüfungsfreigabe**: technisch als zwei unabhängige
   Status (Fahrlehrer + Büro) vorbereitet, aber es wird NICHT erzwungen,
   dass eine Prüfungsanmeldung beide voraussetzt – Punkt 11 ist offen.
6. **Kein Self-Signup**: `apps/api` hat in Prompt 1 keinen
   Registrierungs-Endpunkt; Schülerkonten werden weiterhin büro-seitig
   angelegt (Prompt 2). Der Login-Screen verweist entsprechend darauf statt
   eine Registrierung vorzutäuschen.

## Mock-/Platzhalter-Integrationen (siehe docs/integration-gaps.md)

- **Malware-Scan**: `packages/integrations/src/malware-scan` – Mock meldet
  IMMER "sauber", kein echter AV-Anbieter in dieser Umgebung.
- **Zahlungsoption**: `packages/integrations/src/payments` – liefert nur
  einen `mock-payment://`-Platzhalterlink, keine echte Zahlungsauslösung.
- **Dokumentenspeicher**: weiterhin der In-Memory-Stub aus Prompt 0 (Daten
  gehen bei API-Neustart verloren) – Interface ist bereits S3-kompatibel
  geschnitten, aber kein echter Bucket angebunden.
- **Rückfrage zu Rechnungen**: kein echtes Ticket-/Messaging-System, landet
  nur als Audit-Ereignis.

## Fazit

**STUDENT APP CONDITIONAL**

Bedingungen/offene Punkte, die vor einem echten Go-Live geklärt werden
müssen (keiner davon ist ein technischer Blocker für diese Sitzung, aber
keiner darf stillschweigend als "fertig" gelten):

1. Playwright-E2E ist geschrieben, aber in dieser Sandbox nicht ausführbar
   (Netzwerk-Policy) – muss in einer Umgebung mit Zugriff auf
   `cdn.playwright.dev` nachgeholt werden.
2. Alle in "Mock-/Platzhalter-Integrationen" gelisteten Punkte (Malware-Scan,
   Zahlung, Dokumentenspeicher) sind für einen echten Produktivbetrieb durch
   reale Anbieter zu ersetzen.
3. Die in "Bewusste Vereinfachungen" gelisteten sechs fachlichen Annahmen
   sind von der Fahrschule Krebs zu bestätigen oder zu korrigieren (siehe
   `docs/fachliche-bestaetigungen.md`), bevor sie als endgültige Fachregel
   gelten.
4. Responsive-Verhalten und Screenreader-Kompatibilität wurden über
   Code-Review/automatisierte Rollen-Abfragen, nicht über echtes
   Browser-/AT-Testing geprüft.

Alle Non-Negotiables (kein localStorage-Auth, keine clientseitige
Buchung/Konfliktprüfung, keine automatische Prüfungsfreigabe, keine
Base64-Dokumente, kein Offline-Queuing von Schreibaktionen, interne
Fahrlehrer-Notizen nie in einer Schüler-API-Antwort) sind eingehalten und
durch die oben genannten Tests belegt.
