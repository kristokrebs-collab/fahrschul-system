import { AnimatePresence, motion, useMotionValueEvent, type Variants } from "motion/react";
import { ED } from "@/domain/edition";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { deriveTrade, leverageOverRule } from "@/domain/derive";
import { EXCURSION_KEYS, excursionStale } from "@/domain/excursion";
import { checklistItemsFor, pruneChecks } from "@/domain/enrich";
import { DEFAULT_MISTAKES, EMOTIONS, LEVERAGE_HELP, LEVERAGE_WARNING, MTF_SETUP_ID, TIMEFRAMES } from "@/domain/defaults";
import { parseSignalSnapshot } from "@/domain/signals";
import type { AccountId, Conviction, ScreenshotRef, Settings, Setup, Side, Trade, TradeStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { nowLocalInput } from "@/lib/dates";
import { n1, n2, price as fmtPrice, signed } from "@/lib/format";
import { parseNumber, sanitizeUrl, toInputString } from "@/lib/parse";
import { priceMv } from "@/market/motionValues";
import { celebrateFrom } from "@/motion/Celebrate";
import { MotionNumber } from "@/motion/MotionNumber";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { MorphSelect, type MorphSelectOption } from "@/motion/pulse/MorphSelect";
import { Button, CheckboxRow, ConvictionRadio, Field, Input, Segmented, Textarea, revealInvalid, shakeField } from "@/primitives";
import { saveTradeNow, useJournal } from "@/store/journalStore";
import { jsonEqual } from "@/store/merge3";
import { pushToast, useUi, type AccFilter, type TradeDraft } from "@/store/uiStore";
import { ExecutionSection } from "@/journal/editor/ExecutionSection";
import { PsychSection } from "@/journal/editor/PsychSection";
import { VoiceNote } from "@/journal/editor/LazyVoiceNote";
import { JOURNAL_MESSAGES, dropEmptyJournalKeys, fillFix, journalDefaults, journalFromTrade, journalKey, journalRecord, journalReset, openRemainderMessage, statusAfterFills, validateJournal, type JournalForm } from "@/journal/editor/form";
import { ShotsField } from "@/journal/screenshots/ShotsField";
import { RatingDots } from "@/journal/ui/RatingDots";
import { TagInput, tagSuggestions } from "@/journal/ui/TagInput";
import { winCelebration } from "./celebration";
import { FAB_LABEL } from "@/app/navGroups";
import { HoldConfirm, confirmSwapMotion, useConfirmFocus } from "@/motion/HoldConfirm";
import { AutoHeight } from "@/views/trades/AutoHeight";
import { DETAIL_DIM_HANDOFF } from "./TradeDetail";
import { SAVE_CHECK_TIMEOUT_MS, SIGNAL_SECTION_TITLE, SignalSection, resolveTradeSignal, signalSectionSub, type MtfAuto } from "./SignalSection";
import { boxSnapOf, resolveTradeBoxes, type BoxSnapshot } from "@/market/boxes/snapshot";
import { deleteTradeWithShots, releaseCloudShots, removedCloudPaths } from "@/journal/screenshots/release";
import { normalizeWatchSymbol } from "@/domain/boxes/config";
import { useEntitlement } from "@/billing/entitlements";
import { carryOver, carrySentence, lastTrade } from "./duplicateTrade";
import { useKeyboardInset } from "./keyboardInset";
import { BlockHead, CUSTOMIZE_COPY, CoreSection, FieldCustomizer, FormGroup, FormToolbar, ZoneGrid } from "./TradeFormParts";
import { GROUPS, fieldDef, fieldsIn, filledByZone, filledFields, groupHint, groupOf, isDefaultLayout, moveField, readLayout, defaultLayout, writeLayout, type FieldId, type FormLayout, type GroupId, type ZoneId } from "./tradeFormLayout";

/** Phone footer of a new trade: the `size="sm"` metrics (12 px, tighter padding) so three buttons share one row. */
const FOOT_SM = "max-sm:px-2.5 max-sm:text-xs";

/** P05 risk preview (limits, liquidation, risk %) – a lazy chunk of the editor (P14 slot). */
const RiskPreviewSlot = lazy(() => import("./slots/RiskPreviewSlot"));
/** P07 strategy suggestion for a trade without a setup – a lazy chunk of the editor (P14 slot). */
const ClassifyChipSlot = lazy(() => import("./slots/ClassifyChipSlot"));

/**
 * P02 box context of the entry for `trade.boxSnap` (P14 save path): resolved next to the entry check and never waited
 * for longer than it (`SAVE_CHECK_TIMEOUT_MS`); `null` = no data (offline, too little history) – and for a pair other
 * than the live market's: the editor never judges an ETH trade by BTC's box (review MM-6); the idle backfill
 * (`BoxSnapBackfillHost`) resolves those from the pair's own klines later.
 */
export function boxSnapAt(date: string, side: Side, pair: string, timeoutMs = SAVE_CHECK_TIMEOUT_MS): Promise<BoxSnapshot | null> {
  const symbol = normalizeWatchSymbol(pair);
  if (!symbol) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    resolveTradeBoxes(date, side, { symbol })
      .then((snap) => resolve(snap), () => resolve(null))
      .finally(() => clearTimeout(timer));
  });
}

/* ------------------------------------------------------------------ types */

/** Text inputs of the form (bundle `u`), edited as comma strings and parsed with `parseNumber` on save. */
export interface TradeFormStrings {
  date: string;
  pair: string;
  timeframe: string;
  entry: string;
  stop: string;
  target: string;
  exit: string;
  size: string;
  leverage: string;
  fees: string;
  pnlManual: string;
  reason: string;
  notes: string;
  chart: string;
}

/** Typed inputs of the form (bundle `f`). */
export interface TradeFormTyped {
  account: AccountId;
  side: Side;
  status: TradeStatus;
  setups: string[];
  checks: Record<string, boolean>;
  conviction: Conviction | null;
  followedPlan: boolean | null;
  emotion: string;
  /** Mistake tags (`trade.mistakes`, other journal version): chips from `settings.mistakes` plus own tags. */
  mistakes: string[];
  /** Journal v3 (P06): execution, tags & rating, psyche, screenshots – see `@/journal/editor/form`. */
  j: JournalForm;
}

export type TradeRecord = Omit<Trade, "id"> & { id?: string };

export interface TradeEditorProps {
  /**
   * Last price of the market card (never the mark price). When given, `Live-Preis übernehmen` renders next to
   * `Einstieg` and `Ausstieg`; without it the button is not rendered (no disabled ghost). Wired by the integrator.
   */
  livePrice?: number | null;
  /** Button label; the Bybit fallback passes `Live-Preis (Bybit) übernehmen`. */
  livePriceLabel?: string;
  /** `+ Neue Grundlage` (default: `useUi().openSetupEditor({ fromTrade: true })`). */
  onNewSetup?: () => void;
}

export const LIVE_PRICE_LABEL = "Live-Preis übernehmen";
/** How long the `✓ {price}` confirmation stays in the live-price button. */
export const LIVE_PRICE_CONFIRM_MS = 800;

export const EDITOR_MESSAGES = {
  date: "Bitte Datum angeben.",
  entry: "Bitte einen Einstiegspreis angeben.",
  exit: "Bitte Ausstieg angeben oder P&L manuell eintragen.",
  size: "Bitte Positionsgröße angeben oder P&L manuell eintragen.",
  chart: "Der Chart-Link muss mit https:// beginnen.",
  saveFailed: "Speichern fehlgeschlagen. Prüfe die Verbindung und versuch es erneut.",
  deleteFailed: "Löschen fehlgeschlagen.",
} as const;

/**
 * A save that has not finished after this long shows its busy state ("Speichert …", disabled, aria-busy); a local save
 * finishes within the same task and never flips the editor to busy and back.
 */
export const SAVE_BUSY_DELAY_MS = 160;

/** Unsaved-input guard (Escape, backdrop, close button, swipe, `Abbrechen` on a changed form). */
export const DISCARD_COPY = { ask: "Änderungen verwerfen?", discard: "Verwerfen", keep: "Weiter bearbeiten" } as const;
/** `Fehler` section (other journal version, verbatim sub). */
export const MISTAKES_COPY = { title: "Fehler", sub: "Was lief schief? Kostet dich messbar Geld", add: "+ Eigener Fehler", placeholder: "Eigener Fehler", group: "Fehler-Tags" } as const;

/* --------------------------------------------------------------- defaults */

