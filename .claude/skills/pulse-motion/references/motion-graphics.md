# Motion Graphics Set (motion-graphics)
> Acht kleine, zeitbasierte Bausteine in einer Datei: Partikel formen eine Raute, Gradient fließt, Linie zeichnet sich, Zahlen rollen wie ein Zählwerk, Ringe kreisen, Button wird zum Bezahl-Häkchen, Konfetti-Burst, Wörter schieben ein.

## Wann einsetzen
- Erklär-/Produktvideos, Hero-Kacheln, Dashboards (Linie, Zahl, Häkchen), Feier-Momente nach Erfolg
- Einzelne Bausteine herauslösen: jeder Block ist unabhängig
- EN: motion graphics, particles to shape, line draw, number roll odometer, rings orbit, pay button morph, confetti burst, kinetic words

## Quelle und Ehrlichkeit
Ideenliste aus einem Instagram-Karussell („Claude Motion Graphics, 16 premium animations you can clone“, Charlie Hills): gesehen wurden nur die 16 Titel auf einem Screenshot (Particles→logo, Gradient→flow, Glass→tilt, Globe→arcs, Line→draw, Shape→morph, Grid→wave, Cards→shuffle, Number→roll, Ribbon→twist, Liquid→merge, Phone→explode, Rings→orbit, Words→kinetic, Button→pay, Confetti→burst). **Hier eigene Umsetzung von 8; Code und genaue Werte der Vorlage wurden nicht gesehen.** Noch nicht gebaut: Glass→tilt, Globe→arcs, Shape→morph, Grid→wave, Cards→shuffle, Ribbon→twist, Liquid→merge, Phone→explode.

## Anatomie & Zeitleiste
| Baustein | ms | Verlauf |
|---|---|---|
| Particles → Form | offen | 360 Punkte nähern sich ihrem Ziel mit `1-exp(-k·dt)`, Versatz bis 0,5 s, danach leises Atmen |
| Gradient → Flow | 14 000 alternate | Conic-Verlauf, Blur 34 px, `rotate` + `scale`, ease-in-out |
| Line → Draw | 1 600 + 900 | `stroke-dashoffset` 1→0 ease-out (`pathLength=1`), Endpunkt springt (Feder), Badge zählt 0→128 % |
| Number → Roll | 1 300 + 90 je Stelle | je Ziffer ein Zählwerk-Streifen, `translate3d` ease-out, Stagger von links |
| Rings → Orbit | Schleife | drei Planeten auf Ellipsen, Winkel aus Zeit, pausiert außerhalb des Sichtfelds |
| Button → Pay | 500 / 1 300 / 3 300 | Pille → Kreis (`clip-path`, ease-out), Spinner, Häkchen zeichnet sich 450 ms, nach 2 s zurück |
| Confetti → Burst | 1,6–2,4 s | 90 Teile, Schwerkraft 520 px/s², Luftwiderstand `exp(-1,6·dt)`, Ausblenden in 0,6 s |
| Words → Kinetic | 800 + 140 Stagger | Wortzeilen schieben aus der Maske, ease-out |

## Motion-Tokens
`--draw-ms`, `--roll-ms`, `--roll-stagger-ms`, `--form-k`, `--burst-count`, `--ease-out`, `--ease-in`, `--spring`. Nichts linear.

## Interaktion & Barrierefreiheit
- Jedes Replay ist ein echter Button; Pay-Button mit `aria-busy` und Namen „Bezahlt“ am Ende
- `prefers-reduced-motion`: Endzustand sofort, kein Konfetti, keine Schleifen
- Canvas/SVG tragen `aria-label`; Zahl als Text im `aria-label`

## 120-Hz-Technik
rAF mit Zeitstempel und dt, Leerlauf = keine Arbeit (Konfetti, Orbit pausiert außerhalb des Sichtfelds). Nur `transform`/`opacity`/Canvas; der Pay-Button animiert `clip-path` auf 46 px Fläche. **Gemessen (check120, Headless, alle 8 Bausteine plus wiederholtes Auslösen gleichzeitig):** normale CPU p95 3,7 ms, 0,1 % der Frames über 8,33 ms; mit 4-facher CPU-Drosselung p95 13,9 ms und 16 % über Budget (Urteil des Tools: „zu langsam“ im Stresstest). Teuerste Teile: rotierendes Blur-Gradient (Gradient → Flow) und die Orbit-Schleife. Darum: **Bausteine einzeln oder zu wenigen verwenden**, nicht alle acht auf einem Bildschirm. Gradient pausiert außerhalb des Sichtfelds, Partikel stoppen, sobald sie angekommen sind. Echtgerät-Test bei 120 Hz steht aus.

## Einbindung
Block `COMPONENT:START/END` + CSS kopieren; jeder Baustein hat seinen Abschnitt im Skript (Kommentare `---- 01 … ----`). Nur den gewünschten Baustein mitnehmen.

## React/Framer-Motion-Mapping
```tsx
<motion.path pathLength={1} initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.6, ease:[.16,1,.3,1]}} />   // Line → Draw
<motion.div animate={{y:`-${digit}em`}} transition={{duration:1.3, ease:[.16,1,.3,1], delay:i*.09}} />                           // Number → Roll
```

## Kreativ remixen
1. Line → Draw an echte Daten hängen (Fächer aus `industry-trend-lab/assets/megatest.html`)
2. Number → Roll mit Glas-Look-Karte (`glass-look`) kombinieren
3. Pay → Häkchen → Konfetti verketten (Erfolgsmoment)
4. Particles zu Logo-Maske statt Raute (Zielpunkte aus Alphakanal)

## Bekannte Abweichungen (ehrlich)
- Optik und Zeiten sind plausible Eigenwerte, nicht nach Vorlage gemessen
- Particles-Ziel ist eine gefüllte Raute, kein Logo
- 8 der 16 Titel fehlen noch
