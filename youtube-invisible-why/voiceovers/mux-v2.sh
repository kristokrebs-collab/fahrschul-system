#!/usr/bin/env bash
# Downloads each pilot's narration chunks, joins them, and muxes the result
# onto the rendered silent video — producing the upload-ready MP4.
#
# Why this is a script you run rather than something already done: the
# narration lives on a Higgsfield CDN that the build environment's network
# policy blocks, and the video was rendered locally. Neither side could
# reach the other, so the join happens here, on your machine, where both
# are reachable.
#
# Usage:
#   bash mux-v2.sh                 # all three
#   bash mux-v2.sh pilot-06-waiting-time
#
# Requires: ffmpeg and curl on PATH.
#
# Video and audio durations already match to within 0.1s — the storyboards
# were re-timed against these exact recordings' measured durations. Do NOT
# add -shortest: combined with -c:v copy it has silently truncated audio to
# a few seconds on this project before, while still reporting the full
# duration and both streams present.

set -euo pipefail

BASE="https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${ROOT}/voiceovers/work"
mkdir -p "$WORK" "${ROOT}/renders"

# pilot | chunk filenames in playback order
declare -A CHUNKS=(
  [pilot-04-phone-variable-reward]="hf_20260806_130423_6ec4d2bf-0110-4021-bbf7-d2ba43ca9d84.wav hf_20260806_131149_348c2915-2d62-4697-89d1-938b2d540ee8.wav"
  [pilot-05-decoy-effect]="hf_20260806_130927_44d71fbf-678e-4381-b937-fa7909defa5a.wav hf_20260806_130927_1f4721d2-6085-4a1a-8dec-aca07e82e5c1.wav"
  [pilot-06-waiting-time]="hf_20260806_130628_95a31810-f4ed-483c-b2c5-c29cabd5f4bb.wav hf_20260806_130628_65db7bbd-f511-441d-9629-e94f56b68a85.wav hf_20260806_130121_b8832020-a017-4f18-8aa8-944764f55c0c.wav"
)

TARGETS=("${@:-}")
if [ -z "${TARGETS[0]:-}" ]; then TARGETS=("${!CHUNKS[@]}"); fi

for pilot in "${TARGETS[@]}"; do
  video="${ROOT}/renders/${pilot}.mp4"
  final="${ROOT}/renders/${pilot}-final.mp4"
  [ -f "$video" ] || { echo "missing render: $video" >&2; exit 1; }

  list="${WORK}/${pilot}.txt"
  : > "$list"
  i=0
  for f in ${CHUNKS[$pilot]}; do
    out="${WORK}/${pilot}-$(printf %02d $i).wav"
    [ -s "$out" ] || curl -fL --retry 3 --retry-all-errors "${BASE}/${f}" -o "$out"
    # concat demuxer needs absolute, single-quoted paths
    printf "file '%s'\n" "$out" >> "$list"
    i=$((i+1))
  done

  narration="${WORK}/${pilot}-narration.wav"
  ffmpeg -y -v error -f concat -safe 0 -i "$list" -c copy "$narration"

  ffmpeg -y -v error -i "$video" -i "$narration" \
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k \
    -movflags +faststart "$final"

  echo "wrote ${final}"
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$final"
done
