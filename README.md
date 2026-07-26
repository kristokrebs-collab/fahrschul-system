# Fahrschule Krebs · Digitales Fahrschul-System

Drei live gekoppelte Oberflächen + ein Mini-Server. Keine Installation nötig,
nur Python 3 (auf Windows/macOS/Linux vorinstalliert oder frei erhältlich).

| Datei | Wer nutzt sie | Was sie kann |
|---|---|---|
| `dashboard.html` | Büro / Inhaber (**Zugangscode: 1234**) | 100+ Schüler & 15 Fahrlehrer verwalten, Suche/Sortierung/Filter, Akte mit Theorie/Praxis/Zahlungen/Nachweisen, Smart-Matching absegnen (mit Überbuchungsschutz), Aktivitäts-Feed, Ausfall-Alarm, CSV-Export |
| `app.html` | Fahrschüler (Handy) | Registrierung & Login („angemeldet bleiben"), Ausbildungs-Cockpit, Wunschzeiten, Sehtest/Erste-Hilfe/Passbild hochladen, Termine & Historie |
| `fahrlehrer.html` | Fahrlehrer (Handy) | Anstehende Fahrten (wer/wann/wo/Fahrtart) mit Anruf & Navigation, Fahrstil-Bewertung beim Bestätigen, Arbeitszeiten pflegen (= Matching-Basis), „Heute krank"-Panikknopf, Historie mit Abrechnungs-Status |
| `server.py` | – | Liefert alle Seiten aus und synchronisiert alles zwischen den Geräten in Echtzeit |

## Start (1 Befehl)

```
python3 server.py
```

Der Server zeigt dann die drei Adressen an:

- **Zentrale (PC/Tablet):** `http://localhost:8000/dashboard.html` – Zugangscode `1234`
- **Schüler-App (Handy im gleichen WLAN):** `http://<IP-des-PCs>:8000/app.html`
- **Fahrlehrer-App (Handy):** `http://<IP-des-PCs>:8000/fahrlehrer.html`
- **Zentrale als React-Variante (Variante 2):**
  `http://localhost:8000/react-zentrale/dist/index.html` – gleicher
  Live-Sync, gleiches Designsystem, komplett neu in React gebaut
  (Quellcode in `react-zentrale/`, ändern mit `npm install && npm run build`)

Ohne Server funktioniert die Zentrale auch per Doppelklick – die Schüler-App
öffnet sich dann über den Button „Schüler-App" direkt in der Zentrale.
Geräteübergreifend (Handy ↔ PC) braucht es den Server.

## Der Kreislauf in 60 Sekunden

1. Schüler registriert sich am Handy → erscheint **sofort** in der Zentrale
   (LIVE-Badge + Glocken-Meldung „Neue Anmeldung").
2. Büro weist einen Fahrlehrer zu und **segnet einen Matching-Termin ab**
   (Vorschläge = Wunschzeiten des Schülers × Dienstplan des Fahrlehrers;
   bereits belegte Slots werden automatisch ausgeblendet).
3. Fahrlehrer sieht den Termin in seiner App (Uhrzeit, Datum, Treffpunkt,
   empfohlene Fahrtart), ruft bei Bedarf an oder startet die Navigation.
4. Nach der Fahrt: „Stattgefunden" → Fahrstil kurz bewerten → Fahrt wird
   **abgerechnet**, Stunden & Telemetrie des Schülers aktualisieren sich in
   derselben Sekunde, die Zentrale bekommt die Meldung.
5. Fällt ein Fahrlehrer aus: Panik-Knopf → roter Alarm in der Zentrale,
   Matching für den Tag automatisch gesperrt.

## Daten & Grenzen

- Alle Daten liegen in `sync-data.json` neben dem Server (löschen = Reset)
  bzw. im Browser-Speicher der Geräte.
- Das System ist ein voll funktionsfähiger Prototyp für den Betrieb im
  eigenen Netz. Für einen öffentlichen SaaS-Betrieb (Internet, viele
  Fahrschulen) sind echte Nutzerkonten mit Server-Authentifizierung, eine
  Datenbank (z. B. PostgreSQL mit Row-Level-Security und
  Exclusion-Constraints gegen Doppelbuchungen) und HTTPS erforderlich –
  die Datenmodelle dieses Prototyps sind dafür bereits passend geschnitten.

---

## Produktionsplattform (Prompt 0 – `apps/`, `packages/`)

Die Dateien oben (`app.html`, `dashboard.html`, `fahrlehrer.html`,
`react-zentrale/`, `server.py`) bleiben als historischer Prototyp erhalten
und werden **nicht** verändert. Die eigentliche Produktivsoftware entsteht
im TypeScript-Monorepo unter `apps/` und `packages/` (siehe
`docs/architecture-report.md` für die vollständige Architekturbeschreibung).

### Voraussetzungen

- Node.js ≥ 20, pnpm ≥ 10 (`corepack enable` oder `npm i -g pnpm`)
- PostgreSQL 16 – entweder via `docker compose up -d` (siehe
  `docker-compose.yml`) **oder** eine bereits lokal laufende Instanz

### Setup in einem Befehl

```bash
./setup.sh          # macOS, Linux, oder Windows in Git Bash / WSL
```

Windows-PowerShell: `.\setup.ps1` (ungetestet – im Zweifel `setup.sh` in Git
Bash nutzen, das ist geprüft).

Das Skript legt `.env` an (mit zufällig erzeugtem `SESSION_SECRET`),
installiert die Abhängigkeiten, startet bei Bedarf den Postgres-Container,
erstellt beide Datenbanken, migriert sie und seedet Testdaten – jeder Schritt
wird übersprungen, wenn er schon erledigt ist. `--reset` baut die Datenbanken
nach Rückfrage neu auf, `--start` startet danach API und alle vier Apps.

### Setup von Hand

```bash
pnpm install
cp .env.example .env        # SESSION_SECRET ersetzen, Platzhalter ist unsicher
docker compose up -d        # startet lokalen Postgres-Container
# Alternative ohne Docker: eine lokale Postgres-Instanz mit denselben
# Zugangsdaten aus .env (Rolle "fahrschul", DBs "fahrschul_dev"/"fahrschul_test")
# Beide Datenbanken müssen existieren, migrate legt sie nicht an.

pnpm db:migrate              # wendet packages/database/migrations/*.sql an
pnpm db:seed                 # NUR lokale Testdaten, siehe packages/database/src/seed.ts
```

Danach in **fünf** Terminals (die API zuerst):

```bash
pnpm dev:api                              # http://localhost:4000  (/health)
pnpm --filter @fahrschul/student dev      # http://localhost:5173  Schüler-App
pnpm --filter @fahrschul/office dev       # http://localhost:5174  Büro-Zentrale
pnpm --filter @fahrschul/instructor dev   # http://localhost:5175  Fahrlehrer-App
pnpm --filter @fahrschul/finance dev      # http://localhost:5176  Finanz-Cockpit
```

Die Ports sind in den `vite.config.ts` fest vergeben (`strictPort`), weil die
API genau `5173`–`5176` in ihrer CORS-Allowlist führt (`apps/api/src/app.ts`).
Auf einem anderen Port blockiert der Browser die Session-Cookies, und der
Fehler sieht dann fälschlich wie ein Login-Bug aus.

### Testkonten (nur nach `pnpm db:seed`)

Passwort für **alle**: `Test-Passwort-123!`

| E-Mail | Rolle | App |
|---|---|---|
| `schueler@example.test` | schueler | 5173 |
| `buero@example.test` | buero | 5174 |
| `fahrlehrer@example.test` | fahrlehrer | 5175 |
| `finanzen@example.test` | finanzen | 5176 |
| `leitung@example.test` | geschaeftsfuehrung | 5176 |

**Mitarbeitende brauchen zusätzlich einen TOTP-Code** (alle Rollen außer
`schueler`) – so verlangt es `STAFF_ROLES_REQUIRING_MFA`. Den aktuell gültigen
Code liefert:

```bash
node scripts/dev-totp.mjs           # einmal ausgeben
node scripts/dev-totp.mjs --watch   # bei jedem 30-Sekunden-Wechsel neu
```

Alternativ das statische Dev-Secret einmal in eine Authenticator-App
aufnehmen (steht in `packages/database/src/seed.ts`). Ohne Code antwortet der
Login absichtlich mit `mfa_required_or_invalid` – das ist kein Fehler.

### Stolpersteine

- **`pnpm db:seed` ist nicht wiederholbar.** Ein zweiter Lauf bricht mit einer
  Unique-Verletzung ab, weil die Konten schon existieren. Für einen frischen
  Stand die Datenbank neu anlegen (`dropdb`/`createdb`) und `db:migrate`
  erneut ausführen.
- **`apps/api`-Tests brauchen eine existierende Test-Datenbank**
  (`fahrschul_test`, wird von `setup.sh` angelegt). `pnpm test` im Root lädt
  `.env` selbst; wer stattdessen `pnpm -r test` oder `vitest` direkt im
  Paketverzeichnis aufruft, muss `DATABASE_URL_TEST` selbst exportieren –
  `dotenv` sucht relativ zum Arbeitsverzeichnis und findet die Root-`.env`
  dort nicht.
- **Ohne laufenden Scheduler kein Echtzeit-Sync.** `pnpm dev:api` startet die
  wiederkehrenden Jobs (Outbox-Zustellung, Angebotsablauf,
  Konsistenzprüfung); ohne sie bleiben Änderungen in der Outbox liegen. Für
  einen separaten Prozess siehe `apps/api/src/worker.ts` und
  `GET /ops/scheduler`.
- **Alle externen Anbieter sind Mocks** (Bank, E-Mail/Push, Malware-Scanner,
  Kalender, CRM) – siehe `docs/integration-gaps.md`. Ausfallpfade sind echt
  und getestet, die Gegenstellen nicht.

### Tests

```bash
pnpm -r test        # alle Unit-/Integrationstests (Vitest), apps/api braucht Postgres
pnpm -r typecheck   # TypeScript-Prüfung über das gesamte Monorepo
```

`apps/api`'s Tests benötigen `DATABASE_URL_TEST` (siehe `.env.example`) und
prüfen u. a. den Login-Flow, dass Rollen-Middleware falsche Rollen blockiert,
und – am wichtigsten – dass eine zweite, überschneidende Terminbuchung für
denselben Fahrlehrer serverseitig abgelehnt wird (`booking-conflict.test.ts`).
