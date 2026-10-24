# Cinematic Orbit Hero (cinematic-orbit-hero)

> Acht Foto-Karten liegen zuerst als schraeger Faecher (gerade Diagonale, -12 Grad) in der Mitte; nach ~2.5 s oeffnen sie sich in ~2.8 s (langsamer Anlauf, Spitze bei 1.4 s, langer Auslauf) zu einer flachen 3D-Ellipse um den Titel "Cinematic Depth." - hinten klein, vorn gross, an den Seiten leicht trapezfoermig gekippt -, waehrend der Textblock linear einblendet und von 90% auf 100% waechst; danach driften die Karten tiefenabhaengig mit dem Zeiger.

Quelle: 21st.dev-Vorschau "Cinematic Orbit Hero", rekonstruiert aus einer Bildschirmaufnahme (Samsung Browser, 120-Hz-Display, Inhalt unbekannt -> Name aus dem Titel). Datei: `assets/cinematic-orbit-hero.html`.

## Wann einsetzen
- Hero einer Produkt-/Portfolio-/Sport-/Wearable-Seite mit 6-10 starken Fotos (Kampagnen-Look) - hero, product showcase
- Intro-Sequenz "Stapel -> Ring" nach dem Laden oder beim Sichtbarwerden (Splash, Onboarding, Case-Study-Einstieg) - reveal, intro
- Karussell-Ersatz: Karten kreisen um einen Claim, Tiefe statt Slider - orbit carousel, coverflow
- Team-/Referenz-/Album-/Rezept-Ring um eine Headline - team ring, album wall
- Scroll-Szene (p an Scroll koppeln) oder Klick-Toggle "Alle zeigen" - scroll scrub, toggle
- Dunkles Premium-Design mit Tiefenillusion ohne WebGL (reines CSS-3D/matrix3d) - no WebGL, parallax

## Anatomie & Zeitleiste
Aufbau: Buehne `#1b1c1f` + ruhender roter Radial-Glow; Textblock (h1 + p) liegt UNTER allen Karten; Ring = 8 `li.coh__card` (260x208 Basis, 5:4), jede per `matrix3d` exakt auf ein Viereck abgebildet. Referenz 1234x673, Zeiten = Video-Sekunden (Aufnahme-Sekunde 0 = Modal geoeffnet).

| Phase | Video-t | Verhalten |
|---|---|---|
| Faecher ruht | 0 - 2.5 s | 8 Karten, Mitten (424,256) bis (773,400) (Schritt 49.8/20.6), je 113x82, -12 Grad; z-Ordnung: mittlere Karte (s/w Starter) oben, nach aussen abfallend |
| Anlauf | 2.5 - 3.5 s | p 0 -> 0.10 (p(3.2)=.04, p(3.4)=.07), Titel erscheint ab 3.2 s |
| Oeffnung | 3.5 - 4.4 s | p 0.10 -> 0.84, Spitzentempo ~1.3 p/s bei 3.85-3.95 s; Karten wandern linear (Position, Form) vom Faecherplatz zum Ringplatz |
| Auslauf | 4.4 - 5.3 s | p 0.84 -> 1.0 (p(4.5)=.88, p(4.8)=.97, p(5.0)=.99) |
| Text | Opacity 3.2 - 4.85 s linear; Skala .9 -> 1 per Sinus-Ease 3.15 - 5.15 s (Drehpunkt Blockmitte) | kein Blur, kein Versatz |
| Ruhe | 5.0 - 5.6 s | Ring exakt symmetrisch um (617,389); Zeigerpfeil steht bei (880,372) |
| Drift | ab 5.62 s | Zeigerpfeil verschwindet, Karten gleiten tiefenabhaengig nach links unten (vorn ~ -40/+20..30 px, hinten ~ -7/+6), exponentiell tau ~0.5 s, bei 6.6 s noch nicht ganz fertig |

