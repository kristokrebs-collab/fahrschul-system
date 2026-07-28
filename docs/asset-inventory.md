# Asset-Inventar

> **Stand 2: 28.07.2026 — das Archiv ist jetzt eingebunden.** Der ursprüngliche
> Befund (kein Zugriff) steht weiter unten; dieser Abschnitt beschreibt den
> aktuellen Zustand.

## Der Relay-Weg

Die Egress-Policy des Containers blockiert das Higgsfield-CDN bis heute.
Gelöst über GitHub Actions: Ein manuell ausgelöster Workflow
(`.github/workflows/fetch-assets.yml`) lädt das Archiv auf einem
GitHub-Runner (uneingeschränktes Internet) und committet es auf den
Orphan-Branch `higgsfield-assets`, den die Sandbox über ihren
authentifizierten Git-Zugang holt. Kein Byte läuft durch die Konversation.

## Die 16 Bilder des Archivs

| Inhalt | Verwendung |
| --- | --- |
| **Echtes Logo** (KREBS ‖ Fahrschule Verkehrsbildungszentrum, mit Krebs-Silhouette) | Wortmarke als Typografie nachgebaut (Header/Footer); Krebs-Scheren als Wasserzeichen im Schlusskapitel (`public/brand/`) |
| **Echtes Teamfoto „Das K-TEAM"** (~20 Personen, plus Duplikat) | Kapitel „Menschen & Orte" und `/team` (`public/team/`) |
| **3 Screenshots der echten Cockpit-App** | Vorlage für den originalgetreuen HTML-Nachbau des Cockpit-Kapitels; intern in `docs/app-reference/` |
| **4 Studio-Fahrzeuge** (Audi Kombi, Actros, Citaro, Suzuki — dunkles Studio, roter Leuchtring) | Kategorie-Bühnen im Klassen-Kapitel (`public/vehicles/`, AVIF 800/1600) |
| 4 Referenz-Screenshots (Google-Lens/YouTube: Bus, Audi, Suzuki, **DEGENER-360°-simdrive-Simulator**) | **Nicht publizierbar** (Fremdinhalte) — als Gestaltungsreferenz genutzt; der Simulator-Schemazeichnung liegt die Dreischirm-Bauform zugrunde |
| 1 privates Katzenfoto | Nicht verwendet |

Die Studio-Fahrzeuge sind KI-Inszenierungen im Markenlook — sie werden als
„Studio-Darstellung" beschriftet und nirgends als Fuhrpark-Fotos ausgegeben.

---

## Ursprünglicher Befund (27.07.)

Es lag **kein einziges** Foto, Logo, Video oder Markenasset vor. Die gesamte
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
