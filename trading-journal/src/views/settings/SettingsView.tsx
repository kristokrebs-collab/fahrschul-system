import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useMemo, useState } from "react";
import type { Rule } from "@/domain/types";
import type { FeedId, ProviderHealth, StatusLabel } from "@/market/types";
import { cn } from "@/lib/cn";
import { HoldButton } from "@/motion/HoldButton";
import { PulseDot } from "@/motion/PulseDot";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ImportDialog } from "@/overlays/ImportDialog";
import { revealInvalid } from "@/primitives/fieldFx";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input, inputClass } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { DataCard } from "./DataCard";
import { CURRENCIES, changedKeys, draftToSettings, settingsToDraft, type DraftKey, type DraftTextKey, type SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { ChangedDot, SaveButton, useActionPhase, type ActionPhase } from "./fx";
import { HyblockConnectorCard, type HyblockTestConfig } from "./HyblockConnectorCard";
import { LiveDataCard } from "./LiveDataCard";
import { RulesCard } from "./RulesCard";

export const SETTINGS_STRINGS = {
  title: "Einstellungen",
  lead: "Startkapital, Trigger-Level für den Live-Status und die Backtest-Werte, mit denen deine Trades verglichen werden.",
  save: "Speichern",
  saving: "Speichert …",
  saved: "Gespeichert",
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
  unsaved: "Ungespeicherte Änderungen",
  unsavedShort: "Ungespeichert",
  discard: "Verwerfen",
  discardHold: "Halten …",
  discardTitle: "Gedrückt halten, um alle ungespeicherten Änderungen zu verwerfen",
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

const NO_CHANGES: ReadonlySet<DraftKey> = new Set();

/**
 * `Einstellungen` page (Bundle `K$`, Plan 6.4). Draft state is re-hydrated from `settings` on every
 * settings change (as the bundle does); the single `Speichern` validates the 14 numeric fields
 * (`Bitte alle Zahlenfelder ausfüllen`), applies the fallbacks and writes through `saveSettings`
 * (`Einstellungen gespeichert` / `Speichern fehlgeschlagen`). Setups pass through untouched; the
 * NEW `Grundregeln` card edits `settings.rules` inside the same draft.
 *
 * Motion: every `Speichern` morphs idle → spinner → drawn ✓ `Gespeichert` (`SaveButton`); fields whose value
 * differs from the saved settings carry a signal dot, and an `Ungespeicherte Änderungen` bar slides in under the
 * header (`spring.sheet`) with `Verwerfen` (hold to confirm) and its own `Speichern`; a refused save brings the
 * offending field into view, then shakes and pulses it. Cards are memoised, so the 1-Hz health updates of the
 * Live-Daten card never re-render the form.
 */
export function SettingsView({ health, statusLabels, onRefresh, onReconnect, onClearCache, onTestHyblock, className }: SettingsViewProps) {
  const settings = useJournal((s) => s.settings);
  const trades = useJournal((s) => s.trades);
  const saveSettings = useJournal((s) => s.saveSettings);
  const pushToast = useUi((s) => s.pushToast);
  const reduced = useReducedFx();

  const [draft, setDraft] = useState<SettingsDraft>(() => settingsToDraft(settings));
  const [hydratedFrom, setHydratedFrom] = useState(settings);
  /** true once the user touched the draft; a pristine draft follows external settings changes */
  const [dirty, setDirty] = useState(false);
  const [invalidField, setInvalidField] = useState<DraftTextKey | null>(null);
  /** the unsaved bar stays through `Speichert …` / `Gespeichert` when the save started from it */
  const [holdBar, setHoldBar] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** which `Speichern` started the save: only that button plays the ✓ (the others just show the shared busy state) */
  const [origin, setOrigin] = useState<SaveOrigin>("page");
  const { phase, run } = useActionPhase();

  // Re-hydrate the draft when the stored settings change (bundle `useEffect(..., [settings])`), done during
  // render (React "adjusting state on prop change"). Only a PRISTINE draft follows: a cloud snapshot or a
  // SetupEditor save (new `settings` identity) must not wipe unsaved edits.
  if (hydratedFrom !== settings) {
    setHydratedFrom(settings);
    if (!dirty) setDraft(settingsToDraft(settings));
  }

  const saved = useMemo(() => settingsToDraft(settings), [settings]);
  const changed = useMemo(() => {
    const keys = changedKeys(draft, saved);
    return keys.size ? keys : NO_CHANGES;
  }, [draft, saved]);

  const set = useCallback((key: DraftTextKey, value: string) => {
    setDirty(true);
    setInvalidField((f) => (f === key ? null : f));
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);
  const setRules = useCallback((rules: Rule[]) => {
    setDirty(true);
    setDraft((d) => ({ ...d, rules }));
  }, []);
  const openImport = useCallback(() => setImportOpen(true), []);

  async function save() {
    const res = draftToSettings(draft, useJournal.getState().settings);
    if (!res.ok) {
      pushToast({ kind: "error", title: SETTINGS_STRINGS.toastNumbers });
      setInvalidField(res.field);
      revealInvalid(`s-${res.field}`, { reduced });
      return;
    }
    setInvalidField(null);
    setHoldBar(changed.size > 0);
    const ok = await run(async () => {
      await saveSettings(res.settings);
      setDirty(false);
    });
    pushToast(ok ? { kind: "success", title: SETTINGS_STRINGS.toastSaved } : { kind: "error", title: SETTINGS_STRINGS.toastFailed });
  }

  const discard = () => {
    setDraft(settingsToDraft(useJournal.getState().settings));
    setDirty(false);
    setInvalidField(null);
  };

  const onSave = () => {
    setOrigin("page");
    void save();
  };
  const onSaveBar = () => {
    setOrigin("bar");
    void save();
  };
  const barOpen = changed.size > 0 || (holdBar && phase !== "idle");
  const pagePhase = buttonPhase(phase, origin === "page");
  const barButtonPhase = buttonPhase(phase, origin === "bar");

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)}>
      <PageHeader title={SETTINGS_STRINGS.title} lead={SETTINGS_STRINGS.lead} action={<SaveButton phase={pagePhase} onClick={onSave} />} />

      <form
        className="grid grid-cols-1 gap-5 lg:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <AccountsCard draft={draft} onChange={set} changed={changed} invalid={invalidField} />
        <BacktestCard draft={draft} onChange={set} changed={changed} invalid={invalidField} />
        <TriggerCard draft={draft} onChange={set} changed={changed} invalid={invalidField} />

        <LiveDataCard health={health} statusLabels={statusLabels} onRefresh={onRefresh} onReconnect={onReconnect} onClearCache={onClearCache} />

        <HyblockCard className="lg:col-span-2" draft={draft} onChange={set} onTest={onTestHyblock} />

        <DataCardMemo onImport={openImport} />

        <RulesCardMemo rules={draft.rules} onChange={setRules} trades={trades} changed={changed.has("rules")} />

        <div className="flex justify-end lg:col-span-2">
          <SaveButton phase={pagePhase} onClick={onSave} />
        </div>
      </form>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <UnsavedBar open={barOpen} phase={phase} buttonPhase={barButtonPhase} onSave={onSaveBar} onDiscard={discard} />
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

interface DraftCardProps {
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  changed: ReadonlySet<DraftKey>;
  invalid: DraftTextKey | null;
}

type FieldSpec = { id: DraftTextKey; label: string; help?: string; numeric?: boolean };

function DraftFields({ fields, draft, onChange, changed, invalid }: DraftCardProps & { fields: readonly FieldSpec[] }) {
  return fields.map((f) => <DraftField key={f.id} id={f.id} label={f.label} help={f.help} numeric={f.numeric} draft={draft} onChange={onChange} changed={changed.has(f.id)} invalid={invalid === f.id} />);
}

const S = SETTINGS_STRINGS;
const BACKTEST_FIELDS: readonly FieldSpec[] = [
  { id: "winRate", label: S.winRate },
  { id: "expectancy", label: S.expectancy },
  { id: "avgWin", label: S.avgWin },
  { id: "avgLoss", label: S.avgLoss, help: S.avgLossHelp },
  { id: "label", label: S.label, numeric: false },
];
const TRIGGER_FIELDS: readonly FieldSpec[] = [
  { id: "symbol", label: S.symbol, help: S.symbolHelp, numeric: false },
  { id: "longTrigger", label: S.longTrigger, help: S.longTriggerHelp },
  { id: "longStop", label: S.longStop, help: S.longStopHelp },
  { id: "shortTrigger", label: S.shortTrigger, help: S.shortTriggerHelp },
  { id: "invalidation", label: S.invalidation, help: S.invalidationHelp },
  { id: "lowerHigh", label: S.lowerHigh, help: S.lowerHighHelp },
  { id: "rsiWeekly", label: S.rsiWeekly, help: S.rsiWeeklyHelp },
  { id: "zoneLow", label: S.zoneLow, help: S.zoneHelp },
  { id: "zoneHigh", label: S.zoneHigh, help: S.zoneHelp },
];

const AccountsCard = memo(function AccountsCard({ draft, onChange, changed, invalid }: DraftCardProps) {
  return (
    <Card title={S.accounts}>
      <div className="grid grid-cols-2 gap-3.5">
        <DraftFields
          fields={[
            { id: "makro", label: S.makro, help: S.makroHelp },
            { id: "scalp", label: S.scalp, help: S.scalpHelp },
          ]}
          draft={draft}
          onChange={onChange}
          changed={changed}
          invalid={invalid}
        />
        <Field
          label={
            <>
              {S.currency}
              <ChangedDot show={changed.has("currency")} />
            </>
          }
          htmlFor="s-currency"
        >
          <select id="s-currency" className={inputClass} value={draft.currency || "USDT"} onChange={(e) => onChange("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <DraftField id="pair" label={S.pair} numeric={false} draft={draft} onChange={onChange} changed={changed.has("pair")} invalid={invalid === "pair"} />
        <Field
          label={
            <>
              {S.startDate}
              <ChangedDot show={changed.has("startDate")} />
            </>
          }
          htmlFor="s-startDate"
          help={S.startDateHelp}
        >
          <Input id="s-startDate" type="date" value={draft.startDate || ""} onChange={(e) => onChange("startDate", e.target.value)} />
        </Field>
      </div>
    </Card>
  );
});

const BacktestCard = memo(function BacktestCard(props: DraftCardProps) {
  return (
    <Card title={S.backtest}>
      <div className="grid grid-cols-2 gap-3.5">
        <DraftFields fields={BACKTEST_FIELDS} {...props} />
      </div>
    </Card>
  );
});

const TriggerCard = memo(function TriggerCard(props: DraftCardProps) {
  return (
    <Card title={S.trigger}>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <DraftFields fields={TRIGGER_FIELDS} {...props} />
      </div>
    </Card>
  );
});

const HyblockCard = memo(HyblockConnectorCard);
const DataCardMemo = memo(DataCard);
const RulesCardMemo = memo(RulesCard);

/* ------------------------------------------------------------ unsaved bar */

type SaveOrigin = "page" | "bar";

/** Pure: the phase a `Speichern` shows – the originating button runs the whole morph, the others never play the ✓. */
function buttonPhase(phase: ActionPhase, isOrigin: boolean): ActionPhase {
  return isOrigin || phase === "busy" ? phase : "idle";
}

/** The bar's leading text per save phase (short variant below `sm`); stacked in one grid cell and crossfaded. */
const BAR_LABELS: readonly { phase: ActionPhase; long: string; short: string }[] = [
  { phase: "idle", long: S.unsaved, short: S.unsavedShort },
  { phase: "busy", long: S.saving, short: S.saving },
  { phase: "done", long: S.saved, short: S.saved },
];

/**
 * `Ungespeicherte Änderungen` (fixed under the header, centred pill): slides down on `spring.sheet` while the draft
 * differs from the saved settings, and stays through `Speichert …` / `Gespeichert` when the save started there – its
 * leading text crossfades to that phase (`tween.crossfade`; the three labels share one grid cell, so the pill never
 * changes width) and `Verwerfen` fades out once saved. Its own `Speichern` comes after the page's buttons in DOM order;
 * `Verwerfen` must be held (it drops every edit). Narrow screens: the label is the part that gives way (`min-w-0`
 * + truncate), the buttons keep their size, so the pill always fits a 360 px viewport.
 * No live region: the dot and the field marks carry the state, the save result is announced by the toast.
 */
function UnsavedBar({ open, phase, buttonPhase, onSave, onDiscard }: { open: boolean; phase: ActionPhase; buttonPhase: ActionPhase; onSave: () => void; onDiscard: () => void }) {
  const reduced = useReducedFx();
  const fade = reduced ? { duration: 0 } : tween.crossfade;
  const saved = phase === "done";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+72px)] z-[41] flex justify-center px-4">
      <AnimatePresence>
        {open && (
          <motion.div
            key="unsaved"
            className="pointer-events-auto flex min-w-0 max-w-full items-center gap-3 rounded-full border border-line-2 bg-ink-850/95 py-1.5 pl-4 pr-1.5 shadow-[0_18px_48px_rgb(0_0_0/0.55)] backdrop-blur-md"
            initial={reduced ? false : { opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98, transition: tween.exit }}
            transition={{ default: spring.sheet, opacity: tween.fade }}
          >
            <PulseDot tone="signal" size={6} rings={1} active={phase === "idle"} />
            <span className="grid min-w-0 text-[12.5px] font-medium text-fg">
              {BAR_LABELS.map((l) => {
                const on = l.phase === phase;
                return (
                  <motion.span
                    key={l.phase}
                    aria-hidden={on ? undefined : true}
                    className="col-start-1 row-start-1 min-w-0 truncate whitespace-nowrap"
                    initial={false}
                    animate={{ opacity: on ? 1 : 0 }}
                    transition={fade}
                  >
                    {l.short === l.long ? (
                      l.long
                    ) : (
                      <>
                        <span className="sm:hidden">{l.short}</span>
                        <span className="max-sm:hidden">{l.long}</span>
                      </>
                    )}
                  </motion.span>
                );
              })}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <motion.span className={cn("inline-flex", saved && "pointer-events-none")} aria-hidden={saved || undefined} initial={false} animate={{ opacity: saved ? 0 : 1 }} transition={fade}>
                <HoldButton variant="ghost" size="sm" holdLabel={S.discardHold} title={S.discardTitle} onConfirm={onDiscard} disabled={phase !== "idle"}>
                  {S.discard}
                </HoldButton>
              </motion.span>
              <SaveButton phase={buttonPhase} size="sm" onClick={onSave} className="min-w-[8.25rem]" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
