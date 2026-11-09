# `src/journal` – Journal v3 (P06)

Execution-level journaling on top of the bundle trade: fills and partial exits, venue / margin data, tags and an
execution rating, psyche, screenshots, chart drawings, MAE / MFE, a bar-by-bar trade replay, grouped positions / hedges,
more filters with saved views, and a share picture. Everything is **optional and additive**: a trade without the new
fields looks, derives and exports exactly as before (the fields themselves: `src/domain/README.md`, section
"Journal v3 trade fields"; the maths: section "Journal v3 logic").

```
editor/        form.ts (JournalForm ↔ trade, validation), ExecutionSection.tsx, PsychSection.tsx
ui/            JournalDetail.tsx (detail block), ExcursionBar, FillsBar, FillsTimeline, RatingDots, TagInput
screenshots/   store.ts (IndexedDB originals + previews), cloud.ts (Supabase Storage), release.ts (freeing cloud objects),
               image.ts (checks), intake.ts (lazy: sniff, hash, preview, read-back), derive.ts + shot.worker.ts (worker session),
               preview.ts, sha256.ts, sniff.ts, shots.ts (refs / URLs / upload), info.ts (labels, storage verdicts),
               original.ts (view / download the exact bytes), zip.ts + backupZip.ts (backup with pictures), hashList.ts,
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

## Screenshots (A2: originals byte for byte)
- **Intake keeps the file.** `prepareImage` (`image.ts`) only checks it – an image (PNG / JPG / WebP / GIF / AVIF / BMP, by `type`
  or by its first bytes), ≤ 25 MB – and reads type and pixel size from the header (`sniff.ts`); it never decodes, shrinks or
  re-encodes. Up to 12 per trade. What is stored IS the file the trader chose or pasted.
- **Fields per picture** (`ScreenshotRef`, all optional – older references carry none): `sha256` (64 hex), `bytes`, `mime`,
  `originalName`, `w` / `h`, `original: true`, `storage: "device" | "cloud" | "ram"`; plus `store`, `key`, `cacheKey`, `at`.
- **Local original:** IndexedDB `storageKey("shots")` (`tj2-shots` / `tj2share-shots`), object store `blobs`, key = `ref.key`. After
  the write the stored copy is read back and its hash compared (in the worker) – a copy that differs is refused, never kept.
- **Derived preview (separate):** IndexedDB `storageKey("shots-preview")` (a cache, never in a backup), WebP ≤ 1280 px made by
  `derivePreview` (`createImageBitmap` with a target size + `OffscreenCanvas`). Lists, thumbnails and the viewer's first paint use
  it; a file ≤ 400 KB (or a GIF) is shown as it is; a picture without a preview (restore, other device) gets one on first view.
- **Off the main thread:** hashing, decoding, preview and the read-back run in one short-lived inline worker per intake
  (`derive.ts` / `shot.worker.ts`, `?worker&inline`); `crypto.subtle` hashes on the browser's own thread, an incremental pure-JS
  SHA-256 (256 KiB slices with rests) covers insecure contexts; the whole `intake` chunk loads with the first picture. Without
  a worker (single-file build, `file:`) the same code runs on the main thread.
- **No silent shrinking, ever.** Storage verdicts (`putShotBlobChecked`): `device` = in IndexedDB; **`ram`** = only in memory of
  this session – either no IndexedDB (the editor's standing note + panel say „nicht dauerhaft gespeichert“) or the store is
  FULL (`QuotaExceededError`: a toast „Speicher voll“ and the same panel, the store is NOT declared broken so freed space
  works again). The panel offers „Original herunterladen“ – the exact file – as the way out; signed in, the cloud copy makes a
  RAM picture durable. A ram reference that comes back after a reload shows „Nicht gespeichert (war nur im Arbeitsspeicher)“.
- **Cloud (signed in, `cloud.ts`):** the ORIGINAL blob is uploaded unchanged to the private bucket `screenshots`
  (`<uid>/<id>.<ext>`); the reference becomes `store: "cloud"`, `storage: "cloud"` with the local blob kept as `cacheKey`.
  The bucket accepts PNG / JPEG / WebP / GIF up to 5 MB (migration 0007): a larger or other-type original is NOT touched to fit –
  it stays on the device and the editor says why (`UPLOAD_MESSAGES`); a failed upload says so as well. Nothing is promised
  while signed out. Display via signed URLs (1 h, renewed early). `loadOriginal` fetches the object back (signed URL) and checks
  its SHA-256 against the reference.
- Cloud objects leave Storage with the trade (`release.ts`, DSGVO): a picture removed in the editor (on save), a
  deleted trade (editor, detail, Broker-Abgleich) and an upload of an editor closed without saving (also one that
  finishes after the close) are deleted – only objects of the own folder that no trade of the loaded journal still
  references, and also after a downgrade. There is deliberately no sweep over the folder (client or server): a device
  with cloud sync off holds references the server never sees. Account deletion removes the whole folder.
- **Older pictures** (references without `original: true`, i.e. everything written before A2) were shrunk on intake: they stay
  and are labelled **„Version (verkleinert)“** – in the viewer, on the thumbnail („verkleinert“), in the hash list and in the
  backup manifest – and are never called the original. No data migration is needed: the fields are optional and read at
  display time; an export computes a hash for them from the stored bytes.
- **Viewing / downloading:** `ShotLightbox` shows the preview first; „Original ansehen“ lays the exact stored file over it as soon
  as it is decoded; „Original herunterladen“ (`original.ts`) saves the exact bytes under the file's own name and checks the hash
  (a mismatch is reported, never passed off as the original). The facts line says „Original · PNG · 3840 × 2160 · 12,4 MB“ and
  shows the first characters of the SHA-256.
- **Backup:** the plain JSON backup still carries only references (PR #3 format). **„Backup mit Bildern (ZIP)“** (`backupZip.ts`,
  `zip.ts`: stored entries, CRC-32, no dependency, no compression) = `manifest.json` (format `tj-backup-zip/1`, journal hash, one
  row per picture: key, file, `sha256`, bytes, mime, name, size, `original`, trades, `matchesReference`, and the pictures that
  could not be reached) + `journal.json` + `shots/<key>.<ext>`. Every picture is read from the device, else (signed in) from
  the cloud; references of pictures that were only in the cloud get an offline key in the exported copy. **Restore** (Backup
  importieren accepts the ZIP) checks the journal's hash and then EVERY file against the manifest before it is written back –
  a file that differs is not restored and is named. The hashes (and the archive's CRC-32) only show that a file is UNDAMAGED
  („unversehrt“): the manifest sits in the same archive, so a forged backup carries matching hashes – the UI never says
  „echt“. Therefore a restore also runs the entry checks of `restoreGuard.ts` (real PNG / JPEG / GIF / WebP / BMP / AVIF bytes
  whatever the manifest says – no SVG; ≤ 25 MB; measures readable and ≤ 100 million pixels / 30,000 px per side; ≤ 20,000
  pictures; one manifest row per key and per `shots/<name>` file) and NEVER replaces a picture the device already holds under
  the same key (the same bytes are „schon auf diesem Gerät“, different bytes are listed as „nicht überschrieben“). The import
  dialog refuses a JSON file over 200 MB; `manifest.json` is capped at 16 MB and `journal.json` at 64 MB. Old JSON backups with
  base64 pictures (`backupShots.ts`) are still read, with the same entry checks.
- **„Bild-Hashes (CSV)“** (`hashList.ts`): one row per picture – trade, picture, file name, type, bytes, SHA-256, size, where it
  lives, Original / Version (verkleinert), a note.
- Display: `ShotThumb` (`NotchedFrame`, badges Lokal / Cloud / Nur Sitzung / verkleinert), `ShotReel` (one picture: thumbnail;
  several: the pulse `ReelWindow` montage → tableau), `ShotLightbox` (portal, `StripWipe` between pictures, swipe / arrows, Escape
  closes only the lightbox).

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
