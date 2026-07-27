# Betrieb

## Erste Woche

**Tag 1 — Einrichten.**
Schlüssel erzeugen (`keygen`), `.env` füllen, `npm run build`, Konto anlegen,
20–50 wirklich relevante Dokumente nach `./sources/` kopieren, `index` laufen
lassen. Danach **System → Zustand** öffnen und jede Zeile lesen: dort steht,
was funktioniert und was nicht. Im selben Panel Claude verbinden (siehe unten) —
ohne das bleibt JARVIS ein Suchsystem.

**Tag 2 — Suche kalibrieren.**
Stelle im Reiter **Suche** zehn Fragen, deren Antwort du kennst. Achte auf die
Abdeckung: `good` bei bekannten Fakten, `insufficient` bei Dingen, die nicht in
den Unterlagen stehen. Findet er etwas nicht, liegt es fast immer an fehlenden
Dokumenten — nicht an der Suche.

**Tag 3 — Gedächtnis anlegen.**
Sag „Merk dir …“ für fünf bis zehn dauerhafte Dinge (Anrede, Arbeitszeiten,
laufende Entscheidungen). Prüfe jeden Wortlaut vor dem Speichern. So lernst du
den Vorschlagsablauf kennen, bevor er im Alltag wichtig wird.

**Tag 4 — Projekte und Aufgaben.**
Zwei oder drei echte Projekte anlegen, offene Fragen eintragen. Ab jetzt hat das
Briefing Substanz.

**Tag 5 — Bestätigungen erleben.**
Bitte JARVIS, eine Aufgabe anzulegen. Sieh dir die Karte an: Ziel, exakte
Nutzlast, Wirkung, Rückweg. Genau so sieht später eine E-Mail aus, die
tatsächlich rausgeht.

**Tag 6 — Korrigieren.**
Beim ersten Fehler: **Lernen → Korrektur melden**. Retrieval- und
Wissensfehler werden automatisch zu einem Regressionsfall.

**Tag 7 — Absichern.**
`npm run jarvis -- backup`, die Datei vom Rechner wegkopieren, einmal
`audit:verify` laufen lassen. Danach Sicherung in einen Cron.

---

## Laufender Betrieb

Automatisch (stündlich eingeplant, idempotent pro Zeitraum):
Aufbewahrungslauf, tägliche Sicherung, nächtlicher Regressionslauf (offline),
Erzeugung von Verbesserungsvorschlägen, Sitzungsbereinigung, Embedding-Nachlauf.

Manuell sinnvoll:

```bash
npm run jarvis -- status         # ehrlicher Zustand aller Komponenten
npm run jarvis -- eval           # Regression offline, kostenlos
npm run jarvis -- audit:verify   # Integrität der Kette
npm run jarvis -- index          # nach größeren Änderungen an den Quellen
```

---

## Claude verbinden, prüfen, trennen

Der Denkapparat ist zur Laufzeit umschaltbar — kein Codeeingriff, kein Neubau.

```bash
npm run jarvis -- llm:status                # verbunden? Modell? Herkunft des Schlüssels?
npm run jarvis -- llm:connect sk-ant-…      # prüft gegen die API, speichert dann verschlüsselt
npm run jarvis -- llm:test                  # echter Aufruf, sagt was schiefging
npm run jarvis -- llm:disconnect            # zurück in den Quellen-Modus
```

In der Oberfläche: **System → Zustand → „Claude als Denkapparat“**.
Über HTTP: `GET /api/llm`, `POST /api/llm/key`, `POST /api/llm/test`,
`DELETE /api/llm/key` — alle nur für die Rolle `owner`.

Wissenswertes für den Betrieb:

* **Vorrang.** `ANTHROPIC_API_KEY` aus der Umgebung schlägt den gespeicherten
  Schlüssel. Ist die Variable gesetzt, lehnt `POST /api/llm/key` mit `409` ab
  und die Oberfläche zeigt das Feld schreibgeschützt. Damit es genau eine
  Wahrheit gibt.
* **Master-Key nötig.** Ohne `JARVIS_MASTER_KEY` wird das Speichern **verweigert**
  statt den Schlüssel im Klartext abzulegen. Erst `keygen`, dann verbinden.
* **Mitsichern heißt: Master-Key mitsichern.** Eine Sicherung enthält den
  verschlüsselten Schlüssel, aber nicht den Master-Key. Nach einer
  Wiederherstellung auf einem Rechner ohne `JARVIS_MASTER_KEY` ist die
  Verbindung weg und muss neu gesetzt werden.
* **Nie im Klartext lesbar.** Kein Endpunkt und kein Log gibt den Wert zurück;
  überall steht nur `sk-ant-…KJ8s`. Verlorener Schlüssel = neuer Schlüssel in
  der Anthropic-Konsole.
