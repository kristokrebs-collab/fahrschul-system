# Hochwertige Linien: Tausende Pfade lesbar machen (Fächer-Chart)

Anlass: Reel „10.000 Läufe testen“ (algopriceactiontrader) zeigt Pfade, die von einer senkrechten Achse aus auffächern, grün (Gewinn) und rot (Verlust), später Rangliste und Kacheln. Umsetzung hier: `industry-trend-lab/assets/megatest.html` (Canvas). Die Regeln sind eigene Beobachtung, keine Vorlage-Werte.

1. **Nie alle Pfade zeichnen.** Statistik (Perzentil-Bänder 5/25/50/75/95) aus allen 10.000 Pfaden, dazu nur eine Stichprobe von ca. 140 grünen und 140 roten Pfaden als Textur. Die Zahl im Titel bleibt ehrlich („10.000 simuliert“), das Bild ist die Stichprobe.
2. **Alpha statt Linienstärke:** 1,1 px, Deckkraft 0,14–0,16; Überlagerung ergibt Dichte (dunkel: `globalCompositeOperation = 'lighter'`, hell: `source-over`).
3. **Farbe = Ergebnis:** Grün/Rot nach Endwert (>= 1 oder < 1), nie nach Zufall. Median **weiß/dunkel mit Glow** (`shadowBlur 12`), Bänder als weiche Flächen darunter.
4. **Startachse:** senkrechte Linie mit Verlauf (transparent – hell – transparent) macht den „Fächer“-Eindruck; gestrichelte 1×-Linie als Einsatz.
5. **Log-Skala** für Vermögen, gleichmäßige Rasterlinien (0,5×, 1×, 2×, 4× …), kleine Mono-Labels.
6. **Einzeichnen:** Rechteck-Clip wächst in 1,5 s mit ease-out von links nach rechts (rAF-Zeitstempel), Endpunkte danach einblenden; nichts linear.
7. **Fadenkreuz:** nur im Ruhezustand, ein rAF pro Bewegung gebündelt, Tooltip mit P05/Median/P95.
8. **Kosten:** Canvas statt SVG (Tausende Pfade), `devicePixelRatio` auf 2 begrenzen, Neuzeichnen nur bei Resize/Theme/Hover.
9. **Ehrlichkeit im Bild:** Streudiagramm „Auswahl gegen Endtest“ zeigt Überanpassung; Beschriftung nennt Basis und Kandidatin.
