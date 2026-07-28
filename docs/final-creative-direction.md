# Kreative Richtung

## Drei geprüfte Richtungen

**A — „Nachtfahrt".** Kinematisch: nasser Asphalt, Scheinwerferkegel,
Rücklichter, lange Blenden. Stark im Gefühl, aber ohne echtes Bildmaterial nicht
umsetzbar, und die Gefahr war groß, als Autowerbung zu enden, die mit einer
Fahrschule nichts zu tun hat. Lesbarkeit über bewegtem Licht ist zudem heikel.

**B — „Fahrbahn".** Die Oberfläche **ist** Straßeninfrastruktur: Fahrstreifen als
Raster, Markierungen als Trennlinien, die Route als Navigationsmetapher,
Meilensteine als Stationen. Vollständig code-nativ, dadurch schnell und auf
jeder Auflösung scharf. Einer Fahrschule gehört diese Sprache — einem
SaaS-Anbieter nicht.

**C — „Cockpit".** Instrumente, Zeiger, Anzeigen. Für die Cockpit-Sektion
ehrlich, als Gesamtsprache aber genau das, was der Auftrag ausschließt: die
Silhouette eines Krypto-Dashboards oder eines Gaming-HUD.

## Entscheidung

**B als Rückgrat, A als Materialebene, C nur dort, wo Instrumente ehrlich sind.**

- Die **Fahrbahn** trägt die Struktur: Hero, jeder Seitenkopf, der Footer, die 404.
- Die **Nachtatmosphäre** liefert das Material: warmes Fast-Schwarz, Asphaltkorn,
  Lichtabfall von einer einzigen Quelle, dunkles Fahrzeugglas.
- **Instrumente** kommen ausschließlich im Schüler-Cockpit vor — dort sind sie
  keine Dekoration, sondern das Produkt.

Das ergibt ein System statt einer Collage: Wer Kapitel 1 gesehen hat, erkennt
Kapitel 9 wieder.

## Das rote Signal

Ein Akzent, aus Verkehrsrot und Bremslicht hergeleitet, mit **wechselnder
Funktion** statt gleichbleibender Dekoration:

| Ort | Bedeutung |
| --- | --- |
| Hero | Die aktive Fahrspur, die zum Horizont läuft |
| Kapitelmarke | Der Kilometerstein |
| Klassen-Spuren | Die gewählte Spur |
| Finder | Der Fortschritt durch die Kreuzung |
| Cockpit | Der Zustand „läuft gerade" |
| Rechner | Die Vergleichsachse und die Differenz |
| Ausbildungsweg | Die Route durch die Stationen |
| Footer | Die Ziellinie |

Rot markiert nie mehr als eine Sache pro Bildschirm. Wo alles wichtig ist, ist
nichts wichtig.

## Farben

| Rolle | Wert | Herkunft |
| --- | --- | --- |
| Ink 950–400 | `#060708` bis `#6b7480` | Warmes Fast-Schwarz, Asphalt |
| Chalk | `#f3f1ec` | Markierungsfarbe, nicht Reinweiß |
| Signal 400/500/600 | `#ff3b45` / `#e10a17` / `#c00711` | Verkehrsrot und Bremslicht |
| Amber | `#e0a11a` | Nur Warn- und Wartezustände — **kein zweiter Interface-Akzent** |
| State done | `#4ba97a` | Nur abgeschlossene Ausbildungsschritte |

Das Gelb der echten Marke ist bewusst auf Statuszustände beschränkt, damit es
nicht mit dem Signalrot um Aufmerksamkeit konkurriert.

## Typografie

**Archivo** für Display — eine variable Schrift mit **Breitenachse**. Verdichtet
wird über `font-stretch`, nicht über negatives Tracking; das hält große
Schriftgrade technisch statt gequetscht. **Instrument Sans** für Fließtext:
gute Umlaute, ruhige Ziffern, weniger abgenutzt als Inter.

Zahlen laufen überall tabellarisch (`font-variant-numeric: tabular-nums`), damit
Preise und Fortschritte beim Ändern nicht springen.

## Der Ablehnungstest

Für jeden Abschnitt: *Könnte eine andere Fahrschule das Logo tauschen und ihn
unverändert benutzen?*

| Abschnitt | Antwort |
| --- | --- |
| Hero | Nein — perspektivische Fahrbahn mit aktiver Spur |
| Klassen | Nein — Spursystem statt Kartenraster, mit echten Rechtswerten |
| Cockpit | Nein — rekonstruiert die echten Regeln des Betriebs |
| Rechner | Nein — vergleicht bei gleichen Mengen und nennt keine Preise, die es nicht gibt |
| Ausbildungsweg | Nein — sagt bei jeder Station, **wer** handeln muss |
| Simulator | Teilweise — trägt derzeit kein eigenes Foto (siehe `missing-assets.md`) |

## Was bewusst nicht gemacht wurde

Kein Scroll-Hijacking · keine gepinnte Horizontalgalerie · keine
wortweise eingeblendeten Absätze · kein Geschwindigkeits-Skew · keine Marquees ·
kein Custom-Cursor · keine animierte LCP-Zone · kein Cookie-Banner (weil es
nichts zu tracken gibt).
