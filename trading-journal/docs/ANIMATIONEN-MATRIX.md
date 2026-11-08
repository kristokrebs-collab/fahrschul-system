# Animationen-Matrix – alle 177 Inventarpunkte

Stand: 2026-10-31, nach Runde 10 (Zweig `claude/dreamy-dirac-uwi1be`, Commit `7b7d81d`); fortgeschrieben am 2026-11-08 für Runde 12, Paket C (Abschnitt „Runde 12 – Paket C“ unten, die Zeilen 27, 35, 55 und 129 und die Zusatzpunkte Z2, Z7 bis Z9). Der Nutzer hat im Master-Prompt verlangt:
„Jeder der 177 Inventarpunkte muss einzeln geprüft und dokumentiert werden.“ Diese Datei ist die Antwort: eine Zeile je Nummer, geprüft gegen den Code in
`trading-journal/` (Pfade unten sind relativ dazu), ohne Beschönigung. Wo etwas nicht belegt werden konnte, steht das in der Zeile und am Ende der Datei.

Die Vollständigkeit (alle 177 Nummern genau einmal, jeder Status aus der erlaubten Liste) prüft `tests/unit/docs.animationenMatrix.test.ts`. Der Test sagt
nichts darüber, ob eine Zeile inhaltlich stimmt; das kann nur der Blick in den genannten Code.

## Zusammenfassung

| Status | Punkte | Bedeutung |
|---|---|---|
| vorhanden | 44 | war schon da, Runde 9 und 10 haben es nicht verändert |
| wiederhergestellt/verbessert | 23 | existierte, ist durch Runde 9 oder 10 besser (siehe Hinweis zum Wort „wiederhergestellt“ unten) |
| neu eingebaut | 21 | gab es nicht, ist in Runde 9 bis 12 dazugekommen (teils sinngemäß, die Zeile sagt es) |
| bewusst nicht | 65 | passt nicht zu einem Trading-Journal, würde Lesbarkeit, Leistung oder die Startseite verletzen, oder braucht Dienste, Videos und WebGL |
| offen | 3 | sinnvoll, noch nicht gebaut |
| nicht prüfbar | 21 | Quelle R: die Originaldatei lag nie vor und im Code steht kein Nachbau unter diesem Namen |
| **zusammen** | **177** | |

In der App sind 88 von 177 Punkten (44 schon vorher, 23 verbessert, 21 neu). 65 sind begründet nicht gebaut,
3 sind offen, 21 lassen sich ohne die Originale nicht beurteilen. (Runde 12 holt zwei Punkte aus „nicht prüfbar“ in „neu eingebaut“: 27 Radial Share und 129 Thinking Orbs – beide gab es schon seit Runde 11, die Zeilen waren veraltet.)

Nach Quelle (V = Code oder Technik-Anleitung im Skill-Bestand, R = nur referenziert, N = nur Konzept/Titel):

| Quelle | Punkte | vorhanden | wiederhergestellt/verbessert | neu eingebaut | bewusst nicht | offen | nicht prüfbar |
|---|---|---|---|---|---|---|---|
| V | 123 | 25 | 19 | 17 | 59 | 3 | 0 |
| R | 46 | 19 | 4 | 2 | 0 | 0 | 21 |
| N | 8 | 0 | 0 | 2 | 6 | 0 | 0 |

Zu Quelle R (Zahlen mit dem Stand von Runde 12): Im Bestand liegt von der Sammlung `pulse-motion` nur `motion-graphics`, `fintech-glass` und `relay-lime`; die übrigen Vorlagen-Dateien (in
`INVENTAR.md` aufgeführt) sind nicht mehr da. Wo die App einen Port aus früheren Runden hat (`src/motion/pulse/*`, README dort), steht der Port als
Beleg und die Zeile heißt „vorhanden“. Ein Abgleich mit der Vorlage selbst war nicht möglich. Wo es weder Vorlage noch Port gibt, heißt die Zeile „nicht prüfbar“.

## Wie die Tabelle zu lesen ist

- **Status** (nur diese Werte): `vorhanden`, `wiederhergestellt/verbessert`, `neu eingebaut`, `bewusst nicht`, `offen`, `nicht prüfbar`.
- **Hinweis zu „wiederhergestellt“:** Belegbar ist nur „verbessert“. In keinem Fall habe ich nachweisen können, dass eine Animation entfernt und dann zurückgeholt wurde
  (Befund im Abschnitt „Frühere Animationen“). Der Wert heißt so, weil der Auftrag ihn so vorgibt.
- **Sinngemäß** in einer Begründung heißt: die App hat eine leichtere oder andere Form derselben Idee, nicht die Technik der Vorlage. **Ohne Vorlage gedeutet** heißt: der Name steht im
  Inventar, eine Beschreibung gibt es nicht, die Zeile ist meine Lesart.
- **Stelle im Code:** Datei oder Komponente, in der es steht; „–“ heißt, es gibt nichts. Jede Zeile mit `vorhanden`, `wiederhergestellt/verbessert` oder `neu eingebaut` nennt eine Stelle.
- **Entscheidung:** `bleibt` (so lassen), `bleibt (nur reiche Seiten)` (nur unter `[data-rich]`, siehe Leitplanken), `nicht bauen`, `später bauen`, `Original anfordern`.
- Zusammengehörende Punkte (Button-Familie 9 bis 19, Text 65 bis 81, Video 138 bis 148) haben je eine eigene Zeile, die Begründung verweist teils auf die erste.
- Doppelte Namen im Inventar bleiben doppelt: 32 und 121 (Orbiting Avatars), 58 und 108 (Sticky Stacking Cards), 19 und 115 (Magnetic Hover), 22 und 175 (Theme Toggle), 5 und 42 (Sprach-Auswahl).

Belege für Runde 9 und 10 (Commits im Zweig). Die Zuordnung folgt der Reihenfolge der Commits: ab `2e8982f` (`data-rich`) ist Runde 10, die Commits davor vom selben Tag sind Runde 9; die Commits selbst tragen keine Rundennummer.

| Stufe | Commit | Inhalt |
|---|---|---|
| Runde 9 | `d4c6e4c` | Buttons auf ein kleines System (`Button`, `chipClass`), „Mehr anzeigen“ (`Fold`) |
| Runde 9 | `a7fda14`, `862801f`, `cbe81b6` | kurzes Trade-Formular, Navigation in vier Gruppen mit Seitenleiste ab 768 px, Feinschliff |
| Runde 9 | `79d2716` | Aktien › Branchen-Trend mit Fächer-Canvas (10.000 Pfade aus einer Labor-Datei) |
| Runde 10 | `2e8982f`, `d1fcddd` | `data-rich` auf allen Seiten außer Übersicht und Cockpit, CSS-Budget 52 KiB |
| Runde 10 | `560adde`, `79b7c5f` | reiche Seiten: Seitenlicht, Geisterwort, Titelwörter, Karten-Tilt, Diagonalwelle, Leerzustands-Bilder |
| Runde 10 | `78a4fd7`, `d6477e2` | Bedienelemente: Button-Zustände, Glanz, Rollen, Magnet, Chip-Häkchen, Suchfeld-×, Kopieren, Schritt-Feld, Toast-Staffel |
| Runde 10 | `fb6c458` | Diagramme, Zahlen, Listen: Monte-Carlo-Fächer als Canvas, `CountText`, `Rows`, `ChartPlaceholder` |
| Runde 10 | `3b77e4c` | Markt › Einordnung: Karte „Top-Trader: Netto Long/Short“ |
| Runde 10 | `da7bbfc` | Rahmen: Seitenleiste mit Blick über die Seite, Zeichnen der Symbole, untere Leiste, Menü als Blatt, Burger, Kurs als Zählwerk, Sonne/Mond |

## Offen und sinnvoll (nach Nutzen für den Nutzer)

1. **10.000 Läufe im Analyse-Monte-Carlo** (Zusatzpunkt 4): die App rechnet dort 2.000 Läufe; 10.000 × 250 Trades blieben unter der Zellgrenze `MC_CELL_CAP` (4 Mio.), Laufzeit auf Handys wäre vorher zu messen.
2. **Logo als Pfad, der sich zeichnet** (Nr. 83, Zusatzpunkt 2): braucht zuerst einen Entwurf, denn das Kopfzeilen-Logo ist das Schriftzeichen ₿; die Navigationssymbole zeichnen sich schon.
3. **Gleiten in Listen nach Löschen oder Sortieren** auf weiteren reichen Seiten (`LayoutCascade` statt der entfernten App-Gruppe, Commit `9266b0b`): nur gezielt und mit Messung, denn die Gruppe wurde wegen ihrer Messkosten abgeschafft (Tablet-Seitenwechsel p95 38 bis 61 auf 13 bis 15 ms).
4. **Rand-Lauf an der einen Hervorhebung je Seite** (Nr. 17): `Button run` ist gebaut, wird aber an keiner Stelle gesetzt.
5. **Bildzoom in der Screenshot-Kachel** (Nr. 56): ein leichter Zoom im Rahmen, passend zum Wechsel von grau zu Farbe.
6. **Hover-Decode für ein bis zwei Navigationswörter** (Nr. 75): `TextScramble scrambleOnHover` kann es schon.
7. **Originale nachliefern**, falls einer der 23 Punkte „nicht prüfbar“ gewünscht ist (zuerst 1, 27, 128, 129, 153): ohne Vorlage ließe sich nichts ehrlich nachbauen.

## Leitplanken

- **Startseite (Übersicht) und Cockpit bleiben unverändert** in Inhalt und Aussehen. Der Rahmen (Seitenleiste, untere Leiste, Menü, Kopfzeile) darf sich ändern.
  Laut `src/app/README.md` („Bewegung im Rahmen“, Pixelvergleich) war das Cockpit nach Runde 10 in allen vier Ansichten (dunkel und hell, mobil und Desktop) im Inhalt pixelgleich;
  bei der Übersicht weichen nur Live-Zellen ab (Kurs, 24-h-Linie, Order-Flow, Countdown). Ich habe diesen Vergleich für die Matrix nicht neu gemessen.
- **`data-rich`:** `PageHost` setzt das Attribut auf jede Seiten-Ebene außer Übersicht und Cockpit (`isRichPage` in `src/motion/rich.ts`, `RichContext` für Portale). Neue reiche Effekte stehen in
  CSS als `[data-rich] …` oder in Komponenten, die nur dort eingebunden sind (`useRich()` / `useRichFx()`; Bausteine, die auch auf der Übersicht stehen, fragen den DOM erst im Effekt,
  `isRich(el)` in `src/chart/rich.ts`). Sheets und Dialoge liegen außerhalb der Seite und bekommen die reichen Feinheiten nicht. Zeilen mit „nur reiche Seiten“ folgen dieser Regel.
