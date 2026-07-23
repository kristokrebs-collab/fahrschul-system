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

### Setup

```bash
pnpm install
cp .env.example .env        # anpassen, falls eigene DB-Zugangsdaten nötig
docker compose up -d        # startet lokalen Postgres-Container
# Alternative ohne Docker: eine lokale Postgres-Instanz mit denselben
# Zugangsdaten aus .env (Rolle "fahrschul", DBs "fahrschul_dev"/"fahrschul_test")

pnpm db:migrate              # wendet packages/database/migrations/*.sql an
pnpm db:seed                 # NUR lokale Testdaten, siehe packages/database/src/seed.ts

pnpm dev:api                 # startet apps/api auf http://localhost:4000 (/health)
pnpm --filter @fahrschul/student dev    # Vite-Dev-Server für die Platzhalter-Apps
pnpm --filter @fahrschul/office dev
pnpm --filter @fahrschul/instructor dev
pnpm --filter @fahrschul/finance dev
```

### Tests

```bash
pnpm -r test        # alle Unit-/Integrationstests (Vitest), apps/api braucht Postgres
pnpm -r typecheck   # TypeScript-Prüfung über das gesamte Monorepo
```

`apps/api`'s Tests benötigen `DATABASE_URL_TEST` (siehe `.env.example`) und
prüfen u. a. den Login-Flow, dass Rollen-Middleware falsche Rollen blockiert,
und – am wichtigsten – dass eine zweite, überschneidende Terminbuchung für
denselben Fahrlehrer serverseitig abgelehnt wird (`booking-conflict.test.ts`).
