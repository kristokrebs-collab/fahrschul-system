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
- **Toasts** go through `uiStore.pushToast` (kinds `success | error | info`). The integrator renders them with `ToastIsland`
  (map `success → ok`, `error → error`, `info → ok`) or bridges `useUi().toasts` into `primitives/toastStore`.
- Exports for reuse/tests: `defaultForm`, `formFromTrade`, `resetForNext`, `toRecord`, `validateRecord`, `livePriceInput`, `Section`, `LivePriceButton`,
  `EDITOR_MESSAGES`, `LIVE_PRICE_LABEL`, `LIVE_PRICE_CONFIRM_MS`, types `TradeFormStrings`, `TradeFormTyped`, `TradeRecord`.

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
  toast `Trade gelöscht`), `Schließen`, `Bearbeiten`.
- `MiniTradeChart` is imported from `@/chart/MiniTradeChart` (mock that path in tests).

## What the integrator wires

| prop | source | notes |
|---|---|---|
| `TradeEditor.livePrice` | market store last price (`price` of the market card, health `live`/`stale`) | pass `null` when unavailable → button not rendered |
| `TradeEditor.livePriceLabel` | `"Live-Preis (Bybit) übernehmen"` on the Bybit fallback | |
| `TradeDetail.candles` | `provider.history("kline_1h", …)` / cache slice ±3 days around `tradeTime(trade)` | stable array identity per load |
| `uiStore.toasts` | `ToastIsland` | see toast note above |
| FAB / setup card sources | `visibility:hidden` while the sheet with the matching `layoutId` is open | Plan 3.2 rule 9 |

## Other overlays (owned by the setups / settings / overview agents – summary of their exported props)

- **`SetupEditor`** (`SetupEditor.tsx`, bundle `Z$`, Plan 6.3): `{ open?; setupId?; fromTrade?; onClose?; onSaved?(setup) }` – every prop overrides the
  matching `uiStore.setupEditor` field; morphs from `setup-card-{id}` unless `fromTrade`. Helpers `finalizeSetup`, `upsertSetup`, `removeSetup`, `moveItem`,
  `SETUP_EDITOR_STRINGS`, `SETUP_ACCOUNT_OPTIONS`.
- **`HyblockForm`** / **`HyblockReadingsList`** (`HyblockForm.tsx`, bundle `tK`): `{ last?; live?: LiveHyblockValues; onClose?; onSave?; now?; className? }`
  (lives in the `hyblock-new` morph dialog; `live` renders `Live-Werte übernehmen`) / `{ readings?; limit? (5); onDelete?; className? }`. `HYBLOCK_FORM_STRINGS`.
- **`ImportDialog`** (`ImportDialog.tsx`, Plan 8.5): `{ open; onClose; onDone?(result); readFile? }` – Sheet 540 px, `IMPORT_STRINGS`, `IMPORT_MODES`.
