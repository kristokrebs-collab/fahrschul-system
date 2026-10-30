---
name: spar-befehle
description: >-
  Spar-Befehle für Tokens, Limits und Kosten: /tokens (6 Tipps), /8 (8 Gewohnheiten), /claude-limits (5 Tricks), /kontext (4 Hacks), /gratis (9 bezahlte Tools, die Claude teilweise ersetzt), /geld-sparen (10 Wege), /pareto (80/20). Nutze bei diesen Befehlen sowie bei "Tokens sparen", "Limit erreicht", "Kontext wird voll", "zu teuer", "was kann Claude kostenlos ersetzen". Gibt nur belastbare Praxistipps ohne erfundene Prozentzahlen.
---

# Spar-Befehle

Antworte genau mit der angeforderten Anzahl Punkte, je 1 bis 2 Zeilen, passend zum aktuellen Projekt des Nutzers (konkretes Beispiel aus dem Gespräch, wenn möglich). **Keine Prozentversprechen** ("spart 80 %") und keine Preisangaben aus dem Gedächtnis; Wirkung ist je nach Aufgabe verschieden. Zum Schluss höchstens eine Rückfrage, welcher Punkt zuerst umgesetzt werden soll.

## /tokens (6 Tipps ohne Qualitätsverlust)
1. Ein Thema pro Chat; neue Aufgabe = neuer Chat (`/clear`).
2. Lange Chats mit `/compact` und Fokus-Hinweis kürzen, bevor sie voll sind.
3. Konkrete Dateien und Zeilen nennen statt "schau Dir das Projekt an".
4. Große Ausgaben (Logs, Suchen, Recherche) an einen Subagenten geben; im Hauptchat landet nur das Ergebnis.
5. Ziel und Fertig-Kriterium in einem Satz vorgeben, dann kurze Antwort verlangen.
6. Nur die MCP-Server und Skills aktiv lassen, die das Projekt braucht (jeder lädt Beschreibungen in den Kontext).

## /8 (8 Gewohnheiten)
1. Erst fragen lassen, dann bauen (Rückfragen sind billiger als Umbauten).
2. Plan vor großen Änderungen, Freigabe, dann umsetzen.
3. Dauerregeln in eine kurze `CLAUDE.md`, nicht jedes Mal neu erklären.
4. Dateien gezielt lesen (Zeilenbereich, `grep`) statt ganz.
5. Fehlermeldung vollständig, aber nur die relevante Stelle einfügen.
6. Kleine Schritte committen; bei Fehlschlag zurück statt weiter flicken.
7. Schwere Modelle nur für schwere Aufgaben, Routine mit kleinerem Modell.
8. Ergebnis prüfen lassen (Test, Lint, Screenshot) statt dreimal nachbessern.

## /claude-limits (5 Tricks)
1. Große Aufgaben auf mehrere Fenster verteilen; das Limit zählt Nutzung über ein Zeitfenster, nicht pro Chat.
2. Lange Chats vermeiden: jede Nachricht trägt den ganzen Verlauf mit.
3. Anhänge nur wenn nötig, Text statt Screenshot wo möglich.
4. Mehrere Wünsche in einer Nachricht bündeln statt Hin-und-her.
5. Kurz vor dem Limit: Stand in eine Datei oder Notiz schreiben lassen und im neuen Fenster fortsetzen.

## /kontext (4 Hacks)
1. `/compact` mit Anweisung, was bleiben muss (Entscheidungen, offene Punkte).
2. Wichtiges früh festhalten (`CLAUDE.md`, Notizdatei), nicht im Verlauf vergraben.
3. Recherche und Suche im Subagenten, im Hauptchat nur das Fazit.
4. Alte, erledigte Themen nicht mitschleppen: `/clear` und mit Notiz neu starten.

## /gratis (9 bezahlte Tool-Arten, die Claude teilweise ersetzt)
Teilweise heißt: Entwurf und Routine ja, Spezialfunktionen und Live-Daten nein. Immer sagen, was fehlt.
1. Texthilfen/Korrektur · 2. Übersetzer · 3. Meeting-/Dokument-Zusammenfasser · 4. Einfache Tabellenauswertung (Excel-Formeln, Bereinigung) · 5. Regex-/SQL-/Skript-Helfer · 6. Folien- und Dokument-Entwürfe · 7. Einfache Landingpage-/UI-Prototypen (HTML) · 8. Recherche-Zusammenfassungen (mit Quellen prüfen) · 9. Vorlagen für E-Mails, Angebote, Social-Posts.
Nicht ersetzbar: Buchhaltung mit Rechtssicherheit, Live-Kurse, Rechts-/Steuerberatung, echte Bild-/Videoproduktion.

## /geld-sparen (10 Wege)
1. Abos auflisten lassen und Überschneidungen finden (Du lieferst die Liste).
2. Wiederkehrende Texte als Vorlagen/Skills automatisieren.
3. Angebote und Verträge auf Kostenpunkte durchsehen (keine Rechtsberatung).
4. Tabellen/Belege strukturieren, Zeit bei Buchhaltung sparen.
5. Kleine Skripte statt Zusatzsoftware.
6. Eigene Landingpage-Entwürfe statt Agentur für den ersten Wurf.
7. Support-Antworten als Entwurf vorbereiten.
8. Fehler früh finden (Tests, Review) statt teuer nachträglich.
9. Kleineres Modell für Routine, großes nur für Schwieriges.
10. Vor dem Kauf Alternativen und Kosten vergleichen lassen, Preise selbst prüfen.

## /pareto (80/20)
Auf Wunsch gilt: **20 % Aufwand für das Erstellen** (knapper erster Wurf), **80 % für das Prüfen** (Quellen, Zahlen, Randfälle, Tests, Gegenlesen). Ablauf: Entwurf in wenigen Zeilen, dann Checkliste der 3 bis 5 Stellen, an denen ein Fehler am teuersten wäre, und diese zuerst prüfen. Ergebnis mit "geprüft / nicht geprüft" kennzeichnen.
