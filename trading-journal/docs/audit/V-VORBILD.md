# Vorbild-Spezifikation: Anmelde- und Bezahlfenster (1:1-Nachbau)

Stand 08.11.2026. Ausschließlich Analyse, kein Code im Repo geändert.
Quellen:
- Login: `/root/.claude/uploads/0d7866ca-…/784162d9-Screen_Recording_20261031_002523_Instagram.mp4` (6,45 s, 1080×2340, VFR ≈ 59 fps Aufnahme, **Inhalt 30 fps**)
- Bezahlen: `/root/.claude/uploads/0d7866ca-…/adda1f2f-Screen_Recording_20261031_002648_Instagram.mp4` (6,62 s, gleiche Eckdaten)

Übernommen werden **Struktur, Proportionen, Bewegung, Zeiten, Kurven**. Schrift, Farben und Wortlaut kommen aus unserem Designsystem
(in dieser Spec stehen deutsche Platzhalter; Farbangaben nur als Rolle, z. B. „Akzent“, „dunkle Fläche“).

---------------------------------------------------------------------------------------------------------

## 0. Messmethode und Genauigkeit

* Bilder: `vorbild/{login,pay}/f30/` (30 fps, wie verlangt), zusätzlich `f60/` (60 fps, halbe Größe) und **`vfr/` = jedes Originalbild mit
  echtem Zeitstempel** (`vfr/pts.txt`). Alle Zeiten unten sind **Originalzeitstempel des Videos** in ms.
* Komponente ausgeschnitten: Login `1030×621 px` ab (25, 587), Bezahlen `1006×807 px` ab (36, 558) im 1080er Bild (`*/crop/`). Alle px-Werte
  unten sind in diesen Komponentenkoordinaten; Prozente beziehen sich auf **Komponentenbreite W bzw. -höhe H**.
* Das Reel läuft mit **30 fps** (Inhalt ändert sich alle ≈ 33 ms) → **Zeitauflösung ±17 ms**, Dauern ±33 ms. Im Login gibt es einen
  **Aufnahme-Hänger 1961→2060 ms** (≈ 100 ms ohne neues Bild); diese Punkte sind bei Kurvenfits heruntergewichtet.
* Bewegung gemessen über Kanten-/Schwerpunkt-Verfolgung (Python/NumPy), Kurven per Least-Squares gegen `cubic-bezier`/Feder gefittet
  (Skripte: `scratchpad/edgesv.py`, `fitband.py`, `fitflip.py`, `centroid.py`, `cardw2.py`).
* Instagram-Overlays (Herz, Zähler, Kommentar-Kreis am rechten Rand) überdecken Teile der Komponente rechts unten → ignoriert.
* Unterhalb der Demo zeigt das Reel Code-Schnipsel. Sie wurden **nicht übernommen**, nur als Gegenprobe gelesen, wo sie eine
  gemessene Zahl bestätigen (jeweils als „Gegenprobe“ markiert).

Schlüsselbilder: `vorbild/login-01…11-*.png`, `vorbild/pay-01…13-*.png`, Kontaktbögen `vorbild/login-sheet.png`, `vorbild/pay-sheet.png`.

---------------------------------------------------------------------------------------------------------

## 1. Anmelde-/Registrierfenster („Login & Signup“)

### 1.1 Rahmen

| Maß | Wert |
|---|---|
| Kartenformat | **W : H = 1030 : 621 = 1,66 : 1** (Querformat), Höhe **in beiden Modi gleich** (gemessen 621 px / 621 px – kein Höhen-Morph) |
| Eckenradius | ≈ 54 px = **5,2 % W** (= 8,7 % H) |
| Aufbau | **eine** Karte, zwei Flächen: helle Formularfläche + dunkle Markenfläche. Die dunkle Fläche ist **ein einziges schräges Band** (Parallelogramm), das zwischen den Modi die Seite wechselt. Es gibt **keinen** Kopf mit Titel/Schließen-Knopf, **keine** Tabs, **keinen** Rechtstext in der Karte. |
| Trennkante | Schräge, **13,0° gegen die Senkrechte**, oben links → unten rechts („\“), in beiden Modi gleich (gemessen 12,99° / 13,1°) → `skewX(13deg)` |
| Kante | Leuchtende Haarlinie in Akzentfarbe, ≈ 3–4 px (0,35 % W) Verlauf in die helle Fläche, keine harte Linie |
| Dunkle Fläche | senkrechter Verlauf: oben heller, unten dunkler (nur Struktur; Farben aus DS) |

### 1.2 Modus A „Anmelden“ (Zustand bei Start, Schlüsselbild `login-01`)

Dunkles Band rechts. Kantenlage: oben 47,0 % W, Mitte 53,9 % W, unten 60,4 % W.

Formularspalte **links**: x = 4,6 % … 41,6 % W (Breite **37 % W**). Vertikal (Anteil von H, Mittellinien):

