# Fremd-Skills in diesem Repo

Unveränderte Kopien; vor der Übernahme gelesen (nur Markdown, kein ausführbarer Code, keine Netzwerk-/Shell-Aufrufe, keine Hooks).

| Skills | Quelle | Stand | Lizenz |
|---|---|---|---|
| frontend-design, responsive-design, web-design-guidelines, local-business-rebuild, design-system-generator | https://github.com/lotfb86/web-design-skills | Commit 81644c1 (2026-04-14) | keine LICENSE-Datei; README: „Use them, adapt them, build on them.“ (informelle Freigabe) |

Bewusst **nicht** übernommen: `04-theme-factory` (gibt es schon als `anthropic-skills:theme-factory`), `05-website-rebuild` und `07-azerbaijan-website-build` (überlappen mit `local-business-rebuild` bzw. nicht relevant).
Aktualisieren: Repo neu klonen, Ordner vergleichen (`diff -r`), dann ersetzen.

## ECC (Everything Claude Code) – nur Auswahl

| Dateien | Quelle | Stand | Lizenz |
|---|---|---|---|
| `.claude/agents/{code-reviewer,a11y-architect,e2e-runner,doc-updater}.md`, `.claude/rules/web/*.md` | https://github.com/affaan-m/everything-claude-code | Commit 90606c8 (2026-10-20) | MIT |

Unveränderte Kopien nach Durchsicht (nur Markdown, keine Hooks, keine Netzwerk-/Shell-Befehle im Text). `e2e-runner` und `doc-updater` dürfen schreiben und Bash nutzen, laufen aber nur auf Abruf.
**Bewusst nicht übernommen:** die 27 ECC-Hooks (laufen bei jedem Tool-Aufruf, Selbst-Update per git pull), `rules/common` (immer aktiv, ~5.000 Tokens pro Sitzung), `rules/react` (Projekt nutzt kein React), die übrigen 67 Agenten und 311 Skills.
Aktualisieren: Repo neu klonen, `diff -r`, ersetzen.

## day-trader-skill (11 trader-* Skills)

| Dateien | Quelle | Stand | Lizenz |
|---|---|---|---|
| `.claude/skills/trader-{scanner,news,entry,exit,timemachine,risk,budget,broker,alerts,analyst,pelosi}/` | https://github.com/Jakeschincariol/day-trader-skill | Commit 3d0f4ef (2026-10-20) | MIT |

Unverändert kopiert (ohne `tests/`). Vorher gelesen: Python nur Standardbibliothek, Netzwerk nur lesend (Yahoo Chart, Nasdaq Trader, SEC EDGAR, House Clerk), `trader-broker/ticket.py` spricht **nie** mit einem Broker (erzeugt nur Tickets). Syntax geprüft, **nicht ausgeführt**. Eigene Ergänzungen (nicht aus der Quelle): `trading-desk`, `morning-note`, `dcf`.
Kronos (https://github.com/shiyu-coder/Kronos, MIT, Commit 67b630e): **nicht** kopiert; nur Setup-Befehl `setup-claude-extras.sh kronos` und `trading-desk/references/kronos.md`.
