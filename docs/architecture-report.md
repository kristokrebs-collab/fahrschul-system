# Architekturbericht – Prompt 0: Gemeinsame Plattform

## Zusammenfassung

Es wurde ein TypeScript-Monorepo (pnpm-Workspaces) unter `apps/` und
`packages/` aufgebaut, das die in `docs/prototype-audit.md`,
`docs/security-risks.md` und `docs/integration-gaps.md` dokumentierten
Blocker des Prototyps beseitigt: keine PIN-Auth, keine Produktivdaten in
`localStorage`, keine dreifach duplizierten Fahrlehrerlisten, echte
serverseitige Konfliktprüfung bei Terminbuchungen, echtes Rollenmodell mit
Middleware und Tests. Die vier historischen HTML-Dateien und `server.py`
wurden **nicht verändert** und bleiben als fachliche/gestalterische
Referenz für Prompt 1–4 erhalten.

## Struktur

```
apps/
  api/          Fastify-HTTP-API (Auth, Rollen-Middleware, Terminbuchung mit
                serverseitiger Konfliktprüfung)
  student/      Platzhalter-Vite/React-App mit Health-Check (Prompt 1)
  office/       Platzhalter-Vite/React-App mit Health-Check (Prompt 2)
  instructor/   Platzhalter-Vite/React-App mit Health-Check (Prompt 3)
  finance/      Platzhalter-Vite/React-App mit Health-Check (Prompt 4)

packages/
  domain/       Zod-Schemas + Typen für alle Kern-Entitäten, Event-Typen, Rollen
  database/     Drizzle-ORM-Schema, handgeschriebene numerierte SQL-Migrationen,
                Migrationsläufer, NUR-lokaler Seed-Script
  auth/         Passwort-Hashing (scrypt), Server-Sessions, TOTP-MFA
  permissions/  Rollen→Berechtigungs-Matrix als Code (+ docs/role-permission-matrix.md)
  scheduling/   Reine Funktionen für die harten Matching-/Konfliktregeln
  integrations/ Mock-Adapter für Notifications/Kalender/Bank/Storage/CRM
  events/       Helfer zum Aufbau von audit_events-Zeilen (Event-Log Schritt 6)
  testing/      Geteilte Playwright-Basiskonfiguration für spätere App-E2E-Tests
  ui/           Minimale Button/Card-Primitive (Design-DNA aus dem Prototyp)
```

## Datenmodell

`packages/database/migrations/0001_init.sql` legt die für Prompt 0 geforderten
Kern-Entitäten an: Organisation, Standort, Benutzer (inkl. Rolle, Passwort-Hash,
MFA-Secret), Sessions, Schüler, Fahrlehrer, Ausbildung, Verfügbarkeit,
Fahrzeug, Terminangebot, Terminbuchung, Rechnung, Zahlung, Dokument sowie
`audit_events` (Audit-Log + versioniertes Event-Log in einer Tabelle,
Spalte `type`). Jede Entität hat `id` (uuid), `status`, `version`,
`created_at`/`updated_at`, wo fachlich sinnvoll `standort_id`.

`0002_conflict_constraints.sql` fügt **PostgreSQL-EXCLUDE-Constraints**
(via `btree_gist`) auf `terminbuchungen` hinzu, die Überschneidungen pro
Fahrlehrer bzw. Fahrzeug direkt auf Datenbankebene verbieten – zusätzlich zur
Prüfung in `apps/api`. Das ist die stärkste verfügbare Umsetzung des
Non-Negotiables *"Keine Terminbuchung ohne serverseitige Konfliktprüfung"*:
selbst ein Bug im Anwendungscode oder eine echte Race Condition zwischen zwei
gleichzeitigen Requests kann keine doppelte Buchung erzeugen (siehe Test
*"allows two concurrent requests for the same slot and rejects exactly one"*).