| Element | Lage | Details |
|---|---|---|
| Titel „Anmelden“ | Oberkante 18,5 % H | fett, ≈ 4 % H Versalhöhe |
| Akzent-Strich unter Titel | 25 % H | 5,3 % W breit, ≈ 3 px, Akzentfarbe |
| Feld 1 „Benutzername oder E-Mail“ | Platzhalter 34,5 % H, Unterstrich 38,2 % H | **nur Unterstrich** (1 px, gedämpft), **Symbol rechts im Feld** (Person) |
| Feld 2 „Passwort“ | Platzhalter 51,4 % H, Unterstrich 54,9 % H | Symbol rechts (Auge) |
| Zeile Haken + Link | 63,8 % H | links Kästchen (≈ 18 px, Radius 3, gefüllt, Haken) + „Angemeldet bleiben“ (gedämpft); rechts „Passwort vergessen?“ fett, unterstrichen in Akzent |
| Primärknopf „Anmelden“ | 68,4–78,6 % H (Höhe **10,1 % H**) | **Pille** (voll gerundet), **volle Spaltenbreite**, dunkle Fläche mit Verlauf, weicher Schlagschatten, Text fett weiß zentriert |
| Fußzeile | 83,7 % H | „Neu hier?“ gedämpft + „Konto erstellen“ fett mit Akzent-Unterstrich (≈ 2 px) |

Abstand Feld zu Feld (Unterstrich zu Unterstrich) **16,7 % H**.

Markenfläche **rechts**, Textblock ab x = **58,9 % W**:

| Element | Lage | Details |
|---|---|---|
| Augenbraue „TRADE JOURNAL“ | 35,6 % H | klein, Versalien, weit gesperrt, Akzentfarbe |
| Schlagzeile Zeile 1 („Willkommen“) | ≈ 44 % H | große Display-Schrift (im Vorbild Serife, hell), Zeilenhöhe ≈ 8,9 % H |
| Schlagzeile Zeile 2 („zurück.“) | ≈ 53 % H | gleiche Größe, **kursiv in Akzentfarbe** |
| Text, 2 Zeilen | 62,3 % / 66,5 % H | gedämpft, ≈ 2,6 % H Schrift |

### 1.3 Modus B „Registrieren“ (Schlüsselbild `login-07`)

**Spiegelbild**: dunkles Band jetzt **links**, Kantenlage oben 38,9 %, Mitte 45,6 %, unten 52,4 % W (gleiche Schräge).
Markentext links ab x = **5,0 % W**, **gleiche y-Lagen** wie in A („TRADE JOURNAL“ / „Dein Journal.“ / „*Dein Start.*“ / 2 Zeilen Text).

Formularspalte **rechts**: x = 58,4 % … 95,6 % W (wieder 37 % W). Mehr Zeilen, darum höher gepackt:

| Element | Lage (Anteil H) |
|---|---|
| Titel „Konto erstellen“ | Mitte 12,7 % |
| Akzent-Strich | 16,7 % |
| Feld 1 „Name“ – fokussiert | schwebendes Label 22 %, Unterstrich 30,1 % |
| Feld 2 „E-Mail-Adresse“ | Unterstrich 47,2 % (Symbol Brief) |
| Feld 3 „Passwort“ | Unterstrich 63,9 % (Symbol Auge) |
| Passwort-Hinweis | 67,8 %: links **4 kurze Stärke-Segmente** (je ≈ 4 % W, Lücke ≈ 1 % W), rechts „Mindestens 10 Zeichen.“ klein |
| Primärknopf „Konto erstellen“ | 76,2–86,5 % (Höhe 10,3 % H), Pille, volle Spaltenbreite |
| Fußzeile | 91,6 %: „Schon ein Konto?“ + „Anmelden“ (fett, Akzent-Unterstrich) |

Abstand Feld zu Feld wieder **≈ 17 % H**.

### 1.4 Feld-, Fokus- und Caret-Verhalten (gemessen)

* Ruhe: Platzhalter im Feld, 1-px-Unterstrich gedämpft.
* **Nach jedem Moduswechsel bekommt Feld 1 automatisch den Fokus** (A und B). Fokus sichtbar als:
  * Label **schwebt** über das Feld (≈ 60 % Größe, Akzent-/Braunton), Platzhalter weg;
  * Unterstrich wird **Akzentfarbe, ≈ 3 px**, leichter Schein, **wächst von links nach rechts**: 2060 ms ≈ 10 % → 2093 ms 95 % → 2143 ms 100 %
    ⇒ **≈ 120 ms, ease-out**;
  * Caret: dunkel, 2 px breit, ≈ 24 px hoch (3,9 % H). Systemcaret, Blinken gemessen **an 450 ms / aus 417 ms / an 467 ms** (≈ 500-ms-Takt).
    Der Caret steht schon **während** das Band noch deckt (ab 2010 ms) → Fokus wird **beim Inhaltstausch** gesetzt, nicht am Ende.

