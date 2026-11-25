---
name: morning-note
description: >-
  /morning-note: kompaktes Morgenbriefing für Aktienmärkte. Nutze bei "Morgenbriefing", "morning note", "was ist heute wichtig", "Markt-Update", "Pre-Market" oder zu Beginn eines Handelstags. Holt Indizes/Futures, Watchlist-Bewegung, heutige Earnings/Wirtschaftstermine und neue Meldungen aus freien Quellen (TradingView-Konnektor, sonst Yahoo/SEC über trader-news), nennt Quelle und Zeit, erfindet nichts. Kein Trade-Vorschlag, keine Finanzberatung.
---

# /morning-note

Vorher kurz fragen, falls unklar: Märkte (US/EU), Watchlist (sonst `trader/watchlist.json`), Zeitzone (Standard Europe/Berlin).

**Daten (in dieser Reihenfolge, die erste verfügbare):**
1. TradingView-Konnektor (`mcp-tv-get-symbol-data-batch`, `get-economic-calendar`, `get-earnings-calendar`, `get-news`)
2. `python3 "${CLAUDE_SKILL_DIR}/../trader-news/news.py"` (Yahoo-Schlagzeilen, SEC-8-K) und `"${CLAUDE_SKILL_DIR}/../trader-alerts/alerts.py"` für Kurse
3. Nichts verfügbar → sagen, dass Daten fehlen; keine Zahlen aus dem Gedächtnis.

**Format (max. eine Bildschirmseite):**
1. **Überblick** (2 Sätze): Stimmung, was den Tag prägt
2. **Märkte**: S&P 500, Nasdaq, DAX, 10J-Rendite, USD/EUR, Öl, VIX: Stand und Veränderung, Zeitstempel
3. **Watchlist**: nur Titel mit |Δ| ≥ 2 % oder frischer Meldung, je eine Zeile mit Grund
4. **Termine heute**: Earnings, Makrodaten (Uhrzeit Europe/Berlin)
5. **Risiken / worauf achten**: 2 bis 3 Punkte

Jede Zahl mit Quelle und Abrufzeit. Zum Schluss: *Keine professionelle Finanzberatung.* Aus dem Briefing folgt nie automatisch eine Order (siehe `trading-desk`).
