#!/usr/bin/env bash
# sidebyside.sh <orig_frames_dir> <replica_frames_dir> <out.png> [cols=2]
# Links Original-Frame, rechts Nachbau-Frame (gleiche Nummer) -> ein Vergleichsbild. Beide Ordner via frames.sh erzeugt (gleiche fps!).
set -euo pipefail
A="$1"; B="$2"; OUT="$3"; COLS="${4:-2}"
N=$(( $(ls "$A" | wc -l) < $(ls "$B" | wc -l) ? $(ls "$A" | wc -l) : $(ls "$B" | wc -l) ))
ROWS=$(( (N + COLS - 1) / COLS ))
ffmpeg -y -v error -framerate 1 -i "$A/f_%04d.png" -framerate 1 -i "$B/f_%04d.png" \
  -filter_complex "[0]scale=560:-1,drawtext=text='ORIG %{n}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6[a];[1]scale=560:-1,drawtext=text='NACHBAU %{n}':x=4:y=4:fontsize=18:fontcolor=cyan:box=1:boxcolor=black@0.6[b];[a][b]hstack,tile=${COLS}x${ROWS}:padding=3:color=black" \
  -frames:v 1 "$OUT"
echo "$N Paare -> $OUT"
