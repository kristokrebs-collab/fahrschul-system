# Bewegungskonzept

## Regel

Jede Animation muss mindestens eines leisten: **erklären, orientieren,
priorisieren, verbinden, aufdecken oder eine Eingabe bestätigen.** Was nichts
davon tut, wurde entfernt.

## Primärbewegung — genau eine

**Das Cockpit-Kapitel.** Das Gerät steht `position: sticky`, während die sechs
Textpassagen daran vorbeilaufen; der Bildschirminhalt wechselt mit der Passage.

Umgesetzt mit `IntersectionObserver` plus CSS-`sticky`. Kein Pinning, kein
abgefangenes Scrollrad, keine Scrollhöhe, die in Fortschritt umgerechnet wird —
die Seite scrollt die ganze Zeit ganz normal weiter.

Der Beobachter wählt die Passage, deren Mitte der Bildschirmmitte am nächsten
ist, nicht die erste sichtbare. Sonst zeigt das Gerät beim schnellen Scrollen
einen Zustand, an dem die Lesenden längst vorbei sind.

Gesamte gepinnte Scrollstrecke der Website: **0 vh.**

## Sekundärbewegung

| Effekt | Zweck | Umsetzung |
| --- | --- | --- |
| Fahrbahn-Parallaxe im Hero | Die Straße weicht zurück, statt wegzurutschen | Ein `transform` und eine Opazität, in `requestAnimationFrame` direkt auf den Stil geschrieben — React rendert beim Scrollen nie neu |
| Fortschritt im Finder | Zeigt, wie weit die Kreuzung durchquert ist | CSS-Breitenübergang |
| Karten-Hover | Bestätigt, dass etwas anklickbar ist | Rahmenfarbe plus 2 px Pfeilversatz |
| Spurwechsel bei den Klassen | Ordnet die Auswahl zu | Sofortiger Wechsel, keine Ausblendung |
| Panel im Menü | Öffnet und schließt sichtbar | Nur Darstellung, keine Bewegung |

## Atmosphäre

Ein einziges `position: fixed`-Element für das gesamte Dokument trägt das
Asphaltkorn (Inline-SVG-Rauschen, ein Kompositlayer). Es ist **statisch** — es
bewegt sich nicht, es flimmert nicht. Bei `prefers-reduced-motion` wird es
komplett entfernt.

Keine Partikel, keine schwebenden Formen, keine Animationsschleife im Leerlauf.

## Reduzierte Bewegung

Bei `prefers-reduced-motion: reduce`:

- Alle Übergänge und Animationen auf 0,001 ms.
- Kein weiches Scrollen.
- Die Hero-Parallaxe registriert ihren Scroll-Listener gar nicht erst.
- Das Korn verschwindet.
- Die Abblendung inaktiver Cockpit-Passagen entfällt.
- **Die hohen Passagen im Cockpit kollabieren** (`motion-reduce:lg:min-h-0`) —
  ohne Zustandswechsel wäre die Höhe nur noch Leerraum.

Alle Inhalte bleiben vollständig, in derselben Reihenfolge, ohne Bedienschritt.
Zwei Playwright-Tests prüfen das.

## Warum inaktive Passagen 60 % Deckkraft haben

Erst niedriger als etwa 60 % unterschreitet der Fließtext auf diesem Hintergrund
das Kontrastverhältnis von 4,5:1. Eine Passage, die noch nicht erreicht ist,
muss trotzdem lesbar bleiben — schöner wäre 40 %, korrekt ist 60 %.
