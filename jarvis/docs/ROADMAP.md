# 30-Tage-Plan und offene Entscheidungen

## Entscheidungen, die dir gehören

Diese sind bewusst offengelassen, weil sie von deinen Daten und deinem
Risikoappetit abhängen — nicht von der Technik.

**1. Embedding-Anbieter.**
Standard ist `local-lexical`: sofort einsatzbereit, nichts verlässt den Rechner,
aber ohne Synonymverständnis. Für echte Semantik gibt es zwei Wege — Ollama
(lokal, empfohlen) oder Voyage/OpenAI (besser, aber Textausschnitte gehen an
einen Anbieter). Bei Fahrschul- und Gesundheitsunterlagen spricht viel für Ollama.

**2. Welche Ordner indexiert werden.**
`JARVIS_SOURCE_ROOTS` steht auf `./sources`. Sinnvoll ist ein bewusst kuratierter
Ordner statt „mein ganzes Home-Verzeichnis“ — die Suche wird präziser und die
Angriffsfläche für Prompt-Injection kleiner.

**3. E-Mail: entwerfen oder senden?**
`draft_email` existiert und schreibt nur lokal. `send_email` ist als Werkzeug
registriert, aber ohne SMTP-Integration blockiert. Bevor das freigeschaltet wird:
willst du überhaupt, dass JARVIS senden **kann**? Der Entwurfsweg deckt die
meisten Fälle ab, ohne das Risiko.

**4. Erreichbarkeit.**
Nur `localhost` (heute), Tailscale/WireGuard (empfohlen fürs Handy), oder
öffentlich mit TLS und TOTP. Bei Option 3 ist Zwei-Faktor Pflicht.

**5. Schnittstellen der Schwestersysteme.**
Die Adapter erwarten `/api/status`, `/api/summary` und zwei domänenspezifische
Lesepfade, die JSON liefern. Sobald du die realen Pfade nennst, wird die
Allowlist in `src/adapters/sibling.ts` angepasst — mehr ist nicht nötig.

**6. Aufbewahrungsfrist.**
30 Tage bis zum endgültigen Löschen weich gelöschter Erinnerungen. Kürzer ist
datensparsamer, länger verzeiht Fehlbedienung.

---

## Tage 1–10: aus der Nutzung lernen

* Täglich nutzen und **jede** Ungenauigkeit über *Lernen → Korrektur melden*
  erfassen. Nach zwei Korrekturen derselben Kategorie entsteht automatisch ein
  Verbesserungsvorschlag.
* Regressionsfälle auf 15–20 ausbauen — besonders für Fragen, die eine
  **Enthaltung** erzwingen sollen. Falsche Sicherheit ist teurer als Nichtwissen.
* Ollama einrichten und dieselben zehn Fragen vorher/nachher vergleichen.
* Entscheiden, welche `memory_rules` sinnvoll sind (etwa: Präferenzen mit
  Vertraulichkeit `internal` automatisch übernehmen).

## Tage 11–20: Integrationen mit Substanz

* **Kalender (CalDAV, nur lesen).** Ein Leseadapter macht das Briefing sofort
  deutlich wertvoller und ist risikoarm.
* **Schwestersysteme anschließen**, sobald die Endpunkte stehen — inklusive eines
  Konformitätstests gegen einen lokalen Stub, damit der Adapterpfad tatsächlich
  durchlaufen wird.
* **E-Mail lesen (IMAP, nur lesen).** Achtung: E-Mails sind der klassische
  Injection-Vektor. Sie werden als `trust: third_party` indexiert und laufen
  durch dieselbe Erkennung wie Webinhalte.
* **PDF-OCR** für eingescannte Dokumente (`ocrmypdf` als Vorstufe).

## Tage 21–30: schärfen

* **Retrieval evaluieren.** Mit 20 Fällen lässt sich messen, ob eine Änderung an
  Chunk-Größe, Aktualitätsgewicht oder Relevanzschwelle wirklich hilft. Erst
  messen, dann ändern.
* **Prompt-Versionen erproben.** Neue Fassung anlegen, Regression laufen lassen,
  vergleichen, aktivieren. Rollback ist derselbe Handgriff.
* **Sprachprofil.** Stimme und Sprechtempo festlegen; bei täglicher Nutzung des
  Briefings per Sprache lohnt sich das schnell.
* **Wissenskarte kuratieren.** Ordnerbeziehungen sind ein grober Standard —
  explizite Verknüpfungen zwischen Projektunterlagen verbessern das
  beziehungsbasierte Ranking spürbar.

---

## Bewusst nicht geplant

* **Wake-Word.** Eine dauerhaft mithörende Browser-Spracherkennung streamt Audio
  laufend an einen Cloud-Dienst. Das widerspricht dem Zweck dieses Systems.
  Wenn es kommt, dann mit lokaler Keyword-Erkennung auf dem Gerät.
* **Autonome Aktionen ohne Bestätigung.** Die Bestätigungspflicht ist das
  Fundament, nicht eine Reibung, die man wegoptimiert.
* **Selbständiges Ausrollen eigener Prompt-Änderungen.** JARVIS darf vorschlagen
  und bewerten. Aktiv wird nichts ohne deine Freigabe.
* **Zusammenlegen der drei Systeme.** Getrennte Datenbanken und Zugangsdaten sind
  der Grund, warum ein Fehler in einem System die anderen nicht mitreißt.