### 1.5 Zustandsautomat Login

```
            Klick „Konto erstellen“                      Klick „Anmelden“ (Fußlink)
 [A_RUHE] ─────────────────────────► [A→B] ─► [B_RUHE] ─────────────────────────► [B→A] ─► [A_RUHE]
             (Autofokus Feld1 in B)                      (Autofokus Feld1 in A)
 Während [A→B]/[B→A] werden weitere Umschalt-Klicks ignoriert (Band läuft genau einmal).
```

**Übergang A→B (gemessen, Start = Klick ≈ 1470–1500 ms):**

| Spur | Start (rel.) | Dauer | Bewegung | Kurve |
|---|---|---|---|---|
| **Band** (das dunkle Parallelogramm, eine einzige `translateX`) | 0 | **≈ 870 ms** (A→B) / **≈ 915 ms** (B→A) | Verschiebung um **≈ 1,51 W** nach links (A→B) bzw. rechts (B→A). Bandbreite **≈ 1,42 W**. Dadurch: linke Kante fährt aus der Karte, Karte ist **komplett dunkel**, rechte Kante tritt von rechts ein und hält bei 45,6 % W | **ease-in-out mit langem Auslauf**: Fit `cubic-bezier(0.47, 0.18, 0.32, 1.0)` (A→B) / `cubic-bezier(0.54, 0.10, 0.28, 1.0)` (B→A) ⇒ **empfohlen `cubic-bezier(0.5, 0.14, 0.3, 1)`, 900 ms**. **Kein Überschwingen** (Endlage monoton erreicht: 476→470→467→466 px) |
| Inhalt im Band | – | – | bleibt **in Kartenkoordinaten stehen** (Band wirkt wie ein wanderndes Fenster; Gegenprobe Code-Overlay: Innencontainer mit umgekehrtem `translateX`/`skewX`) | – |
| Karte ganz dunkel | ≈ +275 ms … +390 ms (A→B), ≈ +310 … +455 ms (B→A) | **115–145 ms** | – | – |
| **Inhaltstausch** | **+325 ms (= 37 % der Bandzeit)** A→B, **+395 ms (43 %)** B→A | **0 ms – harter Schnitt** | alter Markentext und altes Formular verschwinden **ohne Ausblenden** (Masse des Textes konstant bis 1779 ms, 1811 ms = 0); neue Seiten-Zuordnung (Formular/Marke tauschen die Seite) | – |
| Neue Augenbraue | Tausch +≈ 20 ms | ≈ 300 ms | Opazität 0→1, **steigt 14–15 px** (≈ 2,3 % H) auf | ease-out, Fit `cubic-bezier(0.2, 0, 0, 1)` ≈ 320 ms |
| Neue Schlagzeile (2 Zeilen zusammen) | Tausch +≈ 70–90 ms | ≈ 300 ms | Opazität 0→1, steigt **≈ 11–14 px** | wie oben |
| Neuer Fließtext | Tausch +≈ 130–150 ms | ≈ 250 ms | Opazität 0→1, steigt **≈ 9–10 px** | wie oben |
| Formular-Zeilen (Titel, Feld 1, Feld 2, Feld 3/Hinweis) | ab Tausch, **gestaffelt ≈ 45 ms je Zeile** | je ≈ 200–250 ms | Opazität 0→1, steigen **≈ 5 px** (Feld 2: 283,5→278,2 px; Feld 3: 389→384 px) | ease-out |
| Fokus-Unterstrich Feld 1 | Tausch +≈ 250 ms | ≈ 120 ms | `scaleX` 0→1 von links | ease-out |
| Primärknopf | Tausch **+≈ 270 ms** (A→B: 2075 ms; B→A: 4350 ms) | **≈ 300 ms** | Opazität 0,18 → 0,48 → 0,68 → 0,81 → 0,90 → 0,94 → 0,97 → 1 (je 33 ms), steigt ≈ 8 px | ease-out (`cubic-bezier(0.2,0,0,1)` passt) |
| Fußzeile | Tausch +≈ 390 ms | ≈ 150 ms | Opazität 0→1 | ease-out |
| Gesamt Klick → Ruhe | | **≈ 850–900 ms** | | |

Die Formularfläche wird von der Bandkante **freigelegt** (wischt von rechts nach links in A→B, von links nach rechts in B→A); die
Einblend-Staffel läuft gleichzeitig darunter (die Elemente sind beim Freilegen teils schon halb sichtbar).

**Übergang B→A**: identisch gespiegelt (Band fährt nach rechts), Zeiten oben in Klammern. Gemessen: Start ≈ 3700 ms, Tausch 4095 ms,
Augenbraue 4111→4378 ms (236→220,7 px), Schlagzeile 4178→4444 ms (307→292,7 px), Fließtext 4227→4478 ms, Knopf 4350→4594 ms.

**Reduced Motion** (nicht im Video, Vorschlag): Band springt, Tausch sofort, Fokus trotzdem in Feld 1.

