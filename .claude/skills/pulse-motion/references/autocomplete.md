# Autocomplete (autocomplete)
> Such-Eingabefeld "Search a framework" mit Dropdown, das per kurzem Fade+Scale aufpoppt (Treffer-Liste oder Leerzustand "No frameworks found.") und gegenlaeufig zu einem Hinweistext unter dem Feld ein-/ausblendet.

## Wann einsetzen
- Such-/Command-Felder, Framework-/Tag-/Stadt-Picker, Combobox, Typeahead (autocomplete, combobox)
- Filter in Dashboards, Header-Suche, Formular-Auswahl mit wenigen Treffern
- Dezente, schnelle Micro-Interaction ohne Spring (UI soll "nicht im Weg sein")
- Leerzustaende ("keine Treffer") ohne Layout-Sprung
- Dark-UI im shadcn/21st.dev-Look

## Anatomie & Zeitleiste
Stage 1234x673, Block zentriert; Eingabefeld-Oberkante bei y=287, 288 px breit.

| Phase | Zeit (Video) | Verhalten |
|---|---|---|
| Fokus-Ring ein | 0.714 -> ~0.81 s (ca. 100 ms) | 3px-Ring #484848 blendet ein, Rand heller |
| Panel erscheint (Tippen "h"/"e") | 1.800 -> ~1.87 s, 9.599 -> ~9.66 s (60-90 ms) | opacity 0->1, scale 0.92->1, Origin oben-mitte; Hinweis darunter blendet gleichzeitig aus |
| Liste <-> Leerzustand | 10.050 -> 10.066 s | SOFORT (kein Morph), Panelhoehe 172 <-> 43 px springt |
| Panel verschwindet (leeres Feld / Auswahl) | 12.565 -> ~12.61 s (ca. 50-80 ms) | Fade + leicht kleiner; Hinweis blendet gegenlaeufig ein |
| Auswahl "Remix" | 12.57 s | Wert sofort im Feld, Fokus/Ring bleibt |
Tipp-Takt im Video (nur Demo): h 1.80, ha 2.66, hal 3.70, hall 3.85, hallo 4.10, Loeschen bis 5.57, home 6.2-7.3, leer 8.88, e 9.60, en 10.06, e 11.04, Tap Remix 12.57.

## Motion-Tokens
- `--dur-in: 90ms` `--ease-in: cubic-bezier(.2,.8,.2,1)` (schneller Start, ease-out)
- `--dur-out: 80ms` `--ease-out: cubic-bezier(.4,0,1,1)`
- `--panel-scale-from: .92`, transform-origin `50% 0`
- `--dur-hint: 90ms` linear (Hinweis gegenlaeufig)
- `--dur-ring: 150ms` `--ease-ring: cubic-bezier(.4,0,.2,1)`
- Keine Feder, kein Stagger, kein Blur; Inhaltswechsel ohne Animation.

## Look-Tokens
- Buehne #131313; Feld/Panel #1f1f1f; Rand Feld #3a3a3a (Fokus #444), Panel-Rand #353535
- Fokusring 3px #484848 (Box-Shadow ausserhalb); Radius 8px
- Text #f8f8f8 (Feld 16px, Liste/Leerzustand 14px), Platzhalter/Hinweis #878787 (16px)
- Feld 288x41, Panel 286 breit, 6px unter dem Feld; Zeile 39px, Panel-Padding 7px (4 Zeilen = 172px), Text 21px vom Panelrand
- Panel-Schein: heller, weicher Halo `0 10px 40px rgba(255,255,255,.05)`
- Font: "Inter, Geist, Roboto, ..." (im Video Roboto-artig, Android)

## Interaktion & Barrierefreiheit
- Fokus ins Feld -> Ring; Tippen -> Panel auf (ab 1 Zeichen), leeres Feld -> Panel zu, Hinweis zurueck
- Filter: Teilstring, case-insensitive; Treffer -> Liste, sonst "No frameworks found."
- Tap/Klick auf Zeile waehlt (setzt Wert, schliesst); Pfeil hoch/runter, Enter, Esc; Hover-Markierung nur mit `(hover:hover)`
- role=combobox/listbox/option, aria-expanded, aria-activedescendant, role=status fuer Leerzustand
- `prefers-reduced-motion`: Transitions aus. Mousedown auf Panel preventDefault (Fokus bleibt im Feld).

