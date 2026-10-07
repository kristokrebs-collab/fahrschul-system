import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Rule } from "@/domain/types";
import type { FeedId, ProviderHealth, StatusLabel } from "@/market/types";
import { cn } from "@/lib/cn";
import { HoldButton } from "@/motion/HoldButton";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { PulseDot } from "@/motion/PulseDot";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ImportDialog } from "@/overlays/ImportDialog";
import { revealInvalid } from "@/primitives/fieldFx";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { useUi } from "@/store/uiStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { DataCard } from "./DataCard";
import { CURRENCIES, changedKeys, draftToSettings, settingsToDraft, type DraftKey, type DraftTextKey, type MistakeRow, type SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { ChangedDot, SaveButton, useActionPhase, type ActionPhase } from "./fx";
import { HyblockConnectorCard, type HyblockTestConfig } from "./HyblockConnectorCard";
import { LimitsCard } from "./LimitsCard";
import { LiveDataCard } from "./LiveDataCard";
import { MistakesCard } from "./MistakesCard";
import { RulesCard } from "./RulesCard";
import { SignalCheckCard } from "./SignalCheckCard";
import { StorageCard } from "./StorageCard";
import { SymbolField } from "./SymbolField";

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

/** Subtitle recipe: pixel fill once per session, then the marker on the key word. */
export const SETTINGS_LEAD_FILL = { storageKey: storageKey("fill-settings"), highlight: "Startkapital" } as const;

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
 * differs from the saved settings carry a signal dot, and an in-flow sticky `Ungespeicherte Änderungen` bar opens
 * under the page header (clip reveal synced with the form's push on `spring.sheet`, ST-01) with `Verwerfen` (hold to
 * confirm) and its own `Speichern`; `Währung` is a pulse `MorphSelect`, `TradingView-Symbol` a pulse `Autocomplete`; a refused save brings the
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
  const setMistakes = useCallback((mistakes: MistakeRow[]) => {
    setDirty(true);
    setDraft((d) => ({ ...d, mistakes }));
  }, []);
  /** Several text keys at once (`Standardwerte setzen` of the Einstiegs-Check). */
  const patch = useCallback((p: Partial<SettingsDraft>) => {
    setDirty(true);
    setInvalidField((f) => (f && f in p ? null : f));
    setDraft((d) => ({ ...d, ...p }));
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
  // ST-01: the bar is IN FLOW under the header (sticky) and pushes the form down. It stays mounted through its exit;
  // the form FLIPs (`layout="position"`) only when the bar's slot is on screen – scrolled past it, the browser's scroll
  // anchoring keeps the content still and the bar simply appears at its sticky spot.
  const [barPresent, setBarPresent] = useState(barOpen);
  const [push, setPush] = useState(0);
  const [observeSlot, slotVisible] = useSlotInView();
  if (barOpen && !barPresent) {
    setBarPresent(true);
    if (slotVisible) setPush((k) => k + 1);
  }
  const onBarExited = useCallback(() => {
    setBarPresent(false);
    if (slotVisible) setPush((k) => k + 1);
  }, [slotVisible]);
  const pagePhase = buttonPhase(phase, origin === "page");
  const barButtonPhase = buttonPhase(phase, origin === "bar");

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)}>
      <PageHeader title={SETTINGS_STRINGS.title} lead={SETTINGS_STRINGS.lead} leadFill={SETTINGS_LEAD_FILL} action={<SaveButton phase={pagePhase} onClick={onSave} />} />

      {barPresent && <UnsavedBar open={barOpen} phase={phase} buttonPhase={barButtonPhase} onSave={onSaveBar} onDiscard={discard} onExited={onBarExited} />}

      <motion.form
        layout={reduced ? false : "position"}
        layoutDependency={push}
        transition={{ layout: spring.sheet }}
        className="relative grid grid-cols-1 gap-5 lg:grid-cols-2"
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

        {/* `Card` puts `className` on its inner surface, so a full-width card needs a spanning grid item around it */}
        <div className="min-w-0 lg:col-span-2">
          <SignalCheckCard draft={draft} onChange={set} onPatch={patch} changed={changed} invalid={invalidField} />
        </div>

        <div className="min-w-0 lg:col-span-2">
          <HyblockCard draft={draft} onChange={set} onTest={onTestHyblock} />
        </div>

        <DataCardMemo onImport={openImport} />

        <RulesCardMemo rules={draft.rules} onChange={setRules} trades={trades} changed={changed.has("rules")} />

        <MistakesCard rows={draft.mistakes} onChange={setMistakes} trades={trades} changed={changed.has("mistakes")} />

        <LimitsCard draft={draft} onChange={set} changed={changed} invalid={invalidField} />

        <div className="min-w-0 lg:col-span-2">
          <StorageCard />
        </div>

        <div className="flex justify-end lg:col-span-2">
          <SaveButton phase={pagePhase} onClick={onSave} />
        </div>
        <span ref={observeSlot} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px" />
      </motion.form>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

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
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }));
const BACKTEST_FIELDS: readonly FieldSpec[] = [
  { id: "winRate", label: S.winRate },
  { id: "expectancy", label: S.expectancy },
  { id: "avgWin", label: S.avgWin },
  { id: "avgLoss", label: S.avgLoss, help: S.avgLossHelp },
  { id: "label", label: S.label, numeric: false },
];
const TRIGGER_FIELDS: readonly FieldSpec[] = [
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
          <MorphSelect id="s-currency" value={draft.currency || "USDT"} onChange={(v) => onChange("currency", v)} options={CURRENCY_OPTIONS} />
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
        <SymbolField label={S.symbol} help={S.symbolHelp} value={props.draft.symbol ?? ""} onChange={props.onChange} changed={props.changed.has("symbol")} />
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

/** Sticky offset of the bar: under the 64 px header + 8 px. */
const BAR_TOP = "calc(env(safe-area-inset-top,0px) + 72px)";
const BAR_TOP_PX = 72;

/**
 * Whether the top of the form (= just under the bar's slot) is below the sticky line – one IntersectionObserver on a
 * 1 px sentinel, React state only when it crosses. Without IntersectionObserver: assume visible (push animates).
 */
function useSlotInView(): [observe: (el: HTMLElement | null) => void, visible: boolean] {
  const [visible, setVisible] = useState(true);
  const stop = useRef<(() => void) | null>(null);
  const observe = useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: `-${BAR_TOP_PX}px 0px 0px 0px` });
    io.observe(el);
    stop.current = () => io.disconnect();
  }, []);
  return [observe, visible];
}