### 1.6 Knopf-/Link-Zustände

| Zustand | Vorbild |
|---|---|
| idle | Pille, dunkle Fläche, Schatten |
| pressed / hover | **nicht messbar** (Klicks in der Aufnahme treffen nur die Fußlinks; keine sichtbare Änderung am Link beim Klick) |
| loading / success / error | **nicht im Video** |

### 1.7 Ein-/Austritt des Fensters

**Nicht im Video** (Komponente ist von Bild 1 an da; bei 5,2 s schneidet das Reel hart auf den Anfang = Schleife des Reels, keine UI-Animation).

---------------------------------------------------------------------------------------------------------

## 2. Bezahlfenster („Payment Method“)

### 2.1 Rahmen und Ruhe-Layout (Schlüsselbild `pay-03`)

| Maß | Wert |
|---|---|
| Fensterformat | **W : H = 1006 : 807 = 1,25 : 1**, Eckenradius ≈ 26 px = **2,6 % W** |
| Kopfleiste | Höhe **9,4 % H**, weiß, 1-px-Trennlinie. Links Logo-Quadrat (≈ 3,7 % W, Radius ≈ 25 %), Marke fett + Zusatz gedämpft („TRADE JOURNAL · KASSE“). Rechts **Schrittband** mit 3 Schritten: „Auswahl ✓ — Konto ✓ — ③ Zahlung“ (erledigte Schritte: grüner Kreis mit Haken; aktiver Schritt: gefüllter Kreis mit Ziffer, fetter Text, **Akzent-Unterstrich unter dem aktiven Schritt**, ≈ 13 % W breit) |
| Linke Spalte | x 0–50 % W, **getönte Fläche** (heller Blau-Grau-Verlauf, oben heller) |
| Rechte Spalte | x 50,7–100 % W, **weiße Fläche** |

Linke Spalte:

| Element | Lage | Details |
|---|---|---|
| **Kartengrafik** | x 5,2–45,5 % W (Breite **40,4 % W**), y 23,9–55,5 % H | Format **1,59 : 1** (ISO-Karte), Radius ≈ 5 % der Kartenbreite, weicher Schatten, diagonaler Verlauf hell→Akzent mit feinem Diagonalstreifen-Muster rechts |
| Vorderseite | | oben links Chip (≈ 12 % Kartenbreite) + Kontaktlos-Symbol; oben rechts Marke 2-zeilig („TRADE JOURNAL“ / klein „PREMIUM“); Mitte-links **Kartennummer in Monospace**, 4 Vierergruppen (Glyphe ≈ 16 px hoch = 6,3 % Kartenhöhe), „eingraviert“ (1-px heller Textschatten – Gegenprobe Code); unten links 2 kleine Labels „KARTENINHABER / GÜLTIG BIS“ + Werte; unten rechts Kartenmarke |
| Platzhalter | | leere Ziffern als **„•“ je Ziffer** in 4 Gruppen; Ablauf „••/••“; Marke unten rechts erst nach 1. Ziffer |
| **Bestellübersicht** | x 5,2–45,9 % W, y 59,7–86,1 % H, Radius ≈ 2 % W, weiß halbtransparent | „DEINE BESTELLUNG“ (Versalien klein), Zeilen: Posten + Betrag rechts (Unterzeile gedämpft), „Lieferung – inklusive“ (Erfolgsfarbe), „Steuer“, Trennlinie, „Heute fällig“ + **Betrag groß fett** (Nachkommastellen klein) |

Rechte Spalte (Formular), x 53,5–97,2 % W (Breite **43,7 % W**):

| Element | y (Anteil H) | Details |
|---|---|---|
| Titel „Zahlungsdaten“ | 15,5 % | fett, groß |
| Untertitel | 19,6 % | gedämpft |
| Label „KARTENINHABER“ | 25 % | Versalien klein, gesperrt, gedämpft |
| Feld Name | 27,0–34,2 % (Höhe **7,2 % H**) | **Kastenfeld**, Radius ≈ 12 px (1,2 % W), Symbol links (Person) |
| Label „KARTENNUMMER“ | 40,3 % | |
| Feld Nummer | 42,5–49,7 % | Symbol links (Karte); **Markenzeichen rechts im Feld** (erscheint bei 1. Ziffer) |
| Labels „GÜLTIG BIS“ / „PRÜFZIFFER · Rückseite“ | 55,8 % | Zusatz „Rückseite“ gedämpft |
| Felder Ablauf / Prüfziffer | 57,9–65,1 % | 2 Spalten, Lücke 1,9 % W; Symbole Kalender / Schloss; Platzhalter „MM/JJ“ / „•••“ |
| Kasten „Karte für nächstes Mal speichern“ | 70,9–79,3 % | umrandeter Kasten, Häkchen gefüllt (Akzent), Titel + gedämpfte Unterzeile |
| **Zahlknopf** | 81,4–89,2 % (Höhe **7,8 % H**), volle Breite | Radius ≈ 12 px, Akzentverlauf, farbiger Schein darunter; Inhalt: Schloss + „{Betrag} zahlen“ + Pfeil → |
| Vertrauenszeile | 92,6 % | 2 kleine Punkte mit Symbol (Schild / Schloss) |
| Hinweis | 95,5 % | gedämpft klein |

