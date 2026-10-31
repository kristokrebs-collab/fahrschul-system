# `src/journal` – Journal v3 (P06)

Execution-level journaling on top of the bundle trade: fills and partial exits, venue / margin data, tags and an
execution rating, psyche, screenshots, chart drawings, MAE / MFE, a bar-by-bar trade replay, grouped positions / hedges,
more filters with saved views, and a share picture. Everything is **optional and additive**: a trade without the new
fields looks, derives and exports exactly as before (the fields themselves: `src/domain/README.md`, section
"Journal v3 trade fields"; the maths: section "Journal v3 logic").

```
editor/        form.ts (JournalForm ↔ trade, validation), ExecutionSection.tsx, PsychSection.tsx
ui/            JournalDetail.tsx (detail block), ExcursionBar, FillsBar, FillsTimeline, RatingDots, TagInput
screenshots/   store.ts (IndexedDB blobs), cloud.ts (Supabase Storage), release.ts (freeing cloud objects), image.ts
               (intake), shots.ts (refs / URLs),
               ShotsField (editor), ShotThumb, ShotReel (detail), ShotLightbox
ocr/           screenshot import without a key (local text recognition, parser, preview sheet) – see its README
annotations/   AnnotationToolbar.tsx (tools / colours for the mini chart)
filters/       JournalFilterBar.tsx (views, quick picks, grouping switch, `Mehr Filter`; `JournalFilterSlot` = store-wired)
grouping/      GroupRows.tsx (table rows + mobile cards of a group, hedge connector, group curve), links.ts +
               GroupLinksSection.tsx (manual group / hedge links in the trade detail)
sharePng.ts    1200 × 675 share picture (canvas, no amounts by default)
ExcursionBackfillHost.tsx   idle MAE / MFE backfill (renders nothing)
```

Outside this folder (P06 files): `src/domain/{fills,grouping,excursion}.ts`, `src/market/excursion.ts` (candles → MAE / MFE),
`src/chart/ReplayChart.tsx`, `src/chart/primitives/AnnotationPrimitive.ts`, `src/views/trades/replay/*` (replay sheet, model,
store), `src/store/viewsStore.ts` (saved views); additive edits in `TradeEditor`, `TradeDetail`, `MiniTradeChart`,
`uiStore`, `csv.ts`, `derive.ts` and the trades view (`TradeFilters`, `TradesTable`, `TradesCards`, `tradesModel`).

## Editor (`TradeEditor` sections)
See `src/overlays/README.md` → "Journal v3". Form state is `t.j: JournalForm`; `journalRecord(j, base, prev)` turns it into
trade keys (empty → `undefined` → removed), `validateJournal` adds the German messages of `JOURNAL_MESSAGES`, `fillFix`
says what the fills fix in `Einstieg` / `Größe` / `Ausstieg` (Ø prices rounded to 12 significant digits, so no float noise
is stored). Unknown keys inside a stored fill / target / stop move / psych object survive an edit (each row keeps its
source object). `openEditor({ draft })` (P06 contract for bots, imports and signals) pre-fills a new trade; keys the form
does not edit are saved as they came.