- **Budgets** (`scripts/bundleBudget.mjs`, KiB gzip): JS-Erstladung 800, CSS-Erstladung 52 (seit Runde 12, Paket C: 52,5; gemessen 52,1), ein Lazy-Chunk 120, Haupt-Chunk `index` 575. Für Runde 10 galt je Auftrag höchstens +4 KiB Erstlade-JS und
  +1,5 KiB CSS; alles Größere ist ein eigener Lazy-Chunk (`PageAura`, `EmptyArt`, `TraderNetCard`). Ich habe kein neues Build gemessen.
- **Reduced Motion:** `useReducedFx()` und `MotionRoot` (`reducedMotion="user"`) zeigen den Endzustand sofort; `src/styles/base.css` setzt CSS-Dauern auf nahe null; Schleifen starten nicht
  (`tests/e2e/motion-global.spec.ts`, `tests/e2e/shell-motion.spec.ts`). Mit `html[data-safe-fx]` (Samsung Internet oder `?safefx=1`) entfallen Weichzeichner und `backdrop-filter`.
- **Weitere Regeln, die in „bewusst nicht“ den Ausschlag geben:** nur `transform`, `opacity`, `filter`, `clip-path`; keine Dauerschleife ohne Pause außerhalb des Bildes oder bei verdecktem Tab (`useIdleGate`);
  nichts verdeckt Zahlen; kein Layout-Springen (`tests/e2e/layout-shift.spec.ts`); Tippflächen mindestens 44 px (`tests/e2e/hitbox.ts`); Hauptaktionen („Trade eintragen“, Speichern, Bezahlen, Löschen) behalten Form
  und Wirkung (`fx={false}`); keine erfundenen Zahlen (Zahlenbänder zeigen nur echte Werte); keine neuen Abhängigkeiten.

## Zusatzpunkte des Nutzers

| Nr. | Punkt | Stand | Belege und Grenzen |
|---|---|---|---|
| Z1 | Einklappbare Sidebar | erledigt | Ab 768 px steht die Seitenleiste (`src/app/Sidebar.tsx`): Fuß-Knopf „Seitenleiste einklappen / ausklappen“ (`SIDEBAR_STRINGS`), Wahl `auto`, `open`, `closed` in `uiStore.sidebar` (je Browser gemerkt), Gruppenköpfe falten ihre Zeilen. Runde 10 lässt die schmale Leiste bei Maus, Fokus oder Berührung über die Seite „blicken“ (`src/app/useSidebarPeek.ts`, `src/styles/shell-motion.css`). Tests: `tests/unit/app.sidebar.test.tsx`, `tests/unit/app.shellMotion.test.tsx`, `tests/e2e/shell-motion.spec.ts`. |
| Z2 | Sequenzielle SVG-Logo-Animation | teilweise | Gezeichnet werden die **Navigationssymbole** der Seitenleiste (Runde 12 neu gefasst, Messung im Abschnitt „Runde 12 – Paket C“): einmal je **Seitenaufruf** (vorher je Sitzung), erst wenn die Intro-Bühne weg ist (vorher lief sie darunter, unsichtbar), die Zeilen blenden von oben nach unten 52 ms versetzt mit je 300 ms ein, die **Glyphen zeichnen strikt nacheinander** (ein Glyph ist fertig, bevor der nächste startet: 72 ms je Glyph, die Striche eines Glyphs teilen sich den Platz; `sidebarSequence` und `applySidebarSequence` in `src/app/shellFx.ts`, `sb-draw` in `src/styles/shell-motion.css`, `pathLength="1"`). Nicht bei Hover, Seitenwechsel oder erneutem Rendern; mit „weniger Bewegung“ steht alles sofort da. Die untere Leiste zeichnet das Symbol beim Wechsel neu (0,46 s). Das Kopfzeilen-Logo ist das Schriftzeichen ₿ und kein Pfad; dafür zeichnet die Logo-Sequenz (`src/app/logoSeq.ts`) seine Striche nacheinander. Offen: ein Logo als Pfad (Nr. 83). |
| Z3 | Frühere Animationen wiederherstellen | Befund: nichts ersatzlos entfernt | Siehe Abschnitt „Frühere Animationen“: sechs belegte Abschaltungen oder Vereinfachungen, überwiegend aus Leistungsgründen und meist mit Messwert im Commit; keine gelöschte Animation. |
| Z4 | 10.000-Pfade-Simulation (Canvas) | teilweise | **Anzeige ja:** `FanChart` in `src/views/aktien/branchen/charts.tsx` (Aktien › Branchen-Trend › „Ergebnis eines Laufs prüfen“) zeigt 10.000 simulierte Pfade aus einer `megatest.json` des Python-Labors als Canvas: Bänder 5, 25, 50, 75, 95 % aus allen Pfaden, nur eine Stichprobe als Linien, Log-Skala, Einzeichnen von links, Fadenkreuz. Die App rechnet die Pfade nicht selbst (die Karte sagt es). **In der App gerechnet:** Analyse › Monte Carlo mit 2.000 Läufen (`MC_RUNS` in `src/domain/analytics/montecarlo.ts`, `src/views/analyse/MonteCarloCard.tsx`, Fächer-Canvas `fanDraw.ts` mit 120 Linien); die Zeile der Karte nennt ehrlich „2000 Läufe“. Offen: 10.000 Läufe in der App. |
| Z5 | Wal-/Top-Trader-Anzeige | erledigt | Übersicht: Karte `src/views/overview/TopTraderCard.tsx` und die Plakette im Long-Signal (`TraderNetSection.tsx`). Runde 10: große Karte „Top-Trader: Netto Long/Short“ auf Markt › Einordnung (`src/views/markt/TraderNetCard.tsx`, Canvas `TraderNetPlot.tsx`: Fläche um die Nulllinie, Preislinie, Pfeil am letzten Umschlag, Ring, Fadenkreuz, Zeitraum-Umschalter; Tests `tests/unit/views.markt.traderNet.test.tsx`, `tests/e2e/trader-net-markt.spec.ts`). Ehrlich benannt: Es sind die Top-Trader-Konten der Börse Binance (obere 20 % nach Einsatz), **keine On-Chain-Wale**; in der Oberfläche heißt es „Top-Trader (Binance)“, „Wale“ steht nur im Hilfesatz (verneint) und als Suchwort im Funktionsfinder (`src/app/features.ts`). Der Verlauf reicht rund 30 Tage zurück. |
| Z6 | Quick Reply Pills (im Inventar bei Nr. 95 genannt, ohne eigene Nummer) | vorhanden | Antwort-Pillen im Coach-Chat (`src/views/coach/ChatCard.tsx`, `suggestQuestions`, Folgefragen). |
| Z7 | Ladezustände im Stil des Voice Ring | erledigt (Komponente und Einbauorte; keine Zahlen erfunden) | Neue Variante `ring` der Komponente `ThinkingOrb` (`src/motion/ringMath.ts` rein, `src/motion/VoiceRingCanvas.tsx` als Lazy-Chunk, Canvas ohne neue Abhängigkeit): ein leuchtender, weich verformter Ring in drei Zuständen **aktiv** (drei Fäden, tiefere Verformung, Halo, ein roter Akzent läuft herum), **denkt nach** (zwei Fäden, flacher, schneller) und **ruhig (mono)** (ein dünner Faden in Textfarbe, bewegt sich einen Moment und ruht dann: keine Dauerschleife im Leerlauf). Die Schleife (`orbLoop`) läuft nur bei sichtbarem Tab und sichtbarem Element; Reduced Motion zeigt den stillen SVG-Ring; die Box ist immer `size × size` (kein Layoutsprung). Eingebaut, wo vorher ein Punktbild oder nur Text stand: Coach-Chat und Assistent („Denke nach …“, `src/motion/fx/CoachStream.tsx`), Zeitmaschine (Status „20.000 Szenarien werden berechnet · Sitzungen simulieren“ mit der echten Pfadzahl des Laufs, `TimeMachineCard.tsx`), Wal-Karte (`TraderNetCard.tsx`), Screenshot-Import (`ExtractSheet.tsx`, `OcrImportSheet.tsx`). **Nicht angefasst:** der Kaufknopf „wird vorbereitet“ (Paket B), die Markt-Karte „Zustand der Box“ (bleibt der Punkt-Lader `DotMatrix`, derselbe wie in „Beste Setups“). Tests: `tests/unit/motion.ring.test.tsx`, `tests/unit/views.timemachine.test.tsx`, `tests/unit/views.markt.traderNetWal.test.tsx`, `tests/e2e/interaktionen.spec.ts` (Orb in der Zeitmaschine). |
| Z8 | Teilen-Fächer nach „Share Button Animation“ | erledigt | Siehe Zeile 27. Unverändert bleibt das behobene Scroll- und Schließverhalten (der Fächer geht zu, sobald sich der Auslöser um mehr als 1 px bewegt; ein Scroll, der ihn stehen lässt, schließt nicht). Neu in Runde 12: ein Zeiger, der beim Öffnen noch auf dem Auslöser ruht, wählt nichts (die Chips fliegen unter ihm hervor; Hover wählt erst nach 360 ms), und der Fokus, der von selbst in den Fächer springt, zählt nicht als Wahl – die Beschriftung fragt „Kanal wählen“, bis eine Taste oder der Zeiger wählt. Tests: `tests/unit/motion.radialShare.test.tsx` (23), `tests/e2e/interaktionen.spec.ts` „Radial Share“ (6 je Projekt). |
| Z9 | Suche nach Tätigkeiten | erledigt | Die Suche (Seitenleiste „Seiten suchen“, Menü-Finder, Seite „Funktionen“, globale Suche mit `/`) antwortet auf „Trade suchen“ (→ das Suchfeld der Trade-Liste, der Cursor steht darin), „Screenshot finden“ (→ Bild-Originale und Hashes), „Alarm konfigurieren“ (→ Alarme & Zustellprotokoll), „Simulation öffnen“ (→ Zeitmaschine) – jeweils als erster Treffer. Dafür: Absichten in `src/app/features.ts`, Anker `trades-search` auf dem Suchfeld (`TradeFilters.tsx`), eine zu allgemeine Absicht der Seite „Handelsplan“ entschärft (`pageTargets.ts`). Das Suchfeld ist bereits eine Glas-/Clay-Fläche (`.sf-box`: Blur, innere Lichter und Schatten, 12 px Radius). `/` öffnet die globale Suche mit dem Cursor im Feld, Escape leert und schließt sie (beides gab es schon). Tests: `tests/unit/app.searchTasks.test.ts`, `tests/e2e/funktionsfinder.spec.ts` (GOALS), `tests/e2e/suche-aufgaben.spec.ts`. |
| Z10 | „Flip“-Erklärgrafik (Runde 12, Paket W; zählt zu Nr. 169 „Chart Drawing Reveal“) | erledigt, nur mit Mock-Daten geprüft | Neu: Feld „Was ist ein Flip?“ oben in der Top-Trader-Karte auf Markt (`src/views/markt/FlipExplainer.tsx`, Modell `flipExplainerModel.ts`, Texte `flipExplainerStrings.ts`, eigener Lazy-Chunk). **Bewegung** (einmal, beim ersten Sichtbarwerden; nur `transform`, `opacity`, `stroke-dashoffset`, Web Animations API, keine Dauerschleife): die Linien zeichnen sich (SVG-Pfade mit `pathLength`), die Flächen füllen sich von der Nulllinie aus, die Marke blendet ein und ihr Ring pulst **einmal**; das Schema (drei Felder, „Schema, keine Daten“) spielt seine drei Bilder nacheinander. **Reduzierte Bewegung:** fertiges Bild sofort, keine Animation, nichts bleibt unsichtbar. **Nicht nur Farbe:** Vorzeichen (+ / −), Schraffur der Short-Seite, Wörter im Bild und in der Legende. **Ruhe im Layout:** feste Diagrammhöhe, reservierte Textblöcke (`<style>` in der Komponente, nicht im App-CSS), Platz in der `PendingCard` nachgemessen (`flipExplainerReserve.ts`, `MarktView.tsx`). Ehrlich: zeigt nur, was der Verlauf der Karte hergibt (letzter Flip im Fenster der letzten 14 Tage, sonst „Kein Flip …“; Lücken bleiben Lücken); die Einordnung ist ein Hinweis, keine Prognose und keine Anlageempfehlung. Belege: `tests/unit/views.markt.flipExplainer.test.tsx` (18), `tests/e2e/flip-explainer.spec.ts` (mobil + Desktop, Reveal einmal gezählt, Reduced Motion, CLS, axe hell/dunkel, Alarm-Link; Cloud-Ausgabe gegen Mocks), Bilder `docs/audit/screens/flip-*.jpg`. Nicht gegen echte Binance-Werte geprüft. |