Fokuszustand Feld: Rand in Akzentfarbe + weicher Akzent-Ring außen (≈ 3–4 px). Wechsel **≤ 1 Bild (≤ 33 ms)** – praktisch sofort; Kurve nicht messbar.

### 2.2 Live-Spiegelung der Eingabe (gemessen)

* Getippt wird im Demo mit **50 ms je Zeichen** (Kartennummer: 16 Ziffern 195→962 ms; Ablauf 67 ms je Zeichen).
* Feld: Ziffer erscheint **sofort**. Gruppierung „4242 4242 …“ wird automatisch gesetzt.
* **Karte, je Ziffer** (Ziffer ersetzt den „•“-Platzhalter an ihrer Stelle):
  * Bild 1 nach Eingabe: Glyphe **≈ 70 % groß, ≈ 6 px (≈ 0,4 Glyphenhöhe) höher, ≈ 45 % deckend**;
  * Bild 2: ≈ 94 % groß, ≈ 1 px höher, ≈ 85 % deckend; Bild 3: Ruhe.
  * ⇒ **„fällt ein“: `translateY(-0.5em) scale(0.6) opacity 0` → Ruhe, ≈ 100 ms, ease-out** (genaue Kurve nicht messbar, nur 1–2 Zwischenbilder).
* Markenzeichen: erscheint mit der **ersten Ziffer** im Feld (≈ 66 ms Einblenden) und gleichzeitig auf der Karte unten rechts.
* Ablauf: „1“ → „12“ → „12/2“ (**Schrägstrich automatisch mit der 3. Ziffer**) → „12/28“; Karte zeigt „1•/••“, „12/••“, „12/2•“, „12/28“.
* Prüfziffer: Ziffern erscheinen **auf der Rückseite** im Unterschriftsfeld-Kästchen („1••“, „12•“, „123“).

### 2.3 Kartenwende (gemessen an 3 Wenden)

| | Wert |
|---|---|
| Auslöser | **Fokus auf Prüfziffer → Rückseite**; **Fokus auf ein anderes Feld → Vorderseite** (automatisch, kein Knopf). Gegenprobe Code: `cvc.onfocus → flip(true)` |
| Achse | **Hochachse (rotateY)**, mit Perspektive; hin `0° → 180°`, zurück `180° → 0°` (Gegenrichtung, keine Dauerdrehung): die Vorderseite zeigt sich in beiden Richtungen mit der **rechten Kante nach hinten** |
| Dauer | **≈ 290 ms** (Fit über alle 3 Wenden, gemeinsame Dauer) |
| Kurve | **`cubic-bezier(0.3, 0, 0.3, 1)`** (rms 4,1°); fast gleich gut `ease` = `cubic-bezier(0.25,0.1,0.25,1)`, 287 ms (rms 4,2°). Linear passt schlecht (7,1°) |
| Überschwingen | **keins** messbar (projizierte Breite erreicht 409–418 px und fällt nicht wieder) |
| Perspektive | aus Kantenhöhen geschätzt ≈ 1200–1800 px bei 406 px Kartenbreite ⇒ **`perspective` ≈ 3–4,5 × Kartenbreite** (unsicher, ±30 %) |
| Startverzug | Wende beginnt im selben Bild wie der Fokusring (≤ 33 ms nach Klick) |

Rückseite (Schlüsselbild `pay-06`): oben 12–20 % Kartenhöhe **schwarzer Magnetstreifen** (darüber dünner Akzent-Verlauf); darunter
**Unterschriftsfeld** schraffiert (≈ 75 % Kartenbreite) mit weißem **Prüfziffer-Kästchen** rechts („•••“ → Ziffern); darunter 2 Zeilen
Kleingedrucktes; unten rechts Marke.

### 2.4 Zustandsautomat Bezahlen

```
[EINGABE_VORN] ──Fokus Prüfziffer──► [WENDE→HINTEN 290ms] ─► [EINGABE_HINTEN]
      ▲                                                          │
      └──────────── [WENDE→VORN 290ms] ◄── Fokus anderes Feld ───┘
[EINGABE_*] ──Klick Zahlknopf──► [ABHEBEN ≈300ms] ─► [AUTORISIEREN] ──Antwort ok──► [BEZAHLT] ─► (Knopf „Noch einmal“)
```

**ABHEBEN** (Klick Zahlknopf ≈ 4630 ms; Start der Bewegung t0 ≈ 4645–4652 ms):

