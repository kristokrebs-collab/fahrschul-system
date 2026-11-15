# Flip Search (flip-search)
> Such-Leiste mit einem Knopf und drei Aufgaben (oeffnen, leeren, schliessen): das Eingabefeld klappt per Drehung um die Oberkante (rotateX -90 auf 0, Perspektive ca. 2,2 x Breite) aus dem Nichts auf; Eintritt ease-out, Austritt kuerzer und ease-in.

## Wann einsetzen
- Kopfzeilen, Toolbars, Mobile-Navigation, in denen die Suche zunaechst nur ein Icon ist
- Ein Knopf statt drei: Lupe (oeffnen), Kreis-X (Text leeren), X (schliessen), ohne Layoutsprung
- EN: search bar animation, flip open, 3D flip field, expandable search, search toggle, clear and close button

## Quelle und Ehrlichkeit
Nachbau nach einem Reel-Screenshot ("Search Bar Animation", index.html/app.css/app.js teilweise lesbar). Es ist **eigener Code nach Beschreibung und lesbaren Werten**, keine Kopie; exakte Originalwerte (Dauer, Farben) sind nicht belegt.

## Anatomie & Zeitleiste
| Phase | ms | Verlauf |
|---|---|---|
| Feld oeffnen | 420 | rotateX(-90deg) -> 0 um die Oberkante, `cubic-bezier(.16,1,.3,1)` (ease-out), Opacity in 250 ms |
| Feld schliessen | 260 | zurueck auf -90deg, `cubic-bezier(.55,.08,.4,.95)` (ease-in); kuerzer als das Oeffnen |
| Icon-Wechsel | 320 ein / 220 aus | Icons liegen uebereinander, Wechsel per Drehung + Skalierung + Blende |
| Druck-Feedback | 180 | Knopf scale(.94) beim Druecken |

## Motion-Tokens
`--ease-out`, `--ease-in`, `--flip-in-ms:420`, `--flip-out-ms:260`, `--persp:2.2` (Perspektive = Faktor x Feldbreite). Nichts linear. Nur `transform`/`opacity` animiert.

## Interaktion & Barrierefreiheit
- Ein `button` mit wechselndem Namen ("Suche oeffnen" / "Eingabe leeren" / "Suche schliessen") und `aria-expanded`
- Esc schliesst und gibt den Fokus an den Knopf zurueck; Enter ruft `onSearch(value)`
- Fokusring nur bei Tastatur (`:focus-visible`); Feld ist geschlossen nicht fokussierbar (`visibility:hidden`, `tabindex=-1`)
- `prefers-reduced-motion`: nur kurzes Einblenden, keine Drehung

## 120-Hz-Technik
Reine CSS-Transitions auf `transform`/`opacity` (Compositor); kein rAF, kein Messen. Test: `check120.cjs` = ok (4x CPU).

## Einbindung
`initFlipSearch(rootEl, {onSearch})`; Block `COMPONENT:START/END` + CSS kopieren; Look ueber `:root`-Variablen.

## React/Framer-Motion-Mapping
```tsx
<motion.div style={{transformOrigin:"50% 0", perspective: width*2.2}}
  animate={{rotateX: open ? 0 : -90, opacity: open ? 1 : 0}}
  transition={open ? {duration:.42, ease:[.16,1,.3,1]} : {duration:.26, ease:[.55,.08,.4,.95]}} />
```

## Kreativ remixen
1. Feld mit Feder (leichter Overshoot, `--spring`) statt reiner Kurve oeffnen lassen
2. Ergebnisliste klappt als zweite Ebene mit 60 ms Stagger nach
3. Kombination mit Autocomplete: Dropdown folgt dem Flip
4. Flip um die Seitenkante (rotateY) fuer vertikale Toolbars

## Bekannte Abweichungen (ehrlich)
- Nachbau aus Screenshot, nicht aus Video; Zeiten sind plausible Werte, nicht gemessen
- Kein Suchergebnis-Backend; nur Eingabe und Callback
