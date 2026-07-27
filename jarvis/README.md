# JARVIS — persönlicher Assistent mit Quellenbeleg

Ein selbst gehosteter Sprach- und Text-Assistent, der auf **deine** Dokumente antwortet
und dabei immer zeigt, woher eine Aussage stammt. Läuft auf Desktop, Tablet und Handy.

> **Eigenständiges System.** JARVIS ist bewusst von den beiden Schwestersystemen
> (Fahrschule-Krebs-Social-Autopilot, Finance & Crypto Intelligence) getrennt:
> eigene Datenbank, eigene Zugangsdaten, eigene Fehlerdomäne. Es liest aus den
> anderen ausschließlich über dokumentierte, **schreibgeschützte** Adapter.
> Siehe [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → Systemgrenzen.

---

## Was es kann

| Fähigkeit | Zustand |
|---|---|
| Antworten aus privaten Dokumenten, mit Quelle **und** Fundstelle | ✅ |
| Hybride Suche: Volltext (BM25) + Vektoren + Aktualität + Beziehungen | ✅ |
| Erkennt ersetzte Fassungen und widersprüchliche Angaben | ✅ |
| Dauerhaftes Gedächtnis mit Vorschlag → Bestätigung → Korrektur → Löschen | ✅ |
| Vertrauliche Erinnerungen verschlüsselt (AES-256-GCM) | ✅ |
| Projekte, Aufgaben, Tagesbriefing inkl. „blinder Fleck“ | ✅ |
| Bestätigungspflicht für alles, was nach außen wirkt oder löscht | ✅ |
| Prompt-Injection-Abwehr mit Gating (getestet) | ✅ |
| Sprache: Push-to-Talk-Eingabe + Sprachausgabe im Browser | ✅ |
| Live-Websuche mit Zitaten (Anthropic-Server-Tools) | ✅ (braucht API-Schlüssel) |
| Manipulationssicheres Audit-Log, Backups, Jobs, Health | ✅ |
| Lernschleife: Korrekturen → Regressionstests → Vorschläge → Freigabe | ✅ |
| E-Mail-Versand, Kalender, IMAP | ⛔ nicht enthalten — siehe [Grenzen](#bekannte-grenzen) |
| Wake-Word („Hey JARVIS“) | ⛔ bewusst nicht — siehe [Grenzen](#bekannte-grenzen) |
| OCR für Bildinhalte | ⛔ nur Bild-Metadaten |

---

## Schnellstart

```bash
cd jarvis
npm install

# 1) Schlüssel erzeugen und in .env eintragen
cp .env.example .env
node packages/server/dist/cli.js keygen   # oder: npx tsx packages/server/src/cli.ts keygen
#   → JARVIS_MASTER_KEY und JARVIS_SESSION_SECRET in .env eintragen

# 2) Bauen
npm run build

# 3) Benutzerkonto anlegen
npm run jarvis -- user:create michael 'EinLangesPasswort123' owner

# 4) Dokumente ablegen und einlesen
cp -r ~/meine-notizen/* ./sources/
npm run jarvis -- index

# 5) Starten
npm start
```

Öffne **http://127.0.0.1:8787**.

### Entwicklungsmodus

```bash
npm run dev:server   # Backend auf :8787 mit Hot-Reload
npm run dev:web      # Vite auf :5173, proxied /api → :8787
```

---

## Ohne API-Schlüssel nutzbar

Ohne `ANTHROPIC_API_KEY` läuft JARVIS im **Quellen-Modus**: Suche, Zitate,
Widerspruchserkennung, Erinnerungen, Aufgaben, Briefing und alle Freigaben
funktionieren vollständig. Was fehlt, ist die frei formulierte Antwort — und
genau das sagt JARVIS dann auch, statt etwas zu erfinden.

Mit Schlüssel: `ANTHROPIC_API_KEY=sk-ant-…` in `.env`, Neustart.
Standardmodell ist `claude-opus-5`.

---

## Embeddings wählen

`JARVIS_EMBEDDINGS` steuert die semantische Suche:

| Wert | Qualität | Daten verlassen den Rechner? | Hinweis |
|---|---|---|---|
| `local-lexical` (Standard) | lexikalisch | nein | Sofort einsatzbereit, ohne Download. Findet Wortverwandtschaft und Tippfehler, **keine Synonyme**. |
| `ollama` | semantisch | nein | Empfohlen. `ollama pull nomic-embed-text` genügt. |
| `voyage` / `openai` | semantisch | ja | Textausschnitte gehen an den Anbieter. |
| `none` | — | nein | Nur Volltextsuche. |

Der Systemzustand zeigt die aktive Stufe ehrlich an — `local-lexical` erscheint
bewusst als **„degraded“**, weil es kein neuronales Modell ist.

---

## Verwaltung über die Kommandozeile

```bash
npm run jarvis -- status         # Systemzustand aller Komponenten
npm run jarvis -- briefing       # Tagesbriefing im Terminal
npm run jarvis -- index --force  # alles neu indexieren
npm run jarvis -- eval           # Regressionstests (offline, kostenlos)
npm run jarvis -- audit:verify   # Hash-Kette des Audit-Logs prüfen
npm run jarvis -- backup         # Sicherung erstellen
npm run jarvis -- restore <datei>  # Sicherung einspielen (Server vorher stoppen)
npm run jarvis -- retention      # Aufbewahrungsregeln anwenden
```

---

## Tests

```bash
npm test          # 104 Tests: Sicherheit, Suche, Zuverlässigkeit, Gedächtnis, Auth
npm run typecheck # alle drei Pakete
```

Abgedeckt sind unter anderem: Prompt-Injection-Erkennung **und** -Gating,
Blockade von Geheimnis-Leaks in Nutzlasten, Wiederherstellung nach Absturz
(Jobs und Aktionen), Verschlüsselung ruhender Daten, Kontosperrung,
Manipulationserkennung im Audit-Log, Enthaltung bei fehlender Abdeckung.

---

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Aufbau, Architekturentscheidungen (ADR), Systemgrenzen |
| [`docs/PERMISSION-MATRIX.md`](docs/PERMISSION-MATRIX.md) | Werkzeuge, Risikoklassen, Bestätigungsregeln, Rollen |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Bedrohungsmodell, Injection-Abwehr, Datenschutz-Leitfaden |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Betrieb, Backup/Restore, Störungssuche, erste Woche |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 30-Tage-Plan und offene Entscheidungen |

---

## Bekannte Grenzen

Bewusst ehrlich, statt als „kommt später“ versteckt:

1. **Kein E-Mail-Versand.** `send_email` ist als Werkzeug registriert, damit die
   Risikoklasse und die Bestätigungspflicht getestet sind — es gibt aber keine
   SMTP-Integration. Die Sicherheitsprüfung blockiert den Aufruf mit
   `integration_missing`; JARVIS meldet niemals einen Versand, der nicht stattfand.
2. **Kein Kalender, kein IMAP.** Gleiches Muster: erst Adapter bauen, dann Werkzeug freischalten.
3. **Kein Wake-Word.** Eine dauerhaft mithörende Browser-Spracherkennung streamt
   Audio laufend an einen Cloud-Dienst. Das widerspricht dem Versprechen dieses
   Systems. Push-to-Talk ist der Standard.
4. **Kein OCR.** Bilder sind über Dateiname und Metadaten auffindbar, nicht über
   ihren gedruckten Text. PDFs ohne Textebene werden als solche markiert.
5. **`local-lexical` ist kein semantisches Modell.** Es findet „Fahrschule“ ↔
   „Fahrschulverwaltung“, aber nicht „Auto“ ↔ „Fahrzeug“. Für echte Semantik:
   Ollama oder Voyage.
6. **Injection-Erkennung ist eine Heuristik.** Sie ist eine Stolperdraht- und
   Audit-Funktion. Die eigentliche Grenze ist das Gating (siehe `docs/SECURITY.md`).
7. **Brute-Force-Vektorsuche.** Exakt und schnell bis ~100 000 Abschnitte. Darüber
   wird ein ANN-Index nötig — siehe ADR-3.
8. **Ein-Personen-System.** Rollen `owner`/`guest` existieren, aber es gibt keine
   Mandantentrennung.