| Spur | Start | Dauer | Bewegung | Kurve |
|---|---|---|---|---|
| Rechte weiße Fläche + Formular + Bestellübersicht | t0 | **≈ 90–100 ms** | Formular/Übersicht blenden aus, weiße Fläche geht in die getönte Fläche über (Weiß 255 → 243 → 221 → 208) – danach ist der **ganze Inhaltsbereich unter der Kopfleiste eine ruhige getönte Fläche**. Kopfleiste und Schrittband bleiben unverändert | ≈ linear/ease-out |
| **Karte** | t0 | **≈ 300 ms** | fährt von ihrem Platz in der linken Spalte in die **Mitte des ganzen Fensters** (Mittelpunkt (255, 320) → (503, 393) px = **50 % W, 48,8 % H**), **skaliert auf 1,08** (Gegenprobe Code: Ziel = 44 % der Fensterbreite, geklemmt 1–1,34 → 0,44·1006/406 = 1,09 ✓) | **`cubic-bezier(0.22, 1, 0.36, 1)`** (rms 0,016) bzw. Feder **stiffness ≈ 960, damping ≈ 62, mass 1 (ζ = 1,0, kein Überschwingen)**; Fortschritt gemessen 0,17 / 0,55 / 0,72 / 0,89 / 0,96 / 0,99 / 1 nach 18/49/82/116/150/184/250 ms |
| Karte – Wende | t0 | **≈ 110–120 ms** | war die Rückseite sichtbar, dreht sie **während des Fluges** auf die Vorderseite (180°→0°) | ease-out |
| Glasplatte/Schein hinter der Karte | t0 | ≈ 120 ms | eine halbtransparente, abgerundete Platte (≈ Karte + 10 % Rand) mit **Akzent-Schein** erscheint am alten Kartenplatz und wandert mit, geht dann in den Kartenschein über | – |
| Statustext + Spinner | t0 + ≈ 15 ms | ≈ 80 ms | blenden **an Ort und Stelle** ein (kein Gleiten): Spinner-Mitte 72,7 % H, Titel 78,4 % H, Unterzeile 82,7 % H | ease-out |

**AUTORISIEREN** (Schlüsselbilder `pay-10`, `pay-11`):

| Element | Wert |
|---|---|
| Karte | ruht in der Mitte, Scale 1,08, **Akzent-Schein** als Spread-Shadow (zwei Lagen, ≈ 26 px und ≈ 62 px Unschärfe – Gegenprobe Code) |
| Schein-Puls | Intensität schwankt mit **≈ 500 ms** Periode (Max 4797 ms, Min ≈ 5050 ms, Max ≈ 5230 ms) |
| **Glanzstreifen** | heller Diagonalstreifen (≈ 20 % Kartenbreite) läuft **links → rechts** über die Karte; ein Durchlauf **≈ 200 ms** (Geschwindigkeit ≈ 3 px/ms), Wiederholung **alle 500 ms** (Durchläufe bei 4763 und 5263 ms) |
| Spinner | dünner Ring ≈ 32 px (**3,2 % W**), heller Ring + Akzent-Bogen ≈ 90–100°, **im Uhrzeigersinn, ≈ 300 ms je Umdrehung, linear** |
| Text | Titel „Autorisierung bei deiner Bank“ (halbfett), Unterzeile „Visa •••• 4242 · {Betrag}“ (gedämpft) |
| Dauer im Demo | Klick → Bezahlt **≈ 730 ms**, Karte-in-Ruhe → Bezahlt ≈ 600 ms (Demo-Wert; echte Dauer = Serverantwort) |

**BEZAHLT** (ab ≈ 5363 ms, Schlüsselbilder `pay-12`, `pay-13`):

| Spur | Start | Dauer | Bewegung |
|---|---|---|---|
| Text | 0 | **0 ms (harter Tausch)** | Titel „Bezahlt {Betrag}“ (fett, größer), Unterzeile „Visa •••• 4242 · Beleg ist unterwegs“ |
| Glanz/Spinner | 0 | 0 | Glanzstreifen bricht ab, Akzent-Schein **aus** |
| Erfolgs-Schein | +≈ 30 ms | **≈ 100 ms** | Schein in **Erfolgsfarbe** um die Karte baut sich auf (gleiche Form wie Akzent-Schein) |
| Erfolgsring | +≈ 30 ms | ≈ 100 ms | Ring in Erfolgsfarbe (≈ 38 px) **zeichnet sich** |
| Haken | +≈ 70 ms | ≈ 70–100 ms | Haken-Strich zeichnet sich im Ring |
| Knopf „Noch einmal“ | **+≈ 200 ms** (5563 ms) | ≈ 33–66 ms | kleine **Umriss-Pille** (Akzent-Rand, weiß) unter der Unterzeile, blendet ein |

Rücksetzen: **nicht messbar** (bei 5,88 s schneidet das Reel zurück an den Anfang).

### 2.5 Ein-/Austritt des Fensters

**Nicht im Video.**

