# Informationsarchitektur

## Seitenbestand: 45 statisch vorgerenderte Seiten

```
/                              Startseite, elf Kapitel
/fuehrerschein                 Übersicht plus Finder
/fuehrerschein/[slug]          17 Klassenseiten
  klasse-b · bf17 · b197 · automatik · be · b96
  mofa · am · a1 · a2 · a
  c1 · c1e · c · ce
  d · de
/leistungen                    Übersicht
/leistungen/[slug]             9 Leistungsseiten
  berufskraftfahrer · bkf-weiterbildung · adr · staplerschein
  ladungssicherung · asf · fes · handicap · ferienfahrschule
/digitalpaket                  Wie die Teile zusammenspielen
/schueler-cockpit              Produktvorschau
/simulator                     Simulatortraining
/preise                        Kostenrechner und Kostentöpfe
/ausbildungsablauf             Zwölf Stationen
/standorte/fulda               Standortseite
/standorte/bad-hersfeld        Standortseite
/team                          Historie, Team, Fahrzeuge
/kontakt                       Formular und Kontaktdaten
/impressum · /datenschutz      Recht
/sitemap.xml · /robots.txt     Erzeugt aus der Inhaltsschicht
```

## Abweichungen von der Vorgabe

Der Auftrag nennt `/fuehrerschein/motorrad`, `/fuehrerschein/lkw`,
`/fuehrerschein/bus` und `/fuehrerschein/c-ge` als Sammelseiten. Sie wurden
**nicht** angelegt: eine Seite „Motorrad", die auf A1, A2 und A verweist, hat
keinen eigenen Inhalt und wäre genau die dünne Seite, vor der der Auftrag
warnt. Die Bündelung leistet stattdessen die Spurauswahl auf `/fuehrerschein`,
die Navigation und die Verlinkung verwandter Klassen.

`/handicap`, `/berufskraftfahrer`, `/staplerschein`, `/asf`, `/fes` und `/adr`
liegen unter `/leistungen/…` statt an der Wurzel — gleiche Inhalte, aber eine
Hierarchie, die Menschen und Suchmaschinen die Zusammengehörigkeit zeigt.

`/firmenkunden` fehlt: ein eigenständiges Firmenkundenangebot ließ sich nicht
belegen. Die Firmenperspektive erscheint stattdessen als Rahmen über die
belegten Leistungen (BKF, ADR, Ladungssicherung, Stapler).

## Erzählbogen der Startseite

| Kapitel | Frage der Besucherin | Handlung |
| --- | --- | --- |
| 01 Hero | Wer seid ihr, was gibt es, wo? | Führerschein finden / Beratung |
| 02 Finder | Welche Klasse passt zu mir? | Sechs Fragen, dann Empfehlung |
| 03 Klassen | Was gibt es alles? | Spur wählen, Klasse öffnen |
| 04 System | Wie hängt das zusammen? | Digitalpaket ansehen |
| 05 Cockpit | Wie behalte ich den Überblick? | Cockpit entdecken |
| 06 Simulator | Warum Simulator? | Nach Terminen fragen |
| 07 Kosten | Was kostet das? | Angebote vergleichen |
| 08 Ausbildungsweg | Was muss ich tun? | Ablauf verstehen |
| 09 Beruf & Spezial | Was noch? | Leistung öffnen |
| 10 Menschen & Orte | Wem vertraue ich? | Standort ansehen |
| 11 Abschluss | Und jetzt? | Finden oder fragen |

## SEO

Jede Seite hat einen eigenen Titel, eine eigene Beschreibung, genau ein `h1`,
eine kanonische URL und Open-Graph-Daten — alles aus der Inhaltsschicht, nicht
per Hand gepflegt.

Strukturierte Daten: `Organization` plus zwei `DrivingSchool`-Knoten mit
Adresse und Öffnungszeiten, `WebSite`, `Course` je Klasse, `BreadcrumbList` je
Unterseite. **Kein `offers`-Knoten**, weil keine Preise veröffentlicht werden,
und **kein `AggregateRating`**, weil keine belastbare Bewertung vorliegt. Alle
Felder laufen durch `publicValue()` — die Auszeichnung kann den sichtbaren
Angaben nicht widersprechen.

Nicht getan: „Fahrschule Fulda" in jeden Absatz zu schreiben. Die Ortsrelevanz
entsteht über die Standortseiten, die Adressen, die strukturierten Daten und
die tatsächlichen Inhalte.
