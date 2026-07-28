# Barrierefreiheit

Ziel: WCAG 2.2 AA. Geprüft am Produktionsbuild, nicht am Entwicklungsserver.

## Umgesetzt

**Struktur.** Genau ein `h1` pro Seite (durch Test abgesichert, 18 Seiten),
Landmarken `banner`, `main`, `contentinfo`, jedes Kapitel als `section` mit
`aria-labelledby`, Brotkrumen mit `aria-current="page"`.

**Tastatur.** Sprunglink als erstes fokussierbares Element. Die
Hauptnavigation ist ein Disclosure-Muster: Öffnen per Klick und per Enter,
Schließen mit Escape und Klick außerhalb, `aria-expanded` und `aria-controls`
gesetzt. Nichts ist nur per Hover erreichbar — Hover ist reine Zugabe auf
Zeigegeräten. Die Klassen-Spuren sind eine echte Tablist mit Pfeiltasten-
Navigation und Roving-Tabindex.

**Fokus.** Global sichtbar, 2 px Signalrot mit 3 px Abstand — auch auf dunklen
Flächen erkennbar.

**Formulare.** Jedes Feld hat ein `label`, Fehler stehen in `aria-describedby`,
Felder mit Fehler tragen `aria-invalid`. Die Sammelmeldung ist **ein** Element
mit `role="alert"` — eine zusätzliche unsichtbare Live-Region hätte
Screenreadern alles doppelt vorgelesen. Validiert wird serverseitig; die Seite
bleibt bei Fehlern stehen und behält die Eingaben.

**Dynamische Werte.** Die Summen des Rechners ändern sich ohne Seitenwechsel und
werden deshalb über eine `aria-live="polite"`-Region angesagt. Das
Finder-Ergebnis bekommt beim Erscheinen den Fokus.

**Farbe.** Keine Information hängt allein an Farbe: Zustände im Cockpit tragen
zusätzlich Text („Abgeschlossen", „9 von 12 absolviert"), die Vorschau-Markierung
ist beschriftet, die Differenz im Rechner steht als Zahl mit Vorzeichen.

**Bewegung.** `prefers-reduced-motion` entfernt alle Übergänge, das Korn, die
Hero-Parallaxe und die Abblendung — und **kollabiert die hohen Abstände** im
Cockpit, damit keine Leerfläche zurückbleibt. Zwei Tests prüfen, dass alle sechs
Passagen vollständig und in Reihenfolge sichtbar bleiben.

**Touch.** Alle Bedienelemente mindestens 44 px hoch (`min-h-11` und mehr).
Kein horizontaler Seiten-Scroll auf vier geprüften Seiten bei 412 px — geprüft
wird sowohl die Dokumentbreite als auch, ob sich die Seite tatsächlich seitwärts
schieben lässt.

**Dekoratives.** Alle Zierelemente — Fahrbahn, Korn, Embleme, Gerätrahmen —
tragen `aria-hidden`. Die Bedeutung steht immer im benachbarten Text.

**Sprache.** `lang="de"`, deutsche Bedienbeschriftungen, `hyphens: auto` für
lange Komposita statt Überlauf.

## Gefunden und behoben

| Befund | Behebung |
| --- | --- |
| Inaktive Cockpit-Passagen auf 45 % Deckkraft — Fließtext unter 4,5:1 | Untergrenze auf 60 % angehoben, bei reduzierter Bewegung ganz aus |
| Bei reduzierter Bewegung blieben die 80-vh-Abstände als Leerraum stehen | Abstände kollabieren in diesem Modus |
| Fehlermeldung des Formulars doppelt (sichtbar plus unsichtbare Live-Region) | Ein Element mit `role="alert"` |
| Eingabefelder ohne `aria-describedby` zur Fehlermeldung | Verknüpft, dazu `aria-invalid` |
| **Mobiles Menü hinter dem Seiteninhalt, Links nicht anklickbar** | Panel aus dem Header herausgezogen; `backdrop-filter` machte den Header zum Bezugsrahmen für `position: fixed` |

Der letzte Punkt war ein echter Blocker: Auf dem Telefon ließ sich über das Menü
keine einzige Seite öffnen. Gefunden hat ihn der Playwright-Test, nicht das Auge.

## Offen

- **Kein Test mit echtem Screenreader.** Semantik und ARIA sind sauber, aber
  NVDA, JAWS und VoiceOver wurden nicht gefahren. Vor dem Livegang empfohlen.
- **Kein automatisiertes axe-Audit.** Die Regelbibliothek war in dieser Umgebung
  nicht installierbar; geprüft wurde manuell und über gezielte Tests.
- **200-%-Zoom** wurde nicht systematisch über alle Seiten geprüft. Das Layout
  ist durchgehend relativ (`rem`, `clamp`, Flex und Grid), Probleme sind
  unwahrscheinlich, aber nicht ausgeschlossen.
- Bei Fotos später: sinnvolle `alt`-Texte, dekorative Bilder mit `alt=""`.