---------------------------------------------------------------------------------------------------------

## 3. Vergleich mit unserem früheren Versuch (`docs/audit/B-VORBILD.md`, `docs/audit/img-b/*`)

### 3.1 Anmelden / Registrieren

| # | Vorbild (gemessen) | Unser Versuch | Art |
|---|---|---|---|
| L1 | **Querformat-Karte 1,66 : 1, zweigeteilt** (Formular 37 % W ↔ Markenfläche), schräge Kante 13° | Hochformat-Modal (≈ 541 × 588 px), **eine Spalte**: Kopf „Anmelden“ + ✕, Markenstreifen oben, Formular darunter | Layout |
| L2 | Die dunkle Fläche **ist** das Band; es endet als Markenhälfte auf der **anderen Seite** – Formular und Marke **tauschen die Seiten** | Band ist ein **zusätzliches Overlay**, das über die Karte fährt und **sie wieder verlässt**; Markenstreifen bleibt oben, nichts tauscht die Seite | Bewegung |
| L3 | Band **≈ 900 ms**, `cubic-bezier(0.5,0.14,0.3,1)` (langsam an, langer weicher Auslauf), Tausch bei **37–43 %**, Karte 115–145 ms ganz dunkel | **560 ms**, Tausch bei **46 %**; Original im Doc mit „≈ 0,4–0,5 s“ angesetzt – das ist **etwa halb so lang wie gemessen** (Klick → Ruhe ≈ 850–900 ms) | Timing |
| L4 | Kartenhöhe **konstant** (621 px in beiden Modi) | Höhe ändert sich (Desktop-Shots 588 → 698 px), `AuthMorph`/`MorphHeight` federt die Höhe | Layout/Bewegung |
| L5 | Alter Inhalt **harter Schnitt** unter dem Dunkel; neuer Markentext **fade + 14 px Aufstieg, ≈ 300 ms, Staffel ≈ 60 ms** (Augenbraue → Schlagzeile → Text); Formularzeilen **Staffel ≈ 45 ms, 5 px Aufstieg**; Knopf zuletzt (+270 ms, 300 ms) | Feldgleiten per `spring.layout`/`spring.enter`, keine Staffel nach diesem Muster, kein Aufstieg des Markentexts | Bewegung |
| L6 | Felder **nur Unterstrich**, Symbol rechts; Fokus: **schwebendes Label**, Akzent-Unterstrich 3 px, **wächst links→rechts in ≈ 120 ms** | Kastenfelder mit Versal-Label darüber, Fokus als heller Rahmen/Ring | Feldstil |
| L7 | Primärknopf **Pille, volle Spaltenbreite**, 10 % H hoch, unter der Haken/Link-Zeile | Knopf **rechtsbündig, ≈ halbe Breite**, „Passwort vergessen?“ links daneben | Layout |
| L8 | Markenteil: Augenbraue + **zweizeilige Display-Schlagzeile, 2. Zeile kursiv in Akzent** + 2 Zeilen Text, vertikal mittig (35–67 % H) | Punktraster-Streifen mit Wortmarke + **einzeiliger** Schlagzeile, kein Fließtext | Inhalt/Layout |
| L9 | Kein Tab-Umschalter, Moduswechsel **nur** über den Fußlink | Segment-Tabs „Passwort / Magic Link / Neu hier“ zusätzlich | fehlt im Vorbild (Funktion bei Bedarf anders unterbringen) |
| L10 | Registrieren: 3 Felder (Name, E-Mail, Passwort) + Stärke-Segmente **links**, Hinweis **rechts** in einer Zeile; keine Zustimmungs-Checkbox, kein Rechtstext | 2 Felder, Hinweis + Stärkebalken unter dem Feld, Zustimmungskasten, Rechtstext unten | Layout (Pflichttexte rechtlich prüfen, ggf. außerhalb der Karte) |
| L11 | Autofokus Feld 1 **schon beim Tausch** (Caret blinkt, während das Band noch deckt) | Fokus nach Ende | Timing |
| L12 | Kante: leuchtende Akzent-Haarlinie **auf der Kante** | „feine Lichtkante auf beiden Seiten“ des Overlay-Bandes | Detail |

### 3.2 Bezahlen

