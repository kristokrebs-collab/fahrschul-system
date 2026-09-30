import { useState } from "react";
import type { Rule } from "@/domain/types";
import type { FeedId, ProviderHealth, StatusLabel } from "@/market/types";
import { cn } from "@/lib/cn";
import { ImportDialog } from "@/overlays/ImportDialog";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input, inputClass } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { DataCard } from "./DataCard";
import { CURRENCIES, draftToSettings, settingsToDraft, type DraftTextKey, type SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { HyblockConnectorCard, type HyblockTestConfig } from "./HyblockConnectorCard";
import { LiveDataCard } from "./LiveDataCard";
import { RulesCard } from "./RulesCard";

export const SETTINGS_STRINGS = {
  title: "Einstellungen",
  lead: "Startkapital, Trigger-Level für den Live-Status und die Backtest-Werte, mit denen deine Trades verglichen werden.",
  save: "Speichern",
  saving: "Speichert …",
  accounts: "Konten",
  makro: "Startkapital Makro",
  makroHelp: "Reagiert nur auf Wochenschlüsse",
  scalp: "Startkapital Scalp",
  scalpHelp: "Tägliches Trading, eigene Regeln",
  currency: "Währung",
  pair: "Standard-Paar",
  startDate: "Journal-Start",
  startDateHelp: "Leer = Datum des ersten Trades",
  backtest: "Backtest-Referenz",
  winRate: "Win-Rate %",
  expectancy: "Erwartung pro Trade %",
  avgWin: "Ø Gewinner %",
  avgLoss: "Ø Verlierer %",
  avgLossHelp: "negativ eintragen, z. B. −9,31",
  label: "Bezeichnung",
  trigger: "Live-Status · Trigger-Level",
  symbol: "TradingView-Symbol",
  symbolHelp: "BINANCE:BTCUSDT → Binance Perp; anderes Präfix wird als Binance-Symbol geprüft",
  longTrigger: "Long-Trigger (4H über)",
  longTriggerHelp: "Letzter 4H-Schluss darüber → Long-Trigger aktiv",
  longStop: "Long-Invalidierung",
  longStopHelp: "Long ist ungültig, sobald der Kurs wieder darunter schließt",
  shortTrigger: "Short-Trigger (4H unter)",
  shortTriggerHelp: "Letzter 4H-Schluss darunter → Short-Trigger aktiv",
  invalidation: "Harte Invalidierung",
  invalidationHelp: "4H-Schluss darunter → Bärenfall, alle Longs aus",
  lowerHigh: "Lower High (Weekly)",
  lowerHighHelp: "Weekly Close darüber bricht die Makro-Struktur",
  rsiWeekly: "Weekly-RSI-Schwelle",
  rsiWeeklyHelp: "Weekly-RSI darüber bestätigt den Bruch",
  zoneLow: "Makro-Zone von",
  zoneHigh: "Makro-Zone bis",
  zoneHelp: "Support-/Liquiditätszone für den Falling-Knife-Filter",
  toastSaved: "Einstellungen gespeichert",
  toastNumbers: "Bitte alle Zahlenfelder ausfüllen",
  toastFailed: "Speichern fehlgeschlagen",
} as const;

export interface SettingsViewProps {
  /** Live-Daten card: health snapshot + labels from the market provider (integrator wiring). */
  health?: ProviderHealth | null;
  statusLabels?: Partial<Record<FeedId, StatusLabel>>;
  onRefresh?: () => void | Promise<void>;
  onReconnect?: () => void | Promise<void>;
  onClearCache?: () => void | Promise<void>;
  /** `Verbindung testen` runner; defaults to the MCP path (`Nur auf claude.ai verfügbar.` elsewhere). */
  onTestHyblock?: (cfg: HyblockTestConfig) => Promise<string[]>;
  className?: string;
}

/**
 * `Einstellungen` page (Bundle `K$`, Plan 6.4). Draft state is re-hydrated from `settings` on every
 * settings change (as the bundle does); the single `Speichern` validates the 14 numeric fields
 * (`Bitte alle Zahlenfelder ausfüllen`), applies the fallbacks and writes through `saveSettings`
 * (`Einstellungen gespeichert` / `Speichern fehlgeschlagen`). Setups pass through untouched; the
 * NEW `Grundregeln` card edits `settings.rules` inside the same draft.
 */
export function SettingsView({ health, statusLabels, onRefresh, onReconnect, onClearCache, onTestHyblock, className }: SettingsViewProps) {
  const settings = useJournal((s) => s.settings);
  const trades = useJournal((s) => s.trades);
  const saveSettings = useJournal((s) => s.saveSettings);
  const pushToast = useUi((s) => s.pushToast);

  const [draft, setDraft] = useState<SettingsDraft>(() => settingsToDraft(settings));
  const [hydratedFrom, setHydratedFrom] = useState(settings);
  /** true once the user touched the draft; a pristine draft follows external settings changes */
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Re-hydrate the draft when the stored settings change (bundle `useEffect(..., [settings])`), done during
  // render (React "adjusting state on prop change"). Only a PRISTINE draft follows: a cloud snapshot or a
  // SetupEditor save (new `settings` identity) must not wipe unsaved edits.
  if (hydratedFrom !== settings) {
    setHydratedFrom(settings);
    if (!dirty) setDraft(settingsToDraft(settings));
  }

  const set = (key: DraftTextKey, value: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setRules = (rules: Rule[]) => {
    setDirty(true);
    setDraft((d) => ({ ...d, rules }));
  };

  async function save() {
    const res = draftToSettings(draft, useJournal.getState().settings);
    if (!res.ok) {
      pushToast({ kind: "error", title: SETTINGS_STRINGS.toastNumbers });
      document.getElementById(`s-${res.field}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await saveSettings(res.settings);
      setDirty(false);
      pushToast({ kind: "success", title: SETTINGS_STRINGS.toastSaved });
    } catch {
      pushToast({ kind: "error", title: SETTINGS_STRINGS.toastFailed });
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (
    <Button variant="primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>
      {saving ? SETTINGS_STRINGS.saving : SETTINGS_STRINGS.save}
    </Button>
  );

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)}>
      <PageHeader title={SETTINGS_STRINGS.title} lead={SETTINGS_STRINGS.lead} action={saveButton} />

      <form
        className="grid grid-cols-1 gap-5 lg:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Card title={SETTINGS_STRINGS.accounts}>
          <div className="grid grid-cols-2 gap-3.5">
            <DraftField id="makro" label={SETTINGS_STRINGS.makro} help={SETTINGS_STRINGS.makroHelp} draft={draft} onChange={set} />
            <DraftField id="scalp" label={SETTINGS_STRINGS.scalp} help={SETTINGS_STRINGS.scalpHelp} draft={draft} onChange={set} />
            <Field label={SETTINGS_STRINGS.currency} htmlFor="s-currency">
              <select id="s-currency" className={inputClass} value={draft.currency || "USDT"} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <DraftField id="pair" label={SETTINGS_STRINGS.pair} numeric={false} draft={draft} onChange={set} />
            <Field label={SETTINGS_STRINGS.startDate} htmlFor="s-startDate" help={SETTINGS_STRINGS.startDateHelp}>
              <Input id="s-startDate" type="date" value={draft.startDate || ""} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title={SETTINGS_STRINGS.backtest}>
          <div className="grid grid-cols-2 gap-3.5">
            <DraftField id="winRate" label={SETTINGS_STRINGS.winRate} draft={draft} onChange={set} />
            <DraftField id="expectancy" label={SETTINGS_STRINGS.expectancy} draft={draft} onChange={set} />
            <DraftField id="avgWin" label={SETTINGS_STRINGS.avgWin} draft={draft} onChange={set} />
            <DraftField id="avgLoss" label={SETTINGS_STRINGS.avgLoss} help={SETTINGS_STRINGS.avgLossHelp} draft={draft} onChange={set} />
            <DraftField id="label" label={SETTINGS_STRINGS.label} numeric={false} draft={draft} onChange={set} />
          </div>
        </Card>

        <Card title={SETTINGS_STRINGS.trigger}>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <DraftField id="symbol" label={SETTINGS_STRINGS.symbol} help={SETTINGS_STRINGS.symbolHelp} numeric={false} draft={draft} onChange={set} />
            <DraftField id="longTrigger" label={SETTINGS_STRINGS.longTrigger} help={SETTINGS_STRINGS.longTriggerHelp} draft={draft} onChange={set} />
            <DraftField id="longStop" label={SETTINGS_STRINGS.longStop} help={SETTINGS_STRINGS.longStopHelp} draft={draft} onChange={set} />
            <DraftField id="shortTrigger" label={SETTINGS_STRINGS.shortTrigger} help={SETTINGS_STRINGS.shortTriggerHelp} draft={draft} onChange={set} />
            <DraftField id="invalidation" label={SETTINGS_STRINGS.invalidation} help={SETTINGS_STRINGS.invalidationHelp} draft={draft} onChange={set} />
            <DraftField id="lowerHigh" label={SETTINGS_STRINGS.lowerHigh} help={SETTINGS_STRINGS.lowerHighHelp} draft={draft} onChange={set} />
            <DraftField id="rsiWeekly" label={SETTINGS_STRINGS.rsiWeekly} help={SETTINGS_STRINGS.rsiWeeklyHelp} draft={draft} onChange={set} />
            <DraftField id="zoneLow" label={SETTINGS_STRINGS.zoneLow} help={SETTINGS_STRINGS.zoneHelp} draft={draft} onChange={set} />
            <DraftField id="zoneHigh" label={SETTINGS_STRINGS.zoneHigh} help={SETTINGS_STRINGS.zoneHelp} draft={draft} onChange={set} />
          </div>
        </Card>

        <LiveDataCard health={health} statusLabels={statusLabels} onRefresh={onRefresh} onReconnect={onReconnect} onClearCache={onClearCache} />

        <HyblockConnectorCard className="lg:col-span-2" draft={draft} onChange={set} onTest={onTestHyblock} />

        <DataCard onImport={() => setImportOpen(true)} />

        <RulesCard rules={draft.rules} onChange={setRules} trades={trades} />

        <div className="flex justify-end lg:col-span-2">{saveButton}</div>
      </form>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