## Trade detail (`JournalDetail`)
Rendered by `TradeDetail` between the review and the mini chart; every part only when the trade has data. MAE / MFE: the
stored values, else `MAE/MFE messen` (closed trade on the live market's pair) or the honest reason
(`MEASURE_HINTS`: no market connection, another pair, no exit time …). The `Mitgenommen` share is measured from the
fills' Ø entry / Ø exit and capped at 100 % (whole bars can understate a wick). `Als Bild` downloads the share picture
(privacy `percent`: R and % only); `Replay` opens the replay.

## MAE / MFE (`src/market/excursion.ts`)
`measureTrade(t, provider)` loads the candles of the time in the market through `provider.fetchKlines` (budget class
`bulk`, paged ≤ 4 × 1500, memoised in IndexedDB `storageKey("klines")` once the window is closed): 15m bars up to 3 days,
else 1h; the ATR(14) % from the 1h bars before the entry. Only the provider's symbol can be measured. `measureAndStore`
writes `mae / mfe / maeR / mfeR / atrPct` on the LATEST version of the trade and nothing when the trade was edited
meanwhile in a way that changes the measurement (`excursionStale`); an open trade gets the ATR only.
`ExcursionBackfillHost` (mounted by `TradeDetail`) runs `startExcursionBackfill`: after 4 s idle, one closed trade every
1.5 s, newest first, at most 40 per session, paused while the tab is hidden; every attempt is remembered for 24 h
(`storageKey("excursion-tried")`).

## Trade replay (`src/views/trades/replay`)
`openReplay(id, { fromDetail })` (`replayStore`) – the detail steps aside and returns when the replay closes. `ReplayHost`
(mounted by `TradeDetail`) renders the `Sheet` `Replay · {pair}`: `Kerzen` 15m / 1h / 4h (default by holding time), the
window = entry − N … exit + N bars (`padBars`: 60 % of the bars in the trade, 12–60). `ScrubTimeline` (`Replay-Zeitleiste`:
play, 1× / 2× / 4×, scrub, Leertaste / Pfeile) drives ONE MotionValue; `ReplayChart` (lazy chunk) appends the bars with a
fixed window (no auto-scroll), pops the entry / exit markers with a sonar ripple and grows the MAE / MFE band; the R
counter rolls (`RollingDigits`), MAE / MFE count, the phase label (`Vor dem Einstieg` · `Im Trade` · `Nach dem Ausstieg`)
morphs with `TextRoll`. Zero React renders per bar. Without a market connection / on another pair / without candles the
sheet says so instead of showing a chart.

## Chart drawings
`MiniTradeChart annotations / onAnnotationsChange` + `AnnotationToolbar` (Linie · Trend · Box · Pfeil · Text, Weiß / Grau /
Grün / Rot, `Alle löschen`). `AnnotationPrimitive` stores points as TIME (UTC s) / PRICE, so a drawing stays on its candles
at every zoom and interval (sub-bar interpolation, also right of the last bar); a new drawing draws itself in (520 ms,
instant under reduced motion); a tap selects, `Zeichnung löschen` removes. Saved on `trade.annotations` right away.

## Screenshots
- Intake (`image.ts`): images only (PNG / JPG / WebP / GIF / AVIF / BMP), ≤ 15 MB; larger than 2000 px on the long side →
  scaled down and re-encoded (WebP, JPEG fallback). Up to 12 per trade.
- Local: blobs in IndexedDB `storageKey("shots")` (`tj2-shots` / `tj2share-shots`), the trade keeps only
  `{ id, store: "idb", key, mime, w, h, at }`. Without IndexedDB the blobs live in memory for the session and the editor
  says so. Blobs no trade references are collected when the editor closes.
- Cloud (signed in, `cloud.ts`): every picture is also uploaded to the private Supabase bucket `screenshots`
  (`<uid>/<id>.<ext>`, policies of `supabase/migrations/0001_core.sql`); the reference becomes `store: "cloud"` with the local
  blob kept as `cacheKey` (offline display on this device). Display via signed URLs (1 h, renewed early). Without a
  configured cloud or while signed out everything stays local – nothing pretends to sync.
- Cloud objects leave Storage with the trade (`release.ts`, DSGVO): a picture removed in the editor (on save), a
  deleted trade (editor, detail, Broker-Abgleich) and an upload of an editor closed without saving (also one that
  finishes after the close) are deleted – only objects of the own folder that no trade of the loaded journal still
  references, and also after a downgrade. There is deliberately no sweep over the folder (client or server): a device
  with cloud sync off holds references the server never sees. Account deletion removes the whole folder.
- **The plain JSON backup does NOT contain the pictures** (only the references, PR #3 format); Daten says so as soon
  as a picture lives only in this browser and offers **„Backup mit Bildern“** (`backupShots.ts`: the same JSON plus
  `screenshots: { key: { mime, data } }` for the local blobs and the offline copies of cloud pictures – old importers
  ignore the key). The import preview names what a file carries („inkl. n Screenshots“) or lacks („n Screenshots sind
  nicht enthalten“) and an import writes the carried pictures back. Cloud screenshots come back with the account.
- Display: `ShotThumb` (`NotchedFrame`), `ShotReel` (one picture: thumbnail; several: the pulse `ReelWindow` montage →
  tableau), `ShotLightbox` (portal, `StripWipe` between pictures, swipe / arrows, Escape closes only the lightbox).

## Trades list: filters, saved views, grouping
- `JournalFilterBar` under the bundle filters: `Ansicht` label (TextMorph between saved views), saved view chips (`+ Ansicht
  speichern`, × deletes the active one), `★ Top-Trades` (rating ≥ 4 – "trade the best"; only when ratings exist), `≥ 2 R`,
  the `Positionen gruppieren` switch and `Mehr Filter` (count badge) → `Zeitraum` (+ 7 Tage / 30 Tage / Dieser Monat /
  Dieses Jahr), `Paar`, `Börse`, `Markt`, `Tags` (all must match), ranges `P&L`, `R-Multiple`, `Haltedauer (Min)`, `Hebel`,
  `Diese Filter leeren`. State lives in `uiStore.tradeExtra` (optional keys; `listKey` changes only when one is set).
- Saved views (`src/store/viewsStore.ts`): `storageKey("views")`, at most 24, a UI preference like `tj2-ui` – never in a
  backup, never synced. `applyView(id)` writes filter, extra filter and sort in one update; `matchView` names the current
  one. P14 can offer them in the command palette via `useViews().views` / `applyView`.
- Manual links (Review F04): the trade detail's „Gruppe & Hedge“ offers the trades of the same pair within ± 14 days –
  „Gruppieren“ gives both the same `groupId` (an existing one or a new `grp_…`), „Als Hedge“ (opposite side only) sets
  `hedgeOf`, „Lösen“ removes this trade's own links. `positionId` stays reserved for one exchange position split over
  several records – the Bitunix sync and the CSV importers write one record per position, so nothing writes it yet.
- Grouping (`uiStore.tradeExtra.group`): `groupTrades` folds positions (`positionId`), groups (`groupId`) and hedges
  (`hedgeOf` or detected: long + short on the same pair overlapping in time) into one row / card (`GroupTableRows`,
  `GroupCard`) with Ø prices, Σ P&L, group R and result; unfolding (AutoHeight) shows the legs on a drawn connector and the
  group's P&L curve (`EquityDraw`). A leg opens its own detail.

## Share picture (`sharePng.ts`)
`shareCardModel(t, { privacy, currency, setups, path })` is pure (tested); `drawShareCard(ctx, model)` paints 1200 × 675
(dot grid, the result as dot-matrix digits, pair / side / facts / rating / tags / optional price path);
`renderShareCard` / `shareCardBlob` / `downloadShareCard` (`trade-BTCUSDT-2026-10-02.png`). Default privacy `percent`:
no money amounts, no account size; `full` adds the P&L. Nothing leaves the device. P12's share flow builds on it.

## Screenshot import without a key (`ocr/`, F29 / F30)
The default path: text recognition on the device (tesseract.js in a Web Worker, files self-hosted under `/ocr/<version>/`), a
layout-aware parser for phone cards and desktop tables (EN / DE, position / trade / order histories), a second reading of doubtful
cells, pure plausibility checks (gross, derived fees, ROI, leverage) and the same normalisers as the model path (`extract/`:
`candidate.ts`, `implied.ts`, `merge.ts`, `dedupe.ts`). The sheet (`ocr/ui/OcrImportSheet.tsx`, opened from „Alle Trades“ or
Einstellungen → Daten → Import) previews every trade, writes them in one step and offers „Rückgängig“. Folder README:
`src/journal/ocr/README.md`; terminal check: `npm run ocr:check -- <image>`.

## Screenshot import: order histories (`extract/`, F29 – the optional model path)
The model only READS (`contract.ts`: tool schema + system prompt, incl. `ORDER_HISTORY_PROMPT` – the vocabulary of Bitunix /
Binance / Bybit / OKX histories: „Long öffnen“, „Short schließen“, „Realisierter PnL“, „Durchschnittspreis“, „Ausgeführt“, „Gebühr“; the
word Long / Short is the POSITION's side, the red / green colour is only the order's buy / sell side). Everything else is
deterministic client code:
- `orders.ts` reads an order's name (`parseOrderLabel`: open / close + position side); `candidate.ts` sorts executions by it
  and lets it overrule the model's `side` / entry-or-exit sorting (written into the notes).
- A closing order WITHOUT its opening order is a candidate with `entries = []`: rows say „Einstieg fehlt im Bild“, the quantity
  comes from the exit, the draft carries exit / quantity / fees / leverage / result but no entry and no entry time (the editor's
  required entry stays open; saving is refused until it is typed).
- `implied.ts` offers „Einstieg aus PnL berechnen“: Long `exit − PnL ÷ qty`, Short `exit + PnL ÷ qty`, in two readings (PnL before /
  after the visible fee; the difference is the fee). It is an ASSUMPTION: only a pressed button applies it (`rows.ts`
  `setImpliedEntry`, edit kind `impliedEntry`), the leg is `uncertain`, `Candidate.entryAssumed` keeps the checks / badge / draft
  note alive until the trader types an entry. A filled opening without a closing order becomes an open trade draft.
- `dedupe.ts` compares a closing order without opening by its EXIT (price ±0.05 %, time ±10 min).
- Times without a zone stay „deine Zeit“ (the device's zone) with an override in the preview.
- Errors name the reason (`netlify/functions/shot-extract.mts`: `shot_extract_unavailable` = no key, `_key_rejected`, `_model`,
  `_timeout`, `_network`, `_invalid` with the field, `_failed` with the status; `client.ts` `extractError` also names platform 404 / 5xx).
  `lenient.ts` repairs formatting slips of the model's tool input (empty text, confidence > 1, execution without a price) instead of
  failing the whole reading. `availability.ts` tells „no key“ from „server did not answer“.
Tests: `tests/unit/shot.{orderhistory,errors,extract,candidates}.test.ts`, `tests/e2e/shot-orderhistory.spec.ts` (fixture
`tests/fixtures/orderhistory-bitunix-report.json` = the `report_trades` input for the transcribed Bitunix cards).

## Motion
Tokens only (`@/motion/tokens`), `useReducedFx` everywhere (reduced: no draw-ins, ripples, wipes or blur; values appear
directly), transform / opacity / clip-path only, every loop finite, decorative layers `aria-hidden`, per-frame work
imperative (MotionValues, chart primitives). Used: `StaggerItem` (detail parts), slices cut from the position bar
(`FillsBar`, `spring.layout`), `DotMatrix` rating, `TextRoll` tags / replay phase, `fx-ants` drop border, `ReelWindow`,
`StripWipe` lightbox / replay interval switch, `ScrubTimeline`, `RollingDigits`, `EquityDraw` group curve + drawn
connector, `TextMorph` view label, `AutoHeight` group panels / execution tabs. `layoutId`s: `annotation-tool-{useId}`
(toolbar thumb, per instance).

## Tests
`tests/unit/journal.*.test.ts(x)` (form, filters + views, editor, detail, grouping, market excursion, chart / replay,
screenshots, UI parts + share model), `tests/unit/domain.{fills,grouping,excursion}.test.ts`, the CSV tests, and
`tests/e2e/journal-v3.spec.ts` (filters / views / grouped hedge, editor sections saved, detail facts, MAE / MFE from the
synthetic market, a chart drawing, the replay). `P06_SHOTS=<dir>` writes the screenshots of the visual check.

## Spracheingabe für Notizen (F31, `editor/VoiceNote.tsx`, `editor/LazyVoiceNote.tsx`)

„Diktieren“ unter Begründung, Learnings & Notizen und der Notiz vor und nach dem Trade: ein Tipp startet die Erkennung des Browsers (`useSpeechInput` aus `@/assistant/speech`, `de-DE`, ein Satz je Tipp), jeder fertige
Satz wird Wort für Wort angehängt (`joinNote`; was währenddessen getippt wurde, bleibt), der nächste Tipp beendet sie. Die App nimmt nichts auf und speichert kein Audio; die Karte nennt, dass die Erkennung beim
Browser-Hersteller läuft (Chrome / Edge). Ohne Unterstützung, Erlaubnis oder Netz steht der Grund da (`speechMessage`) und das Tippen bleibt. `LazyVoiceNote` lädt das Stück erst, wenn ein Notizfeld gezeichnet wird (der
Editor gehört zur Erstladung, die Spracherkennung nicht). Test: `journal.voiceNote.test.tsx` (nachgebaute Erkennung).