/** Bundle `Mhe`: defaults for a new trade (`leverage 4` on scalp, `date = now`, `pair = settings.pair`). */
export function defaultForm(settings: Pick<Settings, "pair">, account: AccountId): { d: TradeFormStrings; t: TradeFormTyped } {
  return {
    d: {
      date: nowLocalInput(),
      pair: settings.pair,
      timeframe: "",
      entry: "",
      stop: "",
      target: "",
      exit: "",
      size: "",
      leverage: account === "scalp" ? "4" : "",
      fees: "",
      pnlManual: "",
      reason: "",
      notes: "",
      chart: "",
    },
    t: { account, side: "long", status: "closed", setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", mistakes: [], j: journalDefaults() },
  };
}

/** Form state of an existing trade (bundle `X$` effect). */
export function formFromTrade(t: Trade): { d: TradeFormStrings; t: TradeFormTyped } {
  return {
    d: {
      date: (t.date || "").slice(0, 16),
      pair: t.pair || "",
      timeframe: t.timeframe || "",
      entry: toInputString(t.entry),
      stop: toInputString(t.stop),
      target: toInputString(t.target),
      exit: toInputString(t.exit),
      size: toInputString(t.size),
      leverage: toInputString(t.leverage),
      fees: toInputString(t.fees),
      pnlManual: toInputString(t.pnlManual),
      reason: t.reason || "",
      notes: t.notes || "",
      chart: t.chart || "",
    },
    t: {
      account: t.account || "scalp",
      side: t.side,
      status: t.status,
      setups: [...(t.setups || [])],
      checks: { ...(t.checks || {}) },
      conviction: t.conviction ?? null,
      followedPlan: t.followedPlan ?? null,
      emotion: t.emotion || "",
      mistakes: [...(t.mistakes ?? [])],
      j: journalFromTrade(t),
    },
  };
}

/** Keys the form edits (everything else of a draft is saved with the new trade as given). */
const FORM_KEYS = new Set<string>([
  "id",
  "account",
  "side",
  "status",
  "date",
  "pair",
  "timeframe",
  "entry",
  "stop",
  "target",
  "exit",
  "size",
  "leverage",
  "fees",
  "pnlManual",
  "setups",
  "checks",
  "conviction",
  "followedPlan",
  "emotion",
  "reason",
  "notes",
  "chart",
  "pnl",
  "r",
  "createdAt",
  "updatedAt",
  "mistakes",
  "exitDate",
  "qty",
  "fills",
  "fundingFees",
  "slippage",
  "plannedEntry",
  "margin",
  "marginMode",
  "liqPrice",
  "market",
  "exchange",
  "exchangeAccount",
  "targets",
  "stopHistory",
  "tags",
  "rating",
  "psych",
  "screenshots",
  "origin",
]);

/**
 * Journal v3 (P06): form state of a pre-filled NEW trade (`openEditor({ draft })` from the risk calculator, a box setup or
 * an exchange position): the defaults with every given field applied.
 */
export function formFromDraft(settings: Pick<Settings, "pair">, account: AccountId, draft: TradeDraft): { d: TradeFormStrings; t: TradeFormTyped } {
  const base = defaultForm(settings, draft.account ?? account);
  const d = { ...base.d };
  if (draft.date) d.date = draft.date.slice(0, 16);
  if (draft.pair) d.pair = draft.pair;
  if (draft.timeframe) d.timeframe = draft.timeframe;
  for (const k of ["entry", "stop", "target", "exit", "size", "leverage", "fees", "pnlManual"] as const) if (draft[k] != null) d[k] = toInputString(draft[k]);
  for (const k of ["reason", "notes", "chart"] as const) {
    const v = draft[k];
    if (typeof v === "string") d[k] = v;
  }
  const t: TradeFormTyped = {
    ...base.t,
    side: draft.side ?? base.t.side,
    status: draft.status ?? base.t.status,
    setups: [...(draft.setups ?? [])],
    checks: { ...(draft.checks ?? {}) },
    conviction: draft.conviction ?? null,
    followedPlan: draft.followedPlan ?? null,
    emotion: draft.emotion ?? "",
    mistakes: [...(draft.mistakes ?? [])],
    j: journalFromTrade(draft),
  };
  return { d, t };
}

/** The keys of a draft the form does not edit (`signal`, `boxSnap`, `externalId`, …): saved verbatim (`origin` goes through the form's „Herkunft“, F14). */
export function draftExtras(draft: TradeDraft | undefined): Partial<Trade> {
  if (!draft) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) if (!FORM_KEYS.has(k) && v !== undefined) out[k] = v;
  return out as Partial<Trade>;
}