Die vollständige fachliche Entitätsliste aus dem Original-Prompt (Theorie,
Praxisstunde, Sonderfahrt, Simulator, Prüfung, Prüfungsfreigabe,
Fahrzeugmangel, Raum, Dokumentprüfung, Banktransaktion, Lead/Firma, Nachricht,
Einwilligung, Aufgabe, Integrationsstatus, Mitarbeiter) ist **nicht** in
Prompt 0 modelliert – das ist eine bewusste Priorisierung ("prioritize a
working, tested skeleton over exhaustive feature completeness") und wird in
Prompt 1–4 ergänzt, wenn die zugehörige Fachlogik gebaut wird.

## Auth & Rollen

- Passwort-Hashing mit `scrypt` (Node-Kernmodul) statt argon2/bcrypt, weil in
  dieser Sandbox kein garantierter nativer Build verfügbar ist – scrypt ist
  ebenfalls ein anerkannter, speicherharter KDF (RFC 7914) und deckt dieselbe
  Anforderung ("kein Klartext-/schwaches Passwort-Hashing") ab. Das
  Hash-Format ist versioniert (`scrypt$...`), ein späterer Wechsel auf
  argon2id ist ohne Invalidierung bestehender Hashes möglich.
- Sessions: zufälliges Token im httpOnly-Cookie, nur der SHA-256-Hash liegt
  in der `sessions`-Tabelle. Kein JWT, kein PIN.
- TOTP-MFA (otplib) für Mitarbeitendenrollen (Büro, Finanzen,
  Geschäftsführung, Systemdienst) verpflichtend – Login wird verweigert,
  wenn das Setup nicht abgeschlossen ist, statt stillschweigend ohne MFA
  durchzulassen.
- Rollen-Middleware (`requireRole`, `requirePermission`) in `apps/api`
  gegen die in `packages/permissions` codierte Matrix, die 1:1
  `docs/role-permission-matrix.md` entspricht.

## Terminbuchung (`POST /appointments`)

1. Zod-Validierung des Bodys.
2. Innerhalb einer DB-Transaktion: Idempotenzprüfung (identischer
   `idempotencyKey` ⇒ derselbe Datensatz wird zurückgegeben, keine zweite
   Buchung).
3. Fachliche Vorprüfung über `packages/scheduling` (Fahrlehrer-Qualifikation
   für die Klasse, Fahrzeugklasse, Überschneidung mit bestehenden Buchungen)
   für verständliche Fehlermeldungen.
4. Insert – bei Verstoß gegen die DB-EXCLUDE-Constraints (SQLSTATE `23P01`)
   oder den Unique-Index auf `idempotency_key` (`23505`) wird HTTP 409
   zurückgegeben.
5. Audit-/Event-Zeile (`lesson.booked`) wird in derselben Transaktion
   geschrieben.

## Integrationen

Alle in `docs/integration-gaps.md` gelisteten externen Systeme
(Notifications, Kalender, Bank-Feed, Dokumentenspeicher, CRM-Webhook) sind in
`packages/integrations` als Interface + funktionierender `mock`-Adapter
implementiert. `sandbox`/`live` sind als Konfigurationsoption vorgesehen,
werfen aber bewusst einen Fehler (`assertMockOnly`), damit niemals eine
"funktionierende Live-Schnittstelle" behauptet werden kann, ohne dass sie
getestet wurde.

## Testergebnisse (in dieser Sitzung tatsächlich ausgeführt)

Docker war installiert, aber der Image-Pull von `postgres:16-alpine` wurde
vom Egress-Proxy dieser Umgebung mit `403 Forbidden` abgelehnt
(Organisationsrichtlinie, siehe `/root/.ccr/README.md` – "do not retry
organization policy denials"). Da eine **lokal bereits installierte**
PostgreSQL-16-Instanz im Sandbox-Image vorhanden war, wurde diese stattdessen
gestartet und für Migrations-/API-Tests verwendet (`docker-compose.yml`
bleibt für Umgebungen mit Docker-Registry-Zugang die vorgesehene Methode).

```
pnpm -r test
```

- `packages/permissions` – 5/5 Tests grün (Rollenmatrix, inkl. "systemdienst
  hat keinen Zugriff auf Schülerdaten", "finanzen hat keine
  Terminbuchungsrechte")
- `packages/scheduling` – 7/7 Tests grün (Überschneidungslogik, Qualifikation,
  Fahrzeugklasse, stornierte Buchungen werden ignoriert)
- `packages/auth` – 6/6 Tests grün (Passwort-Hashing/-Verifikation, TOTP)
- `packages/integrations` – 2/2 Tests grün (alle Mock-Adapter, sandbox/live
  wird verweigert)
- `packages/database` – keine eigenen Unit-Tests (wird über `apps/api`
  mitgetestet), `--passWithNoTests`
- `apps/api` – **21/21 Tests grün**, u. a.:
  - `migrations.test.ts`: Migrationen wenden sich sauber an, sind idempotent
    (zweiter Lauf wendet nichts an), alle erwarteten Tabellen und die
    EXCLUDE-Constraints existieren
  - `auth.test.ts`: Login mit korrektem Passwort setzt Session-Cookie, **falsches
    Passwort wird abgelehnt** (401, generische Fehlermeldung gegen
    User-Enumeration), **geschützte Route ohne Session wird abgelehnt** (401),
    Zugriff mit gültiger Session funktioniert, Mitarbeitendenrolle ohne
    abgeschlossenes MFA-Setup wird abgelehnt, Logout invalidiert die Session
  - `roles.test.ts`: **Rollen-Middleware blockiert Schüler** beim Versuch,
    einen Termin zu buchen (403), Fahrlehrer mit passender Berechtigung darf,
    unauthentifizierte Anfragen liefern 401 statt 403
  - `booking-conflict.test.ts` (**der kritische Test**):
    `"REJECTS booking the same instructor for an overlapping slot a second
    time"` – die zweite, überschneidende Buchung desselben Fahrlehrers wird
    mit 409 abgelehnt; zusätzlich: exakte Duplikat-Buchung abgelehnt,
    nicht-überschneidende Anschlussbuchung erlaubt, nicht qualifizierter
    Fahrlehrer abgelehnt, **zwei gleichzeitige (`Promise.all`) Buchungsversuche
    für denselben Slot – genau einer gewinnt (201), der andere schlägt fehl
    (409)** (Beweis der Race-Sicherheit durch den DB-Constraint), sowie zwei
    Idempotenz-Tests: derselbe `idempotencyKey` zweimal ⇒ derselbe Datensatz
    (kein zweiter Eintrag), unterschiedliche Keys für überschneidende Zeiten
    ⇒ Konflikt wird nicht durch die Idempotenz maskiert

Zusätzlich manuell verifiziert: `pnpm --filter @fahrschul/api build` (tsc)
läuft fehlerfrei, `pnpm --filter @fahrschul/api dev` startet und
`GET /health` antwortet mit `200 {"status":"ok"}`, `pnpm db:seed` legt lokale
Testdaten an (Organisation, Standort, je ein Benutzer/Konto pro Rollen-Beispiel,
Fahrlehrer, Schüler, Fahrzeug). `pnpm -r typecheck` ist für alle 15
Workspace-Pakete fehlerfrei.

## Bewusst nicht in Prompt 0 umgesetzt / offene Punkte

- **Docker-Registry-Zugriff**: In dieser Sandbox durch Egress-Policy blockiert
  (siehe oben). `docker-compose.yml` ist korrekt und wurde als Konfiguration
  geschrieben, aber der Image-Pull selbst konnte nicht verifiziert werden;
  stattdessen wurde eine lokal vorinstallierte Postgres-16-Instanz für alle
  Tests verwendet. Sollte in einer Umgebung mit Registry-Zugriff (z. B. CI)
  erneut verifiziert werden.
- **argon2/bcrypt statt scrypt**: bewusste Ersatzentscheidung wegen
  Unsicherheit über native Kompilierung in dieser Sandbox, siehe oben.
  Fachlich gleichwertig, aber abweichend von der wörtlichen Empfehlung.
- **Live-Integrationen**: wie in `docs/integration-gaps.md` festgelegt, bleibt
  jede externe Integration im `mock`-Modus; `sandbox`/`live` sind nicht
  funktionsfähig, da keine echten Zugangsdaten vorliegen.
- **Passkey/WebAuthn**: nicht implementiert (kein echtes HTTPS-Origin zum
  Testen in dieser Sandbox verfügbar, siehe `docs/integration-gaps.md`).
- **Vollständige fachliche Entitätsliste**: siehe Abschnitt "Datenmodell"
  oben – nur die für Prompt 0 explizit geforderten Kern-Entitäten sind
  modelliert, der Rest folgt in Prompt 1–4.
- **apps/student, apps/office, apps/instructor, apps/finance**: bewusst nur
  Health-Check-Platzhalter (Vite/React), keine Fachlogik – das ist Gegenstand
  der separat getrackten Prompts 1–4.
- **packages/ui**: nur zwei Primitive (Button, Card) portiert, kein
  vollständiges Design-System – wie in der Aufgabenstellung als niedrige
  Priorität markiert.
- **Playwright/E2E**: `packages/testing` stellt nur die geteilte
  Basiskonfiguration bereit, es wurden in dieser Sitzung keine E2E-Tests
  geschrieben oder ausgeführt (laut Aufgabenstellung nicht für Prompt 0
  gefordert).
- **Fachliche Annahmen** (Gewichtung Prüfungsreife, Reihenfolge-Zwang
  Ausbildungsschritte, Vier-Augen-Prinzip Prüfungsfreigabe usw.) bleiben wie
  in `docs/fachliche-bestaetigungen.md` beschrieben offen und fließen nicht
  in dieses Fundament ein (Prompt 0 hat keine Ausbildungs-/Prüfungslogik,
  nur das Datenmodell dafür).

## Fazit

**FOUNDATION READY**
