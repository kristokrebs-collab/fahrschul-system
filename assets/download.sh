#!/usr/bin/env bash
# Lädt alle generierten Assets herunter und baut die Hero-Frame-Sequenz.
# Ausführen aus dem Projektordner:  bash assets/download.sh
# (Ich selbst kann das nicht: die CDN ist von meiner Umgebung aus gesperrt.)
set -e
cd "$(dirname "$0")/.."
mkdir -p assets/media assets/hero-frames

echo "→ Videos"
curl -L -o assets/media/hero-nightdrive.mp4 "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_015111_86ae101f-876c-41a4-83d4-8a1ca4bb4019.mp4"
curl -L -o assets/media/krebs-linie.mp4     "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_020141_f937d961-985f-4948-b4bb-a928d46a6f09.mp4"

echo "→ Bilder"
curl -L -o assets/media/welt-pkw.png       "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_020837_046605f4-58a0-4762-9a69-e91a6ade33b1.png"
curl -L -o assets/media/welt-motorrad.png  "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_020850_fa197d6e-68bb-4068-a594-cbd01090e5ab.png"
# Lkw + Bus: europäische Mercedes-Bauform (Frontlenker), Neugenerierung 29.07.
curl -L -o assets/media/welt-lkw.png       "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_021826_9dc7f665-9452-4553-af3b-e1954f25a6d7.png"
curl -L -o assets/media/welt-bus.png       "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_021819_523b9900-d299-4828-9099-6a785246e1ae.png"
curl -L -o assets/media/handicap.png       "https://d8j0ntlcm91z4.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/hf_20260729_021023_9f6849a1-7f62-41c9-879c-322e5a89bf6c.png"

echo "→ Frame-Sequenz für den Hero-Scrub (180 Frames, wie in der Referenz)"
ffmpeg -y -i assets/media/hero-nightdrive.mp4 \
  -vf "fps=30,scale=1600:-2" -q:v 4 -frames:v 180 \
  assets/hero-frames/%04d.jpg

echo "→ Poster (erster Frame, lädt sofort)"
cp assets/hero-frames/0001.jpg assets/media/hero-poster.jpg

echo "✓ fertig. index.html neu laden."
