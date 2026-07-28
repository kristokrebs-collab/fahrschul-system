# Performance

## Messung

Produktionsbuild, Chromium, Viewport 390 × 844, **4-fache CPU-Drosselung** und
gedrosseltes Netz (1,6 Mbit/s, 150 ms Latenz) — grob ein Mittelklasse-Telefon
im Mobilfunknetz.

| Messwert | Startseite | Schwelle „gut" |
| --- | --- | --- |
| Largest Contentful Paint | **1.296 ms** | < 2.500 ms |
| First Contentful Paint | 1.296 ms | < 1.800 ms |
| Cumulative Layout Shift | **0,065** | < 0,1 |
| DOMContentLoaded | 675 ms | — |
| Übertragen | ~212 KB | — |

Die Startseite ist die schwerste Seite der Website (elf Kapitel, drei
interaktive Client-Komponenten). Alle übrigen Seiten liegen darunter.

## Warum das so schnell ist

**Kein einziges Bild.** Die gesamte Bildsprache ist SVG und CSS im Markup. Es
gibt keinen Hintergrund, auf den gewartet wird, und keine Bild-Anfrage zwischen
erstem Pixel und Verständlichkeit.

**Die LCP-Zone wird nicht animiert.** Überschrift, Vorspann und beide
Handlungsschaltflächen stehen sofort und vollständig da — keine
Einblendung, kein `opacity: 0` bis zum Sichtbarwerden, kein Scroll-Auslöser.

**45 Seiten statisch vorgerendert.** Kein Rendering zur Laufzeit außer der
Server-Action des Formulars.

**Schriften selbst ausgeliefert** über `next/font` mit `display: swap` und
größenangepasstem Ersatzzeichensatz — zur Laufzeit keine Verbindung zu Google.

**Geometrie zur Build-Zeit berechnet.** Die Fahrbahn-Pfade entstehen einmal auf
Modulebene, nicht bei jedem Rendern.

**Kein Scroll-Rendering.** Die Hero-Parallaxe schreibt in
`requestAnimationFrame` direkt in den Stil und löst nie ein React-Rendering aus;
sie meldet sich ab, sobald der Hero den Bildschirm verlässt. Das Cockpit nutzt
`IntersectionObserver` statt einer Scroll-Schleife.

**`backdrop-filter` nur auf Zeigegeräten** (`@media (hover: hover)`) — auf
Telefonen ist der Effekt teuer und kaum sichtbar.

**Ein Kompositlayer für die Atmosphäre**, statisch, bei reduzierter Bewegung
entfernt.

## Bundle

| Datei | Größe |
| --- | --- |
| CSS gesamt | 60 KB (unkomprimiert) |
| Größter JS-Chunk | 284 KB (unkomprimiert; React plus Framework) |

`gsap` und `motion` stehen in `package.json`, werden aber nirgends importiert
und sind deshalb **nicht** im ausgelieferten Bundle.

## CLS 0,065

Nicht null, aber im grünen Bereich. Der Rest stammt aus dem Schriftwechsel beim
Laden. `next/font` setzt bereits einen größenangepassten Ersatz ein; die letzten
Hundertstel ließen sich mit manuell abgestimmten `size-adjust`-Werten drücken.
Für den Livegang nicht nötig, als Feinschliff notierbar.

## Verhalten unter Störungen

| Fall | Verhalten |
| --- | --- |
| JavaScript langsam oder aus | Alle Inhalte sichtbar; das Kontaktformular ist ein echtes `form` mit Server-Action und funktioniert vor der Hydration |
| Reduzierte Bewegung | Vollständige Inhalte, Abstände kollabieren |
| Kein WebGL | Nicht relevant — es wird keines verwendet |
| Bild schlägt fehl | Nicht relevant — es gibt keine Bilder |
| Langsames Netz | Text steht vor dem Schriftwechsel; kein blockierendes Asset |

## Nicht gemessen

Kein Lighthouse-Lauf (in dieser Umgebung nicht installierbar) und keine
Felddaten. Die obigen Werte stammen aus der Performance-API im gedrosselten
Browser. Vor dem Livegang empfiehlt sich ein Lighthouse-Durchlauf auf der
echten Hosting-Umgebung, weil dort Kompression, Caching-Header und CDN
mitspielen.
