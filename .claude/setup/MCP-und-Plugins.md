# MCP-Server und Plugins aus Deiner Liste: was ist drin, was nicht

Alles hier läuft auf **Deinem Rechner**. Die Cloud-Sitzung blockiert fremde Hosts und hat keine Schlüssel. Stand 2026-10-25; Repos geklont und gelesen, **nichts davon ausgeführt**.

## Im Repo als Skills (`.claude/skills/`, unveränderte Kopien, Herkunft in `THIRD_PARTY.md`)
`algorithmic-art`, `canvas-design`, `slack-gif-creator`, `webapp-testing` (anthropics/skills, Apache-2.0) · `taste-skill` (MIT) · `hallmark` (MIT) · `ui-ux-pro-max` (MIT, nur dieser eine Skill, ohne die Gemini-Bildgeneratoren) · `llm-council` (MIT).
`taste-skill` und `hallmark` sind zwei konkurrierende „Anti-Slop“-Regelwerke: pro Projekt **eines** nutzen, sonst widersprechen sie sich.

## Als Plugin auf Deinem Rechner (nicht ins Repo kopiert)
| Name | Warum nicht kopiert | Befehl (in Claude Code) |
|---|---|---|
| obra/superpowers (MIT) | bringt 6 Hooks mit, die bei jeder Sitzung laufen | `/plugin marketplace add obra/superpowers` und Installationsweg in dessen README folgen |
| tt-a1i/archify | 103 MB, eigene Node-CLI | Installationsweg in dessen README |
Vorher die README lesen. Hooks können mit Deinem Stop-Hook kollidieren.

## Nicht installiert, mit Grund
- **GSD (glittercowboy/get-shit-done)**: ein Installer mit rund 10.000 Zeilen und 17 Hooks, der in `~/.claude` schreibt. Der in Deiner Liste genannte Link „Taches/get-shit-done“ existiert nicht. Nur nach gesonderter Prüfung auf Deinem Rechner.
- **wcgw (Shell-Vollzugriff)**: Claude Code hat schon eine Shell, ein zweiter Zugang ist nur zusätzliches Risiko.
- **Postgres-MCP**: nur mit eigenem **Read-only-Datenbankbenutzer** und nie mit Produktionsdaten der Fahrschule; das Paket `@modelcontextprotocol/server-postgres` gilt als veraltet.
- **Cloud-Browser mit CAPTCHA-Lösen, Preis-Scraper mit automatischer Preisänderung/Mailversand, automatisches Social-Posting**: widersprechen Deiner Regel „keine Aktion ohne manuelles Ja“ und kollidieren mit Wettbewerbs- und Datenschutzrecht (DSGVO bei Mails). Wenn überhaupt, dann nur als Entwurf mit Freigabe (n8n/Composio mit „Needs approval“).
- **Token-Sparer „claude-token-saver“ (70–80 %)**: Zahl nicht belegt, Repo nicht auffindbar. Nutze stattdessen `spar-befehle`.
- Der Snippet „antworte NIEMALS mit Einleitung/Erklärung“ spart Tokens, kostet aber Nachvollziehbarkeit bei Fehlern; nicht als Dauerregel gesetzt.

## MCP-Server (Vorlage `mcp.example.json`)
Playwright (`@playwright/mcp`), Exa-Suche (braucht `EXA_API_KEY` als Umgebungsvariable), Glance (Browser-Automation, `glance-mcp`), Repomix (Repo-Map, `--mcp`). Versionen festgenagelt; npm-Pakete laufen mit Deinen Rechten, also vorher die READMEs lesen. Pro Projekt nur aktivieren, was gebraucht wird (jeder Server kostet Kontext).

### So aktivierst Du die Vorlage (Claude Code)
1. Im Projektordner auf Deinem Rechner: `cp .claude/setup/mcp.example.json .mcp.json` (Projekt-Datei, nicht `~/.claude/mcp.json`; das ist kein Standardpfad). Beim ersten Start fragt Claude Code, ob es dem Projekt-Server vertraut.
2. `export EXA_API_KEY=...` in Deiner Shell, nie in die Datei. Ohne Schlüssel startet `exa` nicht, die anderen laufen.
3. In Claude Code `/mcp` öffnen und prüfen, welche Server verbunden sind. Nicht Gebrauchte entfernen.
Superpowers und Archify sind **nicht** installiert, bevor Du die Plugin-Befehle oben selbst ausführst.