## Runde 12 – Paket C: Seitenleiste, Ladezustände, Teilen, Suche

Stand 2026-11-08. Quelle der Aufträge: Launch-Audit-Auftrag (Abschnitte 4, 5, 7) und die Aufnahmen des Nutzers: „Glassy SideBar V5“ (Instagram), „Share Button Animation“ (Instagram), „Voice Ring“ (libraries.dev, Chrome). Von den Aufnahmen ist nur das **Verhalten** übernommen, kein Quelltext (Näheres in `docs/KOMPONENTEN-QUELLEN.md`).

**Warum der Nutzer die Einblend-Folge der Seitenleiste nicht gesehen hat** (gemessen mit Playwright/Chromium 1440 × 900, jedes Bild der Seitenleiste mitgeschrieben; die Maschine rendert ohne GPU, daher nur etwa 20 Bilder je Sekunde, die Zeiten selbst sind die der Animationen):

| Zeit nach dem Laden | vorher (Stand `13bbb7d`) | nachher |
|---|---|---|
| 0,65 s | Seitenleiste da, `data-draw="run"`, Intro-Bühne deckt die App (`data-intro-covered`) | Seitenleiste da, `data-draw="wait"`, Zeilen unsichtbar, keine Animation läuft |
| 0,7 s bis 2,2 s | Welle und Zeichnen laufen **unter der Bühne** | wartet |
| 3,1 s | `data-draw` weg, Sitzungs-Flag `tj2-sb-draw` gesetzt – in dieser Sitzung nie wieder | wartet noch |
| 5,2 s | Bühne hebt sich: die Seitenleiste steht fertig da, nichts war zu sehen | Bühne hebt sich, `data-draw="run"` startet im selben Augenblick |
| 5,3 s bis 6,6 s | – | Zeilen blenden von oben nach unten ein, Glyph für Glyph gezeichnet |
| 7,4 s | – | `data-draw` weg, alles ruht gezeichnet |

Ursache: Die Seitenleiste las die Phase des Intros einmal beim Aufbau (`useState`-Start). Beim ersten Rendern steht die Phase noch auf „off“ – `IntroHost`, der letzte Knoten der Hülle, setzt „stage“ erst in seinem Layout-Effekt –, also startete die Folge sofort und war unter der Bühne unsichtbar und verbraucht. Behoben durch `introCoversApp` / `introPendingAtBoot` (`src/intro/introBoot.ts`): die Folge wartet, solange die Bühne die App deckt **oder gleich decken wird** (einmal entschieden, bevor das Intro sein Sitzungs-Flag schreibt), und solange der Tab verborgen ist. Zweite Ursache: Die Symbole zeichneten nicht nacheinander (640 ms je Strich, 46 ms Versatz: etwa 14 Symbole gleichzeitig). Jetzt hat jedes Glyph seinen eigenen Platz (`sidebarSequence`, rein und getestet). Dritte Ursache: „einmal je Sitzung“ – ein Neuladen im selben Tab zeigte nichts mehr; jetzt **einmal je Seitenaufruf** (Modulzustand: kein Neustart bei Hover, Seitenwechsel, erneutem Rendern oder Größenwechsel über 768 px). Ausfallsicher: nach 20 s Wartezeit zeigt die Leiste ihre Zeilen einfach, mit „weniger Bewegung“ steht alles sofort da.

Messung der Folge (nachher, Reihenfolge und Takt): Zeilen 52 ms versetzt, je 300 ms; 19 Glyphs, 72 ms je Glyph, Glyph n + 1 beginnt erst, wenn Glyph n fertig ist (deklarierte Zeiten der laufenden Animationen und die Bilder des Browsers, `tests/e2e/sidebar-sequenz.spec.ts`). Die Feder des Aktiv-Indikators (`spring.layout`) ist unverändert. Die untere Glas-Leiste am Handy bleibt; ihre Symbole kommen weiterhin von links nach rechts (30 ms Versatz, `stagger.cards`), einmal je Sitzung – jetzt mit einem Test.

Was sich geändert hat (Datei | früher | geändert | Funktion | visuell | mobile | Tastatur | Test):

| Datei | früher | geändert | Funktion | visuell | mobile | Tastatur | Test |
|---|---|---|---|---|---|---|---|
| `src/app/Sidebar.tsx`, `src/app/shellFx.ts`, `src/intro/introBoot.ts`, `src/styles/shell-motion.css` | Folge startete bei Mount, unter der Bühne; Flag je Sitzung; Symbole überlappten | wartet auf die sichtbare App, einmal je Seitenaufruf, strikte Glyph-Folge aus reiner Zeitleiste | Reihenfolge, Einmaligkeit, Warten auf die Bühne und auf den Tab | Zeilen 52 ms / 300 ms, Glyphs 72 ms, Glanz am Ende jedes Glyphs | nur ab 768 px (Handy: untere Leiste unverändert) | – | `tests/unit/app.sidebarSequence.test.tsx`, `tests/e2e/sidebar-sequenz.spec.ts` |
| `src/app/Sidebar.tsx`, `src/app/SidebarParts.tsx` | `aria-label` auf Zeilen, kein Tooltip | `title` an Zeilen und Fußknöpfen, solange die Namen nicht offen sind | Tooltip und Name für Icon-only-Zustände | nativer Tooltip | Langdruck öffnet die Namen wie zuvor | Fokus öffnet die Namen wie zuvor | `tests/unit/app.sidebarSequence.test.tsx` |
| `src/motion/ringMath.ts`, `VoiceRingCanvas.tsx`, `ThinkingOrb.tsx` | drei Punktbilder | Variante `ring` mit drei Zuständen, stiller SVG-Ring, Ruhe im Leerlauf | Ladezustand ohne Dauerschleife, ohne Layoutsprung | leuchtender Ring, ein roter Akzent, Mono ohne Glühen | gleich | – | `tests/unit/motion.ring.test.tsx`, Bilder in `docs/belege/runde12-paket-c/` |
| `src/motion/fx/CoachStream.tsx`, `TimeMachineCard.tsx`, `TraderNetCard.tsx`, `ExtractSheet.tsx`, `OcrImportSheet.tsx` | `TextShimmer` allein / Punktbild | Ring neben dem ehrlichen Text; Zeitmaschine nennt die echte Pfadzahl | siehe Z7 | siehe Z7 | gleich | – | die genannten Unit- und E2E-Tests |
| `src/motion/RadialShare.tsx`, `radialLayout.ts` (`captionSide`), `RadialShareButton.tsx`, `ExportCard.tsx` | dunkle Chips, Wort im Auslöser | Glas-Chips, Kreuz im Auslöser, Beschriftung mit `detail` je Ziel, Zeiger-Schonfrist | siehe Z8 | Chip-Drehung beim Auffächern (Feder `spring.pop`) | Touch und Klemmung am Rand unverändert | Pfeile, Home, End, Esc, Tab unverändert | `tests/unit/motion.radialShare.test.tsx`, `tests/e2e/interaktionen.spec.ts` |
| `src/app/features.ts`, `pageTargets.ts`, `TradeFilters.tsx` | „Trade suchen“ führte zur Seite Handelsplan, „Simulation öffnen“ zu „Branchen-Papier“ | Absichten ergänzt, Feldanker | siehe Z9 | – | Menü-Finder am Handy | `/`, Esc | `tests/unit/app.searchTasks.test.ts`, `tests/e2e/suche-aufgaben.spec.ts` |

Nicht geändert und nicht angefasst (Auftrag): Anmelde-Sheet, Bezahlfenster und Kaufstrecke (Paket B), Aufbau von Startseite und Cockpit, „Trade eintragen“. Offen: keine Messung auf einem echten Gerät (nur Chromium ohne GPU); die Wirkung des Ringes im Dauerbetrieb auf einem Handy ist nicht gemessen.

## Frühere Animationen: Befund aus `git log`

Gesucht wurde im ganzen Verlauf des Projekts (613 Commits mit `trading-journal`, 2026-09-30 bis 2026-10-31) mit den Suchworten animation, motion, Physik/physics, Pulse, entfernt, vereinfacht
(und englisch removed, dropped, simplif, no longer), außerdem nach gelöschten Dateien unter `src` und nach entfernten `@keyframes`-Zeilen. **Ergebnis: Keine Animation wurde ersatzlos gelöscht.**
Gelöscht wurden nur drei Dateien (`FeatureCard.tsx`, `overviewScenario.ts`, `signals/whale.ts`), keine davon eine Animation. Belegt sind folgende Abschaltungen oder Vereinfachungen:

| Commit (Datum) | Was | Art und Grund | Stand |
|---|---|---|---|
| `86b69dd` (2026-10-01) | Progressive Weichzeichner-Bänder unter Dock und Kopfzeile: Baustein `EdgeBlur` steht, die Bänder sind leer (`BOTTOM_BANDS`, `TOP_BANDS`) | nie eingeschaltet; „off for perf“, verlorene Frames im Scrollen 130 auf 58 (Nr. 142) | bewusst aus |
| `9266b0b`, `4031f9a` (2026-10-08) | App-weite `LayoutGroup` entfernt: ein `layout`-Element gleitet nicht mehr mit, wenn sich ein anderes verschiebt; Morphs bleiben, `LayoutCascade` gilt für Blätter, Dialoge, Einstellungen | Leistung: Tablet-Seitenwechsel p95 38 bis 61 auf 13 bis 15 ms | bewusst; gezielte Rückkehr offen (Liste oben, Punkt 3) |
| `ec8c61c`, `b1ab457`, `f9b392e`, `0646bf5` (2026-10-08) | Samsung-sichere Effekte (`html[data-safe-fx]`): kein Weichzeichner bei Eintritten und Seitenwechsel, kein `backdrop-filter`, kein maskierter Glanz am Kopfknopf, kein Rauschfilm, kein Toast-Glühen | nur bei Samsung Internet oder `?safefx=1`; sonst unverändert | bedingt, bewusst |
| `549cf28` (2026-10-08) | Die „24 Stunden“-Linie zeichnet sich nur noch einmal je Sitzung ein | vorher bei jeder Rückkehr zur Übersicht (Fehler) | behoben |
| `622a3d4` (2026-10-08) | Der rote Lesefortschritt der Kopfzeile folgt dem Scroll exakt statt mit Feder-Nachlauf | Umbau auf Scroll-Zeitleiste (Compositor) | bewusst |
| `da7bbfc` (2026-10-31) | Menü-Einblendung gestrafft: letzte Zeile nach 0,6 s statt bis 1,8 s; schmale Seitenleiste ohne Tooltips (die Namen kommen mit dem Blick) | Runde 10, Test `app.commandNav.test.tsx` absichtlich angepasst | bewusst |

Ohne sichtbare Änderung umgebaut: `62919ba` (Tempo-Weichzeichner der Kurs-Ziffern als vorgeweichte Kopie statt wachsendem Radius), `420cf6b` (Dock-Markierung gleitet auf dem Compositor statt als geteilter Layout-Morph).
`PageSwitch` wird von der Hülle nicht mehr benutzt (`PageHost` hat es ersetzt), bleibt aber im Barrel.

Grenzen: Auf das ursprüngliche Bundle, auf das Code-Kommentare verweisen („Bundle `Kw`“, „`i2`“, „`aT`“), hatte ich keinen Zugriff; ob dort eine Animation stand, die nie übernommen wurde, ist nicht prüfbar. Das
`dashboard.html` im Repo-Wurzelordner habe ich auftragsgemäß nicht angesehen.

## Die Matrix

Spalten: Nr · Name · Quelle · Status · Stelle im Code · Entscheidung · Begründung.

### A. Suchfelder, Eingaben, Formulare

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 1 | Flip Search | R | nicht prüfbar | – | Original anfordern | Die Originaldatei lag nie vor und unter diesem Namen steht kein Code im Projekt; Suchen läuft über die Autocomplete-Suche (Nr. 2). |
| 2 | Autocomplete Search | R | vorhanden | `src/motion/pulse/Autocomplete.tsx` (Trades-Suche `src/views/trades/TradeFilters.tsx`, Symbolfeld `src/views/settings/SymbolField.tsx`) | bleibt | Gruppierte Vorschläge mit Tastatur und Zieh-Auswahl laufen an sechs Stellen (Port, Original nicht mehr im Bestand). |
| 3 | Selectable Chip Group | V | wiederhergestellt/verbessert | `src/primitives/chip.ts`, `src/styles/controls.css` (`.fx-chip`) | bleibt | Ein/Aus-Pillen (`chipClass`) gab es schon, Runde 10 fügt das aufspringende Häkchen-Abzeichen an der Ecke hinzu, ohne dass etwas im Fluss rückt. |
| 4 | Auto-Height Summary | V | vorhanden | `src/views/trades/AutoHeight.tsx` (genutzt in `src/overlays/TradeEditor.tsx`, `src/overlays/SignalSection.tsx`) | bleibt | Eine einzige Box federt ihre Höhe, der Inhalt darunter wird geschoben statt zu springen. |
| 5 | Morphing Language Selector | R | wiederhergestellt/verbessert | `src/motion/pulse/MorphSelect.tsx`, `src/styles/controls.css` | bleibt | Die Auswahllisten (27 Dateien) bekamen in Runde 10 gestaffelte Zeilen, einen gleitenden Marker und ein gezeichnetes Häkchen; die Öffnen-Logik blieb unberührt. |
| 6 | Uiverse Inputs | R | nicht prüfbar | – | Original anfordern | Der Uiverse-Katalog (lokaler Klon) lag nie vor; das eigene Feld `src/primitives/Input.tsx` (Fokusring, Puls, Lösch-×) lässt sich nicht gegen eine Vorlage prüfen. |
| 7 | Uiverse Forms | R | nicht prüfbar | – | Original anfordern | Keine Vorlage im Bestand; das Formularverhalten (Beschriftung, Schütteln bei Fehler) steht in `src/primitives/Field.tsx`, aber nicht als Abgleich. |
| 8 | Uiverse Toggles | R | nicht prüfbar | – | Original anfordern | Keine Vorlage im Bestand; der eigene Schalter `src/motion/Switch.tsx` (elastischer Daumen) ist nicht gegen sie geprüft. |

### B. Buttons

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 9 | Liquid Metal Button | V | bewusst nicht | – | nicht bauen | Ein Metallverlauf auf dem Knopf widerspricht der ruhigen Nothing-Sprache und dem Papier-Theme (Kontrast); Hauptaktionen bleiben unverändert. |
| 10 | Sweep Shine Button | V | neu eingebaut | `src/primitives/Button.tsx`, `src/styles/controls.css` (`[data-fx~="shine"]`); älterer Glanz des Kopfknopfs: `src/styles/shiny-cta.css` | bleibt (nur reiche Seiten) | Ein Lichtstreifen läuft beim Überfahren über Primär- und Sekundärknöpfe (nur Maus, nur `[data-rich]`); Hauptaktionen sind mit `fx={false}` ausgenommen. |
| 11 | Halo Pill Button | V | neu eingebaut | `src/app/Dock.tsx` (`fab-halo`), `src/styles/shell-motion.css` | bleibt | Sinngemäß: die Mitte „Trade“ der unteren Leiste lässt höchstens achtmal je Seitenaufruf ein Halo atmen, Form und Aktion bleiben gleich. |
| 12 | Jewel Pill Button | V | bewusst nicht | – | nicht bauen | Ein glänzender Edelstein-Knopf würde neben „Trade eintragen“ als zweite Hauptaktion wirken und passt nicht zu einem nüchternen Journal. |
| 13 | Text Roll Button | V | neu eingebaut | `src/primitives/Button.tsx` (`btn-roll`), `src/styles/controls.css`; `src/primitives/CopyButton.tsx` | bleibt (nur reiche Seiten) | Sekundärknöpfe mit reinem Text rollen beim Überfahren in eine Kopie, und „Kopieren“ rollt zu „Kopiert“. |
| 14 | Rotating Arrow Chip | V | bewusst nicht | – | nicht bauen | Ein drehender Pfeil-Chip ließe schlichte Textlinks wie Hauptknöpfe aussehen; die Links der App bleiben Links. |
| 15 | Sliding Fill Button | V | bewusst nicht | – | nicht bauen | Der Farbwisch ist für Redaktionsseiten gedacht; hier hellt Hover nur die Fläche auf (Button-System, DESIGN.md Etappe 1c), und eine Füllung gibt es nur als Halte-Fortschritt in `src/motion/HoldButton.tsx`. |
| 16 | Hard Offset Shadow Button | V | bewusst nicht | – | nicht bauen | Ein harter Schlagschatten ist das Gegenteil von Haarlinien und flachen Flächen dieser Designsprache. |
| 17 | Animated Gradient Border | V | vorhanden | `src/primitives/BorderBeam.tsx` (18 Stellen, z. B. `src/primitives/Card.tsx`, `src/views/coach/TodayCard.tsx`) | bleibt | Eine Randlicht-Runde je Ereignis; die Option `run` am Button existiert, wird aber an keiner Stelle gesetzt. |
| 18 | Conic Spin Ring | V | vorhanden | `src/styles/shiny-cta.css` (Kopfknopf „Trade eintragen“, `src/app/NewTradeButton.tsx`) | bleibt | Die konische Kante dreht nur bei Hover und Fokus, im Ruhezustand läuft nichts. |
| 19 | Magnetic Hover Button | V | wiederhergestellt/verbessert | `src/primitives/Magnetic.tsx` (Kopfzeile, Dock, `NewTradeButton`), neu `src/motion/buttonMagnet.ts` | bleibt | Den Magnet gab es für die Hauptknöpfe; Runde 10 fügt den feinen Zug (höchstens 4 px) für große Primär- und Sekundärknöpfe reicher Seiten hinzu. |
| 20 | Button → Pay | V | neu eingebaut | `src/primitives/Button.tsx` (`status`, `.fx-check`), `src/primitives/useActionStatus.ts` | bleibt (nur reiche Seiten) | Laden, dann gezeichnetes Häkchen, dann zurück bei gleicher Größe; die Kreis-Verwandlung der Vorlage fehlt absichtlich, weil „Bezahlen“ seine Form behält (`fx={false}`). |
| 21 | Confetti Burst Button | V | wiederhergestellt/verbessert | `src/motion/Celebrate.tsx`, `src/motion/fx/celebrate.ts`; Auslöser z. B. `src/overlays/TradeEditor.tsx` | bleibt | Konfetti für Gewinn, Serie und Rekord gab es schon; Runde 10 fügt die kleine Stufe `mini` für Meilenstein-Toasts hinzu. |
| 22 | Theme Toggle | V | wiederhergestellt/verbessert | `src/app/CommandNav.tsx` (`GlyphTheme`), `src/app/themeTransition.ts` | bleibt | Hell/Dunkel gab es mit wachsendem Kreis; Runde 10 dreht Sonne und Mond ineinander und dehnt den Kreis auf 620 ms. |
| 23 | Replay Button | V | vorhanden | `src/intro/introStore.ts` (`replayIntro`: Logo-Klick, Einstellungen „Intro jetzt abspielen“); Replay-Knöpfe je Effekt in `dev/pulse-fx.tsx` | bleibt | Für Nutzer wiederholbar sind das Intro und die Trade-Wiedergabe; Replay-Knöpfe je Effekt gibt es nur in den Entwickler-Galerien. |
| 24 | Uiverse Buttons | R | nicht prüfbar | – | Original anfordern | Der Uiverse-Katalog lag nie vor; ein Abgleich mit dem Button-System (`src/primitives/Button.tsx`) ist nicht möglich. |
| 25 | Magic UI Buttons | R | nicht prüfbar | – | Original anfordern | Keine Vorlage im Bestand; der Eigenbau `BorderBeam` und der Kopfknopf `shiny-cta` sind nicht dagegen geprüft. |
| 26 | Hyper-Stack Buttons | R | nicht prüfbar | – | Original anfordern | Keine Vorlage im Bestand, daher kein Abgleich. |

