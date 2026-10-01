---
name: pulse-motion
description: Bibliothek 120-Hz-tauglicher UI-Animationen, aus echten 21st.dev-Bildschirmaufnahmen als eigenständige HTML-Komponenten nachgebaut (mit exakten Timing-, Easing-, Feder- und Look-Werten) plus Werkzeuge, um neue Aufnahmen aufzunehmen. Nutze diesen Skill IMMER, wenn eine Website, Landing-Page, ein Dashboard, eine App-Komponente oder ein Artefakt animiert, premium, "wow", butterweich, flüssig, mit hoher Bildwiederholrate (120 fps / 120 Hz / 144 Hz), Micro-Interactions, Hover-, Scroll-, Cursor- oder Text-Effekten oder im 21st.dev-Look gebaut werden soll, auch wenn der Nutzer keinen Skill nennt, und wenn Animations-Videos geschickt werden, die in den Skill aufgenommen werden sollen. Kreativ kombinierbar und remixbar. English: micro-interactions, motion design, spring physics, smooth 120Hz UI, hover/scroll/cursor effects, text animation, morphing dropdown, dock, typewriter, autocomplete, 21st.dev components.
---

# pulse-motion — Animationen mit hoher Bildwiederholrate

Zwei Dinge sind hier festgelegt: **(1)** jede Animation sieht aus und fühlt sich an wie das Original-Video (gemessene Dauer, Easing, Feder, Farben, Abstände), **(2)** jede läuft auf **≥ 120 Hz** ruckelfrei (zeitbasiert, nur Compositor-Eigenschaften, geprüft mit `scripts/check120.cjs`). Die Nachbauten sind **Vanilla HTML/CSS/JS ohne Abhängigkeiten** — sie laufen in jedem Chat/Artefakt, jeder Seite, jedem Framework. Quelle sind Aufnahmen von 21st.dev-Komponenten; der Original-Code lag nicht vor, alles ist aus dem Video rekonstruiert (Abweichungen stehen ehrlich in jeder Spec).

## So setzt Du sie ein
1. **Passende Animation suchen** im Index unten (Stichworte DE/EN). Passt keine exakt: die nächste nehmen und remixen (Schritt 4).
2. **Spec lesen** (`references/<slug>.md`): Zeitleiste in ms, Motion-/Look-Tokens, Interaktion, Barrierefreiheit, 120-Hz-Technik, Einbindung, React/Framer-Motion-Mapping.
3. **Komponente übernehmen** (`assets/<slug>.html`): Block zwischen `<!-- COMPONENT:START/END -->` + `/* COMPONENT CSS */` + `init<Name>(root, opts)` ins Zielprojekt kopieren. Look und Tempo nur über die Variablen/CONFIG oben ändern, nicht im Code. Fürs Projekt anpassen: Texte, Farben (Variablen), Größen.
4. **Kreativ remixen** — jede Spec hat einen Abschnitt „Kreativ remixen“. Allgemein: Stellschrauben hochdrehen (weniger Dämpfung → mehr Overshoot, kürzere Dauer, Stagger, Tiefe/Glow), Effekte kombinieren (z. B. Dock-Magnification + Tooltip-Morph, Text-Linse + Typewriter), den Auslöser wechseln (Hover → Scroll → Cursor-Nähe → Tastatur). Die **Anti-Muster-Regeln bleiben bindend** (siehe unten).
5. **Prüfen:** Bei eigenen/geänderten Animationen `node scripts/check120.cjs <html> <actions.cjs>` laufen lassen (Anleitung in `references/principles-120hz.md`); Ziel `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine`.

## Die harten 120-Hz-Regeln (Kurzfassung — Details & getestete Code-Bausteine: `references/principles-120hz.md`)
- Zeit statt Frames: rAF-Zeitstempel/`performance.now()`, **nie** `setInterval`, `1000/60`, „+= pro Frame“.
- Nur `transform`/`opacity`/`filter` animieren; kein `transition: all`; keine Layout-Eigenschaften.
- Federn per exakter Formel (`springAt`), Glätten per `1 - exp(-k·dt)`.
- `pointermove` merken, 1× pro rAF anwenden; nichts pro Frame messen oder neu bauen; Leerlauf = keine Arbeit.
- `prefers-reduced-motion` respektieren; Tastatur/ARIA wo sinnvoll.

