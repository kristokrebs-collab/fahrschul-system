#!/usr/bin/env bash
# setup-claude-extras.sh — holt Fremd-Skills auf DEINEN Rechner (nicht in die Cloud-Sitzung). Nichts wird ohne Dein Zutun ausgeführt:
# es werden nur Markdown-Ordner kopiert; ECC läuft nur als Trockenlauf; WhatsApp ist bewusst Handarbeit (siehe unten).
#   ./setup-claude-extras.sh design                  # 5 Design-Skills aus lotfb86/web-design-skills nach ~/.claude/skills
#   ./setup-claude-extras.sh awesome list            # Skills aus ComposioHQ/awesome-claude-skills anzeigen
#   ./setup-claude-extras.sh awesome add <name>...   # ausgewählte Skills kopieren (z. B. changelog-generator invoice-organizer)
#   ./setup-claude-extras.sh ecc                     # ECC "minimal"-Profil NUR als Trockenlauf (zeigt, was installiert würde)
#   ./setup-claude-extras.sh kronos [Zielordner]     # Kronos klonen + eigene venv (Standard ~/kronos); Gewichte laden erst beim ersten Lauf
# Umgebung: CLAUDE_HOME (Standard ~/.claude)
set -euo pipefail
DEST="${CLAUDE_HOME:-$HOME/.claude}/skills"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
clone() { GIT_TERMINAL_PROMPT=0 git clone --depth 1 -q "https://github.com/$1" "$TMP/$2"; echo "  geklont: $1 @ $(git -C "$TMP/$2" log -1 --format='%h %cs')"; }
copy_skill() {  # copy_skill <quellordner> <zielname>
  if [ -e "$DEST/$2" ]; then echo "  übersprungen (existiert): $2"; return; fi
  mkdir -p "$DEST/$2" && cp -r "$1/." "$DEST/$2/" && echo "  installiert: $2 -> $DEST/$2"
}
case "${1:-}" in
  design)
    clone lotfb86/web-design-skills web
    for s in 01-frontend-design:frontend-design 02-responsive-design:responsive-design 03-web-design-guidelines:web-design-guidelines \
             06-local-business-rebuild:local-business-rebuild 08-design-system-generator:design-system-generator; do
      copy_skill "$TMP/web/${s%%:*}" "${s##*:}"; done
    echo "Fertig. Neue Claude-Sitzung starten, dann sind die Skills aktiv." ;;
  awesome)
    clone ComposioHQ/awesome-claude-skills awe
    case "${2:-list}" in
      list) echo "Skills (Ordner mit SKILL.md):"; find "$TMP/awe" -maxdepth 2 -name SKILL.md -printf '  %h\n' | sed "s#$TMP/awe/##" | sort ;;
      add)  shift 2; [ $# -gt 0 ] || { echo "Namen angeben, z. B.: awesome add changelog-generator"; exit 1; }
            for n in "$@"; do [ -f "$TMP/awe/$n/SKILL.md" ] && copy_skill "$TMP/awe/$n" "$n" || echo "  nicht gefunden: $n"; done ;;
      *) echo "awesome list | awesome add <name>..."; exit 1 ;;
    esac ;;
  ecc)
    echo "Trockenlauf des ECC-Installers (ändert nichts). Erst lesen, dann entscheiden:"
    npx --yes ecc-universal@2.2.3 install --profile minimal --target claude --dry-run ;;
  kronos)
    T="${2:-$HOME/kronos}"; [ -e "$T" ] && { echo "existiert schon: $T (nichts getan)"; exit 1; }
    command -v python3 >/dev/null || { echo "python3 (>= 3.10) fehlt"; exit 1; }
    GIT_TERMINAL_PROMPT=0 git clone --depth 1 -q https://github.com/shiyu-coder/Kronos.git "$T"
    python3 -m venv "$T/.venv" && "$T/.venv/bin/pip" install -q -r "$T/requirements.txt"
    echo "Fertig: $T. Aktivieren: source $T/.venv/bin/activate; Beispiel: cd $T/examples && python prediction_example.py"
    echo "Hinweis: erster Lauf lädt Modell-Gewichte von huggingface.co/NeoQuasar. Prognosen sind keine Finanzberatung." ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