### C. Teilen, Soziales

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 27 | Radial Share | R | neu eingebaut | `src/motion/RadialShare.tsx`, `src/motion/radialLayout.ts` (Trade-Detail `src/social/ui/RadialShareButton.tsx`, Berichte `src/views/berichte/ExportCard.tsx`) | bleibt | Der frühere Eintrag („kein Radialmenü im Code“) war seit Runde 11 veraltet: der Fächer steht, mit Tastatur, Touch und Klemmung am Bildrand. Runde 12 überarbeitet ihn nach der Aufnahme „Share Button Animation“ (Instagram, Aufnahme des Nutzers – Verhalten, kein Quelltext): Glas-Chips, das Symbol des Auslösers wird zum Kreuz, eine Beschriftung („Kanal wählen“, danach was das aktive Ziel tut). Die Vorlage der Quelle R lag nie vor; das Video ist die einzige Referenz. Das Fenster `ShareSheet.tsx` bleibt der Weg für „Link“. |
| 28 | Copy-to-Clipboard | V | wiederhergestellt/verbessert | `src/primitives/CopyButton.tsx` (u. a. `src/views/community/SharesCard.tsx`, `src/views/labor/PineCard.tsx`) | bleibt | Kopieren gab es als Einzellösungen, Runde 10 bündelt es: Symbol wird zum Häkchen, das Wort rollt, die Breite bleibt, ein Fehlschlag schüttelt. |
| 29 | Animated Contact Card | V | bewusst nicht | – | nicht bauen | Die App hat keine Kontaktkarte; ein Kartenzauber ohne Inhalt wäre bloße Zierde. |
| 30 | Overlapping Avatar Cluster | V | bewusst nicht | – | nicht bauen | Die Community zeigt Pseudonyme als Punktmuster (`src/social/ui/Monogram.tsx`) und keine Gesichter; ein Avatar-Haufen suggerierte Mitgliederzahlen. |
| 31 | Social Proof Pill | V | bewusst nicht | – | nicht bauen | Die Zahlenbänder zeigen nur echte Werte („nie erfundene Nutzerzahlen“, `src/views/preise/StatsMarquee.tsx`), eine Pille mit Gesichtern gäbe es nur mit erfundenen Daten. |
| 32 | Orbiting Avatars | V | bewusst nicht | – | nicht bauen | Der Ring der App (`src/motion/pulse/OrbitSpread.tsx`, Coach-Profil) kreist Eigenschaften statt Gesichter, Avatare gibt es nicht. |
| 33 | Motion Footer | R | vorhanden | `src/app/Footer.tsx` (`Marquee`, `DancingSvgWord`) | bleibt | Laufband mit Statistik und Umriss-Wortmarke stehen im Fuß; das Band pausiert außerhalb des Bildes. |

### D. Navigation, Menüs

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 34 | Floating Pill Navigation | V | vorhanden | `src/app/Dock.tsx` | bleibt | Am Handy schwebt die Kapsel unten (mit Lupe am Mauszeiger); die Kopfzeile oben bleibt eine durchgehende Leiste. |
| 35 | Expanding Glass Capsule | V | neu eingebaut | `src/app/Sidebar.tsx`, `src/app/useSidebarPeek.ts`, `src/styles/shell-motion.css` | bleibt | Sinngemäß: die schmale Leiste öffnet sich bei Absicht über die Seite auf 256 px, ohne die Seite zu verschieben (Glas, solange sie offen über der Seite liegt). Runde 12: die Einblend-Folge beim Öffnen der Website (Zusatzpunkt Z2) läuft jetzt sichtbar und strikt nacheinander. |
| 36 | Burger Morph | V | neu eingebaut | `src/app/Burger.tsx`, `src/styles/shell-motion.css` | bleibt | Drei Balken werden zum Kreuz, solange das Menü offen ist (reines CSS auf `translate`/`rotate`). |
| 37 | Staggered Menu Overlay | V | wiederhergestellt/verbessert | `src/app/CommandNav.tsx` (`CONFIG.delays`) | bleibt | Die gestaffelte Einblendung gab es nach der Vorlage; Runde 10 strafft sie, die letzte Zeile startet nach 0,6 s statt 1,8 s. |
| 38 | Animated Navigation Drawer | V | vorhanden | `src/app/CommandNav.tsx` (Wisch von links ab 768 px, `wipeMs` 800) | bleibt | Das Menü fährt ab 768 px als Fläche von links herein, mit Fokusfalle und Escape. |
| 39 | Mobile Bottom Sheet | V | wiederhergestellt/verbessert | `src/app/CommandNav.tsx` (Blatt am Handy, Ziehen am Kopf schließt), `src/motion/Sheet.tsx` | bleibt | Blätter von unten gab es für Editoren; Runde 10 macht auch „Mehr“ zu einem Blatt mit Ziehen zum Schließen. |
| 40 | Animated Dock | R | wiederhergestellt/verbessert | `src/app/Dock.tsx` | bleibt | Das Dock mit Lupe gab es; Runde 10 zeichnet das Symbol beim Wechsel neu und lässt die Mitte ab und zu glänzen. |
| 41 | Immersive Full-Screen Navigation | R | wiederhergestellt/verbessert | `src/app/CommandNav.tsx`, `src/motion/pulse/FullscreenWipe.tsx` | bleibt | Der schwarze Wisch mit gestaffelten Links stammt aus der Vorlage; Runde 10 straffte den Eintritt und gab dem Finder im Menü federnde Treffer mit gleitender Auswahl. |
| 42 | Morphing Language Menu | R | wiederhergestellt/verbessert | `src/motion/pulse/MorphSelect.tsx` | bleibt | Dieselbe Vorlage wie Nr. 5 und derselbe Baustein, mit den Runde-10-Verbesserungen dort beschrieben. |
| 43 | Auto-Cycling Index List | V | bewusst nicht | – | nicht bauen | Eine sich selbst weiterschaltende Liste lenkt von Zahlen ab, und es gibt keine Bildfolge, die sie begleiten würde. |
| 44 | Seamless Card Slider | V | bewusst nicht | – | nicht bauen | Ein Karussell versteckt Inhalt; Karten stehen im Raster, nur reine Textbänder laufen als `Marquee`. |
| 45 | Mobile Scroll-Snap Rail | V | bewusst nicht | – | nicht bauen | Tarifkarten stehen am Handy untereinander, damit der Vergleich ohne verstecktes Wischen sichtbar bleibt; eine einrastende Reihe gibt es nur in der Zeitleiste (`src/motion/pulse/MilestoneRail.tsx`). |
| 46 | Depth Carousel | V | bewusst nicht | – | nicht bauen | Drei bis sechs Produkte mit eigener Farbe gibt es hier nicht, und ein Karussell wäre für Journal-Daten das falsche Muster. |
| 47 | Background Color Crossfade | V | bewusst nicht | – | nicht bauen | Die Seitenfarbe folgt dem Theme, und Signalrot ist die einzige Akzentfarbe (DESIGN.md, Farbrollen); Farbwechsel je Karte wären ein zweites System. |

### E. Karten, Widgets

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 48 | Liquid Glass Surface | V | bewusst nicht | – | nicht bauen | Weichzeichner hinter Flächen kostet Rechenzeit (Dock-Bänder bewusst aus, `src/app/BottomFade.tsx`) und fällt im Samsung-Modus weg; Karten bleiben bei Haarlinie und Schleier. |
| 49 | Frosted Glass UI | V | bewusst nicht | – | nicht bauen | Gleicher Grund wie Nr. 48; Text auf Daten-Karten soll nicht von einem Hintergrund abhängen. |
| 50 | Glass Chips | V | bewusst nicht | – | nicht bauen | Die Pillen sind flach (`chipClass`), Glas darauf brächte Kontrastprobleme im hellen Theme. |
| 51 | Glass Accent Badge | V | bewusst nicht | – | nicht bauen | `src/primitives/Badge.tsx` bleibt flach mit Tonfarbe; Glas würde Gewinn/Verlust-Töne verwässern. |
| 52 | Glass Numbered Panel | V | bewusst nicht | – | nicht bauen | Nummerierte Schritte gibt es im Handelsplan als einfache Leiste, ein Glaspanel brächte keinen Gewinn. |
| 53 | Glass Contact Card | V | bewusst nicht | – | nicht bauen | Keine Kontaktkarte in der App (siehe Nr. 29). |
| 54 | Media Card Hover | V | vorhanden | `src/journal/screenshots/ShotThumb.tsx`, `src/views/setups/SetupCard.tsx` | bleibt | Screenshots und Setup-Karten reagieren beim Überfahren (grau zu Farbe, Notch-Scheibe, leichte Neigung); Icon-Pille und Bildzoom der Vorlage fehlen (Nr. 55, 56). |
| 55 | Icon-to-Label Pill | V | vorhanden | `src/app/Dock.tsx` (`DOCK_CONFIG`, Beschriftung steigt auf), `src/app/Sidebar.tsx` (Namen beim Blick) | bleibt | Symbole zeigen ihren Namen erst bei Absicht, im Dock als aufsteigende Beschriftung, in der Seitenleiste mit dem Öffnen. Runde 12: in der schmalen Leiste tragen Zeilen und Fußknöpfe zusätzlich `aria-label` und Tooltip (`title`), der Tooltip nur, solange die Namen nicht offen sind (offen sagen es die Wörter selbst). |
| 56 | Image Zoom Card | V | offen | – | später bauen | Ein leichter Zoom im Rahmen der Screenshot-Kachel wäre eine natürliche Ergänzung zur Farbe beim Überfahren, ist aber nirgends gebaut. |
| 57 | Frosted Hover Veil | V | neu eingebaut | `src/primitives/Card.tsx` (Frost-Schleier, Zeile um 290) | bleibt (nur reiche Seiten) | Ein weicher Schleier und eine Lichtkante oben legen sich beim Überfahren mit der Maus auf die Karte (nur Deckkraft). |
| 58 | Sticky Stacking Cards | V | bewusst nicht | – | nicht bauen | Gestapelte, kleiner werdende Karten würden Zahlen verdecken, die man vergleichen will. |
| 59 | Draggable Widget Grid | R | vorhanden | `src/motion/pulse/WidgetGrid.tsx` (Cockpit „Anordnen“ `src/views/cockpit/CockpitView.tsx`, Markt-Kacheln `src/views/overview/MarketLive.tsx`) | bleibt | Halten zum Anheben, Ziehen, Werfen und Einrasten laufen im Cockpit, in den Markt-Kacheln und in der Regelliste. |
| 60 | Notched Project Card | R | vorhanden | `src/motion/pulse/NotchedFrame.tsx` (`src/views/setups/SetupCard.tsx`, `src/journal/screenshots/ShotThumb.tsx`) | bleibt | Karten mit Kerbe tragen Setups, Screenshots und Tarife. |
| 61 | Product Timeline | R | vorhanden | `src/motion/pulse/MilestoneRail.tsx` (`src/views/wachstum/GoalCard.tsx`, `src/journal/ui/FillsTimeline.tsx`) | bleibt | Die Leiste zeichnet sich Stück für Stück bei Zielen, Ausführungen und im Rundgang. |
| 62 | In-Page Product Mockup | V | bewusst nicht | – | nicht bauen | Die App ist das Produkt; ein nachgebautes Fenster als Bild gäbe es nur auf einer Werbeseite, die es hier nicht gibt. |
| 63 | Uiverse Cards | R | nicht prüfbar | – | Original anfordern | Der Uiverse-Katalog lag nie vor, die eigene `Card` (`src/primitives/Card.tsx`) ist nicht dagegen geprüft. |
| 64 | Cards Shuffle | N | bewusst nicht | – | nicht bauen | Nur der Titel eines Karussell-Bildes ist bekannt (`pulse-motion/references/motion-graphics.md`: „noch nicht gebaut“, Code nie gesehen); Karten austeilen gibt es (`CardSpread`), Mischen hätte keinen Zweck. |