## 120 Hz
Reine CSS-Transitions auf opacity/transform (Compositor, zeitbasiert, bildratenunabhaengig); kein JS-Animationstakt, kein rAF, keine Layout-Lesezugriffe; `contain: layout paint`; `will-change` nur waehrend der Animation (bei transitionend entfernt); Zeilen einmal erzeugt, nur `hidden` umgeschaltet.
check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (4x: p95 2.9 ms, p99 5.3 ms, 0.2 % ueber Budget). 1 WARN: Transition von box-shadow/border-color am Fokusring (150 ms, nur ein kleines Feld, einmaliger Wechsel, kein Dauer-Effekt) - bewusst beibehalten, da Ring ohne Layout-Aenderung nur so original wirkt.

## Einbindung
`assets/autocomplete.html`: Marker `COMPONENT:START/END`, CSS `/* COMPONENT CSS */`, JS:
`const api = initAutocomplete(rootEl, { items: [...], onSelect(label){}, config: { MATCH: 'includes'|'startsWith', HINT_TEXT, EMPTY_TEXT } })`
Rueckgabe: `open() close() setValue() getValue() isOpen() input`. Look/Motion ueber `:root`-Variablen am Dateianfang.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
shadcn `Command` (cmdk) + Input, `focus-visible:ring-[3px] ring-ring/50`, Liste in `AnimatePresence`:
```jsx
<AnimatePresence>
  {open && (
    <motion.div style={{ originY: 0 }}
      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.09, ease: [0.2, 0.8, 0.2, 1] }}>
      <CommandList>{items.length ? items : <CommandEmpty>No frameworks found.</CommandEmpty>}</CommandList>
    </motion.div>)}
</AnimatePresence>
```
(Eventuell Tween statt Spring; stiffness ~600/damping ~35 waere aehnlich schnell.)

## Kreativ remixen
1. Spotlight/Command-Palette: Panel mit Blur-Backdrop, scale .92 -> 1 plus 8px translateY, Zeilen mit 20 ms Stagger.
2. Echtzeit-Suche mit Treffer-Highlighting: Buchstaben-Match gelb einfaerben, aktive Zeile mit geteiltem Layout-Pill (spring 500/38), der zwischen Zeilen gleitet.
3. Fokus-Ring "hochdrehen": 6px Ring in Akzentfarbe mit Puls (opacity-Loop), Halo-Schein stark (0.15) fuer Neon-Look.
4. Leerzustand mit Persoenlichkeit: "No frameworks found." mit kleinem Shake (translateX +-4px, 160 ms) und Emoji, das aufpoppt (spring overshoot).
5. Kontexte: Stadt-/Kennzeichen-Suche, Fahrschul-Fragenkatalog-Suche, Emoji-Picker, Tag-Eingabe; Tipp-Sound/Haptik (navigator.vibrate(8)) bei Auswahl.

## Bekannte Abweichungen (ehrlich)
- Easing/Dauern aus ~8-ms-Frames geschaetzt (Scale-Start 0.92-0.93 abgelesen); Exit-Dauer weniger sicher.
- Fokusring-Dauer (~100 ms linear-artig im Video) mit 150 ms Standardkurve angenaehert; Randfarbe oben/unten vs. links im Video leicht uneinheitlich (Mittelwert genommen).
- Halo-Schein des Panels nur grob nachgemessen (sehr dezent im Original).
- Schriftart im Video Roboto-artig; Original-Font unbekannt. Aufnahme-Zeiger (Pfeil) und Tipp-Choreografie sind nicht Teil der Komponente.
- Hover-/Aktiv-Zustand der Zeilen im Video nicht sichtbar (Touch) - Farbe #2a2a2a geraten.
- Verhalten bei Fokusverlust/Wiederoeffnen nach Auswahl nicht im Video, selbst festgelegt.
