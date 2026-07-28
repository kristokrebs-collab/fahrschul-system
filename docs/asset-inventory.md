# Asset-Inventar

## Ergebnis in einem Satz

Es liegt **kein einziges** Foto, Logo, Video oder Markenasset vor. Die gesamte
visuelle Sprache der Website ist Code.

## Higgsfield-Archiv

Über den MCP-Server sind **16 Bilder** im Konto sichtbar (12 JPG, 4 PNG,
erstellt am 23./24. Juli 2026). Der Download scheitert an der Egress-Policy des
Containers: `d2ol7oe51mr4n9.cloudfront.net` liefert bei jedem Versuch
HTTP 403 (`connect_rejected`, Policy-Ablehnung).

Der Inhalt der Bilder konnte deshalb **nicht** beurteilt werden. Ob sie zu
Fahrschule Krebs gehören, ist offen.

**Es wurde kein neues Higgsfield-Asset erzeugt.** Nach der Vorgabe ist dafür
eine ausdrückliche Freigabe nötig, und für keine Stelle der Website war eine
KI-Generierung inhaltlich nötig — eine erzeugte Person, ein erzeugtes Fahrzeug
oder ein erzeugter Standort hätte auf der Seite einer realen Fahrschule ohnehin
nicht als echt dargestellt werden dürfen.

## Was stattdessen gebaut wurde

| Asset | Umsetzung | Datei |
| --- | --- | --- |
| Wortmarke | Typografie plus Signalbalken | `components/brand/marks.tsx` |
| Favicon | SVG, aus derselben Geometrie | `app/icon.svg` |
| Fahrbahn (Hero, Kapitelköpfe, Footer, 404) | Echte Perspektivprojektion, zur Build-Zeit berechnet | `components/brand/roadway.tsx` |
| Fahrerperspektive (Simulator) | SVG-Szene | `components/simulator/simulator-chapter.tsx` |
| Asphalt-Korn | Inline-SVG-`feTurbulence` als Data-URI | `components/brand/atmosphere.tsx` |
| Zehn Kapitel-Embleme | SVG aus einem gemeinsamen geometrischen Alphabet | `components/brand/marks.tsx` |
| Gerätrahmen (Cockpit) | CSS-Gradienten und Radien | `components/cockpit/cockpit-showcase.tsx` |
| Cockpit-Oberfläche | Echtes HTML und CSS, kein Screenshot | `components/cockpit/cockpit-screen.tsx` |

Gesamtgewicht aller Grafiken: **0 KB an Bilddaten.** Alles ist Markup.

## Schriften

Archivo (Display, variable Breitenachse) und Instrument Sans (Text) werden über
`next/font/google` zur **Build-Zeit** geladen und selbst ausgeliefert. Zur
Laufzeit besteht keine Verbindung zu Google — relevant für die
Datenschutzerklärung.
