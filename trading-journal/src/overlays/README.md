# `src/overlays` – app-level dialogs

Overlays are mounted **once at app level, without a portal** (Plan 6.6, Entscheidung 6), inside `MotionRoot`'s
group-less `LayoutGroup`, so the `layoutId` morphs from list rows / FAB / cards work. They read their open state from
`uiStore` and their data from `useJournal()`; the integrator only wires the two market-dependent props below.

```tsx
<MotionRoot>
  <MorphDialogProvider>
    …pages…
    <TradeDetail candles={miniCandles} />
    <TradeEditor livePrice={lastPrice} livePriceLabel={fallback ? "Live-Preis (Bybit) übernehmen" : undefined} />
    <ToastIsland toasts={…} onDismiss={…} />
  </MorphDialogProvider>
</MotionRoot>
```

## `TradeEditor` (`TradeEditor.tsx`) – bundle `X$`/`Y$`, Plan 6.5

`Sheet size="lg"` (`sm:max-w-[860px]`), `form#trade-form noValidate`, title `Trade eintragen` / `Trade bearbeiten`.

```ts
interface TradeEditorProps {
  livePrice?: number | null;      // last price of the market card (never mark price); undefined/null → button not rendered
  livePriceLabel?: string;        // default "Live-Preis übernehmen"; Bybit fallback: "Live-Preis (Bybit) übernehmen"
  onNewSetup?: () => void;        // default: useUi().openSetupEditor({ fromTrade: true })
}
```

- **State**: `useUi().editor = { open, tradeId?, fromFab }` – `openEditor()` (new), `openEditor({ tradeId })` (edit),
  `openEditor({ fromFab: true })` → `layoutId="new-trade"` morph from the dock disc (the disc must be `visibility:hidden` while open).
  Defaults: `date = nowLocalInput()`, `pair = settings.pair`, `account = acc === "makro" ? "makro" : "scalp"`, `leverage "4"` on scalp,
  `side long`, `status closed`. The form re-initialises once per open session (`useLayoutEffect`, before paint).
- **Sections / labels** (verbatim): `Eckdaten` (`Konto` Makro|Scalp, `Richtung` ▲ Long|▼ Short with win/loss tones, `Datum & Uhrzeit`,
  `Paar`, `Timeframe` (`–` + `TIMEFRAMES`), `Status` Geschlossen|Noch offen) · `Preise & Größe` – `Komma oder Punkt, beides geht`
  (`Einstieg`, `Stop-Loss`, `Take-Profit`, `Ausstieg` (disabled while open), `Größe ({cur})` – `Positionswert inkl. Hebel`, `Hebel` (suffix `x`,
  help `Regel: 4x` / `Regel: 2–5x`, warning `LEVERAGE_WARNING[account]` + `border-warn/60`), `Gebühren ({cur})`, `P&L manuell` – `Leer = wird berechnet`)
  + live strip `P&L | R-Multiple | Kursbewegung | Risiko | Geplantes CRV` (all `MotionNumber`, `deriveTrade`) ·
  `Entscheidungsgrundlage` – `Warum bist du eingestiegen?` (setup chips `aria-pressed`, account-matching first, others dimmed, `+ Neue Grundlage`, `Begründung`) ·
  `Checkliste` – `{x} von {n} erfüllt` (bar `scaleX` on `spring.bar`, `CheckboxRow`s from `checklistItemsFor`, sub `Grundregel` | setup name) ·
  `Überzeugung & Disziplin` (`Wie sicher warst du beim Einstieg?` `ConvictionRadio`, `Plan befolgt?` Ja|Nein (re-click → null), `Gefühl beim Einstieg` `EMOTIONS` chips) ·
  `Review` (`Learnings & Notizen`, `Chart-Link (TradingView)` → `sanitizeUrl`).
- **Live-Preis übernehmen**: rendered under `Einstieg` and `Ausstieg` only when `livePrice` is finite; disabled with `Ausstieg` while `Noch offen`;
  writes `toInputString(Number(p.toFixed(p < 10 ? 4 : 1)))`, shows `✓ {price(p)}` for 800 ms (`AnimatePresence mode="wait"`).