/**
 * `Ungespeicherte Änderungen` (ST-01): an in-flow, sticky row right under the page header – it takes its own space
 * (the form below is pushed down, never covered) and sticks under the app header while scrolling. The centred pill is
 * opaque from the first frame: it is revealed by a top-down clip on `spring.sheet`, the same spring and start frame
 * as the form's push, so the revealed part is always above the moving content; the exit closes the clip
 * (`tween.exit`) before the slot is removed. Stays through `Speichert …` / `Gespeichert` when the save started here –
 * its leading text crossfades to that phase (`tween.crossfade`; the labels share one grid cell) and `Verwerfen`
 * fades out once saved. Below `sm` the label is `Ungespeichert`. `Verwerfen` must be held (it drops every edit).
 * No live region: the dot and the field marks carry the state, the save result is announced by the toast.
 */
function UnsavedBar({
  open,
  phase,
  buttonPhase,
  onSave,
  onDiscard,
  onExited,
}: {
  open: boolean;
  phase: ActionPhase;
  buttonPhase: ActionPhase;
  onSave: () => void;
  onDiscard: () => void;
  onExited: () => void;
}) {
  const reduced = useReducedFx();
  const fade = reduced ? { duration: 0 } : tween.crossfade;
  const saved = phase === "done";
  const reveal = useMotionValue(reduced ? 1 : 0);
  const clipPath = useTransform(reveal, (v) => (v >= 1 ? "none" : `inset(0% 0% ${((1 - v) * 100).toFixed(2)}% 0% round 999px)`));
  const exited = useRef(onExited);
  useLayoutEffect(() => {
    exited.current = onExited;
  }, [onExited]);

  useLayoutEffect(() => {
    if (reduced) {
      reveal.jump(open ? 1 : 0);
      if (!open) exited.current();
      return;
    }
    const controls = animate(reveal, open ? 1 : 0, open ? spring.sheet : { ...tween.exit, onComplete: () => exited.current() });
    return () => controls.stop();
  }, [open, reduced, reveal]);

  return (
    <div className="sticky z-[41] flex justify-center" style={{ top: BAR_TOP }} data-unsaved-bar="">
      <motion.div
        className={cn(
          "flex min-w-0 max-w-full items-center gap-2 rounded-full border border-line-2 bg-ink-850 py-1.5 pl-3 pr-1.5 shadow-[0_18px_48px_rgb(0_0_0/0.55)] sm:gap-3 sm:pl-4",
          !open && "pointer-events-none",
        )}
        style={{ clipPath }}
        inert={!open || undefined}
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
    </div>
  );
}