## Animations-Index (automatisch erzeugt: `python3 scripts/build_index.py`)
<!-- INDEX:START -->
| Name | Was es ist | Stichworte (EN) | Dateien |
|---|---|---|---|
| **Cinematic Orbit Hero** | Acht Foto-Karten liegen zuerst als schraeger Faecher (gerade Diagonale, -12 Grad) in der Mitte; nach ~2.5 s oeffnen sie sich in ~2.8 s (langsamer Anlauf, Spitze bei 1.4 ... | Hero einer Produkt-/Portfolio-/Sport-/Wearable-Seite mit 6-10 starken Fotos (Kampagnen-Loo ... | [cinematic-orbit-hero.md](references/cinematic-orbit-hero.md) · [html](assets/cinematic-orbit-hero.html) |
| **Draggable Widget Grid** | Dunkles Dashboard-Raster (4 Spalten, 8 "live" tickende Mono-Widgets): Karte gedrueckt halten, sie hebt ab (Scale 1.06 + heller Schein) und folgt dem Zeiger; ueberfaehrt ... | Anpassbare Dashboards / Admin-Panels / Analytics- und Observability-Boards (Widgets umsort ... | [draggable-widget-grid.md](references/draggable-widget-grid.md) · [html](assets/draggable-widget-grid.html) |
| **Glyph Portal** | Ein riesiges Wort ("SUBLIME") in dunklem Gruen auf Grau; beim Scrollen blendet das Interface aus, die Kamera taucht in einen Buchstaben (M) ein - er kippt leicht, wird ... | Hero -> naechste Sektion mit "Wow": Agentur-/Portfolio-/Studio-Startseite, Markenname als  ... | [glyph-portal.md](references/glyph-portal.md) · [html](assets/glyph-portal.html) |
| **Notched Project Card** | Drei Projekt-Karten mit Foto in Graustufen und runder Kerbe unten rechts; beim Hover blendet das Foto in Farbe und der Pfeil-Kreis in der Kerbe wird dunkelrot. | portfolio grid, case studies, team/blog cards, grayscale-to-color hover, notched / cut-out ... | [notched-project-card.md](references/notched-project-card.md) · [html](assets/notched-project-card.html) |
| **Product Launch Hero** | Ein 6.65-s-Produkt-Trailer als Loop: dunkle Punktraster-Karte mit Satz "that lets you [Foto] filter out AI." und drehendem Quadrat -> Kamera zoomt heraus und schwenkt ... | Produkt-/Library-Launch-Hero, "Trailer"-Sektion auf Landingpages - product launch, hero tr ... | [product-launch-hero.md](references/product-launch-hero.md) · [html](assets/product-launch-hero.html) |
| **Text Prism Split** | Ein Wort in Fliesstext-Groesse, ueber dem ein schwarzes, weich gerandetes Linsenfenster federnd dem Zeiger folgt; darin ist der Text 6% groesser, 5px hoeher und besteht ... | Hero-Headline / Markenname / Portfolio-Name auf dunklem Grund (Wow beim ersten Hover) - he ... | [text-prism-split.md](references/text-prism-split.md) · [html](assets/text-prism-split.html) |
<!-- INDEX:END -->

## Neue Animation aufnehmen (wenn der Nutzer weitere Videos schickt)
Der Nutzer schickt 21st.dev-Bildschirmaufnahmen (Samsung-Aufnahmen, 1730×1080, ca. 90–115 Bilder/s variabel). Jede wird zu `assets/<slug>.html` + `references/<slug>.md`.
1. **Duplikate zuerst:** `md5sum` aller Videos vergleichen — der Nutzer schickt Dateien öfter doppelt. Nur Neues bearbeiten.
2. **Identifizieren:** Vollbild ansehen (`ffmpeg -ss 0.3 -i v.mp4 -frames:v 1 full.png`); oben links steht der Komponentenname → `slug`.
3. **Zerlegen:** `scripts/frames.sh <video> <outdir> [fps] [crop]` (Bühne ausschneiden, Kontaktblatt). Schnelle Übergänge mit `fps=120` in kurzen Fenstern; echte Frame-Zeiten via `ffprobe -select_streams v -show_entries frame=pts_time`.
4. **Analysieren:** Zeitleiste der Zustände (ms), Easing-Charakter (ease/Feder/Overshoot), Stagger, Scale/Blur/Opacity, Farben (ImageMagick `convert f.png -crop 1x1+X+Y -format '%[hex:u]' info:`), Radien, Abstände, Schrift.
5. **Nachbauen:** eine selbständige HTML-Datei nach den Regeln oben (Variablen/CONFIG ganz oben, `COMPONENT:START/END`, `init<Name>()`, Demo mit dem Video-Inhalt).
6. **Gegen das Video prüfen:** `scripts/record.cjs` (Playwright nimmt den Nachbau mit derselben Choreografie auf) → `frames.sh` → `scripts/sidebyside.sh` (Original | Nachbau). Bis ~3 Runden verbessern.
7. **120-Hz-Gate:** `scripts/check120.cjs` (alle FAIL beheben).
8. **Spec schreiben** nach dem Muster der vorhandenen (`references/notched-project-card.md` ist ein gutes Vorbild): Wann einsetzen (DE + `- EN:`-Stichwortzeile!), Anatomie & Zeitleiste, Motion-/Look-Tokens, Interaktion & Barrierefreiheit, 120 Hz, Einbindung, React/Framer-Mapping, Kreativ remixen (5 Ideen), Bekannte Abweichungen.
9. **Index + Paket:** `python3 scripts/build_index.py`, dann `scripts/package.sh` → `pulse-motion.zip` für den Upload in claude.ai (Einstellungen → Fähigkeiten/Skills → Hochladen).

## Ehrliche Grenzen
- Nachbauten sind aus Videos rekonstruiert, nicht der Original-Quellcode: Timing/Look sind gegen das Video gefittet (Fidelity je Spec benannt), Nicht-Sichtbares (z. B. `:active`, Touch-Verhalten des Originals) ist als „nicht erkennbar“ markiert.
- 120-Hz-Messung läuft in Headless-Chromium (Software-Raster, kein echtes 120-Hz-Display). Sie beweist Zeitbasiertheit und niedrige Frame-Kosten, ersetzt aber keinen Test auf dem Gerät.
- Demo-Bilder in Specs sind aus dem Video extrahierte Platzhalter, keine Originale.
