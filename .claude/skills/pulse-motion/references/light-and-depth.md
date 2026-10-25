# Light and Depth (light-and-depth)
> Fünf Licht- und Tiefeneffekte als eigener Vanilla-Nachbau nach Aussehen: Spotlight, Karten-Spotlight, Lampe, 3D-Karte, Punktraster-Reveal.

**Quelle:** Die Effekte sind in Aceternity UI (und ähnlichen Bibliotheken) bekannt. Hier **nur nach Aussehen** nachgebaut, **ohne deren Code gelesen oder übernommen zu haben**; deren AGB behalten alle Rechte vor. Kein Video-Vergleich, Optik ähnlich, nicht identisch.

## Wann einsetzen
- Hero-Hintergrund mit Lichtkegeln (Spotlight), „Licht geht an“-Überschrift (Lampe), Feature-Karten mit Zeiger-Licht, Produktkarten mit Tiefe (3D), Aufdecken per Hover (Punktraster)
- EN: spotlight, lamp, light cone, card spotlight, 3D tilt card, canvas dot reveal, hover reveal

## Effekte und Token
| Effekt | Mechanik | Token | 120-Hz-Charakter |
|---|---|---|---|
| Spotlight | zwei weiche Radial-Kegel (−/+35°, Scale .45) gleiten bei Sichtbarkeit ein (2 s, `cubic-bezier(.16,1,.3,1)`, Opazität 1.6 s) | Farbe über `--ink` | transform/opacity |
| Karten-Spotlight | 360px-Lichtfleck folgt dem Zeiger, Glättung `1-exp(-14·dt)`, Einblenden .35 s | `--accent` | transform |
| Lampe | helle Linie, zwei Kegel (scaleX .5→1), Glow, Titel steigt 64px auf, alles 1 s ease-in-out, Titel .25 s verzögert | `--c` | transform/opacity (Glow-Blur statisch) |
| 3D-Karte | Neigung ±14° zum Zeiger (`1-exp(-12·dt)`), Ebenen `translateZ` 30–70px, Perspective 1000px | `--z` je Kind | transform |
| Punktraster-Reveal | Canvas-2D-Raster (6px Abstand, 3px Punkt), Punkte erscheinen nach Abstand zur Zeigerstelle + 25 % Zufall, 0.7 s, vier Alpha-Stufen je ein Pfad | `GAP SIZE cols2` | Canvas, zeichnet nur während der Animation |

## Messung (check120, Headless, 4× CPU-Drosselung)
Ganze Demo mit allen fünf Effekten und Zeiger-Bewegung über jeden: **p95 0.9 ms ungedrosselt, 4.3 ms bei 4× Drosselung**, Schwelle 10.4 ms → „ok“. Echtes 120-Hz-Gerät **nicht geprüft**. Der Hinweis „Layout-Lesezugriffe“ betrifft `getBoundingClientRect` nur bei Zeiger-Ereignissen.

## Barrierefreiheit
`prefers-reduced-motion`: Übergänge aus, Spotlight sofort sichtbar, 3D-Neigung aus, Reveal ohne Animation. Punktraster-Reveal ist per Tastatur fokussierbar (`tabindex`, Fokus deckt auf). Überschriften bleiben echter Text.

## Bekannte Abweichungen
- Die Lampe nutzt Conic-Gradients mit Maske; die Kegelform ist geschätzt.
- Das Raster-Reveal ist Canvas 2D (Original-Bibliotheken nutzen Shader); Punktgröße/Palette sind eigene Werte.
- Nicht nachgebaut: Vortex, Cloud/Dither-Shader, Google-Gemini-Effekt.
