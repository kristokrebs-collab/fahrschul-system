# Claude-Extras: Schritt für Schritt (auf DEINEM Rechner)

Alles hier läuft in Deinem Terminal, nicht in der Cloud-Sitzung. Quelle der Aussagen: die gelesenen READMEs und Code der Repos (Stand Okt. 2026); nichts davon wurde auf einem echten Rechner mit Handy/WhatsApp getestet. Das Skript `setup-claude-extras.sh` ist in einem Wegwerf-Home getestet.

## 0. Vorbereitung
```bash
git clone https://github.com/kristokrebs-collab/fahrschul-system && cd fahrschul-system
git checkout claude/vigilant-edison-iz0c2n && git pull      # enthält .claude/skills und .claude/setup
chmod +x .claude/setup/setup-claude-extras.sh
```
Voraussetzungen: `git`, Node.js ≥ 18 (für ECC/WhatsApp), Claude Code.

## 1. Design-Skills nach `~/.claude/skills/`
```bash
.claude/setup/setup-claude-extras.sh design
```
Installiert `frontend-design` (Typografie), `responsive-design` (Layout), `web-design-guidelines`, `local-business-rebuild`, `design-system-generator` aus `lotfb86/web-design-skills` (vorhandene Ordner werden übersprungen). Danach Claude neu starten.
Eigener Skill `pulse-motion` (24 Animationen + 10 Styles): `cp -r .claude/skills/pulse-motion ~/.claude/skills/`.

## 2. Awesome Claude Skills auswählen
```bash
.claude/setup/setup-claude-extras.sh awesome list
.claude/setup/setup-claude-extras.sh awesome add changelog-generator invoice-organizer
```
Git-Automation: `changelog-generator`. Dokumente: `invoice-organizer`, `file-organizer` (docx/pdf/xlsx hast Du schon über `anthropic-skills`). Offizieller Pfad ist `~/.claude/skills/`, die README der Sammlung nennt `~/.config/claude-code/skills/`.
Nicht blind installieren: `composio-skills` und `connect-apps` schicken Daten an Composio.

## 3. ECC (Everything Claude Code), vorsichtig
```bash
.claude/setup/setup-claude-extras.sh ecc        # nur Trockenlauf des Profils "minimal", ändert nichts
```
Erst die Ausgabe lesen. ECC bringt 71 Agenten, 311 Skills, 27 Hooks und einen Selbst-Update-Mechanismus mit. Hooks laufen bei jedem Tool-Aufruf und können mit Deinen Stop-Hooks kollidieren. Wenn Dir die Liste passt:
```bash
npx ecc-universal@2.2.3 install --profile minimal --target claude
npx ecc-universal@2.2.3 doctor --target claude
```
Sparsamer: nur `agents/code-reviewer.md`, `a11y-architect.md`, `e2e-runner.md`, `doc-updater.md` und die Regeln `rules/common`, `rules/web`, `rules/react` per `cp` übernehmen. Auto-Update danach abschalten bzw. nicht aktivieren.

## 4. WhatsApp (nur mit Vorsicht)
Wahl: `crisandrews/claude-whatsapp` (MIT, Baileys = **inoffizieller** WhatsApp-Client, Meta kann die Nummer sperren).
- Zweit-SIM/Testnummer nutzen, **nicht** die Nummer der Fahrschule.
- Eigener leerer Ordner **ohne Geheimnisse/Repos**. Keine Schülerdaten über diesen Weg (DSGVO).
- **Ohne** `--dangerously-skip-permissions` starten (sonst kann jede freigeschaltete Nachricht Befehle ausführen).
```bash
mkdir ~/whatsapp-agent && cd ~/whatsapp-agent && claude
```
In Claude Code:
```
/plugin marketplace add crisandrews/claude-whatsapp
/plugin install whatsapp@claude-whatsapp          # Scope: "Install for you, in this repo only (local scope)"
```
Beenden (`/exit`) und neu starten:
```bash
claude --dangerously-load-development-channels plugin:whatsapp@claude-whatsapp
```
Dann:
```
/whatsapp:configure                    # QR-Code; WhatsApp > Einstellungen > Verknüpfte Geräte > Gerät hinzufügen
/whatsapp:access pair <code>           # Kontakt koppeln (Code kommt per WhatsApp)
/whatsapp:access policy allowlist      # nur gekoppelte Kontakte
```
Ohne Kamera: `/whatsapp:configure pair +49…` (8-stelliger Code statt QR). Freigaben für Tool-Aufrufe lassen sich per Permission-Relay über WhatsApp bestätigen (siehe README des Plugins, Abschnitt „Permission requests over WhatsApp“).
Alternativen: `gokapso/claude-code-whatsapp` (E2B-Sandbox + Kapso, 4 API-Schlüssel, keine Lizenzdatei), `mnott/Whazaa` (nur Selbst-Chat, braucht AIBroker, macOS-lastig).

## 5. Prüfen
```bash
ls ~/.claude/skills            # Skills vorhanden?
claude                         # neue Sitzung, dann /skills bzw. nach dem Skill fragen
```