Ring-Reihenfolge im Uhrzeigersinn ab 12 Uhr: Sprinter (blauer Himmel), Staffellaeufer, Basketball (orange), Watch "Trail Run", s/w Starterblock, Fussballer, Radfahrer, dunkle Watch. Ellipse um (617,389): rx 517, ry 100.5; Kartenbreite oben 102px, Seiten ~137px, unten 193px.

## Motion-Tokens
| Token | Wert | Anmerkung |
|---|---|---|
| startDelay | 2500 ms | Ruhe im Faecher (Ausloeser im Video unbekannt, hier Zeit/Sichtbarkeit) |
| curve p(t) | `[0,0] [500,.015] [900,.075] [1050,.15] [1200,.28] [1400,.52] [1600,.70] [2000,.88] [2300,.962] [2800,1]` (ms nach Start) | per Bildvergleich Original/Nachbau gefittet (+-0.03); monotone Kubik. Naeherung: cubic-bezier(.65,0,.35,1) ueber 2.8 s (Fehler <= 0.08) |
| Karten-Interpolation | Position, Eckpunkte linear in p | gemeinsames p fuer alle Karten, kein Stagger |
| text | delay 700, duration 1650 (Opacity linear); scaleFrom .9, scaleDelay 650, scaleDuration 2000 (Sinus) | |
| parallax | x 105 px, y 50 px am Buehnenrand (Karte ganz vorn), Karte hinten ~15% davon | kritisch gedaempfte Feder k=20, c=9 (omega 4.5, ~0.5 s) |
| spin (cycle) | Feder k=70, c=15; +-45 Grad je Schritt | Erweiterung, im Video nicht sichtbar |
| z-Ordnung | `10 + round((sin(theta)+1)*50)` | sortiert nach Tiefe |

## Look-Tokens
| Token | Wert |
|---|---|
| Buehne | `#1b1c1f` |
| Glow | Radialverlauf Mitte der Buehne, Radius ~520px: `#2a191d` 0% / `#251a1d` 23% / `#231b1d` 34% / `#211c1e` 45% / `#1e1d20` 57% / `#1c1d20` 80% / `#1b1c1f` 96%; statisch (im Video nur 8-bit-Banding als feine Ringe) |
| Titel | `#eeeeee`, ~72px (Versalhoehe 53px), Gewicht 600 (Stamm ~9px), Laufweite -0.075em (Wortbreite 505px, Grundlinie y=298), mittig; Inter/Roboto-artig |
| Untertitel | ~14.5px, Gewicht 300, `#c4c4c9`, Zeilenabstand 21px, 2 Zeilen mit Umbruch nach "Watch" (Zeile 1 = 391px breit), mittig unter dem Titel |
| Karte | 5:4, Radius 20px (Basis, ~15px bei 193px Breite), kein Rand, Schatten kaum sichtbar (`0 24px 48px -18px rgba(0,0,0,.55)`) |
| Kartenformen | Faecher: 113x82, Kanten -12 Grad (reine Drehung). Ring: Vierecke je Slot (siehe `ringQuads`), z.B. rechts (Basketball) obere Kante +15 Grad, rechte Kante 20% laenger als linke |

## Interaktion & Barrierefreiheit
- Video: kein Fingerabdruck sichtbar, nur ein Zeigerpfeil; Oeffnung laeuft von selbst (`trigger: 'auto'`, startet erst wenn sichtbar). Weitere Modi: `'click'` (Tippen/Klick/Enter toggelt) und `'manual'` (`open()/close()/setProgress(p)`).
- Zeiger/Touch: Karten wandern zum Zeiger (Tiefen-Parallax), Touch = Finger halten/ziehen, Loslassen/Verlassen = zurueck (Feder). `touch-action: pan-y`.
- Tastatur: Fokus auf der Komponente, Enter/Leertaste oeffnen/schliessen, Pfeil links/rechts drehen den Ring um einen Slot (`cycle(+-1)`).
- Titel ist echter `h1`, Untertitel `p`; Ring `aria-hidden`, Bilder `alt=""`; Region mit `aria-label`.
- `prefers-reduced-motion`: Ring ist sofort offen, Text sofort sichtbar, kein Parallax, Federn springen.

