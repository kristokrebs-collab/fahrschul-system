# Krebs Brand Film — Kapitel-Mapping (aus vorhandenem Higgsfield-Archiv)

27 fertige Clips im Archiv geprüft. **Keine neue Generierung nötig** — alle
Kernszenen waren bereits vorhanden und stilistisch konsistent
(Premium Automotive, ARRI-Look, Crimson #E11D48 nur als reale Lichtquelle).

| Sektion | Clip-ID | Motiv |
|---|---|---|
| Hero (Desktop) | f723693e | Drehbühne mit 4 Fahrzeugen: Kombi, Motorrad, Lkw, Bus |
| Hero (Mobile 9:16) | 15d67bec | Vertikaler Cut, Kombi im Lichtaufblitz |
| Finder | 12bef6a6 | Rote Lichtspur läuft über Asphalt |
| Cockpit / App | 747fccfe | Interface-Panels scrollen, laterale Dolly |
| Klassen | 974cabea | Morph ohne Schnitt: Pkw → Motorrad → Lkw → Bus |
| Simulator | bb31526f | Push in den Simulatorschirm → reale Straße |
| Preise | 34773992 | Bogen fast geschlossen, Lücke bleibt (Fortschritt) |
| Weiterbildung/Handicap | ca580b6b | Makro-Orbit Handbedienung, Engineering-Grade |
| Standorte | 5d632862 | Route verbindet zwei Orte (Fulda ↔ Bad Hersfeld) |
| Team | c5e24bae | Fahrersicht: Lenkrad, Spiegel, Straße |

## Technik
- Zwei `<video>`-Layer, Cross-Fade → kein schwarzer Blitz beim Kapitelwechsel
- IntersectionObserver statt Scroll-Scrubbing → kein Scrolljacking, kein Jank
- Mobile: vertikaler Hero-Cut + nur 4 Kapitel (Daten/Akku)
- `prefers-reduced-motion`: Standbild, keine Wiedergabe
- Hooks: `window.__bgv()`, `window.__videoChapters`, `window.__lenis`, `window.__ST`

## Offen / Empfehlung
Videos liegen aktuell auf der Higgsfield-CDN. Für Produktion herunterladen,
selbst hosten (Performance, Ausfallsicherheit, DSGVO) und WebM-Variante + Poster
erzeugen. Reale Aufnahmen der echten Krebs-Flotte ersetzen später 1:1 einzelne Kapitel.
