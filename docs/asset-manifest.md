# Asset-Manifest

## Higgsfield (neu generiert, Ultra-Plan)
| Zweck | Job | Status |
|---|---|---|
| Hero-Scrub Nachtfahrt (Fahrbahnmarkierung → Rücklicht-Makro) | `86ae101f` | ✅ fertig |
| Krebs-Linienzeichnung (Lichtlinie zeichnet den Krebs) | `f937d961` | ⏳ rendert |

Kosten: 27 Credits je 6-s-Clip.
Nächster Schritt: mit ffmpeg in 180 JPEG-Frames zerlegen → `assets/hero-frames/0001.jpg …`

## Lokal gesichert (kein CDN)
- `vendor/gsap.min.js` (71 KB) + `vendor/ScrollTrigger.min.js` (43 KB) — aus npm, inline-fähig
- `assets/fonts/` — Anton (Display), Archivo 400/800 (Text), JetBrains Mono (HUD), 80 KB gesamt

## Fehlt noch (vom Auftraggeber)
- **Logo als Datei** (SVG bevorzugt, sonst JPG/PNG) → für exakte Konturanimation
- Restliche 21st.dev-Komponenten als Code
