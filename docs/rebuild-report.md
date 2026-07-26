# Fahrschule Krebs — Rebuild-Report

## 0. Medien-Bestätigung
**Es wurde kein neues Video generiert. Keine Higgsfield-Credits verbraucht.**
Verwendet wurden ausschließlich die 27 bereits im Archiv vorhandenen Clips
(Inventar: `docs/higgsfield-archive.json`, Mapping: `docs/film-chapters.md`).

## 1. Audit-Ergebnis (Ist-Zustand vorher)
Bewahrenswert: Filmbühne, Lenis/GSAP, Finder, Cockpit-Demo, Preisstruktur,
Mobile-Nav, Reduced-Motion, Modal.
Bestätigte Defekte:
| # | Defekt | Status |
|---|---|---|
| 1 | App-Sektion lag **außerhalb `<main>`**, isoliert nach der FAQ | behoben |
| 2 | Finaler CTA außerhalb `<main>` | behoben |
| 3 | **Kein Focus-Trap** im Modal, kein `inert`, kein Fokus-Rückgabe-Schutz | behoben |
| 4 | **Erfundene Telefonnummer** `tel:+49000000000` ausgeliefert | entfernt |
| 5 | Rechtslinks = `alert()` | echte Sektionen mit korrektem Gerüst |
| 6 | Scrollspy mit **hartkodierter** Reihenfolge → falsche Markierung nach Umbau | leitet Reihenfolge jetzt aus dem DOM ab |
| 7 | Formular ohne echte Validierung/Ladezustand | native Validierung + a11y-Fehler + Ladezustand |
| 8 | Keine Video-Ausfallsicherung | Fallback-Fläche nach 2 Fehlversuchen |
| 9 | Kein Save-Data-Respekt | Video wird bei `saveData`/2G nicht geladen |
| 10 | Finder-Auswahl ging verloren | wird in Rechner + Formular übernommen |

## 2. Informationsarchitektur (neu)
`finder → cockpit → app → klassen → simulator → preise → weiterbildung → standorte → team → FAQ → CTA`
Die App steht jetzt **direkt am digitalen Ausbildungssystem** statt als Werbeblock nach der FAQ.

## 3. Scroll-Narrativ
Ein Filmkapitel pro Sektion, Cross-Fade über zwei Video-Layer, gesteuert per
IntersectionObserver (kein Scrolljacking, keine Scroll-Falle, kein Schwarzblitz).
Mobil: vertikaler Cut + nur 4 Kapitel. Reduced Motion: Standbild ohne Wiedergabe.

## 4. Ausfall- und Randfälle (getestet)
- CDN nicht erreichbar → Seite bleibt vollständig lesbar (real getestet, s. Screenshot)
- Bibliotheken (GSAP/Lenis) blockiert → Seite funktioniert nativ weiter
- `prefers-reduced-motion` → keine Wiedergabe, alle Inhalte gleichwertig

## 5. OFFENE GESCHÄFTSANGABEN (nicht erfunden, blockieren den Ausbau nicht)
1. Telefonnummern je Standort + zentrale E-Mail
2. Anschriften Fulda / Bad Hersfeld, Büro- und Theoriezeiten
3. **Offizielle Einzelpreise** — der Rechner zeigt bewusst „—" statt falscher Zahlen
4. Bestätigter Leistungskatalog (ADR, Stapler, Erste Hilfe, Unternehmerprüfung)
5. Digitalpaket-Mengen (80+ Videos, 9 Theorieangebote/Woche, Simulatoreinheiten)
6. Impressum-/Datenschutz-Inhalte
7. Team: Namen/Rollen/Qualifikationen

## 6. NICHT LIEFERBAR (ehrlich)
- **Logo, Teamfoto, Simulatorbild, App-Screenshots liegen nicht als Datei im Projekt** —
  sie wurden nur im Chat gezeigt. Ohne Dateien kann ich sie weder einbinden noch
  freistellen/parallaxen. Das Logo ist deshalb weiterhin als Wortmarke nachgebaut.
  → Bitte als Dateien in `assets/` legen, dann binde ich sie 1:1 ein.
- **Archiv-Videos konnten nicht lokal gespiegelt werden**: der Sandbox-Proxy blockt
  die CDN. Für Produktion herunterladen und selbst hosten (Performance, DSGVO).