* **Offline-Modus sticht.** Bei `JARVIS_OFFLINE=true` wird kein Modellaufruf
  gemacht, auch mit gültigem Schlüssel. Die Oberfläche weist darauf hin.
* **Wechseln** ist Trennen + Verbinden; der Client wird beim nächsten Zug
  automatisch mit dem neuen Schlüssel neu gebaut, ohne Neustart.

---

## Sicherung und Wiederherstellung

**Sicherung** nutzt `VACUUM INTO`: ein konsistenter Einzeldatei-Schnappschuss im
laufenden Betrieb, ohne WAL-Beiwerk.

```bash
npm run jarvis -- backup          # → data/backups/jarvis-«zeit».db
```

**Wiederherstellung** — Server **vorher stoppen**:

```bash
# 1. Server beenden
# 2. Sicherheitskopie des Ist-Zustands
cp data/jarvis.db data/jarvis.db.vorher
# 3. Einspielen (prüft Schema und Integrität, bevor getauscht wird)
npm run jarvis -- restore data/backups/jarvis-2026-07-27T18-00-00-000Z.db
# 4. Server starten
npm start
```

Der Vorgang lehnt eine Datei ab, die kein JARVIS-Schema hat oder deren
`integrity_check` fehlschlägt.

**Mitsichern:** `.env` gehört an einen sicheren Ort. Ohne `JARVIS_MASTER_KEY`
sind verschlüsselte Erinnerungen aus einem Backup nicht lesbar.

---

## Als Dienst betreiben (systemd)

```ini
# /etc/systemd/system/jarvis.service
[Unit]
Description=JARVIS
After=network.target

[Service]
Type=simple
User=jarvis
WorkingDirectory=/opt/jarvis
EnvironmentFile=/opt/jarvis/.env
ExecStart=/usr/bin/node packages/server/dist/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/jarvis/data /opt/jarvis/sources

[Install]
WantedBy=multi-user.target
```

TLS davor (Caddy):

```
jarvis.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Erst mit HTTPS funktioniert die Spracheingabe außerhalb von `localhost`.

---

## Störungssuche

| Symptom | Ursache | Abhilfe |
|---|---|---|
| „Kein Anthropic-API-Schlüssel konfiguriert“ | erwartet ohne Schlüssel | `llm:connect` oder System → Zustand → Verbinden |
| Verbinden schlägt fehl mit „Schlüssel ungültig“ | 401/403 von der API | Schlüssel in der Anthropic-Konsole prüfen; ganze Zeile kopieren, ohne Leerzeichen |
| Verbinden schlägt fehl mit „Modell nicht verfügbar“ | 404 auf `JARVIS_LLM_MODEL` | Modellnamen prüfen; Konto braucht Zugriff auf `claude-opus-5` |
| Verbunden, aber keine freien Antworten | `JARVIS_OFFLINE=true` | Variable auf `false`, Neustart |
| Nach Wiederherstellung ist Claude getrennt | Master-Key fehlt auf dem Zielrechner | `JARVIS_MASTER_KEY` aus der alten `.env` übernehmen, sonst neu verbinden |
| Erinnerung mit `private` wird abgelehnt | kein Master-Key | `keygen`, `JARVIS_MASTER_KEY` setzen |
| Embeddings zeigen „degraded“ | `local-lexical` aktiv | Ollama einrichten für echte Semantik |
| Suche findet nichts | nichts indexiert oder Datei außerhalb der Wurzeln | `index:stats`, `JARVIS_SOURCE_ROOTS` prüfen |
| Mikrofon-Button inaktiv | kein HTTPS, oder Firefox | TLS davor; Push-to-Talk braucht Chrome/Safari |
| „Anfrage ohne Client-Kennung abgelehnt“ | CSRF-Schutz greift | Über die App aufrufen; Skripte senden `x-jarvis-client` |
| Jobs stehen auf `dead` | Handler schlug 5× fehl | **System → Jobs**, `last_error` lesen |
| „Kette gebrochen“ im Audit | Datenbank wurde direkt verändert | Aus Sicherung wiederherstellen, Ursache klären |
| Antwort behauptet etwas ohne Beleg | Abdeckung war `insufficient` | **Lernen → Korrektur melden**; wird Regressionsfall |
| Aktion steht auf „Ausgang unbekannt“ | Absturz während der Ausführung | Manuell prüfen, ob die Wirkung eintrat |

---

## Aktualisierung

```bash
git pull
npm install
npm run build
npm test                      # muss grün sein
npm run jarvis -- eval        # Regression gegen die echten Quellen
npm run jarvis -- backup      # vor dem Neustart
# Dienst neu starten
```

Das Schema wird beim Start idempotent angewendet; laufende Jobs und
angefangene Aktionen werden beim Start sauber wiederhergestellt.
