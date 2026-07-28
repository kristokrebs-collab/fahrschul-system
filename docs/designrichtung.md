# Designrichtung — Premium-Relaunch „Die Krebs Route"

Dieses Dokument entsteht **vor** dem Code und ist die Messlatte, gegen die am Ende
geprüft wird. Es hält fest, was die Seite sein soll, was sie bewusst *nicht* wird,
und welche eine Bewegung sie trägt.

---

## Schritt 0 — Bestandsaudit (durchgeführt, ehrlich)

Geprüft am laufenden Production-Server bei 1440 / 1024 / 768 / 390 px, mit
Screenshots in Hero-, Finder-, Klassen-, Cockpit-, Preis- und Leistungs-Zustand.
Messwerte: 11 Kapitel, kein horizontaler Overflow auf keiner Breite, keine
Konsolenfehler, 3D-Route aktiv ab 1024 px.

**Wirkt die Route wie ein echtes Signature-Element?**
Zur Hälfte. Die WebGL-Route ist technisch echt — Kamera fährt eine Spline,
Wegpunkte pro Kapitel, Filament mit Lichtpuls. Aber sie liegt *hinter* allem bei
niedriger Deckkraft und wird von keinem Kapitel je zum Hauptdarsteller gemacht.
Damit erfüllt sie Prinzip 5 der Referenzen gerade nicht: Sie ist gedimmtes
Ambiente, nicht der scharfe visuelle Hauptdarsteller. Sie muss mindestens einmal
ganz nach vorn.

**Fühlt sich das Cockpit-Kapitel wie eine Inszenierung an?**
Ja, das ist der stärkste Teil der Seite. Fünf Szenen, Gerät kippt und setzt sich,
In-App-Scroll folgt dem Seiten-Scroll, Meilensteinschiene, Finale mit
Routenlinie. Das ist keine gerahmte Bildschirmaufnahme, das trägt.

**Reagiert der Finder leichtfüßig?**
Ja. Sechs Fragen, sofortige Antwort, Ergebniszustand mit echten Fakten.
Kein Ladezustand, kein Sprung. Handwerklich in Ordnung.

**Der eigentliche Befund: keine Helligkeitsspannweite.**
Messung: *alle elf* Kapitel haben `background: transparent`. Die gesamte Seite ist
eine einzige fast-schwarze Fläche, über die nur ein Atmosphären-Overlay in
Nuancen variiert. Damit sitzt die Seite exakt im KI-Standardlook „dunkler
Hintergrund plus ein Akzent". Das ist das größte Einzelproblem und wird zuerst
behoben.

**Weitere bestätigte Schwachstellen:** alle neun Leistungen liegen auf der
Startseite; die Wort-für-Wort-Enthüllung läuft auf *jeder* Überschrift statt nur
auf kurzen Kapitel-Headlines; ein Marquee ohne Informationswert steht zwischen
Hero und Finder (laut eigenen Regeln verboten); die WebGL-Route rendert
durchgehend, auch wenn der Tab im Hintergrund liegt.

---

## Designthese

> Eine Fahrschule verkauft keinen Kurs, sondern einen Übergang: von „ich werde
> gefahren" zu „ich fahre". Die Website macht diesen Übergang **sichtbar als
> Tagesverlauf** — sie beginnt im Dunkeln vor der ersten Fahrstunde und endet im
> klaren Tageslicht der bestandenen Prüfung. Die Route ist die Straße, auf der
> das passiert, und der Besucher fährt sie durch Scrollen selbst ab.

Daraus folgt alles Weitere: Die Helligkeit ist keine Stilfrage, sondern die
Erzählung. Wer am Ende der Seite ankommt, ist im Hellen angekommen.

---

## Farbrollen — der Tagesverlauf

Rot (`#e10a17`) und Ink bleiben Markenkern. Neu ist die **Spannweite**: jedes
Kapitel bekommt eine eigene Fläche auf einer Tageslicht-Achse, nicht nur ein
Overlay. Gemessen als Helligkeit der Kapitelfläche:

| Kapitel | Rolle | Fläche | Lichtstimmung |
|---|---|---|---|
| 01 Hero | Nacht vor dem Start | `ink-950` | Scheinwerfer auf nassem Asphalt |
| 02 Entscheiden | Dämmerung | `ink-900` | erster Aufhellung am Horizont |
| 03 Klassen | früher Morgen | `ink-850` | Studiolicht auf der Drehbühne |
| 04 System | Morgen | `dawn-800` | diffuser Dunst |
| 05 Cockpit | Gerät im Dunkeln | `ink-900` | Display ist die Lichtquelle |
| 06 Simulator | Innenraum | `ink-850` | Monitorlicht |
| 07 Kosten | **Tageslicht** | `dawn-200` | heller Papierbogen, dunkle Schrift |
| 08 Weg | Vormittag | `dawn-700` | klarer, kühler |
| 09 Beruf | Mittag | `dawn-600` | offen, sachlich |
| 10 Orte | Nachmittag | `dawn-750` | warmes Streiflicht |
| 11 Ankommen | **volles Licht** | `dawn-100` | Ziel erreicht, hell |

Zwei Kapitel (Kosten, Ankommen) kippen bewusst ganz ins Helle mit **dunkler
Schrift auf hellem Grund** — das ist der Bruch, der beweist, dass die Seite
Helligkeit kann und nicht aus Bequemlichkeit dunkel ist. Rot bleibt in beiden
Modi der einzige Akzent.

Neue Token: eine `dawn`-Skala (warmes Papierweiß bis Nebelgrau), damit helle
Flächen nicht als kaltes Weiß, sondern als Tageslicht lesen.