### F. Text, Schrift

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 65 | Staggered Blur Rise | V | vorhanden | `src/motion/Reveal.tsx`, `src/motion/Stagger.tsx` | bleibt | Karten und Dialoginhalte steigen aus leichter Unschärfe gestaffelt auf und enden bei `filter: none`. |
| 66 | Settle-Zoom Media | V | bewusst nicht | – | nicht bauen | Es gibt keine Hero-Bilder oder -Videos, die sich setzen könnten. |
| 67 | Animated Entrance System | V | vorhanden | `src/motion/Reveal.tsx` (`RevealGroup`), `src/motion/Stagger.tsx` | bleibt | Ein Vokabular für alle Eintritte; ohne Bewegung oder ohne Beobachter erscheint alles sofort, nie eine leere Seite. |
| 68 | Word-by-Word Blur | V | vorhanden | `src/views/setups/PageHeader.tsx` (`WORD_FROM`) | bleibt | Die Titelwörter steigen nacheinander aus 4 px Unschärfe auf. |
| 69 | Masked Line Pull-Up | V | neu eingebaut | `src/views/setups/PageHeader.tsx` (`PULL_CLIP`) | bleibt (nur reiche Seiten) | Auf reichen Seiten werden die Titelwörter aus einer Zeilenmaske hochgezogen. |
| 70 | Soft Word Rise | V | vorhanden | `src/views/setups/PageHeader.tsx`, `src/cloud/ui/AuthCard.tsx` | bleibt | Wörter heben sich 10 px auf `spring.enter`. |
| 71 | Character Cascade | V | vorhanden | `src/primitives/SplitText.tsx` (Abschnittstitel der Analyse), `src/motion/pulse/AsciiCascade.tsx` | bleibt | Buchstaben steigen einmal je Sitzung auf, Entschlüsseln gibt es für die Wortmarke. |
| 72 | Animated Shine Text | V | vorhanden | `src/motion/TextShimmer.tsx` | bleibt | Ein Lichtband läuft über kurze Ladetexte und pausiert außerhalb des Bildes. |
| 73 | Metallic Gradient Text | V | bewusst nicht | – | nicht bauen | Metallschrift senkt den Kontrast und passt nicht zur Plex- und Doto-Schrift der App. |
| 74 | Scramble Text | V | vorhanden | `src/motion/TextScramble.tsx` (16 Stellen, z. B. `src/views/overview/MarketPanel.tsx`) | bleibt | Entschlüsseln läuft an Stellen mit Aussage (Paar und Quelle, Codes, Vorschläge). |
| 75 | Hover Decode Text | V | offen | `src/motion/TextScramble.tsx` (Option `scrambleOnHover`, ungenutzt) | später bauen | Der Baustein kann es schon, aber keine Stelle schaltet es ein; sinnvoll nur für ein bis zwei Navigationswörter. |
| 76 | Typewriter Text | V | vorhanden | `src/motion/pulse/Typewriter.tsx`, `src/motion/fx/CoachStream.tsx` | bleibt | Getippt wird die Datenzeile im Intro, die Treffer-Zeile in Leerzuständen und die Antwort des Coaches. |
| 77 | Animated Caret | V | vorhanden | `src/motion/pulse/Typewriter.tsx`, `src/motion/fx/CoachStream.tsx` | bleibt | Der Cursor blinkt 500 ms an und 500 ms aus, ohne Zeilen umzubrechen; in der Coach-Antwort hört er nach dreimal auf. |
| 78 | Depth-of-Field Text | V | vorhanden | `src/motion/Reveal.tsx` (`REVEAL_FROM` mit Unschärfe), `src/views/setups/PageHeader.tsx` | bleibt | Texte und Karten werden beim Eintritt von unscharf zu scharf (ohne Unschärfe im Samsung-Modus). |
| 79 | Rotating Word Slot | V | bewusst nicht | – | nicht bauen | Wechselnde Wörter ohne Anlass lenken ab; echte Wertwechsel rollt schon `src/motion/TextRoll.tsx`. |
| 80 | Scroll Word Reveal | V | bewusst nicht | – | nicht bauen | Text, der sich erst beim Scrollen lesbar färbt, verschlechtert Lesbarkeit und Suchen im Text; die App hat keine Manifest-Absätze. |
| 81 | Scroll Character Reveal | V | bewusst nicht | – | nicht bauen | Gleicher Grund wie Nr. 80. |
| 82 | Giant Ghost Word | V | neu eingebaut | `src/motion/rich/PageAura.tsx`, `src/motion/rich/rich.css` (`ghost`, an 13 Seitenköpfen gesetzt) | bleibt (nur reiche Seiten) | Ein Geisterwort (7 % Tinte) steht ab 1100 px hinter der Kopfzeile; die Umriss-Wortmarke im Fuß (`DancingSvgWord`) gab es schon. |
| 83 | SVG Wordmark Assembly | V | offen | – | später bauen | Die Wortmarke im Kopf ist das Schriftzeichen ₿ und kein Pfad; gezeichnet werden nur die Navigationssymbole (Zusatzpunkt 2), ein aufgebautes Logo bräuchte erst einen Entwurf. |
| 84 | Count-Up Statistics | V | wiederhergestellt/verbessert | `src/motion/MotionNumber.tsx` (`countOnReveal`), `src/chart/CountText.tsx` | bleibt | Kennzahlen zählten schon beim ersten Sehen, Runde 10 zählt auch fertig formatierte Textzahlen und rollt bei Änderung. |
| 85 | Counter Preloader | V | bewusst nicht | – | nicht bauen | Ein Zählwerk als Ladebild wäre eine Verzögerung ohne Nutzen; Laden zeigt Platzhalter in Endgröße. |
| 86 | Number Roll / Odometer | V | wiederhergestellt/verbessert | `src/motion/RollingDigits.tsx`, `src/app/HeaderTicker.tsx` | bleibt | Den Zählwerk-Baustein gab es für den Live-Kurs; Runde 10 setzt auch den Kopfzeilen-Kurs darauf. |
| 87 | Words → Kinetic | V | neu eingebaut | `src/views/setups/PageHeader.tsx` (`PULL_CLIP`), `src/motion/fx/SplitFlap.tsx` | bleibt (nur reiche Seiten) | Sinngemäß: Wortzeilen schieben aus der Maske, in den Berichten klappen Zeichen wie eine Anzeigetafel. |
| 88 | Dancing Letters | R | vorhanden | `src/motion/pulse/DancingLetters.tsx` (Kopfzeile bei Hover, Fuß) | bleibt | Die Buchstaben der Wortmarke tanzen bei Hover. |
| 89 | Text ASCII Cascade | R | vorhanden | `src/motion/pulse/AsciiCascade.tsx` (Kopfzeile, `src/views/preise/PricingHero.tsx`, Intro) | bleibt | Die Wortmarke entschlüsselt sich ab dem ersten Zeichen. |
| 90 | Text Morphing | R | vorhanden | `src/motion/pulse/TextMorph.tsx` (`StatusPill`-Beschriftungen, `src/journal/filters/JournalFilterBar.tsx`) | bleibt | Beschriftungen gehen über statt zu springen. |
| 91 | Text Prism Split | R | vorhanden | `src/motion/pulse/TextPrism.tsx` (`src/views/overview/Hero.tsx`, `src/views/analyse/KennzahlenHero.tsx`) | bleibt | Das Prisma liegt nur mit Maus über der großen Netto-Zahl. |
| 92 | Pixel Text Fill | R | vorhanden | `src/motion/pulse/PixelTextFill.tsx` (`src/views/setups/LeadFill.tsx`) | bleibt | Seitenuntertitel füllen sich einmal je Sitzung mit rotem Funken. |
| 93 | Tactile Highlight | R | vorhanden | `src/motion/pulse/TactileHighlight.tsx` (13 Dateien) | bleibt | Schlüsselwörter bekommen eine Markierung mit Griff. |
| 94 | Text Animate | R | vorhanden | `src/motion/pulse/Typewriter.tsx` (Pack `text-animate`) | bleibt | Die getippte Zeile im Intro und in Leerzuständen stammt aus dieser Vorlage. |
| 95 | Glyph Portal | R | vorhanden | `src/motion/pulse/GlyphZoom.tsx`, `src/intro/portal.ts` (`src/social/ui/ShareSheet.tsx`, `src/views/cockpit/CockpitView.tsx`) | bleibt | Der Kameraflug in einen Buchstaben läuft im Intro, beim Teilen-Bild und bei neuen Cockpit-Widgets. |

