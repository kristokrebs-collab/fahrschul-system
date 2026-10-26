# `src/views/funktionen` – Seite „Funktionen“ (Auffindbarkeit)

`FunktionenView` (`h1` „Funktionen“, Hash `#funktionen`, Taste `g f`): alles, was die App kann – **nach Aufgabe des Händlers** geordnet, mit
ehrlichem Stand, in unter zehn Sekunden gefunden. Die Seite ist **kein Dock-Tab und keine Dashboard-Karte**; sie ist erreichbar über die
Befehlsnavigation („Alle Funktionen“ ganz oben neben dem Finder, Seitenlink Nr. 16), die globale Suche („Funktionen“), `g f`, die Einstellungen
(„Weitere Einstellungen → Alle Funktionen“) und den Assistenten (Link im Leerzustand, „Wo finde ich …?“).

## Aufbau der Seite

1. **Kopf** (`PageHeader`, Zähler).
2. **Suche „Was willst du tun?“** – ein großes Feld (56 px, 16 px Schrift). Es versteht Aufgaben in eigenen Worten („warum verliere ich“,
   „Strategie testen“, „TradingView-Skript“), Tippfehler („Wochenbricht“), Endungen („Wochenberichte“) und Fragesätze („ich will wissen, ob mein Setup
   funktioniert“). Treffer ersetzen alles darunter (Zeilen mit Aufgabe, Gruppe und Ort), Enter öffnet den ersten, Esc leert. Passt nichts genau, steht
   „Nichts passt genau – n Vorschläge“; ganz ohne Treffer ein ehrlicher Leerzustand mit Knopf zum Assistenten.
3. **Zuletzt benutzt** (nur wenn es etwas gibt, höchstens drei) und **Empfohlen** (immer; höchstens vier, mobil zwei): zuerst, worauf die Zähler des
   Assistenten zeigen („Für dich“), dann die Funktionen des letzten Releases („Neu“, zwei Monate nach `since`), dann die wenigen Einstiegspunkte
   (`star`). Kompakte Zeilen, nur Name + Gruppe.
4. **Aufgaben** – zehn große Kacheln (`GroupTile`: Symbol, Name, ein Satz, Anzahl und ein Status-Punkt: grün = alle fertig, bernstein = einige nur
   teilweise, in Worten daneben). Mobil eine Spalte, ab `md` zwei, ab `xl` drei.
5. **Gruppe** (Kachel angetippt): „← Alle Aufgaben“, Name und Satz, die Funktionen unter Zwischenüberschriften (`sub`) als Zeilen (`FeatureRow`). Die
   ganze Zeile öffnet die Stelle; ein stiller Knopf rechts klappt die Details auf (was es tut, **Fehlt noch** / Zu wissen, So geht’s, Voraussetzung,
   Gerät, Tarif, **Siehe auch**, F-IDs). Die offene Gruppe ist ein Rückschritt-Eintrag (`openBackEntry`): die Zurück-Taste des Systems führt zu den
   Kacheln, nicht von der Seite weg; Esc und der Knopf tun dasselbe und geben der Kachel den Fokus zurück.

Nichts wird gespeichert oder gesendet: „Empfohlen“ liest `settings.assistant.interests` (Zähler, die der Assistent ohnehin führt), „Zuletzt benutzt“
die Suche-Liste (`feature:<id>`, nur dieser Browser). Unter allem steht der Stand-Satz („nach dem Code, nicht nach dem Wunsch“, „Keine professionelle
Finanzberatung.“).

## Eine Quelle: `src/app/features.ts`

Diese Seite, die globale Suche (`src/search/sources.ts`, Art `feature`), der Finder der Befehlsnavigation und der Assistent (`tools.ts`, `whereTool`)
lesen dieselben Zeilen; `docs/COVERAGE.md` (F01–F74) und das Register hält `tests/unit/features.registry.test.ts` zusammen, `docs/UEBERSICHT.md` ist die
Karte „Aufgabe → Seite → Abschnitt“.

| Feld | Bedeutung |
|---|---|
| `id`, `fids` | stabiler Slug (Deep-Link `feature:<id>`), Bauplan-F-IDs (`[]` für Funktionen außerhalb der 74 Punkte) |
| `name`, `task`, `benefit` | Name · **die Aufgabe in einfachen Worten** („Den Tag in vier Szenarien durchdenken“, ≤ 75 Zeichen) · ein Satz Nutzen mit den Fakten |
| `group`, `sub` | die **eine** Hauptgruppe (`heute` · `pruefen` · `risiko` · `testen` · `lernen` · `auswerten` · `wachsen` · `daten` · `community` · `konto`) und die Zwischenüberschrift (Pflicht ab acht Funktionen in der Gruppe) |
| `page`, `anchor`, `place`, `action`, `path` | Seite + Anker (`data-testid` oder Kartenüberschrift) · **der Abschnitt in den Worten der Seite** („Strategie & Kosten · Eigene Idee“, angezeigt als „Labor › …“) · ein Öffner (`training`, `assistant`, `newTrade`, `csvImport`, `shortcuts`) · `path` = „So geht’s“, wenn nichts zum Scrollen da ist (Trade-Detail …) |
| `keywords`, `intents` | Stichwörter · **Absichten**: Wörter und Sätze, mit denen jemand die Funktion in eigenen Worten sucht („warum verliere ich“, klein geschrieben) – mindestens drei |
| `see` | „Siehe auch“: andere Funktionen in anderen Gruppen oder auf anderen Seiten |
| `since`, `star` | Monat des Releases (`2026-10` → „Neu“ für zwei Monate) · einer der wenigen Einstiegspunkte („Empfohlen“) |
| `status`, `note` | `fertig` / `teilweise` – nach dem Code; `teilweise` braucht eine `note`, die sagt, was fehlt |
| `gate`, `device`, `needs`, `topics` | Plan-Gate (daraus `tierOf`), Gerätehinweis, Voraussetzung („erscheint nach einem fertigen Lauf“, „nur Cloud“), Interessen-Schlüssel des Assistenten-Gedächtnisses |

