# `src/views/funktionen` – Seite „Funktionen“ (Auffindbarkeit)

`FunktionenView` (`h1` „Funktionen“, Hash `#funktionen`, Taste `g f`): alles, was die App kann, nach Aufgabe des Nutzers geordnet – mit
ehrlichem Stand. Die Seite ist **kein Dock-Tab und keine Dashboard-Karte**; sie ist erreichbar über die Befehlsnavigation (Nr. 16), die
globale Suche („Funktionen“), `g f`, die Einstellungen („Weitere Einstellungen → Alle Funktionen“) und den Assistenten (Link im
Leerzustand, „Wo finde ich …?“).

## Eine Quelle: `src/app/features.ts`

Das Register ist die einzige Wahrheit. Diese Seite, die Suche (`src/search/sources.ts`, Art `feature`) und der Assistent
(`tools.ts`, `whereTool`) lesen dieselben Zeilen; `docs/COVERAGE.md` (F01–F74) und das Register werden vom Test
`tests/unit/features.registry.test.ts` zusammengehalten.

| Feld | Bedeutung |
|---|---|
| `id`, `fids` | stabiler Slug (Deep-Link `feature:<id>`), Bauplan-F-IDs (`[]` für Funktionen außerhalb der 74 Punkte) |
| `name`, `benefit` | deutscher Name, ein Satz Nutzen |
| `group` | `heute` · `beobachten` · `einstieg` · `testen` · `lernen` · `daten` · `community` · `konto` |
| `page`, `anchor`, `action`, `path` | Seite + Anker (`data-testid` oder Kartenüberschrift) – oder ein Öffner (`training`, `assistant`, `newTrade`, `csvImport`, `shortcuts`); `path` = „So geht’s“, wenn nichts zum Scrollen da ist (Trade-Detail …) |
| `status`, `note` | `fertig` / `teilweise` – nach dem Code; `teilweise` braucht eine `note`, die sagt, was fehlt |
| `gate`, `device`, `needs` | Plan-Gate (`Feature` aus `billing/types`, daraus `tierOf` = niedrigster Tarif), Gerätehinweis, Voraussetzung („erscheint nach einem fertigen Lauf“, „nur Cloud-Version“) |
| `keywords`, `topics` | Suchwörter; Interessen-Schlüssel des Assistenten-Gedächtnisses (`behavior:*`, `page:<seite>` …) |

`featureQuery.ts` (rein): `searchFeatures` (derselbe tippfehlertolerante Scorer wie die Suche), `filterFeatures`, `groupFeatures`,
`forYou`, `recentFeatures`, `whereIs` / `featureQueryOf` („Wo finde ich den Belastungstest?“ → `belastungstest`, mit Urteil, ob der erste
Treffer klar ist). `featureOpen.ts`: `openFeature(id)` – Aktion oder Seite + Scrollen (`reveal.ts`: `whenShown` wartet auf die lazy Seite,
`revealCard` scrollt unter den Kopf und lässt einmal Signal über die Karte laufen). Fehlt die Stelle (Karte erscheint erst nach einem Lauf, Tarif
fehlt), sagt ein Toast warum – nie ein stilles Oben-Bleiben.

## Befehlsnavigation

Seitenlink Nr. 16 „Funktionen“ (Zusatzzeile „Index“ – der Zähler kennt das Register nicht) und, **nur wenn es welche gibt**, die Chips „Zuletzt benutzte
Funktionen“ unter den Schnellaktionen (`useRecentFeatures` in `CommandNav.tsx`: die `feature:<id>`-Einträge der Suche; erst dann lädt ein dynamischer Import
`featureChips.ts` und damit das Register). Ein Chip schließt die Navigation und öffnet die Funktion (`openFeature`). Die Erstladung bleibt frei vom Register.

## Seite

Kopf (`PageHeader`, Zähler), Suchfeld (Enter öffnet den ersten Treffer, Esc leert) + zwei `Segmented` (Stand: Alle / Fertig / Teilweise;
Tarif: Alle / Frei / Pro / Premium / Team), danach – ohne aktiven Filter – **Für dich** und **Zuletzt benutzt**, dann ein Abschnitt je Gruppe mit
Karten (1 / 2 / 3 Spalten). Jede Karte: Name, Stand-Badge, Tarif-Badge (bei fehlendem Tarif „nicht in deinem Tarif“, nur wenn Zahlung aktiv),
Nutzen, „Fehlt noch“ / „Zu wissen“, „So geht’s“, Voraussetzung, Gerät, F-ID, Knopf „Öffnen“.

* **Für dich**: `forYou(memoryOf(settings).interests)` – dieselben Zähler, die der Assistent ohnehin führt (`settings.assistant.interests`,
  nur Zähler, nie die Fragen). Kein neuer Tracker, nichts Neues an einen Server. Ohne Zähler steht ein ehrlicher Leerzustand da.
* **Zuletzt benutzt**: die `feature:<id>`-Einträge der Suche (`searchStore.recent`, lokal in diesem Browser). `openFeature` schreibt sie – egal ob
  von dieser Seite, der Suche oder dem Assistenten. Ohne Einträge: ehrlicher Leerzustand.

## Bewegung / Mobil

Nur `src/motion`: `PageHeader` (Wortstaffel), `Reveal` je Abschnittskopf und je Karte (gestaffeltes Einblenden `index % 3`, endet bei
`transform: none`, reduzierte Bewegung → Endzustand sofort), `Button`/`Segmented`-Bewegung der Primitive. Mobil 390 px: eine Spalte, Segmente
umbrechen (`max-w-full flex-wrap`), lange Wörter brechen (`overflow-wrap:anywhere`), Tippflächen ≥ 44 px bei grobem Zeiger
(`pointer-coarse:min-h-11`), kein horizontaler Scroll.

## Verweise auf anderen Seiten (`src/app/FeatureLinks.tsx`)

Wo eine Funktion sonst nur zufällig gefunden würde, steht eine leise Zeile „Auch hier: …“ (Textlinks, die `openFeature` lazy aufrufen):
Coach-Seite → Verpasste Chancen (letzte Karte der langen Seite), Üben, Was wäre wenn (beides im Trade-Detail). Die Labor-Startzeile nennt, was nach
dem ersten Lauf darunter erscheint. Nie auf dem Dashboard.

## Tests

`tests/unit/features.registry.test.ts` (Register + COVERAGE.md), `features.query.test.ts`, `features.open.test.ts`, `views.funktionen.test.tsx`,
`search.features.test.ts`, `assistant.where.test.ts`; e2e `tests/e2e/funktionen.spec.ts` (mobil + Desktop: Seite, Navigation, `g f`, Suche findet
„Labor“ und ein Treffer navigiert, Filter, Öffnen mit Scrollen, Assistent).