## 120 Hz
Technik (Pflicht des Nutzers: mindestens 120 fps; Ziel 120/144/165/240 Hz):
- Alles zeitbasiert: eine Zeitleiste `tl` (ms) wird aus rAF-Zeitstempeln (`dt <= 50 ms`) fortgeschrieben; p = Funktion von `tl` (monotone Kubik), nie ein Frame-Zaehler. Federn (Parallax, Drehung) = exakte analytische Loesung der gedaempften Feder => bildratenunabhaengig.
- Pro Frame nur `transform` (8x `matrix3d`, Heckbert-Abbildung Einheitsquadrat -> Viereck, ~20 Flops/Karte) und `opacity`/`transform` am Textblock; keine Layout-Eigenschaften, kein `transition: all`, `will-change` nur waehrend der Bewegung (`.is-live`), `contain: layout paint`; Loop stoppt in Ruhe, im Wartezustand wird nichts geschrieben.
- `pointermove` speichert nur, Anwendung einmal pro rAF; Rect/Skalierung/Kartengroesse per ResizeObserver gecacht (Layout-Reads nur bei Init/Resize/Eintritt).
- check120 (`act_check.cjs`: Startverzoegerung uebersprungen, Zeiger kreist 6.2 s durchgehend): `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine`; ohne Drosselung p95-Frame 0.7ms (p99 1.2), Script 0.04ms/Frame; mit 4x CPU p95 3.3ms (Grenze 10.4), p99 5.0, Script 0.14ms/Frame, 0 Layouts/Frame. Einziger Hinweis: INFO zu Layout-Lesezugriffen (nur Init/Resize).
- Mit der 1:1-Video-Choreografie (2.5 s Startwartezeit, 0.6 s Pause) meldet check120 bei 4x p95 16.8ms: das sind Compositor-Leerlauf-Frames des Headless-Chromium (60 Hz, kein Schaden), keine Skriptlast; reine Bewegungsphasen messen 4x p95 1.5-2.9ms (unthrottled 0.3-0.7ms).

## Einbindung (assets/cinematic-orbit-hero.html)
- Kopiere `CINEMATIC_ORBIT_HERO_CONFIG` (JS), `/* COMPONENT CSS */`, `/* COMPONENT JS */` und das Markup (`<!-- COMPONENT:START -->`): `section.coh` > `.coh__glow`, `.coh__copy` (h1.coh__title + p.coh__sub), `ul.coh__ring` > 8x `li.coh__card > img`; Bilder per `img.src` setzen (Demo: acht 190x152-Platzhalter aus dem Video, je ~6 KB, ersetzen!).
- `const hero = initCinematicOrbitHero(el, opts)` -> `{ open(), close(), toggle(), cycle(n), seek(ms), setProgress(p|null), getProgress(), destroy() }`.
- Optionen (tief gemerged): `trigger` ('auto'|'click'|'manual'), `startDelay`, `startWhenVisible`, `speed`, `curve`, `text`, `fan`, `ring`, `fanQuad`, `ringQuads`, `parallax{x,y,spring}`, `spin{auto,spring}`, `maxDt`. Look per `--coh-*` im `:root`. Container braucht eine Hoehe (Demo: 100dvh); `--u` skaliert alles ab 1234px Breite.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + framer-motion: ein Fortschritts-MotionValue (0 -> 1) steuert pro Karte Position/Skala/Rotation per `useTransform`; Karten bekommen `rotateY/rotateX` + `perspective`, Tiefe per Trig (`sin` -> scale/zIndex), Zeiger per `useSpring`.
```tsx
const progress = useMotionValue(0);
useEffect(() => { animate(progress, 1, { delay: 2.5, duration: 2.8, ease: [0.65, 0, 0.35, 1] }); }, []);
const mx = useSpring(0, { stiffness: 20, damping: 9 }), my = useSpring(0, { stiffness: 20, damping: 9 });
// pro Karte i: theta = -90deg + i*45deg; x = lerp(fanX[i], cx + rx*cos(theta), progress) + depth*mx
//   y = lerp(fanY[i], cy + ry*sin(theta), progress) + depth*my; scale = lerp(.43, .513/(1-.309*sin(theta)), progress)
//   rotate = lerp(-12, 16*cos(theta), progress); zIndex = round((sin(theta)+1)*50)
```