/** `Speichern & neu` reset (Plan 6.5): keeps date (renewed), pair, account, side, leverage, timeframe. */
export function resetForNext(d: TradeFormStrings, t: TradeFormTyped): { d: TradeFormStrings; t: TradeFormTyped } {
  return {
    d: { ...d, date: nowLocalInput(), entry: "", stop: "", target: "", exit: "", size: "", fees: "", pnlManual: "", reason: "", notes: "", chart: "" },
    t: { ...t, status: "closed", setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", mistakes: [], j: journalReset(t.j ?? journalDefaults()) },
  };
}

/**
 * The optional fields that carry the trader's own value (feeds the `n ausgefüllt` badges and decides which groups a
 * draft opens). A NEW trade's default leverage (`4` on scalp) is not the trader's value; a stored trade's leverage is.
 */
export function filledOf(d: TradeFormStrings, t: TradeFormTyped, settings: Pick<Settings, "pair">, isNew: boolean): FieldId[] {
  const levDefault = isNew ? defaultForm(settings, t.account).d.leverage : null;
  return filledFields({ d: { ...d, leverage: levDefault != null && d.leverage === levDefault ? "" : d.leverage }, t });
}

/** The groups (not the core) that hold at least one of `filled`. */
export function groupsWithValues(layout: FormLayout, filled: readonly FieldId[]): GroupId[] {
  const out: GroupId[] = [];
  for (const id of filled) {
    const g = groupOf(layout, id);
    if (g && fieldDef(id).optional && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Where a validation message of the v3 part points: the execution block (and its exit-time field where the message is about it). */
export function journalProblemTarget(problem: string): { field: FieldId; dom: string } | null {
  if (problem === JOURNAL_MESSAGES.exitBeforeEntry) return { field: "execution", dom: "f-exit-date" };
  if ((Object.values(JOURNAL_MESSAGES) as string[]).includes(problem) || problem.includes("noch offen –")) return { field: "execution", dom: "fb-execution" };
  return null;
}

/** Comparable form state: unchecked boxes, chip order and whitespace-only differences are not "changes". */
function formKey(d: TradeFormStrings, t: TradeFormTyped) {
  const checks = Object.keys(t.checks)
    .filter((k) => t.checks[k])
    .sort();
  return { d, t: { ...t, checks, setups: [...t.setups].sort(), mistakes: [...t.mistakes].sort(), j: t.j ? journalKey(t.j) : undefined } };
}

/** True when the form differs from the state it was opened (or last reset) with. */
export function isFormDirty(cur: { d: TradeFormStrings; t: TradeFormTyped }, base: { d: TradeFormStrings; t: TradeFormTyped }): boolean {
  return !jsonEqual(formKey(cur.d, cur.t), formKey(base.d, base.t));
}

/**
 * Mistake chips: the settings list first, then own tags used on other trades (so a tag typed once is offered again;
 * a default tag removed from the settings stays removed), then tags only this trade carries – each once.
 */
export function mistakeOptions(settingsTags: readonly string[] | undefined, tradeTags: readonly string[], usedTags: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const m of [...(settingsTags ?? []), ...usedTags, ...tradeTags]) {
    const v = m.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Own (non-default) mistake tags used in the journal, newest trades first, at most `max`. */
export function usedOwnMistakes(trades: readonly Pick<Trade, "mistakes" | "date">[], max = 12): string[] {
  const out: string[] = [];
  const sorted = [...trades].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  for (const t of sorted) {
    for (const m of t.mistakes ?? []) {
      const v = typeof m === "string" ? m.trim() : "";
      if (v && !DEFAULT_MISTAKES.includes(v) && !out.includes(v)) out.push(v);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * `s_mtf` auto-ticks applied over the form's own checks (other journal: only while `s_mtf` is selected, a snapshot
 * exists and the user has not touched an `s_mtf:*` item; existing trades start "manual").
 */
export function withMtfAuto(checks: Record<string, boolean>, auto: MtfAuto | null, apply: boolean): Record<string, boolean> {
  if (!apply || !auto) return checks;
  const out = { ...checks };
  for (const [k, v] of Object.entries(auto)) out[`${MTF_SETUP_ID}:${k}`] = v;
  return out;
}

/**
 * Bundle `S`: the typed record the form would save (before pnl/r/timestamps). Journal v3: the v3 keys follow
 * (`journalRecord`, empty → `undefined`), and with fills the bundle fields `Einstieg` / `Größe` (and `Ausstieg` once the
 * position is flat) come from the fills (Ø entry, notional, Ø exit) – what every older reader of the trade shows.
 */
export function toRecord(d: TradeFormStrings, t: TradeFormTyped): Omit<Trade, "id" | "pnl" | "r" | "createdAt" | "updatedAt"> {
  const { j, ...typed } = t;
  const base = toBundleRecord(d, typed);
  if (!j) return base;
  const fix = fillFix(j.fills, t.side);
  const v3 = journalRecord(j, { status: t.status, side: t.side });
  return {
    ...base,
    ...v3,
    // 12 significant digits: an average of fills never stores binary noise (83 799,99999999999)
    ...(fix ? { entry: sig12(fix.entry), size: sig12(fix.size), exit: t.status === "open" ? null : fix.exit != null ? sig12(fix.exit) : base.exit } : null),
  };
}

const sig12 = (v: number): number => Number(v.toPrecision(12));

function toBundleRecord(d: TradeFormStrings, t: Omit<TradeFormTyped, "j">): Omit<Trade, "id" | "pnl" | "r" | "createdAt" | "updatedAt"> {
  return {
    ...t,
    date: d.date,
    pair: d.pair,
    timeframe: d.timeframe,
    entry: parseNumber(d.entry),
    stop: parseNumber(d.stop),
    target: parseNumber(d.target),
    exit: t.status === "open" ? null : parseNumber(d.exit),
    size: parseNumber(d.size),
    leverage: parseNumber(d.leverage),
    fees: parseNumber(d.fees),
    pnlManual: parseNumber(d.pnlManual),
    reason: (d.reason || "").trim(),
    notes: (d.notes || "").trim(),
    chart: sanitizeUrl(d.chart || ""),
  };
}

/**
 * Bundle validation order; `null` when valid. Journal v3: a closed trade may give its size as `Menge` (qty) instead of
 * `Größe`; with the form's `j` the v3 checks follow (exit time before the entry, incomplete fills / ladder rungs / stop
 * moves, more closed than opened, ladder over 100 %).
 */
export function validateRecord(rec: ReturnType<typeof toRecord>, rawChart: string, j?: JournalForm): string | null {
  if (!rec.date) return EDITOR_MESSAGES.date;
  if (!(rec.entry != null && rec.entry > 0)) return EDITOR_MESSAGES.entry;
  if (rec.status !== "open" && rec.pnlManual == null) {
    if (!(rec.exit != null && rec.exit > 0)) {
      // fills with an open remainder: say what is open and how to go on (review F4)
      const fix = j ? fillFix(j.fills, rec.side) : null;
      return fix && fix.exit == null && fix.remaining > 0 ? openRemainderMessage(fix.remaining) : EDITOR_MESSAGES.exit;
    }
    if (!(rec.size != null && rec.size > 0) && !(rec.qty != null && rec.qty > 0)) return EDITOR_MESSAGES.size;
  }
  if (rawChart.trim() && !rec.chart) return EDITOR_MESSAGES.chart;
  return j ? validateJournal(j, { date: rec.date, status: rec.status, side: rec.side }) : null;
}

/**
 * The price `Live-Preis übernehmen` applies: the freshest trade (`priceMv`, full precision, every print); the host's
 * `livePrice` prop (re-read once a second, rounded) is only the fallback while no trade has arrived yet.
 */
export function freshLivePrice(fallback: number): number {
  const p = priceMv.get();
  return p > 0 && Number.isFinite(p) ? p : fallback;
}

/** `nt(Number(price.toFixed(price < 10 ? 4 : 1)))` → comma string for the input (Plan 6.5). */
export function livePriceInput(price: number): string {
  return toInputString(Number(price.toFixed(price < 10 ? 4 : 1)));
}

/** Fields that a validation message points at (shake, scroll into view, `aria-invalid`). */
export type InvalidField = "date" | "entry" | "exit" | "size" | "chart";

/** The form field behind a `validateRecord` message, `null` for messages that are not about one field. */
export function invalidFieldOf(problem: string): InvalidField | null {
  switch (problem) {
    case EDITOR_MESSAGES.date:
      return "date";
    case EDITOR_MESSAGES.entry:
      return "entry";
    case EDITOR_MESSAGES.exit:
      return "exit";
    case EDITOR_MESSAGES.size:
      return "size";
    case EDITOR_MESSAGES.chart:
      return "chart";
    default:
      return null;
  }
}

/** `Timeframe` options of the morph select (`–` = none); a stored value outside the list is offered too (never shown as "–"). */
const TIMEFRAME_OPTIONS: readonly MorphSelectOption[] = [{ value: "", label: "–" }, ...TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))];
export function timeframeOptions(current: string): readonly MorphSelectOption[] {
  return current && !TIMEFRAME_OPTIONS.some((o) => o.value === current) ? [...TIMEFRAME_OPTIONS, { value: current, label: current }] : TIMEFRAME_OPTIONS;
}

/** Detail → editor hand-off: the sheet's dim starts at the detail's level, the panel enters after the detail's exit. */
const DETAIL_HANDOFF = { backdropFrom: DETAIL_DIM_HANDOFF, enterDelay: tween.exit.duration };

/** Id of the footer alert; an invalid control points at it via `aria-describedby`. */
const ERROR_ID = "trade-form-error";

function defaultAccount(acc: AccFilter): AccountId {
  return acc === "makro" ? "makro" : "scalp";
}

/* --------------------------------------------------------------- component */

/**
 * Trade editor sheet (bundle `X$`/`Y$`, Plan 6.5): `Sheet size="lg"` (`layoutId="new-trade-{fabCycle}"` when opened from
 * the FAB – one-way: the exiting sheet keeps its id while the disc remounts under the next cycle's id),
 * `form#trade-form noValidate`, six sections with the verbatim labels, live derived strip (`deriveTrade`), validation,
 * `Speichern | Speichern & neu | Abbrechen`, inline delete confirmation, toasts. State comes from `uiStore.editor`
 * and `useJournal()`.
 *
 * Motion: the sections cascade in after the sheet body mounts (`StaggerItem`, `stagger.sections`); a validation
 * error shakes the footer alert and brings the offending field into view, then shakes and pulses it; the live strip
 * flashes win/loss on every change; emotion chips share one sliding thumb; saving a realised win bursts confetti
 * from the pressed button (bigger for a new equity high, a ≥ 2 R win or a third win in a row).
 */
export function TradeEditor({ livePrice, livePriceLabel = LIVE_PRICE_LABEL, onNewSetup }: TradeEditorProps) {
  const editor = useUi((s) => s.editor);
  const fabCycle = useUi((s) => s.fabCycle);
  const acc = useUi((s) => s.acc);
  const closeEditor = useUi((s) => s.closeEditor);
  const openSetupEditor = useUi((s) => s.openSetupEditor);
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  const deleteTrade = useJournal((s) => s.deleteTrade);
  const reduced = useReducedFx();

  const trade = editor.tradeId ? trades.find((t) => t.id === editor.tradeId) : undefined;
  // a pre-filled new trade (`openEditor({ draft })`, Journal v3); its sequence re-initialises an already open editor
  const draft = !editor.tradeId ? editor.draft : undefined;
  const session = editor.open ? `${editor.tradeId ?? ""}|${draft ? (editor.draftSeq ?? 0) : ""}` : null;
  const initialised = useRef<string | null>(null);

  const [d, setD] = useState<TradeFormStrings>(() => defaultForm(settings, defaultAccount(acc)).d);
  const [t, setT] = useState<TradeFormTyped>(() => defaultForm(settings, defaultAccount(acc)).t);
  const [err, setErr] = useState("");
  const [invalid, setInvalid] = useState<InvalidField | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** The form as opened (or last reset by `Speichern & neu`): "dirty" = differs from it. */
  const [baseline, setBaseline] = useState<{ d: TradeFormStrings; t: TradeFormTyped } | null>(null);
  /** `Prüfen` / `Neu prüfen` pressed on an existing trade. */
  const [checkReq, setCheckReq] = useState(false);
  /** The user toggled an `s_mtf:*` item (existing trades start manual): auto-ticks stop. */
  const [manualMtf, setManualMtf] = useState(false);
  const [autoMtf, setAutoMtf] = useState<MtfAuto | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Where the fields are shown (core / accordion group), per device – see `tradeFormLayout.ts`. */
  const [layout, setLayout] = useState<FormLayout>(readLayout);
  const [openGroups, setOpenGroups] = useState<readonly GroupId[]>([]);
  /** `Felder anpassen` is open (the form stays mounted, hidden). */
  const [customizing, setCustomizing] = useState(false);
  /** The sentence under `Letzten Trade duplizieren`, and the one after `Zurücksetzen`. */
  const [dupNote, setDupNote] = useState("");
  const [resetNote, setResetNote] = useState("");
  /** A jump to a field in a closed group: the group opens without animation first, then the field is focused. */
  const [reveal, setReveal] = useState<{ dom: string; nonce: number } | null>(null);
  const [snapGroup, setSnapGroup] = useState<GroupId | null>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLSpanElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  /** A save is running (double-submit guard; the visible busy state follows only after `SAVE_BUSY_DELAY_MS`). */
  const savingRef = useRef(false);
  const { trigger: deleteTrigger, no: deleteNo } = useConfirmFocus(confirmDelete);
  const { trigger: discardTrigger, no: discardNo } = useConfirmFocus(confirmDiscard);

  // Reset once per open session (bundle effect on `[open, trade]`), before paint.
  useLayoutEffect(() => {
    if (session == null) {
      initialised.current = null;
      return;
    }
    if (initialised.current === session) return;
    initialised.current = session;
    setErr("");
    setInvalid(null);
    setSaving(false);
    setConfirmDelete(false);
    setConfirmDiscard(false);
    setCheckReq(false);
    setManualMtf(Boolean(trade));
    setAutoMtf(null);
    const init = trade ? formFromTrade(trade) : draft ? formFromDraft(settings, defaultAccount(acc), draft) : defaultForm(settings, defaultAccount(acc));
    setD(init.d);
    setT(init.t);
    setBaseline(init);
    setCustomizing(false);
    setDupNote("");
    setResetNote("");
    setReveal(null);
    setSnapGroup(null);
    // a pre-filled draft (screenshot import, box setup …) opens the groups that hold its values, so nothing it filled is
    // hidden from the trader's check; a blank form and a stored trade start compact (the badges say what is inside)
    setOpenGroups(draft ? groupsWithValues(layout, filledOf(init.d, init.t, settings, true)) : []);
  }, [session, trade, draft, settings, acc, layout]);

  const rec = useMemo(() => toRecord(d, t), [d, t]);
  const x = useMemo(() => deriveTrade(rec), [rec]);
  const account = t.account;
  const capital = settings.capital[account] || 0;
  const items = useMemo(() => checklistItemsFor(t.setups, settings), [t.setups, settings]);
  // Einstiegs-Check: new trades always, existing ones on request or when date / side moved away from the stored check
  const stored = useMemo(() => (trade ? parseSignalSnapshot(trade.signal) : null), [trade]);
  const timingChanged = stored != null && baseline != null && (d.date !== baseline.d.date || t.side !== baseline.t.side);
  const checking = !trade || checkReq || timingChanged;
  const mtfSetup = settings.setups.find((s) => s.id === MTF_SETUP_ID);
  const autoApplies = Boolean(mtfSetup) && t.setups.includes(MTF_SETUP_ID) && !manualMtf && autoMtf != null;
  const checks = useMemo(() => withMtfAuto(t.checks, autoMtf, autoApplies), [t.checks, autoMtf, autoApplies]);
  const checked = items.filter((it) => checks[it.id]).length;
  const dirty = baseline != null && (checkReq || isFormDirty({ d, t }, baseline));
  const usedTags = useMemo(() => usedOwnMistakes(trades), [trades]);
  const tags = useMemo(() => mistakeOptions(settings.mistakes, t.mistakes, usedTags), [settings.mistakes, t.mistakes, usedTags]);
  const tfOptions = useMemo(() => timeframeOptions(d.timeframe), [d.timeframe]);
  // Journal v3: fills fix Einstieg / Größe (and Ausstieg once flat); journal tags offered as quick picks
  const fix = useMemo(() => fillFix(t.j.fills, t.side), [t.j.fills, t.side]);
  const journalTags = useMemo(() => tagSuggestions(trades), [trades]);
  // Review F4: the status follows the fills while the trader edits them (a partial exit → „Noch offen“, flat again →
  // back to „Geschlossen“ when the fills opened it); a status the trader picks wins. Decided in the event, not in an
  // updater (the flag is a ref), from the form as last rendered.
  const autoOpened = useRef(false);
  const statusCtx = useRef({ side: t.side, status: t.status, exit: d.exit, pnlManual: d.pnlManual });
  useLayoutEffect(() => {
    statusCtx.current = { side: t.side, status: t.status, exit: d.exit, pnlManual: d.pnlManual };
  });
  const patchJ = useCallback((patch: Partial<JournalForm>) => {
    let status: TradeStatus | null = null;
    if (patch.fills) {
      const cur = statusCtx.current;
      const next = statusAfterFills(patch.fills, { ...cur, autoOpened: autoOpened.current });
      autoOpened.current = next.autoOpened;
      if (next.status !== cur.status) status = next.status;
    }
    setT((o) => ({ ...o, ...(status ? { status } : null), j: { ...o.j, ...patch } }));
  }, []);
  const updateShots = useCallback((update: (prev: ScreenshotRef[]) => ScreenshotRef[]) => setT((o) => ({ ...o, j: { ...o.j, screenshots: update(o.j.screenshots) } })), []);
  const leverageOver = leverageOverRule(rec.leverage, account);
  const sortedSetups = useMemo(
    () => [...settings.setups].sort((a, b) => +(b.account === account || b.account === "both") - +(a.account === account || a.account === "both")),
    [settings.setups, account],
  );
  const chipOrder = sortedSetups.map((s) => s.id).join("|");
  const cur = settings.currency;
  const isOpen = t.status === "open";
  const hasLive = livePrice != null && Number.isFinite(livePrice);
  const riskLive = useEntitlement("riskLive");
  const v3 = rec as Partial<Trade>;

  const setStr = (k: keyof TradeFormStrings) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setD((o) => ({ ...o, [k]: v }));
    if (k === invalid) setInvalid(null);
  };
  const patchT = useCallback((patch: Partial<TradeFormTyped>) => setT((o) => ({ ...o, ...patch })), []);

  // ---- short form: layout, groups, duplicate (Etappe 1b)
  useKeyboardInset(editor.open);
  const filled = useMemo(() => filledOf(d, t, settings, !trade), [d, t, settings, trade]);
  const filledPer = useMemo(() => filledByZone(layout, filled), [layout, filled]);
  const last = useMemo(() => lastTrade(trades), [trades]);
  const changeLayout = useCallback((next: FormLayout) => {
    setLayout(next);
    writeLayout(next);
    setResetNote("");
  }, []);
  const toggleGroup = (g: GroupId) => setOpenGroups((o) => (o.includes(g) ? o.filter((x) => x !== g) : [...o, g]));
  /** Brings a field into view: leaves the customiser, opens its group (without animation) and focuses the control. */
  const jumpTo = useCallback(
    (field: FieldId, dom: string) => {
      const g = groupOf(layout, field);
      if (!customizing && (g == null || openGroups.includes(g))) {
        // already on screen (core or an open group): focus it right away, exactly as the flat form did
        revealInvalid(dom, { reduced });
        return;
      }
      setCustomizing(false);
      if (g && !openGroups.includes(g)) {
        setOpenGroups((o) => (o.includes(g) ? o : [...o, g]));
        setSnapGroup(g);
      }
      setReveal((r) => ({ dom, nonce: (r?.nonce ?? 0) + 1 }));
    },
    [layout, openGroups, customizing, reduced],
  );
  useEffect(() => {
    if (!reveal) return;
    // two frames: the group is open at its final height before the field is measured and scrolled to
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        revealInvalid(reveal.dom, { reduced });
        setSnapGroup(null);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reveal, reduced]);
  /** `Letzten Trade duplizieren`: the setting of the last trade into the open form; says what was taken over. */
  const duplicateLast = () => {
    if (!last) return;
    const c = carryOver(last, settings.setups, settings.currency);
    const p = c.draft;
    setD((o) => ({
      ...o,
      pair: p.pair ?? o.pair,
      timeframe: p.timeframe ?? o.timeframe,
      size: p.size != null ? toInputString(p.size) : o.size,
      leverage: p.leverage != null ? toInputString(p.leverage) : o.leverage,
    }));
    setT((o) => ({ ...o, account: p.account ?? o.account, side: p.side ?? o.side, setups: p.setups ? [...p.setups] : o.setups, j: { ...o.j, tags: p.tags ? [...p.tags] : o.j.tags } }));
    setDupNote(carrySentence(c));
  };
  const toggleCheck = (id: string) => {
    if (id.startsWith(`${MTF_SETUP_ID}:`)) {
      // from here on the user owns the s_mtf items: the current (auto) state becomes the manual one
      setManualMtf(true);
      patchT({ checks: { ...checks, [id]: !checks[id] } });
    } else patchT({ checks: { ...t.checks, [id]: !t.checks[id] } });
  };
  const recheck = () => {
    setCheckReq(true);
    setManualMtf(false);
  };
  const onAuto = useCallback((auto: MtfAuto | null) => setAutoMtf(auto), []);
  /** Implicit and explicit closes of a changed form ask first ("alle eingetragenen Werte bleiben"). */
  const cancel = () => (dirty ? setConfirmDiscard(true) : closeEditor());

  /**
   * The form as last committed. A save that waits for the Einstiegs-Check (a back-dated trade: the history check, up to
   * `SAVE_CHECK_TIMEOUT_MS`) reads it again before it writes, so input typed meanwhile is saved – never dropped with
   * the closing sheet.
   */
  const latestRef = useRef({ rec, d, t, checks, items, x, checking });
  useLayoutEffect(() => {
    latestRef.current = { rec, d, t, checks, items, x, checking };
  });

  const save = useCallback(
    async (mode: "close" | "again") => {
      if (savingRef.current) return;
      const reject = (problem: string): void => {
        const field = invalidFieldOf(problem);
        setErr(problem);
        setInvalid(field);
        shakeField(alertRef.current, { reduced, self: true });
        // the field may sit in a closed group: open it, then focus the control (no page jump – only the sheet body scrolls)
        const target = field ? { field: field as FieldId, dom: `f-${field}` } : journalProblemTarget(problem);
        if (target) jumpTo(target.field, target.dom);
      };
      const problem = validateRecord(rec, d.chart, t.j);
      if (problem) {
        reject(problem);
        return;
      }
      setErr("");
      setInvalid(null);
      // One commit per save (perf-120 C): the button turns "Speichert …" (disabled, aria-busy) only for a save that
      // takes a while (a history check, a remote store); a local save completes within the same task, and flipping the
      // whole editor to busy and back cost two extra synchronous commits. `savingRef` blocks a second submit meanwhile.
      savingRef.current = true;
      let busyShown = false;
      const busy = setTimeout(() => {
        busyShown = true;
        setSaving(true);
      }, SAVE_BUSY_DELAY_MS);
      try {
        // the check at save time: live within 5 min of now, else the (memoised) history check; none → keep the stored one
        let at = { date: d.date, side: t.side };
        // P02 box context, in parallel with the entry check (a draft that brought its own – the box card's setup – keeps it)
        const ownBoxes = !trade && draft?.boxSnap != null;
        const boxesFor = (a: { date: string; side: Side }): Promise<BoxSnapshot | null> | null =>
          checking && !ownBoxes ? boxSnapAt(a.date, a.side, latestRef.current.d.pair) : null;
        let boxes = boxesFor(at);
        let signal = checking ? await resolveTradeSignal(at.date, at.side) : undefined;
        // input typed while the check loaded is written with the trade: the form as it stands now (a date / side moved
        // meanwhile is checked again), validated again – an invalid edit keeps the sheet open with its message
        let cur = latestRef.current;
        for (let i = 0; i < 3 && cur.checking && (cur.d.date !== at.date || cur.t.side !== at.side); i++) {
          at = { date: cur.d.date, side: cur.t.side };
          boxes = boxesFor(at);
          signal = await resolveTradeSignal(at.date, at.side);
          cur = latestRef.current;
        }
        if (cur.rec !== rec) {
          const late = validateRecord(cur.rec, cur.d.chart, cur.t.j);
          if (late) {
            reject(late);
            return;
          }
        }
        const boxSnap = boxes ? await boxes : undefined;
        const now = new Date().toISOString();
        // Spread the stored trade first so passthrough/unknown fields (legacy extras, `signal`, `mistakes`) survive an edit.
        const record: TradeRecord = {
          ...(trade ?? draftExtras(draft)),
          ...cur.rec,
          checks: pruneChecks(cur.checks, cur.items),
          ...(signal ? { signal } : null),
          ...(boxSnap ? { boxSnap } : null),
          pnl: cur.x.pnl,
          r: cur.x.r,
          updatedAt: now,
          createdAt: trade?.createdAt || now,
        };
        if (trade?.id) record.id = trade.id;
        else delete record.id;
        // a re-checked entry without box data drops the old context (it belonged to another time / side), and so does
        // a context of another pair (the pair was edited, or an older save took the live market's symbol – MM-6)
        if (boxSnap === null || (record.boxSnap != null && !boxSnapOf(record))) delete (record as Partial<Trade>).boxSnap;
        // Journal v3: an empty v3 field writes no key (an untouched legacy trade gains nothing, a cleared one loses it)
        dropEmptyJournalKeys(record);
        // stored MAE / MFE were measured from the old entry / exit / stop: drop them, the backfill measures again
        if (trade && excursionStale(trade, record)) for (const k of EXCURSION_KEYS) delete (record as Record<string, unknown>)[k];
        // `trades` is still the journal before this save – exactly what the equity-high check compares against
        const burst = winCelebration(trades, record, trade);
        // Local storage persists and publishes synchronously: the toast and the close (or the reset for the next trade)
        // follow in the same tick, so React commits the new journal, the close and the toast together. A remote store
        // is awaited first; nothing closes before the write is known to have happened (zero data loss).
        const { persisted, done } = saveTradeNow(record);
        if (!persisted) await done;
        // pictures removed from the trade leave the cloud with this save (PRIV-01)
        if (trade) void releaseCloudShots(removedCloudPaths(trade, record));
        pushToast({
          kind: "success",
          title: trade ? "Trade aktualisiert" : "Trade gespeichert",
          value: cur.x.pnl == null ? "offen" : signed(cur.x.pnl),
          valueTone: cur.x.pnl == null ? undefined : cur.x.pnl < 0 ? "loss" : "win",
        });
        if (burst) {
          if (mode === "close") {
            // one moment, not two: the sheet exits first (`tween.exit`), then the burst rises from the hero Netto-P&L
            // that is about to roll (or the FAB the editor morphs back into) – never from the vanished Save button
            const save = saveRef.current;
            setTimeout(() => {
              const hero = document.querySelector('[data-celebrate-anchor="hero-net"]');
              const fab = document.querySelector(`[aria-label="${FAB_LABEL}"]`);
              celebrateFrom([hero, fab, save], { kind: burst, tone: "win", squash: false });
            }, tween.exit.duration * 1000);
          } else celebrateFrom(againRef.current, { kind: burst, tone: "win" });
        }
        if (mode === "close") {
          closeEditor();
        } else {
          const next = resetForNext(cur.d, cur.t);
          setD(next.d);
          setT(next.t);
          setBaseline(next);
          setManualMtf(false);
          const scroller = formRef.current?.closest<HTMLElement>(".overflow-y-auto");
          if (scroller && typeof scroller.scrollTo === "function") scroller.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
          entryRef.current?.focus({ preventScroll: true });
        }
      } catch {
        setErr(EDITOR_MESSAGES.saveFailed);
        shakeField(alertRef.current, { reduced, self: true });
        pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
      } finally {
        clearTimeout(busy);
        savingRef.current = false;
        if (busyShown) setSaving(false);
      }
    },
    [rec, d, t, checking, trade, draft, trades, closeEditor, reduced, jumpTo],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void save("close");
  };

  const onDelete = async () => {
    if (!trade) return;
    try {
      await deleteTradeWithShots(deleteTrade, trade);
      pushToast({ kind: "info", title: "Trade gelöscht" });
      closeEditor();
    } catch {
      setConfirmDelete(false);
      setErr(EDITOR_MESSAGES.deleteFailed);
      shakeField(alertRef.current, { reduced, self: true });
    }
  };

  const applyLive = (k: "entry" | "exit"): number | undefined => {
    if (!hasLive) return undefined;
    const price = freshLivePrice(livePrice);
    setD((o) => ({ ...o, [k]: livePriceInput(price) }));
    if (k === invalid) setInvalid(null);
    return price;
  };

  const footer = (
    <AnimatePresence mode="wait" initial={false}>
      {confirmDiscard ? (
        <motion.div key="discard" role="group" aria-label={DISCARD_COPY.ask} className="flex w-full flex-wrap items-center justify-end gap-2.5" data-testid="discard-confirm" {...confirmSwapMotion(reduced)}>
          <span className="basis-full text-[12.5px] font-medium text-(--color-danger-text) sm:mr-auto sm:basis-auto">{DISCARD_COPY.ask}</span>
          <span className="inline-flex gap-2">
            <Button variant="danger" className="pointer-coarse:min-h-11" onClick={closeEditor}>
              {DISCARD_COPY.discard}
            </Button>
            <Button ref={discardNo} variant="primary" className="pointer-coarse:min-h-11" onClick={() => setConfirmDiscard(false)}>
              {DISCARD_COPY.keep}
            </Button>
          </span>
        </motion.div>
      ) : (
        // a new trade on a phone: ONE row – Abbrechen (small) + the two saves in equal columns, an error above them
        // (P1-12; the 3 buttons wrapped into two rows ≈ 150 px of an 844-px screen). Editing keeps the flex row (it fits).
        <motion.div key="actions" className={cn("flex w-full flex-wrap items-center gap-2.5", !trade && "max-sm:grid max-sm:grid-cols-[auto_1fr_1fr] max-sm:gap-2")} {...confirmSwapMotion(reduced)}>
      {trade && (
        <span className="flex min-h-10 items-center">
          <AnimatePresence mode="wait" initial={false}>
            {confirmDelete ? (
              <motion.span key="confirm" className="flex flex-wrap items-center gap-2 text-[12.5px] text-(--color-danger-text)" {...confirmSwapMotion(reduced)}>
                Wirklich löschen?
                <Button size="sm" variant="danger" className="pointer-coarse:min-h-11" onClick={() => void onDelete()}>
                  Ja, löschen
                </Button>
                <Button ref={deleteNo} size="sm" className="pointer-coarse:min-h-11" onClick={() => setConfirmDelete(false)}>
                  Nein
                </Button>
              </motion.span>
            ) : (
              <motion.span key="ask" className="inline-flex" {...confirmSwapMotion(reduced)}>
                <HoldConfirm ref={deleteTrigger} onAsk={() => setConfirmDelete(true)} onConfirm={() => void onDelete()}>
                  Löschen
                </HoldConfirm>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      )}
      <span className={cn("flex-1", !trade && "max-sm:hidden")} />
      <span ref={alertRef} id={ERROR_ID} role="alert" className={cn("text-[12.5px] font-medium text-(--color-danger-text)", !trade && "max-sm:col-span-full max-sm:empty:-mb-2")}>
        <AnimatePresence mode="wait" initial={false}>
          {err && (
            <motion.span
              key={err}
              className="inline-block"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: reduced ? { duration: 0 } : tween.exit }}
              transition={tween.fade}
            >
              {err}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <Button ref={discardTrigger} className={cn("pointer-coarse:min-h-11", !trade && FOOT_SM)} onClick={cancel}>
        Abbrechen
      </Button>
      <span className={cn("inline-flex gap-1.5", !trade && "max-sm:contents")}>
        {!trade && (
          <Button ref={againRef} disabled={saving} className={cn("pointer-coarse:min-h-11", FOOT_SM)} onClick={() => void save("again")}>
            Speichern & neu
          </Button>
        )}
        <Button ref={saveRef} variant="primary" type="submit" form="trade-form" disabled={saving} aria-busy={saving || undefined} className={cn("min-w-[110px] pointer-coarse:min-h-11", !trade && cn(FOOT_SM, "max-sm:min-w-0"))}>
          <TextRoll mode="roll" text={saving ? "Speichert …" : "Speichern"} />
        </Button>
      </span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const fieldInvalid = (k: InvalidField) => (invalid === k ? { invalid: true, "aria-describedby": ERROR_ID } : {});

  // Journal v3: with fills Einstieg (Ø), Größe (notional) and – once flat – Ausstieg (Ø) come from the fills
  const fromFills = (k: "entry" | "exit" | "size"): string | null => {
    if (!fix) return null;
    const v = k === "entry" ? fix.entry : k === "size" ? fix.size : isOpen ? null : fix.exit;
    return v == null ? null : toInputString(Number(v.toFixed(v < 10 ? 6 : 2)));
  };
  const priceField = (k: "entry" | "stop" | "target" | "exit", label: string) => {
    const live = (k === "entry" || k === "exit") && hasLive;
    const fixed = k === "entry" || k === "exit" ? fromFills(k) : null;
    const disabled = (k === "exit" && isOpen) || fixed != null;
    return (
      <Field key={k} label={label} htmlFor={"f-" + k} help={fixed != null ? "Ø aus den Fills" : undefined}>
        <div className={cn(live && "grid gap-1.5")}>
          <Input
            id={"f-" + k}
            ref={k === "entry" ? entryRef : undefined}
            numeric
            autoComplete="off"
            value={fixed ?? d[k]}
            onChange={setStr(k)}
            disabled={disabled}
            {...(k === "entry" || k === "exit" ? fieldInvalid(k) : {})}
          />
          {live && <LivePriceButton price={livePrice} label={livePriceLabel} disabled={disabled} onApply={() => applyLive(k)} />}
        </div>
      </Field>
    );
  };

  const strip: [string, ReactNode][] = [
    ["P&L", x.pnl == null ? "–" : <MotionNumber value={x.pnl} decimals={2} signed tone="auto" flash suffix={` ${cur}`} aria-label={`${signed(x.pnl)} ${cur}`} />],
    ["R-Multiple", x.r == null ? "–" : <MotionNumber value={x.r} decimals={2} signed tone="auto" flash suffix=" R" />],
    ["Kursbewegung", x.move == null ? "–" : <MotionNumber value={x.move * 100} decimals={1} signed tone="auto" flash suffix=" %" />],
    [
      "Risiko",
      x.risk == null ? (
        "–"
      ) : (
        <>
          <MotionNumber value={x.risk} decimals={0} flash /> <span className="text-xs text-mute">{capital ? `(${n1((x.risk / capital) * 100)} %)` : ""}</span>
        </>
      ),
    ],
    ["Geplantes CRV", x.rr == null ? "–" : `1 : ${n2(x.rr)}`],
  ];

  // ---- every movable unit of the form as a node; WHERE it is shown is decided by `layout` (core / accordion group)
  const blocks: Record<FieldId, ReactNode> = {
    pair: (
      <Field label="Paar" htmlFor="f-pair">
        <Input id="f-pair" value={d.pair} onChange={setStr("pair")} autoComplete="off" />
      </Field>
    ),
    side: (
      <Field label="Richtung">
        <Segmented<Side>
          aria-label="Richtung"
          value={t.side}
          onChange={(side) => patchT({ side })}
          tones={{ long: "!border-win/40 !bg-win/15", short: "!border-loss/40 !bg-loss/15" }}
          options={[
            { v: "long", label: "▲ Long" },
            { v: "short", label: "▼ Short" },
          ]}
        />
      </Field>
    ),
    date: (
      <Field label="Datum & Uhrzeit" htmlFor="f-date">
        <Input id="f-date" type="datetime-local" value={d.date} onChange={setStr("date")} {...fieldInvalid("date")} />
      </Field>
    ),
    account: (
      <Field label="Konto">
        <Segmented<AccountId>
          aria-label="Konto"
          value={account}
          onChange={(account) => patchT({ account })}
          options={[
            { v: "makro", label: "Makro" },
            { v: "scalp", label: "Scalp" },
          ]}
        />
      </Field>
    ),
    timeframe: (
      <Field label="Timeframe" htmlFor="f-tf">
        <MorphSelect id="f-tf" value={d.timeframe} options={tfOptions} onChange={(timeframe) => setD((o) => ({ ...o, timeframe }))} />
      </Field>
    ),
    status: (
      <Field label="Status">
        <Segmented<TradeStatus>
          aria-label="Status"
          value={t.status}
          onChange={(status) => {
            autoOpened.current = false; // the trader's own choice wins over the fills (F4)
            patchT({ status });
          }}
          options={[
            { v: "closed", label: "Geschlossen" },
            { v: "open", label: "Noch offen" },
          ]}
        />
      </Field>
    ),
    entry: priceField("entry", "Einstieg"),
    stop: priceField("stop", "Stop-Loss"),
    target: priceField("target", "Take-Profit"),
    exit: priceField("exit", "Ausstieg"),
    size: (
      <Field label={`Größe (${cur})`} htmlFor="f-size" help={fix ? "Aus den Fills" : "Positionswert inkl. Hebel"}>
        <Input id="f-size" numeric autoComplete="off" value={fromFills("size") ?? d.size} onChange={setStr("size")} disabled={fix != null} {...fieldInvalid("size")} />
      </Field>
    ),
    leverage: (
      <Field label="Hebel" htmlFor="f-lev" suffix="x" help={leverageOver ? <span className="font-medium text-warn">{LEVERAGE_WARNING[account]}</span> : LEVERAGE_HELP[account]}>
        <Input id="f-lev" numeric autoComplete="off" value={d.leverage} onChange={setStr("leverage")} placeholder="z. B. 4" className={cn(leverageOver && "border-warn/60")} />
      </Field>
    ),
    fees: (
      <Field label={`Gebühren (${cur})`} htmlFor="f-fees">
        <Input id="f-fees" numeric autoComplete="off" value={d.fees} onChange={setStr("fees")} placeholder="0" />
      </Field>
    ),
    pnlManual: (
      <Field label="P&L manuell" htmlFor="f-pnl" help="Leer = wird berechnet" suffix={cur}>
        <Input id="f-pnl" numeric autoComplete="off" value={d.pnlManual} onChange={setStr("pnlManual")} placeholder="automatisch" />
      </Field>
    ),
    signal: (
      <div>
        <BlockHead title={SIGNAL_SECTION_TITLE} sub={signalSectionSub({ checking, stored })} />
        <SignalSection date={d.date} side={t.side} checking={checking} stored={stored} changed={timingChanged && !checkReq} onCheck={recheck} onAuto={onAuto} />
      </div>
    ),
    execution: (
      <div id="fb-execution" tabIndex={-1} className="outline-none">
        <BlockHead title="Ausführung" sub="Fills, Teil-Exits, Funding, Margin – alles optional" />
        <ExecutionSection j={t.j} onChange={patchJ} side={t.side} status={t.status} date={d.date} entry={rec.entry} stop={rec.stop} currency={cur} />
      </div>
    ),
    setups: (
      <div className="grid gap-3.5">
        <BlockHead title="Entscheidungsgrundlage" sub="Warum bist du eingestiegen?" />
        {/* a new chip order (Konto switch) never FLIPs the transparent chips through each other (ED-01): the group
              fades out, re-orders, the chips cascade back in; the row height follows on a spring */}
        <AutoHeight className="-my-1.5 py-1.5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={chipOrder} className="flex flex-wrap gap-2" variants={CHIP_GROUP} initial={reduced ? false : "hidden"} animate="shown" exit={reduced ? undefined : "exit"}>
              {sortedSetups.map((s) => (
                <SetupToggle key={s.id} setup={s} account={account} selected={t.setups.includes(s.id)} onToggle={() => patchT({ setups: t.setups.includes(s.id) ? t.setups.filter((id) => id !== s.id) : [...t.setups, s.id] })} />
              ))}
              <motion.button
                type="button"
                onClick={() => (onNewSetup ? onNewSetup() : openSetupEditor({ fromTrade: true }))}
                variants={CHIP}
                whileTap={{ scale: 0.96 }}
                transition={spring.press}
                className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-white/40 hover:text-fg pointer-coarse:min-h-11"
              >
                + Neue Grundlage
              </motion.button>
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
        {editor.open && (
          <Suspense fallback={null}>
            <ClassifyChipSlot
              draft={{ side: t.side, pair: d.pair, timeframe: d.timeframe, account, date: d.date, boxSnap: v3.boxSnap ?? draft?.boxSnap, signal: trade?.signal ?? draft?.signal }}
              picked={t.setups}
              onApply={(id) => patchT({ setups: [id] })}
            />
          </Suspense>
        )}
      </div>
    ),
    reason: (
      <Field label="Begründung" htmlFor="f-reason">
        <Textarea id="f-reason" rows={3} className="leading-relaxed" value={d.reason} onChange={setStr("reason")} placeholder={ED.COPY.reasonPlaceholder} />
        <VoiceNote value={d.reason} onChange={(reason) => setD((x) => ({ ...x, reason }))} label="Begründung" testId="voice-reason" />
      </Field>
    ),
    checklist: (
      <div className="grid gap-3.5">
        <BlockHead title="Checkliste" sub={items.length ? <CountRoll checked={checked} total={items.length} /> : undefined} />
        <ChecklistBar ratio={items.length ? checked / items.length : 0} complete={items.length > 0 && checked === items.length} />
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((it) => {
            const setupName = it.id.startsWith("g:") ? "Grundregel" : settings.setups.find((s) => it.id.startsWith(s.id + ":"))?.name;
            const auto = autoApplies && it.id.startsWith(`${MTF_SETUP_ID}:`);
            return (
              <CheckboxRow key={it.id} checked={Boolean(checks[it.id])} sub={auto ? `${setupName} · automatisch` : setupName} onToggle={() => toggleCheck(it.id)}>
                {it.text}
              </CheckboxRow>
            );
          })}
        </div>
      </div>
    ),
    conviction: (
      <Field label="Wie sicher warst du beim Einstieg?">
        <ConvictionRadio value={t.conviction} onChange={(conviction) => patchT({ conviction })} />
      </Field>
    ),
    followedPlan: (
      <Field label="Plan befolgt?">
        <Segmented<"yes" | "no">
          aria-label="Plan befolgt?"
          value={t.followedPlan == null ? null : t.followedPlan ? "yes" : "no"}
          onChange={(v) => patchT({ followedPlan: (t.followedPlan === true && v === "yes") || (t.followedPlan === false && v === "no") ? null : v === "yes" })}
          options={[
            { v: "yes", label: "Ja" },
            { v: "no", label: "Nein" },
          ]}
        />
      </Field>
    ),
    emotion: (
      <Field label="Gefühl beim Einstieg">
        <EmotionChips value={t.emotion} onChange={(emotion) => patchT({ emotion })} />
      </Field>
    ),
    tags: (
      <Field label="Tags">
        <TagInput value={t.j.tags} onChange={(tags) => patchJ({ tags })} suggestions={journalTags} />
      </Field>
    ),
    rating: (
      <Field label="Bewertung">
        <RatingDots value={t.j.rating} onChange={(rating) => patchJ({ rating })} />
      </Field>
    ),
    psych: (
      <div>
        <BlockHead title="Psyche" sub="Stress, Zuversicht, Verhalten" />
        <PsychSection j={t.j} onChange={patchJ} />
      </div>
    ),
    mistakes: (
      <div>
        <BlockHead title={MISTAKES_COPY.title} sub={MISTAKES_COPY.sub} />
        <MistakeChips options={tags} value={t.mistakes} onChange={(mistakes) => patchT({ mistakes })} />
      </div>
    ),
    notes: (
      <Field label="Learnings & Notizen" htmlFor="f-notes">
        <Textarea id="f-notes" rows={3} className="leading-relaxed" value={d.notes} onChange={setStr("notes")} placeholder="Was lief gut, was mache ich nächstes Mal anders?" />
        <VoiceNote value={d.notes} onChange={(notes) => setD((x) => ({ ...x, notes }))} label="Learnings und Notizen" testId="voice-notes" />
      </Field>
    ),
    chart: (
      <Field label="Chart-Link (TradingView)" htmlFor="f-chart">
        <Input id="f-chart" type="url" value={d.chart} onChange={setStr("chart")} placeholder="https://www.tradingview.com/x/…" autoComplete="off" {...fieldInvalid("chart")} />
      </Field>
    ),
    shots: (
      <div>
        <BlockHead title="Screenshots" sub="Ziehen, einfügen oder wählen" />
        <ShotsField value={t.j.screenshots} onChange={updateShots} />
      </div>
    ),
  };
  const render = (id: FieldId) => blocks[id];

  // The live strip is output, not a field: P&L and R-Multiple stay under the core; the three risk tiles and the risk preview
  // ride with `Ziele und Ausstieg` (or under the core when that group has no field left).
  const riskInTargets = fieldsIn(layout, "targets").length > 0;
  const stripTop = riskInTargets ? strip.slice(0, 2) : strip;
  const stripRisk = riskInTargets ? strip.slice(2) : [];
  const tiles = (items: [string, ReactNode][], label: string, cols: string) => (
    <div className={cn("grid gap-2", cols)} aria-label={label} role="group">
      {items.map(([name, value]) => (
        <div key={name} className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{name}</div>
          <div className="num mt-0.5 font-mono text-[14px] font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
  const riskPreview =
    riskLive && editor.open ? (
      <Suspense fallback={null}>
        <RiskPreviewSlot
          id={trade?.id}
          account={account}
          side={t.side}
          status={t.status}
          entry={rec.entry}
          stop={rec.stop}
          target={rec.target}
          size={rec.size}
          qty={v3.qty ?? null}
          leverage={rec.leverage}
          marginMode={v3.marginMode}
          margin={v3.margin ?? null}
        />
      </Suspense>
    ) : null;
  const coreFields = fieldsIn(layout, "core");

  return (
    <Sheet
      open={editor.open}
      onClose={closeEditor}
      title={trade ? "Trade bearbeiten" : "Trade eintragen"}
      size="lg"
      // the save bar rides on top of the on-screen keyboard (`--kb-inset`, 0 without one)
      className="mb-[var(--kb-inset,0px)]"
      layoutId={editor.fromFab && !trade ? `new-trade-${fabCycle}` : undefined}
      handoff={editor.fromDetail ? DETAIL_HANDOFF : undefined}
      footer={footer}
      dismissGuard={() => dirty}
      onDismissAttempt={() => setConfirmDiscard(true)}
    >
      <form id="trade-form" ref={formRef} onSubmit={onSubmit} noValidate>
        {/* while `Felder anpassen` is open the form stays mounted (state, live check, validation) but hidden */}
        <div hidden={customizing}>
          <FormToolbar canDuplicate={!trade && last != null} onDuplicate={duplicateLast} note={dupNote} onCustomize={() => setCustomizing(true)} />

          <CoreSection>
            {coreFields.length > 0 && <ZoneGrid fields={coreFields} render={render} />}
            {tiles(stripTop, "Live-Vorschau", stripTop.length > 3 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2")}
            {!riskInTargets && riskPreview}
          </CoreSection>

          {GROUPS.map((g) => {
            const fields = fieldsIn(layout, g.id);
            if (fields.length === 0) return null;
            return (
              <FormGroup
                key={g.id}
                id={g.id}
                title={g.title}
                hint={groupHint(layout, g.id)}
                filled={filledPer[g.id] ?? 0}
                open={openGroups.includes(g.id)}
                onToggle={() => toggleGroup(g.id)}
                instant={snapGroup === g.id}
              >
                <ZoneGrid fields={fields} render={render} />
                {g.id === "targets" && riskInTargets && (
                  <>
                    {tiles(stripRisk, "Risiko-Vorschau", "grid-cols-3")}
                    {riskPreview}
                  </>
                )}
              </FormGroup>
            );
          })}
        </div>

        {customizing && (
          <FieldCustomizer
            layout={layout}
            isDefault={isDefaultLayout(layout)}
            onMove={(id, zone: ZoneId) => changeLayout(moveField(layout, id, zone))}
            onReset={() => {
              changeLayout(defaultLayout());
              setResetNote(CUSTOMIZE_COPY.resetDone);
            }}
            onDone={() => setCustomizing(false)}
            note={resetNote}
          />
        )}
      </form>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- pieces */

/**
 * Bundle `Pc`: form section with `h3` + optional sub. Inside the sheet body it is a `StaggerItem`, so the six
 * sections cascade in (`stagger.sections`) once the body mounts; elsewhere it renders statically.
 */
export function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <StaggerItem as="section" className="grid gap-3.5 border-t border-line py-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold">
        {title}
        {sub && <span className="text-xs font-normal text-faint">{sub}</span>}
      </h3>
      {children}
    </StaggerItem>
  );
}

/** `{x} von {n} erfüllt` – the label rolls up when the count grows and down when it shrinks. */
function CountRoll({ checked, total }: { checked: number; total: number }) {
  const [last, setLast] = useState({ checked, dir: "up" as "up" | "down" });
  if (last.checked !== checked) setLast({ checked, dir: checked > last.checked ? "up" : "down" });
  return <TextRoll mode="roll" direction={last.dir} text={`${checked} von ${total} erfüllt`} />;
}

/** Checklist progress (`scaleX` on `spring.bar`); a pre-rendered win layer crossfades in when every point is met. */
function ChecklistBar({ ratio, complete }: { ratio: number; complete: boolean }) {
  const reduced = useReducedFx();
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
      <motion.div className="relative h-full w-full rounded-full" style={{ transformOrigin: "left" }} initial={false} animate={{ scaleX: ratio }} transition={spring.bar}>
        <span className="absolute inset-0 rounded-full bg-gradient-to-r from-(--color-faint) to-white" />
        <motion.span className="absolute inset-0 rounded-full bg-win" initial={false} animate={{ opacity: complete ? 1 : 0 }} transition={reduced ? { duration: 0 } : tween.crossfade} />
      </motion.div>
    </div>
  );
}

const CHIP_PRESS = { pressed: { scale: 0.94 } };

/**
 * `Gefühl beim Einstieg` chips (`aria-pressed`, re-click clears): one shared thumb glides between them
 * (`layoutId="emotion-{useId}"`, `spring.segment`) and fades out when the choice is cleared. Only the label dips
 * on press, so the thumb is never measured mid-press.
 */
function EmotionChips({ value, onChange }: { value: string; onChange: (emotion: string) => void }) {
  const id = useId();
  const reduced = useReducedFx();
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gefühl beim Einstieg">
      {EMOTIONS.map((e) => {
        const on = value === e;
        return (
          <motion.button
            key={e}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "" : e)}
            whileTap={reduced ? undefined : "pressed"}
            className={cn("relative rounded-full border border-line-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors pointer-coarse:min-h-11", on ? "text-fg" : "text-mute hover:text-fg")}
          >
            <AnimatePresence initial={false}>
              {on && (
                <motion.span
                  layoutId={`emotion-${id}`}
                  layoutDependency={value}
                  aria-hidden="true"
                  className="absolute -inset-px rounded-full border border-white/60 bg-white/10"
                  style={{ borderRadius: radius.pill }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: tween.exit }}
                  transition={{ layout: spring.segment, opacity: tween.fade }}
                />
              )}
            </AnimatePresence>
            <motion.span className="relative block" variants={CHIP_PRESS} transition={spring.press}>
              {e}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}

/**
 * `Fehler` chips (other journal version): multi-select toggles (`aria-pressed`) over the settings tags plus own ones;
 * `+ Eigener Fehler` turns into a small field (Enter adds the tag to this trade and selects it, Escape cancels).
 * On: loss-tinted (`border-loss/50 bg-loss/12`); the chip dips on press (`spring.press`).
 */
function MistakeChips({ options, value, onChange }: { options: readonly string[]; value: readonly string[]; onChange: (next: string[]) => void }) {
  const reduced = useReducedFx();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /** Escape cancelled the field: the blur that follows must not add the draft. */
  const cancelled = useRef(false);
  const toggle = (m: string) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = draft.trim();
    setDraft("");
    setAdding(false);
    if (v && !value.includes(v)) onChange([...value, v]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      // only the field: the sheet's Escape must not fire for it
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      cancelled.current = true;
      setDraft("");
      setAdding(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={MISTAKES_COPY.group}>
      {options.map((m) => {
        const on = value.includes(m);
        return (
          <motion.button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(m)}
            whileTap={reduced ? undefined : { scale: 0.94 }}
            transition={spring.press}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-200 pointer-coarse:min-h-11",
              on ? "border-loss/50 bg-loss/[0.12] text-(--color-danger-text)" : "border-line-2 text-mute hover:border-white/40 hover:text-fg",
            )}
          >
            {m}
          </motion.button>
        );
      })}
      {adding ? (
        <Input
          autoFocus
          aria-label={MISTAKES_COPY.placeholder}
          placeholder={MISTAKES_COPY.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          wrapperClassName="!w-48"
          className="rounded-full !py-1.5 text-[12.5px]"
        />
      ) : (
        <motion.button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setAdding(true);
          }}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          transition={spring.press}
          className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-white/40 hover:text-fg pointer-coarse:min-h-11"
        >
          {MISTAKES_COPY.add}
        </motion.button>
      )}
    </div>
  );
}

/** Chip group of `Entscheidungsgrundlage`: chips cascade in (`stagger.rows`), the whole group leaves on `tween.exit`. */
const CHIP_GROUP: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: (i: number) => Math.min(i, stagger.max) * stagger.rows } },
  exit: { opacity: 0, transition: tween.exit },
};
const CHIP: Variants = {
  hidden: { opacity: 0, y: 4 },
  shown: { opacity: 1, y: 0, transition: { opacity: tween.fade, y: spring.enter } },
};

/**
 * Setup chip toggle (`aria-pressed`; account-matching setups bright, others dimmed). The colour dot pops into a
 * check disc when selected (`spring.pop`, check drawn on `tween.check`); when the account re-orders the chips
 * (account-matching setups first) the group crossfades instead of FLIP-sliding (ED-01).
 */
function SetupToggle({ setup, account, selected, onToggle }: { setup: Setup; account: AccountId; selected: boolean; onToggle: () => void }) {
  const reduced = useReducedFx();
  const fits = setup.account === account || setup.account === "both";
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      variants={CHIP}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      transition={spring.press}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-200 pointer-coarse:min-h-11",
        selected ? "text-fg" : fits ? "border-line-2 text-fg/85 hover:border-white/40" : "border-line text-faint hover:text-mute",
      )}
      style={{ borderRadius: radius.pill, ...(selected ? { borderColor: setup.color + "aa", background: setup.color + "22" } : null) }}
    >
      <span className="relative grid size-3.5 shrink-0 place-items-center" aria-hidden="true">
        <motion.span className="absolute inset-0 rounded-full" style={{ background: setup.color }} initial={false} animate={{ scale: selected ? 1 : 0.58 }} transition={spring.pop} />
        <svg viewBox="0 0 16 16" className="relative size-2.5" fill="none" stroke="var(--color-ink-950)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M3.5 8.5l3 3 6-7" initial={false} animate={{ pathLength: selected ? 1 : 0, opacity: selected ? 1 : 0 }} transition={reduced ? { duration: 0 } : tween.check} />
        </svg>
      </span>
      {setup.name}
    </motion.button>
  );
}

/**
 * Live price next to the label, shown while `priceMv` carries a price: a mini odometer that glides with every
 * trade (zero React renders per tick). `aria-hidden` – the button's name stays the label. It only appears when the
 * button is wide enough to hold label and digits on one line (container query on the button).
 */
function LiveTicker({ wide }: { wide: boolean }) {
  const [on, setOn] = useState(() => priceMv.get() > 0);
  const shown = useRef(on);
  useMotionValueEvent(priceMv, "change", (v) => {
    const next = v > 0;
    if (next === shown.current) return;
    shown.current = next;
    setOn(next);
  });
  if (!on) return null;
  return (
    <span aria-hidden="true" className={cn("hidden items-center gap-1.5", wide ? "@min-[215px]:inline-flex" : "@min-[180px]:inline-flex")}>
      <span className="h-3 w-px bg-line-2" />
      {/* static label: the whole ticker is aria-hidden, so the odometer's 1-Hz label writer stays off */}
      <RollingDigits source={priceMv} decimals={0} blur={false} aria-label="Live-Preis" className="font-mono text-[10px] text-faint" />
    </span>
  );
}

/**
 * `Live-Preis übernehmen` (Plan 6.5): writes the last price into the field, then shows `✓ {price}` for 800 ms
 * (`AnimatePresence mode="wait"`). Rendered only while a price exists; disabled together with `Ausstieg`. While idle
 * a mini live odometer (`priceMv`, aria-hidden) rides next to the label when there is room. `onApply` may return the
 * price it actually applied (the freshest trade); the check mark then shows that one instead of `price`. The 800 ms
 * dwell starts when the check mark is on screen (after the label's exit), not on click — a stalled frame loop
 * would otherwise eat the whole confirmation before `mode="wait"` ever mounted it.
 */
export function LivePriceButton({ price, label, disabled, onApply, className }: { price: number; label: string; disabled?: boolean; onApply: () => number | void; className?: string }) {
  const [applied, setApplied] = useState<number | null>(null);
  const done = applied !== null;
  const clearApplied = useCallback(() => setApplied(null), []);
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => {
        const p = onApply();
        setApplied(typeof p === "number" ? p : price);
      }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={spring.press}
      className={cn(
        "@container inline-flex h-7 w-full items-center justify-center overflow-hidden rounded-lg border border-line-2 px-2 text-[11px] font-medium text-mute transition-colors hover:border-white/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-11",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "done" : "idle"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: tween.exit }}
          transition={tween.fade}
          className={cn("num inline-flex items-center gap-1.5", done && "font-mono text-win")}
        >
          {done ? (
            <AppliedCheck value={applied ?? price} onDone={clearApplied} />
          ) : (
            <>
              {label}
              <LiveTicker wide={label.length > LIVE_PRICE_LABEL.length + 3} />
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

/** The `✓ {price}` confirmation; its `LIVE_PRICE_CONFIRM_MS` dwell runs from its own mount. */
function AppliedCheck({ value, onDone }: { value: number; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, LIVE_PRICE_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [onDone]);
  return <>{`✓ ${fmtPrice(value)}`}</>;
}
