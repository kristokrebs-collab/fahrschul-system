# `src/views/settings` – Einstellungen page

Bundle `K$` (Plan 6.4, 8.5, 8.6). One draft (`SettingsDraft`, all numbers as de-DE strings) re-hydrated
from `settings` on every store change; a single `Speichern` (header + bottom) validates the 14 numeric
fields, applies the fallbacks and calls `useJournal().saveSettings`. Toasts go through `useUi().pushToast`:
`Einstellungen gespeichert`, `Bitte alle Zahlenfelder ausfüllen`, `Speichern fehlgeschlagen`.
Import from `@/views/settings`.

## `SettingsView`
```ts
interface SettingsViewProps {
  health?: ProviderHealth | null;                              // Live-Daten card (from provider.getHealth())
  statusLabels?: Partial<Record<FeedId, StatusLabel>>;         // optional provider.statusLabel(feed) per feed
  onRefresh?(): void | Promise<void>;                          // `Jetzt aktualisieren`
  onReconnect?(): void | Promise<void>;                        // `Jetzt neu verbinden`
  onClearCache?(): void | Promise<void>;                       // `Cache leeren` (IndexedDB tj-market)
  onTestHyblock?(cfg: HyblockTestConfig): Promise<string[]>;   // `Verbindung testen`; default = MCP path
  className?: string;
}
```
Cards (grid `lg:grid-cols-2`): `Konten` · `Backtest-Referenz` · `Live-Status · Trigger-Level` (with help lines,
symbol help `BINANCE:BTCUSDT → Binance Perp; …`) · `Live-Daten` (NEW) · `Hyblock-Connector` (`lg:col-span-2`) ·
`Daten` · `Grundregeln` (NEW). The `ImportDialog` is rendered at page level (outside any transformed card).

## Building blocks
| export | props / signature | notes |
|---|---|---|
| `settingsToDraft(s)` / `draftToSettings(draft, base)` | pure | `→ { ok: true, settings } \| { ok: false, error: "numeric", field }`; percentages ×100 ↔ ÷100; fallbacks `USDT`, `BTC/USDT`, `BINANCE:BTCUSDT`, `BTC`, `1h`, `Backtest`; rules trimmed, empty dropped; `setups` untouched. `NUMERIC_FIELDS`, `CURRENCIES`, `FALLBACKS`. |
| `DraftField` | `{ id; label; help?; numeric? (true); draft; onChange(key, value); placeholder? }` | Bundle helper `l`: `Field` + `Input#s-{id}` (`inputMode=decimal font-mono`). |
| `HyblockConnectorCard` | `{ draft; onChange; onTest?; className? }` | Intro (verbatim) + NEW note that live values come from Binance without a key; 7 fields; `Verbindung testen` / `Teste …` → `<pre role="status">`. `runHyblockTest(cfg)` = bundle `Che` 1:1 (`window.claude.use("mcp")`, `hyblock_get`, `limit: 3`, empty params removed; `Nur auf claude.ai verfügbar.` without MCP). Helpers `unwrapRows` (`Wf`), `describeRows`, `describeError`, `testConfigFromDraft`; `HyblockTestConfig = { endpoints: string[]; params: Record<string, string \| number> }`. Netlify path: integrator passes `onTestHyblock` returning `[HYBLOCK_STRINGS.proxyMissing]`. |
| `LiveDataCard` | `{ health?; statusLabels?; onRefresh?; onReconnect?; onClearCache?; className? }` | Overall `StatusPill` + `Online/Offline` + `WS-Reconnects: n`; table `Feed \| Quelle \| Stand \| Status` (`FEED_LABELS`, `STATE_LABELS`, `toneOfState`); buttons disabled without handler; Segmented `Top-Trader-Basis: Konten \| Positionen` → `useUi.setPref("topTraderBase")` (never `settings.hyblock`), `Sparkline: Ablesungen \| Live` → `setPref("sparkline")`; `EU-Proxy verwenden` (`Switch`) only when `health.proxy.usable === true` → `setPref("useProxy")`. Without `health`: placeholder text. |
| `DataCard` | `{ onImport(); className? }` | `CSV exportieren` / `Backup (JSON)` (`exportCsv`/`exportJson`; `DOWNLOAD_UNAVAILABLE` text when `!canDownload()`), `Backup importieren`, mode pill `MODE_LABELS[mode]`, `Letztes Backup {date}`, `Wiederherstellen` list (`listBackups()`, 5 rows + `Alle anzeigen`, popLayout rows, inline `Alles ersetzen? Ja/Nein` → `restoreBackup(tag)`), `Quarantäne ansehen` (`readQuarantine()` JSON) when `quarantined > 0`, footer `{n} Trades gespeichert · {m} Grundlagen · {k} Grundregeln`. |
| `RulesCard` | `{ rules; onChange(rules); trades; className? }` | `Reorder.Group` (drag handle `Regel {n} verschieben` + ArrowUp/Down), inputs `Regel {n}`, `+ Regel hinzufügen` (`newRuleId()` → `g…`), `Regel entfernen` with inline `{n} Trades verlieren den Haken` when used (`ruleUsage`). `moveRule` helper. |