Neue Funktion eintragen = eine Zeile im Register (die Tests sagen, was fehlt: Aufgabe, Absichten, Anker, Gruppe) – danach findet sie die Seite, die
Suche, der Finder und der Assistent.

## Suche (`src/app/featureQuery.ts`)

Ein Scorer für alles: Wörter der Frage ohne Füllwörter („ich“, „mein“, „will“), jedes Wort gegen Name (1,0), `intents` (0,95), `keywords` (0,85),
`task` (0,7), Gruppe/Seite/Ort (0,5) und Nutzensatz (0,4): ganzes Wort, Wortanfang, Endung, Teil eines Kompositums, Umlaut als „ae“, Tippfehler
(Editierabstand 1–2). Ein Wort, das nirgends im Register vorkommt („wissen“ in „ich will wissen, ob …“), zählt nicht gegen eine Funktion. Trifft
nur die Hälfte der Wörter, steht die Funktion hinter denen, die alle treffen; steht die ganze Frage wörtlich in einem Namen oder einer Absicht, gibt
es einen Bonus. `searchFeatures` (Seite, Finder, Assistent) und `scoreFeature` (globale Suche über `SearchItem.match`) sind dieselbe Rechnung; unter
`STRONG_HIT` ist ein Treffer „vielleicht“. `tests/unit/features.intents.test.ts` hält 46 Absichten fest: die richtige Funktion unter den ersten drei.

## Bewegung / Mobil

Nur `src/motion`: `PageHeader` (Wortstaffel), `Reveal` je Abschnittskopf, Kachel und Zeile (gestaffeltes Einblenden `index % 3`, endet bei `transform: none`,
reduzierte Bewegung → Endzustand sofort), `Collapse` der Details. Mobil 390 px: eine Spalte, lange Wörter brechen (`overflow-wrap:anywhere`), Tippflächen
≥ 44 px bei grobem Zeiger (Zeile 56 px, Details-Knopf 56 px breit, Kachel ≥ 104 px), kein horizontaler Scroll. Lesbare Schrift ist `text-mute` (≥ 4,5 : 1),
nie `text-faint`.

## Verweise auf anderen Seiten (`src/app/FeatureLinks.tsx`)

Wo eine Funktion sonst nur zufällig gefunden würde, steht eine leise Zeile „Auch hier: …“ (Textlinks, die `openFeature` lazy aufrufen): Coach-Seite →
Verpasste Chancen, Üben, Was wäre wenn. Nie auf dem Dashboard. Lange Seiten haben außerdem die Inhalt-Leiste (`SectionNav`, `src/primitives`).

## Tests

`tests/unit/features.registry.test.ts` (Register, Gruppen, Aufgaben, Anker im Code, COVERAGE.md), `features.query.test.ts`, `features.intents.test.ts`
(46 Absichten gegen Finder **und** globale Suche), `features.open.test.ts`, `views.funktionen.test.tsx`, `search.features.test.ts`,
`assistant.where.test.ts`, `app.commandNav.features.test.tsx`; e2e `tests/e2e/funktionen.spec.ts` (mobil + Desktop: Kacheln, Gruppe, Zurück-Taste,
Suche, Finder, `g f`, Assistent, Tippflächen), `funktionen-anker.spec.ts` (**jeder Anker des Registers steht im DOM seiner Seite**; jeder Chip der
Inhalt-Leisten landet unter der Leiste), `a11y-funktionen.spec.ts` (axe, hell und dunkel).

## Einstieg in die Demo (F58)

Unter den Kacheln steht eine ruhige, gestrichelte Box (`data-testid="funktionen-demo"`, Knopf `funktionen-demo-open`): „Neu hier? Probier die App mit
Beispieldaten aus.“ Der Knopf öffnet das Demo-Blatt (`openFeature` → Aktion `demo` → lazy `DemoHost`, siehe `src/views/demo/README.md`); das Register
führt die Demo als `produktdemo` (Suche, Finder, Assistent finden sie). Nichts startet von selbst.

## Gruppen und Reihenfolge (Runde 8)

Zwölf Kacheln statt zehn: „Aktien beobachten & bewerten“ (Scanner, Watchlist, News, Kongress, Zahlen-Analyst, DCF, Kaufthese) und „Trade planen“ (Handelsplan in fünf Schritten, Verwaltung planen,
Ausführbarkeit, Zeitmaschine) haben jetzt eine eigene Gruppe, weil beide eine eigene Seite sind und vorher über zwei Gruppen verteilt waren. Die Gruppen stehen in der Reihenfolge des Tages; die beiden
Alarm-Funktionen (Alarme, E-Mail-Alarm) stehen zusammen unter „Heute vorbereiten“. Die Seite selbst ist unverändert (Logik und Texte kommen aus dem Register, `FUNKTIONEN` in `strings.ts`).
