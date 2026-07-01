#!/bin/bash
# Fahrschul-Cockpit – lokaler Start (Linux)
# Falls Doppelklick nur den Text anzeigt: Terminal öffnen, "bash start-linux.sh" eingeben.
cd "$(dirname "$0")"
PORT=8099

echo "Starte Fahrschul-Cockpit auf http://localhost:$PORT ..."
( sleep 1.5 && xdg-open "http://localhost:$PORT/index.html" 2>/dev/null ) &

if command -v python3 &>/dev/null; then
  python3 -m http.server "$PORT"
elif command -v python &>/dev/null; then
  python -m http.server "$PORT"
else
  echo "Python wurde nicht gefunden. Bitte installiere Python 3 und starte diese Datei erneut."
  read -p "Drücke Enter zum Schließen..."
fi
