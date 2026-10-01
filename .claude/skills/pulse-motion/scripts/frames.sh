#!/usr/bin/env bash
# frames.sh <video.mp4> <outdir> [fps=10] [crop=W:H:X:Y]
# Zerlegt eine Bildschirmaufnahme (21st.dev-Vorschau) in Einzelbilder der BUEHNE
# (ohne Browser-Chrome) + Kontaktblatt. Standard-Crop passt auf Samsung-Aufnahmen 1730x1080.
set -euo pipefail
V="$1"; OUT="$2"; FPS="${3:-10}"; CROP="${4:-1234:673:248:240}"
mkdir -p "$OUT/frames"
ffmpeg -y -v error -i "$V" -vf "fps=$FPS,crop=$CROP" "$OUT/frames/f_%04d.png"
N=$(ls "$OUT/frames" | wc -l)
COLS=4; ROWS=$(( (N + COLS - 1) / COLS ))
ffmpeg -y -v error -framerate 1 -i "$OUT/frames/f_%04d.png" \
  -vf "scale=620:-1,drawtext=text='%{n}':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=${COLS}x${ROWS}:padding=3:color=black" \
  -frames:v 1 "$OUT/sheet.png" 2>/dev/null || \
ffmpeg -y -v error -framerate 1 -i "$OUT/frames/f_%04d.png" -vf "scale=620:-1,tile=${COLS}x${ROWS}:padding=3:color=black" -frames:v 1 "$OUT/sheet.png"
echo "$N Frames @ ${FPS}fps -> $OUT/frames/ ; Kontaktblatt: $OUT/sheet.png"