- **Validation** (`validateRecord`, bundle order): `Bitte Datum angeben.` · `Bitte einen Einstiegspreis angeben.` ·
  `Bitte Ausstieg angeben oder P&L manuell eintragen.` · `Bitte Positionsgröße angeben oder P&L manuell eintragen.` · `Der Chart-Link muss mit https:// beginnen.`
  Footer error `role="alert"`.
- **Save** → `useJournal().saveTrade({ …record, checks: pruneChecks, pnl, r, createdAt, updatedAt, id? })`; toast `Trade gespeichert` / `Trade aktualisiert`
  (`value: signed(pnl) | "offen"`, `valueTone`), failure → inline `Speichern fehlgeschlagen. Prüfe die Verbindung und versuch es erneut.` + toast `Speichern fehlgeschlagen`.
- **Footer**: `Löschen` (edit only → `Wirklich löschen?` `Ja, löschen` / `Nein`, toast `Trade gelöscht`, error `Löschen fehlgeschlagen.`), `Abbrechen`,
  `Speichern & neu` (new only: saves, keeps the sheet open, resets entry/stop/target/exit/size/fees/pnlManual/setups/checks/conviction/plan/emotion/reason/notes/chart,
  keeps date (renewed)/pair/account/side/leverage/timeframe, scrolls the body to top and focuses `Einstieg`), `Speichern` (`type="submit" form="trade-form"`, `Speichert …` while saving).
- **Toasts** go through `uiStore.pushToast` (kinds `success | error | info`); the shell renders them with `ToastIsland`
  (`src/app/toasts.ts`: `success → ok`, `error → error`, `signal`/`info → warn` glyph with the 2.8 s / 5.2 s `TOAST_MS` lifetime). The
  store never auto-dismisses: the island counts the visible time (from the front of the queue, paused on hover / focus / drag). The island
  floats above every overlay (`TOAST_Z` 95); a toast pushed while a Sheet / MorphDialog / TradeDetail is open takes the `top` lane
  (overlays register via `useOverlayLane(open)` from `@/primitives/toastStore`), so `Speichern & neu` confirms visibly (TO-01).
- Exports for reuse/tests: `defaultForm`, `formFromTrade`, `resetForNext`, `toRecord`, `validateRecord`, `livePriceInput`, `freshLivePrice`, `Section`, `LivePriceButton`,
  `EDITOR_MESSAGES`, `LIVE_PRICE_LABEL`, `LIVE_PRICE_CONFIRM_MS`, types `TradeFormStrings`, `TradeFormTyped`, `TradeRecord`.
- **Einstiegs-Check zum Zeitpunkt** (NEW, after `Eckdaten`; `SignalSection.tsx`, other journal `forms.tsx`):
  - new trade / re-check, date within 5 min of now → live check (`useSignalCheck`, only the section subscribes); the stored snapshot is
    taken AT SAVE TIME (`resolveTradeSignal(date, side)` → `checkTradeAt`, ≤ 3 s, never rejects);
  - back-dated → `retroCheck(minute)` debounced 300 ms with `Kerzen für diesen Zeitpunkt werden geladen …`; too little history →
    `Zu wenig Kursdaten für diesen Zeitpunkt.` (no snapshot is stored – never a fake strength 0); load error → `Erneut versuchen`;
  - existing trade: shows `trade.signal` (either app's format, `parseSignalSnapshot`) + `Neu prüfen`; without one `Prüfen`. It is re-checked
    only on that click, or automatically when its date / side changed (the stored check no longer describes it). A failed / empty
    re-check keeps the stored snapshot (`...stored trade` spread);
  - `s_mtf` auto-ticks (`mtfAutoChecks`) while `s_mtf` is selected and the user has not toggled one of its items (existing trades start
    manual; `Neu prüfen` re-enables); auto items read `{setup} · automatisch`. Applied as a derived layer (`withMtfAuto`), saved via `pruneChecks`.
- **Fehler** (NEW, after `Überzeugung & Disziplin`): `aria-pressed` chips from `settings.mistakes`, then own tags used on other trades
  (`usedOwnMistakes`, defaults excluded), then the trade's own (`mistakeOptions`); `+ Eigener Fehler` → field (Enter adds + selects, Escape cancels
  only the field). Saved as `trade.mistakes` (the settings list is never written from here).
