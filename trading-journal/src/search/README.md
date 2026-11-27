# `src/search` – global search (P13)

One overlay that finds everything in the journal: trades, setups (Entscheidungsgrundlagen), day notes, pages, settings
sections, reports (when the page `berichte` is registered) and commands. Open with `/` or ⌘⇧F / Ctrl+⇧F (bound by
`src/app/ShortcutHost.tsx`), from CommandNav (`openSearch()`), or from code. ⌘K stays CommandNav's.

## Wiring (integrator)

```tsx
// App.tsx, after <SetupEditor/>, before <Celebrate/> (next to ShortcutHost / OnboardingHost)
import { GlobalSearchHost } from "@/search/GlobalSearchHost";
<GlobalSearchHost />
```

The host is a leaf: it subscribes to `useSearch().open` only, loads the overlay chunk (`GlobalSearch.tsx` + the index)
on first open (`preloadSearch()` warms it, e.g. on hover of a search button), and runs the chosen action AFTER the
overlay's exit animation (`onExitComplete` → `takePending()` → `runSearchAction`), so the page switch / detail morph
never fights the closing panel.

## Modules

| file | what |
|---|---|
| `fuzzy.ts` | pure scorer: `fold` (lower case, umlauts ä→a, ß→ss, diacritics stripped, 1:1 index map for highlights), `tokenize`, `matchText` / `matchFolded` (whole word 100 > word prefix 80+ > substring 55 > subsequence ≤ 40), `scoreFields` (every token must hit title or a keyword, title hits weigh double; "uebersicht" falls back to "ubersicht" via `digraphFold`), `mergeRanges` |
| `sources.ts` | `buildSearchIndex(IndexInput)` – pure: same input, same items. Kinds `trade`, `setup`, `day`, `page`, `setting`, `report`, `command`, plus the virtual groups `best` / `recent`. `COMMANDS` (new trade, top / winner / loser / open filters, theme, new setup, shortcuts, tour, intro, export JSON / CSV, navigation, fullscreen), `SETTING_SECTIONS`, `KIND_LABEL`, `setupStats` |
| `rank.ts` | `searchIndex(items, q)` → groups in kind order with highlights; `suggestions()` = what the empty field shows: **"Stärkste zuerst"** (the setups that earn the most, the best trades by R – Trade the best), then recent hits, then a few commands |
| `searchStore.ts` | zustand: `open`, `seed`, `pending`, `recent` (`storageKey("search-recent")`, max 8). `openSearch(seed?)`, `closeSearch(pending?)`, `toggleSearch()`, `takePending()`, `rememberRecent(id)` |
| `actions.ts` | `runSearchAction(a)`: page switch (`navigate`), trade detail (`openDetail(id, null)`), setup → setups page + scroll + a red sweep over the card (`revealCard`), settings section → scroll + sweep, day → overview calendar, commands. `whenShown(page, find, then)` waits for the kept-alive page layer to be visible |
| `GlobalSearch.tsx` | the overlay: `role="dialog"` + `aria-modal`, `useDialogBehaviour`, `useOverlayLane`, `data-layer="Suche"`; combobox + listbox (`aria-activedescendant`, the active option scrolls into view), groups with headings, highlights, `Kbd` hints, honest empty state ("Nichts gefunden" + what to try) |
| `GlobalSearchHost.tsx` | lazy host (see above) |
| `glyphs.tsx` | the per-kind glyphs |

## Effects (120-Hz rules)

- Open: a light variant of the pulse `FullscreenWipe` (`CONFIG` in `GlobalSearch.tsx`): a signal-red curtain wipes
  across the panel (transform only), the panel follows; the curtain is removed once the open has settled. Reduced
  motion: an opacity fade. No blur under `data-safe-fx`.
- Results: `StaggerItem` rows; on the FIRST open the "Stärkste zuerst" titles run a `TextScramble` once; the active row
  carries the shared `HoverPill` (`layoutId="hover-search"`).
- All decor is `aria-hidden`; the overlay announces nothing itself (ToastIsland stays the only `aria-live`).

## Tests

`tests/unit/search.fuzzy.test.ts`, `search.index.test.ts`, `search.overlay.test.tsx` (combobox semantics, filter,
arrows, Enter runs after the exit, Escape); e2e `tests/e2e/search.spec.ts` (dev harness `/dev/ux.html`, mobile +
desktop) and `tests/e2e/a11y.spec.ts` (axe, dark + light; the rule `scrollable-region-focusable` is off for the result
list only – it scrolls through the combobox by design).

## Funktionen (Register `src/app/features.ts`)

`buildSearchIndex({ …, features })` nimmt das Funktionsregister auf: je Funktion ein Treffer der Art `feature` („Funktionen“) mit Name, Untertitel
„Aufgabe · Seite › Abschnitt“, Markierung „teilweise“ und der Aktion `{ type: "feature", id }`. Gewertet wird nicht mit `scoreFields` (alle Wörter müssen
treffen), sondern mit dem eigenen Scorer des Registers (`SearchItem.match` → `scoreFeature` in `src/app/featureQuery.ts`): Absichten und Synonyme („warum
verliere ich“), Fragesätze ohne Füllwörter, Tippfehler, Endungen, Teile von Komposita; ein Wort, das nirgends im Register steht, zählt nicht gegen eine
Funktion. Die Gruppe steht hinter den Seiten (`KIND_BIAS`), so liefert „Labor“ die Seite *und* die Labor-Funktionen. `runSearchAction` öffnet einen Treffer über
`openFeature` (Seite + Scrollen zur Karte, oder das Sheet); der Overlay-Chunk merkt ihn in der „Zuletzt geöffnet“-Liste (`feature:<id>`), die auch „Zuletzt
benutzt“ der Seite „Funktionen“ speist. Ohne `features` im Input gibt es keine Funktionstreffer (das Register ist ein Lazy-Chunk). Tests:
`tests/unit/search.features.test.ts`, `features.intents.test.ts` (46 Absichten: die richtige Funktion unter den ersten drei Funktionstreffern).

## Finder und Rauschen (Feinschliff, Runde 8)

Der Zähler (`src/app/featureQuery.ts`) gilt für die Seite „Funktionen“, die Navigation, diese Suche und den Assistenten. Damit ein Wort ohne Sinn keine sichere Antwort bekommt:
ein längeres Wort zählt für ein kürzeres nur mit kurzer Endung oder langem Stamm („Positionsrechner“ → „Position“, aber „bestellen“ nicht → „beste“); Tippfehler gelten nur, wenn der erste Buchstabe stimmt
(„Positonsrechner“ ja, „bestellen“ → „einstellen“ nein) und ein angefangenes Wort mit einem Fehler erst ab sechs Buchstaben („Danke“ ist nicht „Dunkel“); „App“ ist ein Füllwort („Was kann die App“ findet
nicht jede Funktion mit „App“ im Namen). `tests/unit/features.finder.test.ts` hält 80 Fragen an die später gekommenen Bereiche (Handelsplan, Zeitmaschine, Aktien, Kongress, Archiv, Demo, Belege …, mit Tippfehlern)
und die Gegenprobe (Unsinn findet nichts Sicheres; „Order senden“ führt zum Ticket, das nie sendet). Die Seiten haben in `PAGE_WORDS` ihre eigenen Suchwörter (nur das, was auf der Seite selbst steht).
