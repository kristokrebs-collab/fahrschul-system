import { AnimatePresence, motion, useMotionValueEvent } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { deriveTrade } from "@/domain/derive";
import { checklistItemsFor, pruneChecks } from "@/domain/enrich";
import { EMOTIONS, LEVERAGE_HELP, LEVERAGE_WARNING, TIMEFRAMES } from "@/domain/defaults";
import type { AccountId, Conviction, Settings, Setup, Side, Trade, TradeStatus } from "@/domain/types";
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
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, CheckboxRow, ConvictionRadio, Field, Input, Segmented, Textarea, inputClass, revealInvalid, shakeField } from "@/primitives";
import { useJournal } from "@/store/journalStore";
import { pushToast, useUi, type AccFilter } from "@/store/uiStore";
import { winCelebration } from "./celebration";
import { FAB_LABEL } from "@/app/Dock";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";

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
    t: { account, side: "long", status: "closed", setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "" },
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
    },
  };
}

/** `Speichern & neu` reset (Plan 6.5): keeps date (renewed), pair, account, side, leverage, timeframe. */
export function resetForNext(d: TradeFormStrings, t: TradeFormTyped): { d: TradeFormStrings; t: TradeFormTyped } {
  return {
    d: { ...d, date: nowLocalInput(), entry: "", stop: "", target: "", exit: "", size: "", fees: "", pnlManual: "", reason: "", notes: "", chart: "" },
    t: { ...t, status: "closed", setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "" },
  };
}