## Kreativ remixen
1. **Dauerorbit**: `spin: { auto: 18 }` (Grad/s) plus `ring.ry: .22` und `parallax.y: 90` - die Karten kreisen wirklich "von vorn nach hinten"; bei `auto: 45` + Beat-Sync (`hero.cycle(1)` auf jeden Beat) wird es ein Musik-Visualizer.
2. **Scroll-Szene**: Sektion 300vh mit `position: sticky`; `hero.setProgress(scrollProgress)` statt Zeitleiste - Fan beim Reinscrollen, Ring in der Mitte, per `cycle()` drehen beim Weiterscrollen.
3. **Tiefenschaerfe**: pro Karte `filter: blur((1 - depth) * 3px) brightness(.7 + depth * .3)` (nur auf 8 Karten) und `parallax.x/y` auf 160/90 - echtes Kino-Bokeh, Karten springen mit dem Zeiger.
4. **Doppelring**: zwei Instanzen mit `ring.ry` .10/.20, 12 Karten je Ring, gegenlaeufiges `spin.auto` (+-12) - Galaxie-Look fuer Portfolio/Team/Album.
5. **Andere Kontexte**: Produkt-Launch (Ring um Preis + CTA), Reise-/Foto-Seite ("Alle Orte"), Rezeptbuch; `trigger: 'click'` mit Button "Explore" (Fan = Stapel auf der Karte, Klick = Ring), `speed: 1.6` fuer knackigere Interaktion.

## Bekannte Abweichungen (ehrlich)
- Fotos sind aus dem Video entzerrte 190x152-Platzhalter (JPEG), weicher als das Original; Inhalte aus dem Video herausgemessen, nicht die Originalbilder.
- Ausloeser der Oeffnung nicht erkennbar (Zeit, Scroll oder Sichtbarkeit): hier Zeit/Sichtbarkeit; der Zeigerpfeil im Video (steht bei (880,372), verschwindet bei 5.62 s) ist keine Komponentenlogik - die Parallax-Deutung (Drift nach links unten ab 5.62 s) ist eine Annahme; der neutrale Endzustand ist die symmetrische Ruhe bei 5.0-5.6 s, der Drift bei 6.6 s noch nicht abgeschlossen (Amplitude x leicht unterschaetzt, ~-5px).
- Was nach 6.6 s passiert (Ring "cycle foreground to background", Dauerrotation?) ist im Video nicht zu sehen; `spin.auto` ist 0, `cycle()` ist eine Erweiterung.
- Kartenformen nur im Endzustand gemessen (+-4px), Zwischenzustaende linear interpoliert; der Faecher ist reine Drehung (rechte Kanten verdeckt).
- Schrift: Original wirkt wie Roboto/Inter Medium; mit Fallback (Liberation Sans) ist der Titel etwas kraeftiger, Untertitel ohne Light-Schnitt heller; Laufweite auf Arial-artige Breite kalibriert. Schatten der Karten im Video kaum erkennbar (geschaetzt).
- Glow ohne das 8-bit-Banding des Videos; erste Aufnahme-Frames (unscharfer Modal-Einblend) nicht nachgebaut. Nur bei 1234x673 verifiziert (Mobil/1920px per Screenshot geprueft). Bildvergleich: Fehler Original vs. Nachbau im Mittel ~3.7 Graustufen (Basis 2.4 durch Textur/Schrift), Zeitversatz 0 ms.