- **Timeframe** options = `TIMEFRAMES` (incl. 30m / 45m / 2h) plus a stored value outside the list (`timeframeOptions`), never shown as `–`.
- **Unsaved input** (`isFormDirty` vs. the state the form opened with / was reset to by `Speichern & neu`; `Neu prüfen` counts): Escape,
  backdrop, header ✕, swipe and `Abbrechen` show the footer confirm `Änderungen verwerfen?` `[Verwerfen]` `[Weiter bearbeiten]` (focus on the
  safe answer, back to `Abbrechen`) instead of closing (`Sheet dismissGuard / onDismissAttempt`).
- More exports: `isFormDirty`, `mistakeOptions`, `usedOwnMistakes`, `withMtfAuto`, `timeframeOptions`, `DISCARD_COPY`, `MISTAKES_COPY`;
  `SignalSection.tsx`: `SignalSection`, `resolveTradeSignal`, `signalSectionSub`, `localMs`, `SIGNAL_SECTION_TITLE`, `SIGNAL_SECTION_COPY`,
  `RETRO_DEBOUNCE_MS`, `SAVE_CHECK_TIMEOUT_MS`; `SignalSummary.tsx`: `SignalSummary`, `StrengthBars`, `StrengthDots`, `MistakeChips`,
  `signalTone`, `snapshotSource`, `tradeSignal`.

## `TradeDetail` (`TradeDetail.tsx`) – bundle `q$`, Plan 6.2 / 2.5

```ts
interface TradeDetailProps {
  candles?: Candle[];            // 1h candles ±3 days around tradeTime(trade) → <MiniTradeChart>; omitted → no chart
  onEdit?: (id: string) => void; // default: closeDetail(), then openEditor({ tradeId }) after the exit animation
  className?: string;
}
```

- **State**: `useUi().detail = { id, source }`; open with `openDetail(id, "recent" | "table" | "marker")` (no-op while `transitioning`), `closeDetail()`.
- Backdrop `fixed inset-0 z-[58] bg-black/70` (`tween.fade`/`tween.exit`), wrapper `z-[59] grid place-items-center p-4`, panel `role="dialog" aria-modal
  aria-label="Trade-Details"` `max-w-[460px]` `borderRadius 28` `layoutRoot`, `layoutId="trade-{id}"` on `spring.detail` – shared with the recent-trades row
  (`source "recent"`), the table ghost / mobile card (`"table"`) or the chart-marker ghost (`"marker"`); `trade-side-{id}` and `trade-pnl-{id}` travel along
  (`layout="position"`). Escape / backdrop / `Schließen` close; focus trap, scroll lock and `inert` siblings via `useDialogBehaviour`.
- Content: `▲ Long|▼ Short · Makro|Scalp`, `{date} {time}[ · tf] · {pair}`, `.dot-num text-[30px]` P&L (`MotionNumber`, `offen` when null), tiles
  `Einstieg | Ausstieg (– open) | R | Bewegung`, facts `Stop | Ziel | Größe | Hebel | Gebühren | CRV`, setup chips, `Checkliste {checked}/{items}` + bar
  (`scaleX`, win when complete) + `CheckRow` discs ✓/✕/· (· for open trades), `Überzeugung | Plan befolgt | Gefühl`, `Warum` → reason, `Learning` → notes,
  `MiniTradeChart` slot, `Chart öffnen ↗` (`target=_blank rel=noreferrer`), buttons `Löschen` (inline `Wirklich löschen?` `Ja, löschen` / `Nein` → `deleteTrade`,
  toast `Trade gelöscht`), `Schließen`, `Bearbeiten`. The footer swaps actions ↔ confirmation in sequence (`confirmSwapMotion`,
  `AnimatePresence mode="wait"`). `Bearbeiten` = `uiStore.editFromDetail(id)`: detail closes and editor opens in one update; the editor
  sheet gets `handoff` (dim starts at the detail's level, panel enters after the detail's exit) – no bare page in between (TR-05).
- `MiniTradeChart` is imported from `@/chart/MiniTradeChart` (mock that path in tests).
- NEW: `Einstiegs-Check` (`SignalSummary` of `trade.signal`: score, label, `{Stärke} · {tiers} von {n} Timeframes`, timeframe + zone pills,
  where it came from) and `Fehler` chips (`trade.mistakes`), after the checklist.