### G. Scroll-Effekte, Seitenabschnitte

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 96 | Viewport Staggered Reveal | V | wiederhergestellt/verbessert | `src/motion/Reveal.tsx` (52 Dateien, Runde 10: `wave`) | bleibt | Das Einblenden beim Sichtbarwerden gab es überall, Runde 10 gibt Kachelraster eine Diagonalwelle statt Zeile für Zeile. |
| 97 | Directional Corner Decoration | V | bewusst nicht | – | nicht bauen | Eckzierrat, der aus der Scrollrichtung hereinfährt, ist Dekoration ohne Aussage für Datenkarten. |
| 98 | Sticky Cinematic Stage | V | bewusst nicht | – | nicht bauen | Eine festgepinnte Bühne über viele Bildschirmhöhen kostet Rechenzeit und verhindert das schnelle Springen zwischen Abschnitten. |
| 99 | Split-Frame Parting | V | bewusst nicht | – | nicht bauen | Gehört zur Pinned-Bühne (Nr. 98) und hat ohne Fotos nichts, was sich teilen könnte. |
| 100 | Scroll Depth-of-Field | V | neu eingebaut | `src/motion/rich/core.css` (`.rich-depth`), `src/views/analyse/ui.tsx` | bleibt (nur reiche Seiten) | Abschnittstitel steigen beim Hereinscrollen 14 px auf und verlieren 2 px Unschärfe, rein über die Scroll-Zeitleiste ohne Skript. |
| 101 | Scroll Tint Transition | V | bewusst nicht | – | nicht bauen | Ein Farbwechsel des Hintergrunds je Abschnitt wäre ein zweites Farbsystem neben Hell/Dunkel. |
| 102 | Panel Slide-Over | V | bewusst nicht | – | nicht bauen | Seiten wechseln per Gleiten (`src/app/PageHost.tsx`); ein Hero-Panel, das sich über ein Bild schiebt, gibt es nicht. |
| 103 | Scattered Gallery | V | bewusst nicht | – | nicht bauen | Verstreute Bilder passen nicht zu Tabellen und Kennzahlen; Screenshots laufen im Reel (`src/journal/screenshots/ShotReel.tsx`). |
| 104 | Blend Outro | V | bewusst nicht | – | nicht bauen | Ein Überblendungs-Abspann am Seitenende hätte keinen Inhalt. |
| 105 | Pinned Heading | V | bewusst nicht | – | nicht bauen | Lange Seiten haben stattdessen die klebende Abschnittsleiste „Inhalt“ (`src/primitives/SectionNav.tsx`), die ohne gepinnte Überschrift auskommt. |
| 106 | Counter-Drifting Columns | V | bewusst nicht | – | nicht bauen | Gegenläufig driftende Spalten würden Zahlen beim Lesen bewegen. |
| 107 | Single-Element Parallax | V | bewusst nicht | – | nicht bauen | Scroll-Parallax bewegt Inhalt gegen den Blick; auf Daten-Seiten stört das. |
| 108 | Sticky Stacking Cards | V | bewusst nicht | – | nicht bauen | Doppelt zu Nr. 58, gleicher Grund. |
| 109 | Opposing Marquee Rows | V | bewusst nicht | – | nicht bauen | Einfache Laufbänder gibt es (`src/motion/pulse/Marquee.tsx`, Fuß, Preise, Community); gegenläufig und an den Scroll gekoppelt würden sie Ticker-Zahlen unlesbar machen. |
| 110 | 3D Tilted Text Crawl | V | bewusst nicht | – | nicht bauen | Ein schräg wegkriechender Text ist ein Film-Abspann und hat in einem Journal keinen Platz. |
| 111 | Parallax Strip Slider | R | vorhanden | `src/motion/pulse/StripWipe.tsx` (`src/views/markt/BoxChartCard.tsx`, `src/views/berichte/ReportHero.tsx`) | bleibt | Zehn Streifen lösen die alte Kurve beim Intervall- und Zeitraumwechsel ab. |
| 112 | Product Launch Hero | R | vorhanden | `src/motion/pulse/LaunchGrid.tsx` (`src/views/preise/PricingHero.tsx`, Rundgang) | bleibt | Der Aufbau mit Punktraster und fliegenden Karten steht auf Preise und im Einstieg. |
| 113 | Slanted Spread Hero | R | vorhanden | `src/motion/pulse/CardSpread.tsx` (`src/views/preise/PlanGrid.tsx`) | bleibt | Karten werden aus einem schrägen Stapel ins Raster ausgeteilt. |
| 114 | Reel Collage | R | vorhanden | `src/motion/pulse/ReelWindow.tsx` (`src/journal/screenshots/ShotReel.tsx`, `src/views/setups/StrategyBlock.tsx`) | bleibt | Harte Schnitte und eine zusammenklappende Zeile zeigen Screenshots und Beispiel-Setups. |

### H. 3D, Zeiger, besondere Interaktionen

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 115 | Magnetic Hover | V | wiederhergestellt/verbessert | `src/primitives/Magnetic.tsx`, `src/motion/buttonMagnet.ts` | bleibt | Dieselbe Technik wie Nr. 19: Kopfzeile und Dock zogen schon, Runde 10 fügt den Zug für große Knöpfe reicher Seiten hinzu. |
| 116 | Pointer Parallax Layers | V | vorhanden | `src/primitives/HeroBackdrop.tsx` (Hero der Übersicht) | bleibt | Sinngemäß: Raster und Lichtfleck des Heros bewegen sich gegenläufig zum Zeiger; Foto-Ebenen gibt es nicht. |
| 117 | Spotlight Reveal | V | vorhanden | `src/primitives/Card.tsx`, `src/primitives/glowField.ts` | bleibt | Sinngemäß: ein Lichtfleck und ein Näherungsbogen folgen dem Zeiger über Karten (höchstens vier zugleich); eine Maske über zwei Bilder gibt es nicht. |
| 118 | Cursor Image Trail | V | bewusst nicht | – | nicht bauen | Eine Bilderspur hinter dem Zeiger hat keine Bilder, und sie würde Zahlen überdecken. |
| 119 | Exclusion Blend Cursor | V | bewusst nicht | – | nicht bauen | Ein Mischmodus über der ganzen Oberfläche kostet Rechenzeit und verändert Gewinn/Verlust-Farben. |
| 120 | Custom Cursor | V | bewusst nicht | – | nicht bauen | Ein eigener Zeiger ersetzt Systemverhalten und hilft weder Touch noch Screenreadern. |
| 121 | Orbiting Avatars | V | bewusst nicht | – | nicht bauen | Doppelt zu Nr. 32, gleicher Grund. |
| 122 | Sand Dissolve Transition | V | vorhanden | `src/motion/fx/DissolveOut.tsx` (`src/views/setups/ClassifyCard.tsx`, `src/exchanges/ui/SyncInbox.tsx`, `src/cloud/ui/PixelDissolve.tsx`) | bleibt | Sinngemäß: ein Pixelzerfall mit festen Zufallswerten statt SVG-Turbulenz, eingesetzt beim Entfernen von Zeilen und Karten, nicht als Bildwechsel. |
| 123 | Real 3D Model Hero | V | bewusst nicht | – | nicht bauen | Braucht WebGL und ein neues Paket, was Erstlade-Budget und Regel „keine neuen Abhängigkeiten“ verbieten; ein 3D-Objekt trüge keine Information. |
| 124 | Animated Shader Background | V | neu eingebaut | `src/motion/rich/PageAura.tsx`, `src/motion/rich/rich.css` | bleibt (nur reiche Seiten) | Sinngemäß ohne Shader: zwei sehr langsame Lichtflecke als CSS, die außerhalb des Bildes pausieren. |
| 125 | Pointer Chroma Blob | V | neu eingebaut | `src/motion/rich/PageAura.tsx` | bleibt (nur reiche Seiten) | Sinngemäß: ein Spotlight folgt der Maus hinter der Kopfzeile, ohne Farbbrechung und ohne WebGL. |
| 126 | Fluted Glass Shader | V | bewusst nicht | – | nicht bauen | Braucht einen Shader auf Bitmaps (schwer) und es gibt kein Bild, das er brechen könnte. |
| 127 | Cinematic Orbit Hero | R | vorhanden | `src/motion/pulse/OrbitSpread.tsx` (`src/views/coach/ProfileCard.tsx`), Intro | bleibt | Das Coach-Profil fächert sich zu einem Ring, den man mit ←/→ dreht. |
| 128 | Light and Depth | R | nicht prüfbar | – | Original anfordern | Original nie vorgelegen und kein Port mit diesem Namen im Code; was daran erinnert (Seitenlicht, Kartenkante), ist ohne Vorlage nicht zuordenbar. |
| 129 | Thinking Orbs | R | neu eingebaut | `src/motion/ThinkingOrb.tsx` (`ThinkingOrbCanvas.tsx`, `orbMath.ts`, `orbLoop.ts`; Variante `ring`: `ringMath.ts`, `VoiceRingCanvas.tsx`) | bleibt | Der frühere Eintrag („kein Port im Code“) war seit Runde 11 veraltet: drei Punktbilder (Kugel, Wolke, Kreisbahn) als Ladezeichen, Referenz die Aufnahme „Thinking Orbs“ (libraries.dev, kein Quelltext). Runde 12 ergänzt den Voice Ring (Zusatzpunkt Z7) und setzt ihn an Coach und Assistent („Denke nach …“), Zeitmaschine, Wal-Karte und Screenshot-Import ein. |
| 130 | Agent Trace | R | vorhanden | `src/motion/pulse/ScrubTimeline.tsx`, `src/chart/replay.ts`, `src/chart/EquityChart.tsx` | bleibt | Ziehbare Wiedergabe mit Spuren steht bei Kurve, Trades, Labor und Monte-Carlo-Läufen. |
| 131 | Glass Tilt | N | neu eingebaut | `src/primitives/Card.tsx` (`tilt`), `src/primitives/hoverTilt.ts` | bleibt (nur reiche Seiten) | Nur der Titel ist bekannt; sinngemäß neigt sich eine Karte um bis zu 3° zum Zeiger mit mitlaufendem Glanz (Glas gibt es nicht). |
| 132 | Globe Arcs | N | bewusst nicht | – | nicht bauen | Nur der Titel ist bekannt (Code nie gesehen), und die App hat keine Orts- oder Verbindungsdaten, die Bögen zeigen könnten. |
| 133 | Shape Morph | N | bewusst nicht | – | nicht bauen | Nur der Titel ist bekannt; eine Form, die sich verwandelt, trüge keine Aussage (Karte zu Dialog gibt es als `MorphCard`). |
| 134 | Grid Wave | N | neu eingebaut | `src/motion/Reveal.tsx` (`wave`), `src/motion/rich.ts` (`gridCell`), `src/motion/fx/HeatGridReveal.tsx` | bleibt (nur reiche Seiten) | Nur der Titel ist bekannt; sinngemäß laufen Kachelraster in einer Diagonalwelle ein, die Heatmap kaskadiert vom besten Feld. |
| 135 | Ribbon Twist | N | bewusst nicht | – | nicht bauen | Nur der Titel ist bekannt; ein verdrehtes Band ist reine Zierde. |
| 136 | Liquid Merge | N | bewusst nicht | – | nicht bauen | Nur der Titel ist bekannt; verschmelzende Tropfen haben keinen Datenbezug (der Flüssigkeitsmesser `LiquidGauge` zeigt Auslastung). |
| 137 | Phone Explode | N | bewusst nicht | – | nicht bauen | Nur der Titel ist bekannt; eine auseinanderfliegende Geräte-Zeichnung wäre ein Werbebild. |

