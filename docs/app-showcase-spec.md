# Spezifikation: Schüler-Cockpit

## Ehrlichkeitsrahmen

Öffentlich ließ sich **keine** Schüler-App der Fahrschule nachweisen. Das
Kapitel zeigt deshalb ausdrücklich eine **Vorschau**: Badge „In Entwicklung",
Fußzeile „Demo-Ansicht mit Beispieldaten" auf jedem Bildschirm, und eine
Einleitung, die im Futur formuliert ist.

Sobald das Cockpit startet: `status` in `content/digital-package.ts` von
`'vorschau'` auf `'verfuegbar'` setzen.

## Grundlage: echte Regeln

Die Oberfläche ist nicht erfunden, sondern aus den Geschäftsregeln des
vorhandenen internen Werkzeugs (`dashboard.html`) rekonstruiert:

- Theorie 12 Doppelstunden, mit Vorbesitz 6.
- Simulatoreinheiten vor den ersten Fahrten im echten Verkehr.
- Sonderfahrten erst nach abgeschlossener Grundausbildung.
- Sonderfahrten B: 5 Überland, 4 Autobahn, 3 Nacht.
- Offene Rechnungen und fehlende Unterlagen blockieren die Prüfungsanmeldung.
- Prüfungsreife ist eine **Liste erfüllter Bedingungen**, keine Prognose.

Keine echten Personendaten. Die Demo-Schülerin heißt Lena, Klasse B mit B197.

## Sechs Zustände

| # | Reiter | Zeigt |
| --- | --- | --- |
| 1 | Heute | Fortschritt in Prozent, nächster Termin, eine konkrete nächste Aufgabe |
| 2 | Ausbildung | Neun Stationen von der Anmeldung bis zur praktischen Prüfung |
| 3 | Praxis | „Das lief gut", „Daran arbeiten wir", Ziel der nächsten Stunde |
| 4 | Sonderfahrten | 9 von 12, pro Art als Segmentleiste |
| 5 | Unterlagen | Status je Dokument, offene Beträge |
| 6 | PrüfungsReady | Erfüllte und offene Bedingungen, wer freigibt |

## Verhalten

**Desktop (ab 1024 px).** Das Gerät steht `sticky`, die Passagen scrollen daran
vorbei, der Inhalt wechselt mit. Die Seite scrollt durchgehend normal — kein
Pinning, keine verschachtelte Scrollfalle. Die aktive Passage wird über den
Abstand ihrer Mitte zur Bildschirmmitte bestimmt.

**Mobil (unter 1024 px).** Kein Gerätrahmen, kein Handy im Handy. Jeder Zustand
ist eine Karte in voller Breite direkt unter der zugehörigen Passage, in
normalem Dokumentenfluss. Keine Synchronisation, kein Scroll-Eingriff.

**Reduzierte Bewegung / kein JavaScript.** Alle sechs Passagen stehen
vollständig und in richtiger Reihenfolge im Markup; der Beobachter fügt das
synchrone Verhalten nur obendrauf. Die hohen Abstände kollabieren, damit keine
Leerfläche entsteht. Zwei Playwright-Tests sichern das ab.

## Warum HTML statt Screenshot

Die Oberfläche ist echtes Markup: scharf auf jedem Display, markierbar,
übersetzbar, von Screenreadern lesbar, ohne Bild-Download — und sie lässt sich
ändern, ohne dass jemand ein neues Bild exportiert.