/** Bundle `S`: the typed record the form would save (before pnl/r/timestamps). */
export function toRecord(d: TradeFormStrings, t: TradeFormTyped): Omit<Trade, "id" | "pnl" | "r" | "createdAt" | "updatedAt"> {
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

/** Bundle validation order; `null` when valid. */
export function validateRecord(rec: ReturnType<typeof toRecord>, rawChart: string): string | null {
  if (!rec.date) return EDITOR_MESSAGES.date;
  if (!(rec.entry != null && rec.entry > 0)) return EDITOR_MESSAGES.entry;
  if (rec.status !== "open" && rec.pnlManual == null) {
    if (!(rec.exit != null && rec.exit > 0)) return EDITOR_MESSAGES.exit;
    if (!(rec.size != null && rec.size > 0)) return EDITOR_MESSAGES.size;
  }
  if (rawChart.trim() && !rec.chart) return EDITOR_MESSAGES.chart;
  return null;
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
  const saveTrade = useJournal((s) => s.saveTrade);
  const deleteTrade = useJournal((s) => s.deleteTrade);
  const reduced = useReducedFx();

  const trade = editor.tradeId ? trades.find((t) => t.id === editor.tradeId) : undefined;
  const session = editor.open ? `${editor.tradeId ?? ""}` : null;
  const initialised = useRef<string | null>(null);

  const [d, setD] = useState<TradeFormStrings>(() => defaultForm(settings, defaultAccount(acc)).d);
  const [t, setT] = useState<TradeFormTyped>(() => defaultForm(settings, defaultAccount(acc)).t);
  const [err, setErr] = useState("");
  const [invalid, setInvalid] = useState<InvalidField | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const entryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLSpanElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const { trigger: deleteTrigger, no: deleteNo } = useConfirmFocus(confirmDelete);

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
    const init = trade ? formFromTrade(trade) : defaultForm(settings, defaultAccount(acc));
    setD(init.d);
    setT(init.t);
  }, [session, trade, settings, acc]);

  const rec = useMemo(() => toRecord(d, t), [d, t]);
  const x = useMemo(() => deriveTrade(rec), [rec]);
  const account = t.account;
  const capital = settings.capital[account] || 0;
  const items = useMemo(() => checklistItemsFor(t.setups, settings), [t.setups, settings]);
  const checked = items.filter((it) => t.checks[it.id]).length;
  const leverageOver = rec.leverage != null && (account === "scalp" ? rec.leverage > 4 : rec.leverage > 5);
  const sortedSetups = useMemo(
    () => [...settings.setups].sort((a, b) => +(b.account === account || b.account === "both") - +(a.account === account || a.account === "both")),
    [settings.setups, account],
  );
  const cur = settings.currency;
  const isOpen = t.status === "open";
  const hasLive = livePrice != null && Number.isFinite(livePrice);

  const setStr = (k: keyof TradeFormStrings) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setD((o) => ({ ...o, [k]: v }));
    if (k === invalid) setInvalid(null);
  };
  const patchT = useCallback((patch: Partial<TradeFormTyped>) => setT((o) => ({ ...o, ...patch })), []);

  const save = useCallback(
    async (mode: "close" | "again") => {
      const problem = validateRecord(rec, d.chart);
      if (problem) {
        const field = invalidFieldOf(problem);
        setErr(problem);
        setInvalid(field);
        shakeField(alertRef.current, { reduced, self: true });
        if (field) revealInvalid(`f-${field}`, { reduced });
        return;
      }
      const now = new Date().toISOString();
      // Spread the stored trade first so passthrough/unknown fields (legacy extras) survive an edit.
      const record: TradeRecord = {
        ...(trade ?? {}),
        ...rec,
        checks: pruneChecks(t.checks, items),
        pnl: x.pnl,
        r: x.r,
        updatedAt: now,
        createdAt: trade?.createdAt || now,
      };
      if (trade?.id) record.id = trade.id;
      else delete record.id;
      setErr("");
      setInvalid(null);
      setSaving(true);
      try {
        await saveTrade(record);
        pushToast({
          kind: "success",
          title: trade ? "Trade aktualisiert" : "Trade gespeichert",
          value: x.pnl == null ? "offen" : signed(x.pnl),
          valueTone: x.pnl == null ? undefined : x.pnl < 0 ? "loss" : "win",
        });
        // `trades` is still the journal before this save – exactly what the equity-high check compares against
        const burst = winCelebration(trades, record, trade);
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
          const next = resetForNext(d, t);
          setD(next.d);
          setT(next.t);
          const scroller = formRef.current?.closest<HTMLElement>(".overflow-y-auto");
          if (scroller && typeof scroller.scrollTo === "function") scroller.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
          entryRef.current?.focus({ preventScroll: true });
        }
      } catch {
        setErr(EDITOR_MESSAGES.saveFailed);
        shakeField(alertRef.current, { reduced, self: true });
        pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
      } finally {
        setSaving(false);
      }
    },
    [rec, d, t, items, x, trade, trades, saveTrade, closeEditor, reduced],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void save("close");
  };

  const onDelete = async () => {
    if (!trade) return;
    try {
      await deleteTrade(trade.id);
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
    <>
      {trade &&
        (confirmDelete ? (
          <motion.span
            key="confirm"
            className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ default: tween.fade, scale: spring.pop }}
          >
            Wirklich löschen?
            <Button size="sm" variant="danger" onClick={() => void onDelete()}>
              Ja, löschen
            </Button>
            <Button ref={deleteNo} size="sm" onClick={() => setConfirmDelete(false)}>
              Nein
            </Button>
          </motion.span>
        ) : (
          <HoldConfirm ref={deleteTrigger} onAsk={() => setConfirmDelete(true)} onConfirm={() => void onDelete()}>
            Löschen
          </HoldConfirm>
        ))}
      <span className="flex-1" />
      <span ref={alertRef} id={ERROR_ID} role="alert" className="text-[12.5px] font-medium text-[#ff8a90]">
        {err && (
          <motion.span key={err} className="inline-block" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade}>
            {err}
          </motion.span>
        )}
      </span>
      <Button onClick={closeEditor}>Abbrechen</Button>
      <span className="inline-flex gap-1.5">
        {!trade && (
          <Button ref={againRef} disabled={saving} onClick={() => void save("again")}>
            Speichern & neu
          </Button>
        )}
        <Button ref={saveRef} variant="primary" type="submit" form="trade-form" disabled={saving} aria-busy={saving || undefined} className="min-w-[110px]">
          <TextRoll mode="roll" text={saving ? "Speichert …" : "Speichern"} />
        </Button>
      </span>
    </>
  );

  const fieldInvalid = (k: InvalidField) => (invalid === k ? { invalid: true, "aria-describedby": ERROR_ID } : {});

  const priceField = (k: "entry" | "stop" | "target" | "exit", label: string) => {
    const live = (k === "entry" || k === "exit") && hasLive;
    const disabled = k === "exit" && isOpen;
    return (
      <Field key={k} label={label} htmlFor={"f-" + k}>
        <div className={cn(live && "grid gap-1.5")}>
          <Input
            id={"f-" + k}
            ref={k === "entry" ? entryRef : undefined}
            numeric
            autoComplete="off"
            value={d[k]}
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

  return (
    <Sheet open={editor.open} onClose={closeEditor} title={trade ? "Trade bearbeiten" : "Trade eintragen"} size="lg" layoutId={editor.fromFab && !trade ? `new-trade-${fabCycle}` : undefined} footer={footer}>
      <form id="trade-form" ref={formRef} onSubmit={onSubmit} noValidate>
        <Section title="Eckdaten">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <Field label="Konto" className="col-span-2">
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
            <Field label="Richtung" className="col-span-2">
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
            <Field label="Datum & Uhrzeit" htmlFor="f-date" className="col-span-2">
              <Input id="f-date" type="datetime-local" value={d.date} onChange={setStr("date")} {...fieldInvalid("date")} />
            </Field>
            <Field label="Paar" htmlFor="f-pair">
              <Input id="f-pair" value={d.pair} onChange={setStr("pair")} autoComplete="off" />
            </Field>
            <Field label="Timeframe" htmlFor="f-tf">
              <select id="f-tf" className={inputClass} value={d.timeframe} onChange={setStr("timeframe")}>
                <option value="">–</option>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" className="col-span-2">
              <Segmented<TradeStatus>
                aria-label="Status"
                value={t.status}
                onChange={(status) => patchT({ status })}
                options={[
                  { v: "closed", label: "Geschlossen" },
                  { v: "open", label: "Noch offen" },
                ]}
              />
            </Field>
          </div>
        </Section>

        <Section title="Preise & Größe" sub="Komma oder Punkt, beides geht">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {priceField("entry", "Einstieg")}
            {priceField("stop", "Stop-Loss")}
            {priceField("target", "Take-Profit")}
            {priceField("exit", "Ausstieg")}
            <Field label={`Größe (${cur})`} htmlFor="f-size" help="Positionswert inkl. Hebel">
              <Input id="f-size" numeric autoComplete="off" value={d.size} onChange={setStr("size")} {...fieldInvalid("size")} />
            </Field>
            <Field label="Hebel" htmlFor="f-lev" suffix="x" help={leverageOver ? <span className="font-medium text-warn">{LEVERAGE_WARNING[account]}</span> : LEVERAGE_HELP[account]}>
              <Input id="f-lev" numeric autoComplete="off" value={d.leverage} onChange={setStr("leverage")} placeholder="z. B. 4" className={cn(leverageOver && "border-warn/60")} />
            </Field>
            <Field label={`Gebühren (${cur})`} htmlFor="f-fees">
              <Input id="f-fees" numeric autoComplete="off" value={d.fees} onChange={setStr("fees")} placeholder="0" />
            </Field>
            <Field label="P&L manuell" htmlFor="f-pnl" help="Leer = wird berechnet" suffix={cur}>
              <Input id="f-pnl" numeric autoComplete="off" value={d.pnlManual} onChange={setStr("pnlManual")} placeholder="automatisch" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Live-Vorschau" role="group">
            {strip.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
                <div className="num mt-0.5 font-mono text-[14px] font-medium">{value}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Entscheidungsgrundlage" sub="Warum bist du eingestiegen?">
          <div className="flex flex-wrap gap-2">
            {sortedSetups.map((s) => (
              <SetupToggle key={s.id} setup={s} account={account} selected={t.setups.includes(s.id)} onToggle={() => patchT({ setups: t.setups.includes(s.id) ? t.setups.filter((id) => id !== s.id) : [...t.setups, s.id] })} />
            ))}
            <motion.button
              type="button"
              onClick={() => (onNewSetup ? onNewSetup() : openSetupEditor({ fromTrade: true }))}
              whileTap={{ scale: 0.96 }}
              transition={spring.press}
              className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-white/40 hover:text-fg"
            >
              + Neue Grundlage
            </motion.button>
          </div>
          <Field label="Begründung" htmlFor="f-reason">
            <Textarea id="f-reason" rows={3} className="leading-relaxed" value={d.reason} onChange={setStr("reason")} placeholder="z. B. 4H-Schluss unter 84.500, Delta rot, S&P lehnt ab" />
          </Field>
        </Section>

        <Section title="Checkliste" sub={items.length ? <CountRoll checked={checked} total={items.length} /> : undefined}>
          <ChecklistBar ratio={items.length ? checked / items.length : 0} complete={items.length > 0 && checked === items.length} />
          <div className="grid gap-2 md:grid-cols-2">
            {items.map((it) => (
              <CheckboxRow key={it.id} checked={Boolean(t.checks[it.id])} sub={it.id.startsWith("g:") ? "Grundregel" : settings.setups.find((s) => it.id.startsWith(s.id + ":"))?.name} onToggle={() => patchT({ checks: { ...t.checks, [it.id]: !t.checks[it.id] } })}>
                {it.text}
              </CheckboxRow>
            ))}
          </div>
        </Section>

        <Section title="Überzeugung & Disziplin">
          <Field label="Wie sicher warst du beim Einstieg?">
            <ConvictionRadio value={t.conviction} onChange={(conviction) => patchT({ conviction })} />
          </Field>
          <div className="grid gap-3.5 md:grid-cols-[auto_1fr]">
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
            <Field label="Gefühl beim Einstieg">
              <EmotionChips value={t.emotion} onChange={(emotion) => patchT({ emotion })} />
            </Field>
          </div>
        </Section>

        <Section title="Review">
          <Field label="Learnings & Notizen" htmlFor="f-notes">
            <Textarea id="f-notes" rows={3} className="leading-relaxed" value={d.notes} onChange={setStr("notes")} placeholder="Was lief gut, was mache ich nächstes Mal anders?" />
          </Field>
          <Field label="Chart-Link (TradingView)" htmlFor="f-chart">
            <Input id="f-chart" type="url" value={d.chart} onChange={setStr("chart")} placeholder="https://www.tradingview.com/x/…" autoComplete="off" {...fieldInvalid("chart")} />
          </Field>
        </Section>
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
        <span className="absolute inset-0 rounded-full bg-gradient-to-r from-[#5f5f5f] to-white" />
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
            className={cn("relative rounded-full border border-line-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors", on ? "text-fg" : "text-mute hover:text-fg")}
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
 * Setup chip toggle (`aria-pressed`; account-matching setups bright, others dimmed). The colour dot pops into a
 * check disc when selected (`spring.pop`, check drawn on `tween.check`); chips glide to their new order when the
 * account changes (account-matching setups first).
 */
function SetupToggle({ setup, account, selected, onToggle }: { setup: Setup; account: AccountId; selected: boolean; onToggle: () => void }) {
  const reduced = useReducedFx();
  const fits = setup.account === account || setup.account === "both";
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      layout="position"
      layoutDependency={account}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      transition={{ layout: spring.layout, default: spring.press }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-200",
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
 * price it actually applied (the freshest trade); the check mark then shows that one instead of `price`.
 */
export function LivePriceButton({ price, label, disabled, onApply, className }: { price: number; label: string; disabled?: boolean; onApply: () => number | void; className?: string }) {
  const [applied, setApplied] = useState<number | null>(null);
  const done = applied !== null;
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setApplied(null), LIVE_PRICE_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [done]);
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
        "@container inline-flex h-7 w-full items-center justify-center overflow-hidden rounded-lg border border-line-2 px-2 text-[11px] font-medium text-mute transition-colors hover:border-white/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
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
            `✓ ${fmtPrice(applied ?? price)}`
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