### I. Video, Hintergründe, Motion Graphics

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 138 | Cinematic Background Video | V | bewusst nicht | – | nicht bauen | Die App spielt kein Video; es würde Daten, Akku und Erstlade-Budget kosten und Zahlen hinterlegen. |
| 139 | Seamless Video Loop | V | bewusst nicht | – | nicht bauen | Setzt Hintergrundvideo voraus (Nr. 138). |
| 140 | Video Frame Art Direction | V | bewusst nicht | – | nicht bauen | Setzt Hintergrundvideo voraus (Nr. 138). |
| 141 | Edge Blend Scrim | V | vorhanden | `src/app/BottomFade.tsx` (Verlauf hinter dem Dock), Schatten der Kopfzeile in `src/app/Header.tsx` | bleibt | Sinngemäß: Verläufe schützen den Text unter Dock und Kopfzeile, ohne Video. |
| 142 | Progressive Bottom Blur | V | bewusst nicht | `src/app/BottomFade.tsx` (`EdgeBlur`, `BOTTOM_BANDS = []`), `src/app/Header.tsx` (`TOP_BANDS = []`) | nicht bauen | Der Baustein steht, die Bänder sind absichtlich leer (Leistung, „perf-01“: verlorene Frames im Scrollen 130 auf 58); er war seit dem ersten Commit (86b69dd) nie eingeschaltet. |
| 143 | Cursor Video Scrub | V | bewusst nicht | – | nicht bauen | Setzt Video voraus (Nr. 138). |
| 144 | Dual Video Scrub | V | bewusst nicht | – | nicht bauen | Setzt Video voraus (Nr. 138). |
| 145 | Scroll Video Scrub | V | bewusst nicht | – | nicht bauen | Setzt Video voraus (Nr. 138) und ist die schwerste Technik der Liste. |
| 146 | Boomerang Video | V | bewusst nicht | – | nicht bauen | Setzt Video voraus (Nr. 138). |
| 147 | Crossfade Video Switcher | V | bewusst nicht | – | nicht bauen | Setzt mehrere Videos voraus (Nr. 138). |
| 148 | Adaptive Text Tone | V | bewusst nicht | – | nicht bauen | Der Ton wechselt nur über Video; Schrift und Hintergrund folgen hier dem Theme (Hell/Dunkel). |
| 149 | Gradient → Flow | V | neu eingebaut | `src/motion/rich/PageAura.tsx`, `src/motion/rich/rich.css` | bleibt (nur reiche Seiten) | Sinngemäß: weich fließende Lichtflecke (26 und 34 s) hinter der Kopfzeile, nicht der Kegelverlauf der Vorlage. |
| 150 | Particles → Form | V | neu eingebaut | `src/motion/rich/EmptyArt.tsx` (`burst`), `src/motion/rich/art.css` | bleibt (nur reiche Seiten) | Sinngemäß: zwölf Punkte fliegen im Leerzustand zu einem Ring zusammen; ein Logo aus Partikeln gibt es nicht. |
| 151 | Rings → Orbit | V | neu eingebaut | `src/motion/rich/EmptyArt.tsx` (`orbit`), `src/motion/pulse/OrbitSpread.tsx` | bleibt (nur reiche Seiten) | Ein Punkt mit zwei kleinen auf Ellipsen kreist in Leerzuständen und pausiert außerhalb des Bildes. |
| 152 | Line → Draw | V | wiederhergestellt/verbessert | `src/motion/fx/EquityDraw.tsx`, `src/primitives/Sparkline.tsx`, `src/motion/rich/EmptyArt.tsx` (`draw`) | bleibt | Linien zeichneten sich schon; Runde 10 fügt das Bild im Leerzustand und die atmende Platzhalter-Linie (`src/chart/ChartPlaceholder.tsx`) hinzu. |

### J. Weitere Designsysteme

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 153 | Magic Primitives | R | nicht prüfbar | – | Original anfordern | Original nie vorgelegen und kein Port mit diesem Namen; ein Abgleich mit `BorderBeam` oder Rippeln wäre geraten. |
| 154 | Glass Look | R | nicht prüfbar | – | Original anfordern | Original nie vorgelegen; die App hat keine Glas-Optik (siehe Nr. 48 bis 53). |
| 155 | Fintech Glass | V | bewusst nicht | – | nicht bauen | Ein Stil-Paket mit Glaskacheln und gedimmten Anfangswörtern, das neben der einen Designsprache (DESIGN.md) ein zweites System wäre. |
| 156 | Relay Lime | V | bewusst nicht | – | nicht bauen | Limettengelb als Handlungsfarbe widerspricht Signalrot als einziger Akzentfarbe (DESIGN.md, Farbrollen). |
| 157 | Air | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 158 | Apple España | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 159 | Apple Foldable | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 160 | Dala | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 161 | Factory | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 162 | Origin Financial | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 163 | Oryzo AI | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 164 | Slush | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 165 | Structured | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |
| 166 | Superhuman | R | nicht prüfbar | – | Original anfordern | Stil-Datei nie vorgelegen; als Stil ohnehin nicht Teil der einen Designsprache. |

### K. Trading-Diagramme, Dashboard

| Nr | Name | Q | Status | Stelle im Code | Entscheidung | Begründung |
|---|---|---|---|---|---|---|
| 167 | Animated Fan Chart | V | wiederhergestellt/verbessert | `src/views/analyse/MonteCarloCard.tsx`, `src/views/analyse/fanDraw.ts`, `src/views/analyse/FanCursor.tsx`; Branchen-Trend `src/views/aktien/branchen/charts.tsx` | bleibt | Den Fächer gab es als Canvas; Runde 10 zeichnet auf reichen Seiten eine Szene (Bänder, 120 Linien, Median mit Glühen) und liest per Fadenkreuz ab. |
| 168 | Animated Percentile Bands | V | wiederhergestellt/verbessert | `src/views/analyse/fanDraw.ts`, `src/views/aktien/branchen/charts.tsx`, `src/views/timemachine/` (Fächer 90 und 50 %) | bleibt | Die Bänder 5, 25, 50, 75, 95 kommen aus allen Läufen und gab es im Fächer schon; Runde 10 malt sie auf reichen Seiten in die neue Canvas-Szene. |
| 169 | Chart Drawing Reveal | V | wiederhergestellt/verbessert | `src/chart/EquityChart.tsx`, `src/views/markt/TraderNetPlot.tsx`, `src/views/analyse/fanDraw.ts` | bleibt | Kurven wischen einmal von links ein; neu in Runde 10 sind Fächer und Top-Trader-Fläche. |
| 170 | Interactive Chart Crosshair | V | wiederhergestellt/verbessert | `src/views/analyse/FanCursor.tsx`, `src/views/markt/TraderNetPlot.tsx`, `src/views/aktien/branchen/charts.tsx` | bleibt | Fadenkreuz mit Zeiger, Touch und Pfeiltasten; Runde 10 ergänzt Fächer und Top-Trader-Karte. |
| 171 | Chart Hover Tooltip | V | vorhanden | `src/chart/tooltip.tsx` | bleibt | Ablesefeld mit Rand und Schatten an Kerzen und Kurven. |
| 172 | Animated Performance Counter | V | vorhanden | `src/views/overview/Hero.tsx` (`MotionNumber`, `TextPrism`) | bleibt | Die Netto-Zahl der Übersicht gleitet; die Startseite bleibt ohnehin unverändert. |
| 173 | Animated Status Stamp | V | neu eingebaut | `src/primitives/Badge.tsx` (`data-pill`), `src/styles/rich.css` | bleibt (nur reiche Seiten) | Ohne Vorlage gedeutet: Statuspillen rasten beim Erscheinen mit kleinem Überschwingen ein (0,88 zu 1,04 zu 1). |
| 174 | Staggered Dashboard Rows | V | wiederhergestellt/verbessert | `src/chart/rows.tsx` (`Rows`), `src/styles/rich.css`, `src/motion/Reveal.tsx` | bleibt | Karten stiegen schon gestaffelt auf; Runde 10 staffelt die ersten 12 Zeilen von Listen und Tabellen und hebt sie beim Überfahren. |
| 175 | Dashboard Theme Toggle | V | wiederhergestellt/verbessert | `src/app/CommandNav.tsx`, `src/app/ThemeCard.tsx`, `src/app/themeTransition.ts` | bleibt | Dasselbe wie Nr. 22 (Sonne/Mond, Kreis 620 ms). |
| 176 | Responsive Canvas Chart | V | wiederhergestellt/verbessert | `src/views/analyse/fanDraw.ts`, `src/views/markt/TraderNetPlot.tsx`, `src/views/aktien/branchen/charts.tsx` | bleibt | Canvas mit höchstens doppelter Pixeldichte, neu gemalt bei Größe und Theme; Runde 10 fügt zwei Flächen hinzu. |
| 177 | Simulation Approval Button | V | vorhanden | `src/views/labor/SideCards.tsx` (`ReferenceCard`, `celebrateRecord`) | bleibt | Ohne Vorlage gedeutet: „Als Vergleich übernehmen“ nach einem Labor-Lauf feiert die Übernahme mit Konfetti und Toast. |

## Was nicht belegt werden konnte

- **Die Originale der Quelle R** (46 Punkte, mit Port oder ohne): Die Dateien der Sammlung `pulse-motion` und der Kataloge (Uiverse, Magic UI, Hyper-Stack) liegen nicht im Bestand. Ein „vorhanden“ in R-Zeilen belegt nur, dass die App einen Port hat, nicht dass er der Vorlage gleicht.
- **Punkte, die nur als Titel bekannt sind** (Quelle N, 8 Punkte): Von „Glass → tilt“ bis „Phone → explode“ kennt auch `motion-graphics.md` nur die Titel eines Instagram-Bildes; Code und Werte der Vorlage wurden nie gesehen. Die Zeilen 131 und 134 sind deshalb sinngemäß gelesen, die übrigen sechs (64, 132, 133, 135 bis 137) stehen auf „bewusst nicht“.
- **Gedeutete Namen:** 173 (Animated Status Stamp) und 177 (Simulation Approval Button) stehen ohne Beschreibung im Inventar.
- **Pixelvergleich Übersicht und Cockpit, Budgets, Tests:** hier nicht neu gemessen, gebaut oder ausgeführt (ausgeführt wurde nur `tests/unit/docs.animationenMatrix.test.ts`); die Angaben stammen aus den READMEs und dem Budget-Skript im Zweig.
- **Echte Geräte:** Bewegung und Ruckeln auf Handy und Tablet sind nur über die Messwerte in den Commits belegt.