```tsx
import { SettingsView } from "@/views/settings";
const health = useHealth(); // market layer
<SettingsView health={health} onRefresh={() => provider.refresh("markPrice", { force: true })} onTestHyblock={runHyblockTest} />
```

## Motion & feedback (`fx.tsx`)
| export | notes |
|---|---|
| `useActionPhase()` → `{ phase: "idle"\|"busy"\|"done", run(fn) }` | `run` resolves `true`/`false`; `done` holds `DONE_HOLD_MS` (= `dwell.done` · 1000 = 1.2 s) |
| `SaveButton { phase, …ButtonProps }` | `Speichern` → spinner + `Speichert …` → drawn ✓ + `Gespeichert` on a win wash → back; `TextRoll` labels, fixed width, glyph left of the centred label. Name = current label. |
| `ActionButton { icon?, spinIcon?, onRun? }` | icon → spinner (refresh: the icon spins) → ✓, label unchanged; disabled without `onRun` |
| `PhaseGlyph`, `Spinner`, `DrawnCheck`, `ChangedDot`, `GlyphRefresh/Link/Trash/Download` | building blocks |

- `changedKeys(draft, saved)` (draft.ts): entries whose saved meaning differs (numbers by value, text trimmed, rules without empty rows). Drives the signal dots after field labels (`ChangedDot`, zero-width inline box → a label never wraps when it appears) and the `Ungespeicherte Änderungen` bar (ST-01: IN FLOW between page header and form, `position: sticky` under the app header, `[data-unsaved-bar]`; opaque pill revealed by a top-down clip on `spring.sheet` in sync with the form's `layout="position"` push – the push only animates while the slot is on screen, otherwise scroll anchoring keeps the content still; exit closes the clip, then the slot is removed; label `Ungespeichert` below `sm`; `Verwerfen` is a `HoldButton`; DOM order header → bar → form).
- pulse-motion: `Währung` = `MorphSelect` (`#s-currency`, trigger `button[aria-haspopup=listbox]`, `data-value`); `TradingView-Symbol` = `SymbolField` (`Autocomplete` `#s-symbol` over `BINANCE_FUTURES_SYMBOLS`; rows show the bare symbol, choosing stores `BINANCE:<SYMBOL>`, free text stays allowed, `symbolFilter` matches with or without the prefix); Grundregeln drag lift = `useLift` (scale spring 900/40 to 1.02 + glow layer τ 70 ms); page lead = `LeadFill` (`tj2-fill-settings`, marker on `Startkapital`).
- `IntroPref` (in the Daten card): `Switch` `#s-intro` "Intro beim Start abspielen" (localStorage `tj2-ui-intro`: `"off"` disables, default on) + `Intro jetzt abspielen` → `replayIntro()`.
- LiveDataCard (ST-02): status column reserves `min-w-[12rem]`, the overall pill `min-w-[7.25rem]` – label changes never re-flow the table / the status row.
- A refused save marks the field (`DraftField invalid` → `aria-invalid`) and `revealInvalid`s it (`@/primitives/fieldFx`: scroll, then `shakeField` – shake + border pulse).
- Cards are memoised (`DraftField` compares only its own value), so the Live-Daten health updates never re-render the form. `SettingsPage` no longer ticks every second: labels follow the health snapshot.
- LiveDataCard: rows cascade on first view, `Stand` cells flash on every delivery, proxy preference is a `Switch` (`#live-proxy`, labelled `EU-Proxy verwenden`).
- DataCard: export buttons end on ✓, mode badge `dot` (+ `ping` when synchronised), restore rows use `HoldConfirm` (`@/motion/HoldConfirm`). RulesCard: drag lift (scale 1.02 + shadow layer), changed dot in the title.

Tests: `tests/unit/views.settings.konten.test.tsx`, `tests/unit/views.settings.rules.test.tsx`, `tests/unit/views.settings.motion.test.tsx`.

## Merge pass (Einstiegs-Check, Fehler-Tags, Grenzen, Version & Speicher)
Card order: Konten · Backtest-Referenz · Live-Status · Live-Daten · **Einstiegs-Check** (full width) · Hyblock-Connector (full width) · Daten · Grundregeln · **Fehler-Tags** · **Disziplin-Grenzen** · **Version & Speicher** (full width). `Card` puts `className` on its inner surface, so full-width cards sit in a `lg:col-span-2` grid item (the old `className="lg:col-span-2"` on Hyblock never spanned).

- Draft (`draft.ts`): flat strings `sgLadder` (comma list) `sgReq sgLook sgRsiOs sgRsiOb sgRsiNear sgWtOs sgWtOb sgZoneTf sgSwing sgCh sgAvg sgSig sgNotify ("on"|"") sgNotifyMin`, `mistakes: MistakeRow[]`, `dlTrade dlDay dlMakro dlScalp`. `settingsToDraft` shows what the engine runs with (`sanitizeSignalCfg`) and the discipline limits (`disciplineLimits`). `draftToSettings` writes each part ONLY when it changed (untouched → stored value kept by reference, absent stays absent): signals merged over the stored object (unknown keys of either app survive), ladder sorted/deduped/≥ 30m (≥ 1 rung, else refused on `sgLadder`), `required` 1..ladder length, lengths clamped like the sanitiser, RSI 0..100, `notify`, `notifyMinStrength` 1..4; mistakes trimmed/deduped; discipline % → fractions. NEW: `market` / `hyblock` / `backtest` spread the stored object first (e.g. `market.sourceSymbol` used to be dropped on every save). Numeric validity of the new parts uses the same refusal path (`{ ok:false, field }` → toast + reveal + shake). `changedKeys` covers the new keys (ladder order-insensitive, mistakes by saved meaning).
- `SignalCheckCard` (`data-testid="settings-signal-card"`): ladder toggles `Stufe {tf}` (`aria-pressed`, last active rung `aria-disabled`), resulting ladder with roles, `Pflicht-Stufen` Segmented (1..n), RSI / MCB / WaveTrend fields (`#s-sg*`), `Zone auf` MorphSelect (`#s-sgZoneTf`), `Kerzen für Zone`, `Systembenachrichtigung` switch (`#s-sgNotify`; switching on calls `requestSignalNotifyPermission()` inside the click, only `granted` turns it on; the line below names the permission state), `Hinweis ab Stärke` Segmented 1..4 (`notifyMinStrength`, honoured by the notifier once `src/market/signals/notify.ts` applies it – see report request), `Standardwerte setzen` (the other journal's `DEFAULT_SIGNAL_CFG`, keeps the notification choices).
- `MistakesCard` (`data-testid="settings-mistakes-card"`): rename in place (`Fehler-Tag {n}`), usage count per tag, remove, `+ Fehler-Tag hinzufügen`, duplicate hint; stored trades are never rewritten – tags only on trades (renamed / removed / from the other version) are listed under `Nur auf Trades` with `„{tag}“ wieder in die Liste aufnehmen`. Pure helpers `mistakeUsage`, `orphanTags`.
- `LimitsCard`: `settings.discipline` (`maxLossTradePct`, `maxLossDayPct`, `maxTrades.{makro,scalp}`) for the overview's discipline evaluation.
- `StorageCard` (`data-testid="settings-storage-card"`): edition (Persönlich / Zum Teilen), web app vs. local file, Speicherort (claude.ai / dieser Browser / nirgends), `KEY_PREFIX*` namespace, the no-storage path (`data-testid="settings-no-storage"`, "Speichern nicht möglich."), `Anzeige`: `App installieren` (when the browser offers it), `Vollbild einschalten` / `Vollbild beenden` (Fullscreen API), else the install hint.
- `DataCard`: import hint for the other version's backups (`importHint`); mode pill via `modeLabelFor(mode, storage)` (`Nicht gespeichert` without storage).
- `LiveDataCard`: `kline_15m` label; below `sm` the table rows stack (feed + status, then source · Stand) – no sideways scroll on phones; single-file builds hide the EU-proxy switch and show `fileHint`.
- Touch: Grundregeln handles/remove, mistake remove `pointer-coarse:size-11`; switches `touch-hit`; wrapped action rows `pointer-coarse:gap-3.5`.
- Lead-fill key `storageKey("fill-settings")` (personal: `tj2-fill-settings` unchanged).
- Tests: `tests/unit/views.settings.signals.test.tsx` (+ the existing settings tests).