- NEW (physics): swipe to dismiss on touch / pen (`useSwipeDismiss` mode "zoom"): handle = the header row + a sticky opaque 20 px grabber
  strip (coarse pointers). The column follows 1:1 down, ½ sideways, scales to .88, the dim lifts; a slow pull springs back, a projected
  flick closes: with a source that stays mounted (`hasMorphBack`: recent row, trade card `[data-trade-morph]`) via `dismissDetail(tempo)` –
  the source runs its layout morph from the shrunk box on `contextSpringAt(spring.detail, detailTempo)`; otherwise (table ghost, chart
  marker, calendar) the column flies out on the release velocity with its contents inside. Disabled until the open morph settled and
  during the editor hand-off. Panel `overscroll-contain`.

## Motion (premium pass)

| piece | effect |
|---|---|
| `TradeEditor` sections | `Section` is a `StaggerItem` → the six sections cascade in after the sheet body mounts (`stagger.sections`). |
| validation | the footer `role="alert"` (always mounted, `id="trade-form-error"`, empty when fine) shakes; the field behind the message (`invalidFieldOf`) gets `aria-invalid` + `aria-describedby`, is focused, scrolled into view and then shaken + pulsed (`revealInvalid`). Cleared on edit. |
| live strip | `MotionNumber flash` (win/loss tint per change). Checklist bar crossfades to win at 100 %, the `{x} von {n} erfüllt` label rolls (`TextRoll`). |
| chips | emotion chips share one thumb (`layoutId="emotion-{useId}"`, `spring.segment`, `style.borderRadius` pill, label-only press); setup chips pop their dot into a check disc (`spring.pop`) and glide to their new order on an account switch (`layout="position"`, `layoutDependency={account}`). |
| `LivePriceButton` | aria-hidden mini `RollingDigits source={priceMv}` next to the label while a live price exists (container query: only when label + digits fit). The name stays exactly the label; a click applies the freshest trade (`freshLivePrice`: `priceMv`, full precision) and falls back to the `livePrice` prop (re-read once a second, rounded) until a trade has arrived. |
| celebration | a save that realises a win calls `celebrateFrom(button, { kind })` – `winCelebration(tradesBefore, record, before)`: `record` = new equity high, `streak` = R ≥ 2 or third win in a row, `win` otherwise; edits of an existing win stay quiet. |
| `TradeDetail` | like `MorphDialog`: the fixed wrapper is the backdrop click target (the dim layer is decorative, never the target – it would be `inert`), the drop shadow sits on an unscaled sibling and fades in after the morph, and `useDialogBehaviour(…, { settled })` keeps `inert` / the focus return out of the morph and exit frames. The body is a stagger parent: fact tiles one by one (`stagger.cards`) → more facts → setups → checklist (bar fills, discs pop `spring.pop` · `stagger.rows`) → meta → notes → chart → actions. |
| delete / destructive | `HoldConfirm` (`@/motion/HoldConfirm`, built on `HoldButton`'s `onRelease`): tap/click/quick key/AT → `onAsk` (the existing inline `Wirklich löschen? Ja, löschen / Nein` flow, unchanged names); a completed hold → `onConfirm` at once. `useConfirmFocus(confirming)` moves focus to `Nein` and back. Used by TradeEditor, TradeDetail (delete after the drawn check), SetupEditor, ImportDialog (`Ersetzen`), Settings `Wiederherstellen`. |
| `SetupEditor` | fields cascade (`StaggerItem`), checklist rows enter/leave and lift while dragged (scale 1.02 + pre-rendered shadow layer), colour ring glides (`layoutId="sf-color-{useId}"`), a missing name shakes into view. |
| `ImportDialog` | blocks cascade, preview counts up (`countOnReveal`), progress bar (`role="progressbar"`) glides on `spring.bar` with a shimmer band inside the fill and turns win at 100 %. |
| `HyblockForm` | blocks cascade with the MorphDialog body; a refused value shakes its field into view. |
| swipe handles | every swipe handle (sheet header, dialog head, detail grabber / header, toast) carries `useTouchMoveGuard` (`@/motion/a11y`): a native non-passive `touchmove` that is `preventDefault`ed while dragging – otherwise Chrome treats the next tap within ~1 s as a fling cancel and swallows its click (e.g. the FAB right after swiping the editor away). |

Helpers: `winCelebration` (`celebration.ts`), `BIG_WIN_R`, `STREAK_WINS`, `invalidFieldOf`. Shared with the views (moved out of this
folder): `revealInvalid(idOrEl, { reduced })` → `@/primitives/fieldFx` (focus without jump → smooth scroll if needed → shake once
visible); `HoldConfirm`, `useConfirmFocus`, `HOLD_CONFIRM_TITLE` → `@/motion/HoldConfirm`.

## What the integrator wires

| prop | source | notes |
|---|---|---|
| `TradeEditor.livePrice` | `EditorHost`: the rounded last price, read once a second on `nowMv` only while the editor is open | pass `null` when unavailable → button not rendered; a click applies `priceMv` first (full precision) |
| `TradeEditor.livePriceLabel` | `"Live-Preis (Bybit) übernehmen"` on the Bybit fallback | |
| `TradeDetail.candles` | `provider.history("kline_1h", …)` / cache slice ±3 days around `tradeTime(trade)` | stable array identity per load |
| `uiStore.toasts` | `ToastIsland` | see toast note above |
| FAB / setup card sources | `visibility:hidden` while the sheet with the matching `layoutId` is open | Plan 3.2 rule 9 |

## Other overlays (owned by the setups / settings / overview agents – summary of their exported props)

- **`SetupEditor`** (`SetupEditor.tsx`, bundle `Z$`, Plan 6.3): `{ open?; setupId?; fromTrade?; onClose?; onSaved?(setup) }` – every prop overrides the
  matching `uiStore.setupEditor` field; morphs from `setup-card-{id}` unless `fromTrade`. Helpers `finalizeSetup`, `upsertSetup`, `removeSetup`, `moveItem`,
  `SETUP_EDITOR_STRINGS`, `SETUP_ACCOUNT_OPTIONS`.
  - Dirty guard: `dismissGuard` = the form differs from how it opened (exported `sameForm`: trimmed, empty checklist rows ignored);
    `onDismissAttempt` (Escape, backdrop, ✕, swipe) and `Abbrechen` show the footer confirm (`data-testid="setup-discard-confirm"`,
    words from `SHEET_DISCARD_COPY`) instead of closing.
  - `s_mtf` (Multi-TF Signal): the checklist help adds `SETUP_EDITOR_STRINGS.mtfAuto` (the entry check ticks these items when a trade is
    entered; renaming keeps the link, a deleted item is no longer ticked).
- **`HyblockForm`** / **`HyblockReadingsList`** (`HyblockForm.tsx`, bundle `tK`): `{ last?; live?: LiveHyblockValues; onClose?; onSave?; now?; className? }`
  (lives in the `hyblock-new` morph dialog; `live` renders `Live-Werte übernehmen`) / `{ readings?; limit? (5); onDelete?; className? }`. `HYBLOCK_FORM_STRINGS`.
  - Unsaved input: `Abbrechen` with typed values shows the confirm `HYBLOCK_FORM_STRINGS.discardAsk` `[Verwerfen]` `[Weiter bearbeiten]`
    (`data-testid="hyblock-discard-confirm"`); the dialog's Escape, backdrop, ✕ and swipe ask the same way through
    `useMorphDialogGuard(() => dirty, () => setAsking(true))` (`@/motion/MorphDialog`). Saving and `Verwerfen` close unguarded.
- **`ImportDialog`** (`ImportDialog.tsx`, Plan 8.5): `{ open; onClose; onDone?(result); readFile? }` – Sheet 540 px, `IMPORT_STRINGS`, `IMPORT_MODES`.
  `dismissGuard={false}` (nothing typed to lose).
- **Sheet guard for other editors**: pass `dismissGuard={() => dirty}` + `onDismissAttempt={() => showConfirm()}`. Without
  `dismissGuard` the Sheet guards itself as soon as any field inside received input and asks with its own inline
  `Änderungen verwerfen?` strip above the footer (`SHEET_DISCARD_COPY`).
