# Prototype Audit

Analysiert: `app.html` (3224 Zeilen, Schüler-App), `dashboard.html` (2166 Zeilen,
Büro-Zentrale), `cockpit-pro.html` (586 Zeilen, Marketing/Fahrzeug-Konfigurator),
`fahrlehrer.html` (566 Zeilen, Fahrlehrer-App), `server.py` (318 Zeilen, Sync-Server).

**Gap:** `finanzen-1.html` ist im Repository nicht vorhanden. Es gibt kein
Finanz-/Flotten-Cockpit-Referenzdokument. Prompt 4 muss daher ohne HTML-Referenz
direkt aus dem Datenmodell und den KPI-Anforderungen entwickelt werden
(siehe `docs/integration-gaps.md`).

## Vorhandene Funktionen (referenzwürdig für UX/Fachlichkeit)

### app.html – Schüler-App
- Registrierung, Login, "angemeldet bleiben"
- Klassenwahl (B, BE, A, A1, A2, AM, C, CE, D …) mit klassenabhängigem Ausbildungsweg
- Ausbildungs-Cockpit: Theorie-Fortschritt, Übungsstunden, Sonderfahrten-Zähler
- Wunschzeiten-Matrix (6 Wochen × Tag × Periode)
- Onboarding-Verfügbarkeit direkt nach Klassenwahl (aus dieser Session ergänzt)
- Sehtest/Erste-Hilfe/Passbild-Upload (als Base64 im Client-State)
- Termine & Historie, Fahrstil-Feedback-Anzeige
- Tacho-Gauge für Gesamt-Prüfungsreife (aus dieser Session ergänzt)
- Rechnungsübersicht (nur lesend)

### dashboard.html – Büro-Zentrale
- Zugangscode-Gate (statischer PIN `1234`, Zeile 713)
- Schülerliste mit Suche/Sortierung/Filter, Schüler-Akte
- Smart-Matching-Vorschläge aus Wunschzeiten × Fahrlehrer-Dienstplan
- Überbuchungsschutz (rein clientseitig berechnet)
- KI-Lücken-Filler im Auto-Matching (aus dieser Session ergänzt)
- Aktivitäts-Feed, Ausfall-Alarm ("Heute krank"-Auswertung)
- CSV-Export
- Tacho/Ring-Visualisierung für Prüfungsreife (aus dieser Session ergänzt)

### fahrlehrer.html – Fahrlehrer-App
- Tagesplan (wer/wann/wo/Fahrtart) mit Anruf-Link und Navigations-Link
- Fahrstil-Bewertung beim Bestätigen einer Fahrt
- Arbeitszeiten-Pflege als Matching-Basis (grobe Tagesperioden, kein exaktes Zeitraster)
- "Heute krank"-Panikknopf
- Historie mit Abrechnungs-Status

### cockpit-pro.html / website.html
- Marketing-/Landingpage-Charakter, Fahrzeug-Konfigurator als Showcase
- Keine Produktionslogik, keine echten Daten

### server.py
- `http.server`-basierter Mini-Server, liefert statische Dateien aus
- `/sync/all`, `/sync/pull`, `/sync/push`, `/sync/admin` – JSON-Datei
  (`sync-data.json`) als einzige "Datenbank", rollenbasiertes Merge mit
  Compare-and-Swap (`baseRev`), aus vorheriger Session gehärtet
- Kein Auth, kein TLS, kein Prozess-Manager, kein Connection-Pooling

## Demo-Daten / fest codierte Regeln

| Fundstelle | Inhalt | Risiko |
|---|---|---|
| `dashboard.html:713` | `ADMIN_PIN='1234'` | Statischer Demo-Zugang, kein echtes Konto |
| `dashboard.html:757` | `const INSTRUCTORS=[...]` (15 Fahrlehrer fest codiert) | Keine echte Stammdatenverwaltung |
| `fahrlehrer.html:211` | Duplikat derselben `INSTRUCTORS`-Liste | Datenverdopplung, Inkonsistenzrisiko |
| `react-zentrale/src/data.js:3` | Dritte Kopie derselben Liste | Drei Wahrheiten für dieselben Stammdaten |
| `dashboard.html` `seedStudents()` | Generierte Demo-Schüler beim ersten Start | Keine echte Anmeldung/Lead-Quelle |
| App-weit | Keine Fahrzeuge, Räume, Standorte als Entitäten – nur Klassen-Strings | Fehlendes Ressourcenmodell |
| App-weit | Keine echten Preise/Produkte – Beträge werden pro Buchung frei erzeugt | Keine Preislisten-Governance |

## Lokale Datenspeicher (Produktivdaten im Client)

- `localStorage` in allen vier HTML-Apps: Sitzungsstatus, Profil, Schülerliste,
  Notizen, Zuweisungen (`ADMIN_KEY`, `ASSIGN_KEY`, `NOTES_KEY`, `STATE_KEY`,
  `PROFILE_KEY` u.a.)
- Dokumente (Sehtest, Erste-Hilfe-Nachweis, Passbild) werden als Base64 in den
  App-State geschrieben, der wiederum über `localStorage`/JSON-Datei
  persistiert – dauerhafte Dokumentenablage im Browser/Klartext-JSON
- `sync-data.json` neben dem Server ist die einzige serverseitige
  Persistenz – eine flache JSON-Datei ohne Transaktionen, Indizes oder
  Zugriffskontrolle

## Cross-App-Kopplung

- `BroadcastChannel` (`app.html:3096`, `dashboard.html:1056`) für
  Same-Origin-Tab-Sync
- `postMessage`-Brücke (`app.html:3106`, `dashboard.html:1091`) für die in
  die Zentrale eingebettete Schüler-App – kein Origin-Check erkennbar an den
  zitierten Stellen, Ziel `window.parent.postMessage(...)`
- Echte Geräteübergreifende Synchronisation läuft aktuell nur über den
  Python-Mini-Server (`/sync/*`), nicht über BroadcastChannel/postMessage

## Wiederverwendbare UI-Bestandteile (Design-DNA, produktionswürdig)

- Farbsystem, Typografie, Card-/Panel-Layout aus `dashboard.html`/`app.html`
  (bereits als CSS-Variablen in `react-zentrale/src/index.css` extrahiert)
- Tacho-Gauge-Komponente (240°-SVG-Gauge) – gut isolierbar für `packages/ui`
- Bottom-Nav-Pattern der Schüler-/Fahrlehrer-App – Vorlage für
  `apps/student`, `apps/instructor`
- Karten-/Listen-/Detail-Split-Pattern der Zentrale – Vorlage für `apps/office`

## Fazit

Die vier HTML-Dateien sind ein funktionaler und gestalterischer Prototyp mit
korrekt durchdachten fachlichen Abläufen (Matching, Storno-Handling,
Fahrstil-Feedback), aber ohne jede produktionsfähige Persistenz-, Auth- oder
Rechteschicht. Sie dienen in Prompt 1–4 als UX-/Fachlogik-Referenz, nicht als
Code-Basis.