## Typografie

Unverändert Archivo (Display) + Instrument Sans (Fließtext) — sitzt bereits.
Neu ist die **Disziplin nach Prinzip 2**: genau *ein* typografischer Ausreißer
auf der ganzen Seite. Das ist die Hero-Zeile „Ein Weg." — nur sie bekommt die
Buchstaben-Enthüllung mit Federphysik und den Lichtstrich. Jede andere
Überschrift bleibt ruhig und erscheint als Ganzes.

## Motion Map — genau eine primäre Bewegung

**Primär: die Fahrt.** Der Scrollfortschritt bewegt die Kamera auf der Route.
Alles andere ist entweder Reaktion darauf oder Mikro-Feedback auf Eingaben:

| Ebene | Bewegung | Auslöser |
|---|---|---|
| **Primär** | Kamerafahrt auf der Spline, Kapitel als Wegpunkte | Scrollposition |
| Reaktion | Lichtstimmung des Kapitels, Wegpunkt zündet | Kapitel im Blick |
| Reaktion | Cockpit-Sequenz, Weg-Lichtstrahl | Scroll innerhalb des Kapitels |
| Mikro | Scheinwerfer-Cursor, magnetischer CTA, Tab-Indikator | Zeiger/Eingabe |

Verboten in dieser Map: identisches Fade-up pro Sektion, Animation von
Fließtext, jede zweite konkurrierende „Hauptbewegung".

---

## Fünf KI-Muster, die bewusst vermieden werden

1. **Durchgehend fast-schwarzer Hintergrund mit einem Akzent.** Gegenmaßnahme:
   die Tageslicht-Achse oben, inklusive zweier echter Hell-Kapitel mit dunkler
   Schrift. Prüfkriterium: Screenshot-Reihe muss von oben nach unten sichtbar
   heller werden.
2. **Wort-für-Wort-Scroll-Reveal als durchgehendes Motiv.** Gegenmaßnahme: nur
   noch kurze Kapitel-Headlines (≤ 4 Wörter), plus der eine Hero-Ausreißer.
   Leads und lange Überschriften erscheinen ohne Animation.
3. **Marquee als Deko.** Gegenmaßnahme: ersatzlos entfernt. Was übrig bleibt,
   trägt Information (Kapitelnummern, Klassenkürzel) oder existiert nicht.
4. **Stock-Drohnenvideo mit 20 % Deckkraft hinter Fließtext.** Gegenmaßnahme:
   Bewegtbild ist entweder scharfer Hauptdarsteller in einem eigenen Rahmen
   (Drehbühne, Simulator, Cockpit) oder es fliegt raus. Keine gedimmten
   Ambient-Loops hinter Absätzen.
5. **Karten-Friedhof als Inhaltsstrategie.** Gegenmaßnahme: Startseite zeigt
   kuratierte Auswahl mit einem klaren Weg zur Übersicht; Details leben auf
   eigenen Seiten.

---

## 21st.dev-Bookmarks — Zuordnung

Abgerufen wurden alle 16 vorhandenen Bookmarks. Eingesetzt und in Rot/Schwarz
übersetzt werden mindestens elf; jede Technik dockt dort an, wo sie der Route
oder einem Kapitel dient — nie als Fremdkörper im Originallook.

| # | Bookmark | Einsatzort bei Krebs |
|---|---|---|
| 5508 | Shiny Button | Primär-CTA: Conic-Schimmer als Scheinwerferstreif |
| 2491 | Reveal Text | *Der eine* Ausreißer: Hero-Zeile „Ein Weg." |
| 1081 | Container Scroll | Cockpit-Gerät kippt beim Eintritt in die Szene |
| 1913 | Section With Mockup | Digitalpaket: Parallaxe auf dem Geräte-Mockup |
| 525 | Animated Tabs | Klassen-Spurwechsel mit gleitendem Indikator |
| 3226 | Minimal Dock | Kapitel-Rail als Dock mit Vergrößerung + Reflexion |
| 4559 | View Magnifier | Fahrzeug-Stills auf Klassenseiten: Lupe im Detail |
| 9643 | Morphing Cursor | Scheinwerfer-Cursor, nur Desktop, nur auf der Route |
| 8687 | Hover Footer | Footer: Spalten reagieren auf Annäherung |
| 5649 | Hero (Paper Shader) | Hero-Dunstschicht über dem Asphaltvideo |
| 2049 | Sign In Flow | Cockpit-Login-Vorschau (nicht auf der Homepage) |
| 3052 | Feature Carousel | Simulator-Situationen als Karussell |
| 4582 | Minimalist Hero | Hero-Zurückhaltung: eine Aussage, viel Luft |

---

## Prüfliste „fertig"

- [ ] Fünf Sekunden: Angebot, Standort, nächste Aktion erkennbar
- [ ] Route ist mindestens einmal Hauptdarsteller, nicht nur Hintergrund
- [ ] Sichtbare Helligkeitsspannweite über die Kapitel, zwei helle Kapitel
- [ ] Genau ein typografischer Ausreißer
- [ ] Keine neun Leistungskarten auf der Startseite
- [ ] Kein Marquee ohne Informationswert
- [ ] ≥ 11 Bookmark-Techniken eingesetzt und umgefärbt
- [ ] Keine dauerhafte GPU-Last (Render pausiert außerhalb des Sichtfelds)
- [ ] Alle CTAs übertragen Klasse, Standort, Anliegen, Quelle
- [ ] Tastatur, Fokus, Kontrast, `prefers-reduced-motion`, Mobile geprüft
