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
| `LiveDataCard` | `{ health?; statusLabels?; onRefresh?; onReconnect?; onClearCache?; className? }` | Overall `StatusPill` + `Online/Offline` + `WS-Reconnects: n`; table `Feed \| Quelle \| Stand \| Status` (`FEED_LABELS`, `STATE_LABELS`, `toneOfState`); buttons disabled without handler; Segmented `Top-Trader-Basis: Konten \| Positionen` → `useUi.setPref("topTraderBase")` (never `settings.hyblock`), `Sparkline: Ablesungen \| Live` → `setPref("sparkline")`; `EU-Proxy verwenden` (CheckboxRow) only when `health.proxy.usable === true` → `setPref("useProxy")`. Without `health`: placeholder text. |
| `DataCard` | `{ onImport(); className? }` | `CSV exportieren` / `Backup (JSON)` (`exportCsv`/`exportJson`; `DOWNLOAD_UNAVAILABLE` text when `!canDownload()`), `Backup importieren`, mode pill `MODE_LABELS[mode]`, `Letztes Backup {date}`, `Wiederherstellen` list (`listBackups()`, 5 rows + `Alle anzeigen`, popLayout rows, inline `Alles ersetzen? Ja/Nein` → `restoreBackup(tag)`), `Quarantäne ansehen` (`readQuarantine()` JSON) when `quarantined > 0`, footer `{n} Trades gespeichert · {m} Grundlagen · {k} Grundregeln`. |
| `RulesCard` | `{ rules; onChange(rules); trades; className? }` | `Reorder.Group` (drag handle `Regel {n} verschieben` + ArrowUp/Down), inputs `Regel {n}`, `+ Regel hinzufügen` (`newRuleId()` → `g…`), `Regel entfernen` with inline `{n} Trades verlieren den Haken` when used (`ruleUsage`). `moveRule` helper. |

```tsx
import { SettingsView } from "@/views/settings";
const health = useHealth(); // market layer
<SettingsView health={health} onRefresh={() => provider.refresh("markPrice", { force: true })} onTestHyblock={runHyblockTest} />
```

Tests: `tests/unit/views.settings.konten.test.tsx`, `tests/unit/views.settings.rules.test.tsx`.
