# Fahrschule Krebs — Social Media Autopilot

Kommandozentrale für Recherche, Planung, Produktion, **Freigabe**, Veröffentlichung,
Auswertung und Verbesserung der Social-Media-Arbeit der Fahrschule Krebs GmbH
(Fulda und Bad Hersfeld).

Der zentrale Satz zuerst: **Ohne ausdrückliche Freigabe des Inhabers wird nichts
öffentlich.** Das ist keine Einstellung, sondern dreifach abgesichert — in der
Servicelogik, über einen an den Inhalt gebundenen Hash und über einen
Datenbank-Trigger, der auch bei einem Fehler in der Anwendungsschicht hält.

---

## In 5 Minuten lauffähig

Voraussetzung: **Node.js ≥ 22.5** (bringt `node:sqlite` mit — keine native
Kompilierung, keine externe Datenbank nötig).

```bash
# 1. Abhängigkeiten
npm install

# 2. Konfiguration anlegen
cp .env.example .env

# 3. Schlüssel erzeugen und in .env eintragen
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))" >> .env
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))" >> .env

# 4. Erstes Inhaber-Konto festlegen (in .env eintragen)
#    BOOTSTRAP_OWNER_EMAIL=inhaber@fahrschule-krebs.de
#    BOOTSTRAP_OWNER_PASSWORD=<mindestens 12 Zeichen>

# 5. Bauen, Grunddaten anlegen, Medienarchiv importieren
npm run build
npm run seed
npm run import:higgsfield

# 6. Starten
npm start
```

Danach erreichbar unter **http://localhost:8080**. Anmeldung mit den unter
`BOOTSTRAP_OWNER_*` gesetzten Daten; das Passwort danach unter *Einstellungen*
ändern.

### Sofort prüfen, ob alles funktioniert

```bash
npm test        # 85 automatisierte Tests
npm run e2e     # kompletter Praxislauf gegen das kontrollierte Testziel
```

Der Praxislauf geht den ganzen Weg durch: Asset freigeben → recherchieren →
planen → produzieren → prüfen → freigeben → zustellen → Zustellung
verifizieren → Kennzahlen → zwei getrennte Bewertungen → Lead zuordnen →
Postmortem → Lernbericht → Sicherung. Er beweist auch die Gegenprobe: ein
absichtlich schlechter Beitrag wird blockiert, und eine Änderung nach der
Freigabe entwertet die Freigabe.

---

## Was das System tut

| Bereich | Inhalt |
|---|---|
| **Marken-Wissensbasis** | Jede Tatsache trägt `VERIFIED`, `NEEDS_OWNER_CONFIRMATION` oder `EXPIRED`. Nur `VERIFIED` darf behauptet werden. |
| **Medienarchiv** | Rechte- und Einwilligungsstatus pro Asset, automatische Datenschutz-Vorprüfung, erklärbare Suche. |
| **Recherche** | Themenchancen, bewertet auf zehn Dimensionen; Risiken zählen negativ. |
| **Planung** | Rollender Wochenplan mit Formatmischung und Sättigungsausgleich. |
| **Produktion** | Vollständiges Veröffentlichungspaket: 3 Hooks, Skript, Schnittliste, Untertitel, Text, Cover, Alt-Text, CTA, Story-Folge, Plan für die erste Stunde. |
| **Prüfung** | Fünf Agenten, vier davon mit Vetorecht. Deterministische Regelwerke, kein LLM. |
| **Freigabe** | Freigabekarte mit Vorschau, Rechte- und Faktenprüfung, offenen Risiken, Versionsverlauf. |
| **Versand** | Idempotent, neustartfest, mit Backoff, Dead-Letter-Queue und Zustellprüfung beim Anbieter. |
| **Posteingang** | Klassifikation, Antwortentwürfe (nie ohne Freigabe gesendet), Lead-Pipeline. |
| **Analyse** | **Zwei getrennte Bewertungen**: Virality Score und Business Impact Score. Keine Gesamtnote. |
| **Experimente** | Eine Variable, Mindeststichprobe, Störgrößen werden ungefragt benannt. |
| **Lernen** | Postmortem, versionierte Änderungsvorschläge, Regressionstests, Rollback. |

---

## Nützliche Befehle

| Befehl | Zweck |
|---|---|
| `npm run build` | TypeScript übersetzen |
| `npm start` | Dienst starten |
| `npm test` | Testsuite |
| `npm run e2e` | Durchgehender Praxislauf |
| `npm run migrate` | Migrationen anwenden und Schemastand zeigen |
| `npm run seed` | Grunddaten (idempotent) |
| `npm run import:higgsfield` | Higgsfield-Archiv ins Medienarchiv importieren |
| `npm run backup` | Konsistente Sicherung mit Prüfsumme |
| `npm run restore -- <datei.db>` | Sicherung zurückspielen (prüft vorher die Prüfsumme) |

---

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) | Aufbau, Entscheidungen und ihre Begründung |
| [`docs/BETRIEB.md`](docs/BETRIEB.md) | Betriebshandbuch für den Inhaber: erste Woche, Störungen, Sicherung |
| [`docs/SICHERHEIT-DATENSCHUTZ.md`](docs/SICHERHEIT-DATENSCHUTZ.md) | Sicherheits- und Datenschutzprüfung, DSGVO-Annahmen |
| [`docs/GRENZEN.md`](docs/GRENZEN.md) | **Was das System nicht kann** — ohne Beschönigung |
| [`docs/ROLLOUT-30-TAGE.md`](docs/ROLLOUT-30-TAGE.md) | 30-Tage-Einführungsplan |
| [`docs/ENTSCHEIDUNGEN.md`](docs/ENTSCHEIDUNGEN.md) | Offene Punkte, die der Inhaber entscheiden muss |

---

## Aufbau

```
src/
  config/         Konfiguration; einzige Stelle, die Secrets liest
  db/             Schema als versionierte Migrationen, Query-Helfer
  security/       Kryptographie, Authentifizierung, Rollen
  domain/         Marke, Medien, Inhalte, Freigabe, Analyse, Experimente,
                  Posteingang, Lernen
  agents/         15 Fachrollen + Orchestrator; Prüfer als Regelwerke
  integrations/   Instagram, Facebook, TikTok, YouTube, Sandbox
  queue/          Persistente Veröffentlichungs-Warteschlange
  workers/        Zeitplan für Hintergrundaufgaben
  routes/         HTTP-API
  tests/          85 automatisierte Tests
  cli/            seed, import, backup, restore, e2e, migrate
web/              PWA ohne Build-Schritt (ES-Module)
docs/             Dokumentation
data/seed/        Higgsfield-Archivexport (30 Objekte)
```

## Lizenz und Nutzung

Internes Werkzeug der Fahrschule Krebs GmbH. Nicht zur Weitergabe bestimmt.