| # | Vorbild (gemessen) | Unser Versuch | Art |
|---|---|---|---|
| P1 | Fenster **1,25 : 1**, Kopfleiste mit Logo + **Schrittband mit Haken-Kreisen und Unterstrich unter dem aktiven Schritt**; Inhalt zweispaltig 50/50: links **getönte** Spalte (Karte + Bestellübersicht-Kärtchen), rechts **weißes** Formular | Modal „Deine Bestellung“, Schrittband als Textzeile „1 Bestellung prüfen – 2 … – 3 …“, rechts eine **lange Vertragstabelle** (Abrechnung, Gesamtpreis, Erste Zahlung, Verlängerung, Kündigung, Steuer …), Fußzeile mit Abbrechen + Summe + Knopf | Layout |
| P2 | Karte **40 % W**, ISO-Format, oben links; darunter Bestellübersicht | Planbild ≈ 1/3 der Breite, darunter Umdreh-Knopf + Hinweistext, keine Übersicht unter der Karte | Layout |
| P3 | **Live-Spiegelung je Zeichen**: Ziffer fällt in ≈ 100 ms ein (−0,5 em, 60 %, 0 → Ruhe), „•“-Platzhalter, Marke bei 1. Ziffer, Auto-Schrägstrich | keine Eingabe, Karte zeigt Tarif/Betrag (bewusst: Stripe-Weiterleitung) | fehlender Schritt (Grund: Stripe – Betreiberentscheidung „Payment Element einbetten“ offen) |
| P4 | Wende **automatisch** per Fokus Prüfziffer / anderes Feld, rotateY 0↔180°, **≈ 290 ms `cubic-bezier(0.3,0,0.3,1)`**, kein Überschwingen | Wende per **Knopf**, `spring.smooth` (Dauer/Kurve im Doc nicht beziffert) | Auslöser + Timing |
| P5 | Klick „Zahlen“: Formular **verschwindet in ≈ 100 ms**, Karte **fliegt in die Fenstermitte** (Scale 1,08) in **≈ 300 ms `cubic-bezier(0.22,1,0.36,1)`** und dreht dabei auf die Vorderseite | `PayStage` legt eine Glasfläche über die (inerte) Zusammenfassung; Karte erscheint dort, **fliegt nicht** von ihrem Platz; Fußleiste mit Knopf „Wird vorbereitet …“ bleibt sichtbar | Bewegung |
| P6 | Autorisieren: **Spinner-Ring 32 px, 300 ms/Umdrehung**, **Glanzstreifen alle 500 ms (≈ 200 ms Durchlauf)**, Schein pulsiert 500 ms; 2 Textzeilen mittig unter der Karte | Halo-Ring „3 Atemzüge, dann Ruhe“ + `ThinkingOrb plan` + 3–4 Zeilen Text (Betrag in Monospace, Verlängerung, Hinweis) | Bewegung/Inhalt |
| P7 | Bezahlt: harter Texttausch, Schein wechselt in **Erfolgsfarbe (100 ms)**, Ring + Haken zeichnen sich, **„Noch einmal“-Pille nach +200 ms** – alles **im selben Fenster** | Erfolg nur auf der Ergebnisseite nach Webhook (bewusst, rechtlich/technisch richtig) | fehlender Schritt im Fenster (nur mit Serverbestätigung nachbaubar) |
| P8 | Kaufknopf: volle Formularbreite, Schloss + „{Betrag} zahlen“ + Pfeil, mit farbigem Schein | Knopf rechts in der Fußleiste, Beschriftung „Zahlungspflichtig bestellen“ (gesetzlich vorgegeben – bleibt, nur Form/Lage angleichen) | Layout |
| P9 | Kastenfelder mit Symbol links, Fokus = Akzentrand + Ring, Labels in gesperrten Versalien | keine Felder | – |
| P10 | Fenstergröße während des ganzen Ablaufs **unverändert** | ebenfalls unverändert (≤ 2 px) | gleich ✓ |

---------------------------------------------------------------------------------------------------------

## 4. Nicht messbar / nicht im Material

* **Ein- und Austritt** beider Fenster (Videos zeigen nur die laufende Komponente; Reel schneidet hart in die Schleife).
* **Echte CSS-Pixel**: nur Verhältnisse (Videos zeigen eine skalierte Browser-Vorschau). Schriftgrößen nur als Anteil von H.
* **Hover/Pressed** von Knöpfen und Links (keine sichtbare Änderung; Zahlknopf zeigt beim Klick keine messbare Skalierung).
* **Fehler-, Lade-, Erfolgszustände des Login-Knopfs** (nicht gezeigt).
* Feine Kurven < 100 ms (Ziffer-Einfallen, Fokusring, Haken-Strich, „Noch einmal“-Einblenden): nur 1–3 Bilder → Dauer ±33 ms, Kurvenform geschätzt.
* **Perspektive** der Kartenwende nur grob (≈ 3–4,5 × Kartenbreite).
* Periode Glanz/Puls nur aus 2 Zyklen (≈ 500 ms ± 33 ms); Bogenlänge des Spinners ≈ 90–100° (Auflösung).
* Login: Hänger in der Aufnahme 1961–2060 ms; Band-Fit hat dort Ausreißer bis 72 px (übrige Punkte ±5 px). Die Rückrichtung (sauberer) ist maßgeblich.
* Rücksetzen nach „Noch einmal“, mobiles Layout (beide Videos zeigen nur die Desktop-Ansicht).
* Ob die Karte im Ruhezustand der Maus folgt (`card__tilt` im Code-Overlay deutet Neigung an) – in der Aufnahme keine Neigung messbar.
