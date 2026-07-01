#!/bin/bash
# Fahrschul-Cockpit – lokaler Start (macOS)
# Einfach per Doppelklick im Finder öffnen.
cd "$(dirname "$0")"
PORT=8099

echo "Starte Fahrschul-Cockpit auf http://localhost:$PORT ..."
( sleep 1.5 && open "http://localhost:$PORT/index.html" ) &

if command -v python3 &>/dev/null; then
  python3 -m http.server "$PORT"
elif command -v python &>/dev/null; then
  python -m http.server "$PORT"
else
  echo "Python wurde nicht gefunden. Bitte installiere Python 3 (python.org) und starte diese Datei erneut."
  read -p "Drücke Enter zum Schließen..."
fi
