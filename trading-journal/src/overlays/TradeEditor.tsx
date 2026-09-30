import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { deriveTrade } from "@/domain/derive";
import { checklistItemsFor, pruneChecks } from "@/domain/enrich";
import { EMOTIONS, LEVERAGE_HELP, LEVERAGE_WARNING, TIMEFRAMES } from "@/domain/defaults";
import type { AccountId, Conviction, Settings, Setup, Side, Trade, TradeStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { nowLocalInput } from "@/lib/dates";
import { n1, n2, price as fmtPrice, signed } from "@/lib/format";
import { parseNumber, sanitizeUrl, toInputString } from "@/lib/parse";
import { MotionNumber } from "@/motion/MotionNumber";
import { Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { Button, CheckboxRow, ConvictionRadio, Field, Input, Segmented, Textarea, inputClass } from "@/primitives";
import { useJournal } from "@/store/journalStore";
import { pushToast, useUi, type AccFilter } from "@/store/uiStore";

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

/** `nt(Number(price.toFixed(price < 10 ? 4 : 1)))` → comma string for the input (Plan 6.5). */
export function livePriceInput(price: number): string {
  return toInputString(Number(price.toFixed(price < 10 ? 4 : 1)));
}

function defaultAccount(acc: AccFilter): AccountId {
  return acc === "makro" ? "makro" : "scalp";
}

/* --------------------------------------------------------------- component */

/**
 * Trade editor sheet (bundle `X$`/`Y$`, Plan 6.5): `Sheet size="lg"` (`layoutId="new-trade"` when opened from the FAB),
 * `form#trade-form noValidate`, six sections with the verbatim labels, live derived strip (`deriveTrade`), validation,
 * `Speichern | Speichern & neu | Abbrechen`, inline delete confirmation, toasts. State comes from `uiStore.editor`
 * and `useJournal()`.
 */
export function TradeEditor({ livePrice, livePriceLabel = LIVE_PRICE_LABEL, onNewSetup }: TradeEditorProps) {
  const editor = useUi((s) => s.editor);
  const acc = useUi((s) => s.acc);
  const closeEditor = useUi((s) => s.closeEditor);
  const openSetupEditor = useUi((s) => s.openSetupEditor);
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  const saveTrade = useJournal((s) => s.saveTrade);
  const deleteTrade = useJournal((s) => s.deleteTrade);

  const trade = editor.tradeId ? trades.find((t) => t.id === editor.tradeId) : undefined;
  const session = editor.open ? `${editor.tradeId ?? ""}` : null;
  const initialised = useRef<string | null>(null);

  const [d, setD] = useState<TradeFormStrings>(() => defaultForm(settings, defaultAccount(acc)).d);
  const [t, setT] = useState<TradeFormTyped>(() => defaultForm(settings, defaultAccount(acc)).t);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const entryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset once per open session (bundle effect on `[open, trade]`), before paint.
  useLayoutEffect(() => {
    if (session == null) {
      initialised.current = null;
      return;
    }
    if (initialised.current === session) return;
    initialised.current = session;
    setErr("");
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
  };
  const patchT = useCallback((patch: Partial<TradeFormTyped>) => setT((o) => ({ ...o, ...patch })), []);

  const save = useCallback(
    async (mode: "close" | "again") => {
      const problem = validateRecord(rec, d.chart);
      if (problem) {
        setErr(problem);
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
      setSaving(true);
      try {
        await saveTrade(record);
        pushToast({
          kind: "success",
          title: trade ? "Trade aktualisiert" : "Trade gespeichert",
          value: x.pnl == null ? "offen" : signed(x.pnl),
          valueTone: x.pnl == null ? undefined : x.pnl < 0 ? "loss" : "win",
        });
        if (mode === "close") {
          closeEditor();
        } else {
          const next = resetForNext(d, t);
          setD(next.d);
          setT(next.t);
          const scroller = formRef.current?.closest<HTMLElement>(".overflow-y-auto");
          if (scroller && typeof scroller.scrollTo === "function") scroller.scrollTo({ top: 0 });
          entryRef.current?.focus();
        }
      } catch {
        setErr(EDITOR_MESSAGES.saveFailed);
        pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
      } finally {
        setSaving(false);
      }
    },
    [rec, d, t, items, x, trade, saveTrade, closeEditor],
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
      setErr(EDITOR_MESSAGES.deleteFailed);
    }
  };

  const applyLive = (k: "entry" | "exit") => {
    if (!hasLive) return;
    setD((o) => ({ ...o, [k]: livePriceInput(livePrice) }));
  };

  const footer = (
    <>
      {trade &&
        (confirmDelete ? (
          <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]">
            Wirklich löschen?
            <Button size="sm" variant="danger" onClick={() => void onDelete()}>
              Ja, löschen
            </Button>
            <Button size="sm" onClick={() => setConfirmDelete(false)}>
              Nein
            </Button>
          </span>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Löschen
          </Button>
        ))}
      <span className="flex-1" />
      {err && (
        <span role="alert" className="text-[12.5px] font-medium text-[#ff8a90]">
          {err}
        </span>
      )}
      <Button onClick={closeEditor}>Abbrechen</Button>
      <span className="inline-flex gap-1.5">
        {!trade && (
          <Button disabled={saving} onClick={() => void save("again")}>
            Speichern & neu
          </Button>
        )}
        <Button variant="primary" type="submit" form="trade-form" disabled={saving} className="min-w-[110px]">
          {saving ? "Speichert …" : "Speichern"}
        </Button>
      </span>
    </>
  );

  const priceField = (k: "entry" | "stop" | "target" | "exit", label: string) => {
    const live = (k === "entry" || k === "exit") && hasLive;
    const disabled = k === "exit" && isOpen;
    return (
      <Field key={k} label={label} htmlFor={"f-" + k}>
        <div className={cn(live && "grid gap-1.5")}>
          <Input id={"f-" + k} ref={k === "entry" ? entryRef : undefined} numeric autoComplete="off" value={d[k]} onChange={setStr(k)} disabled={disabled} />
          {live && <LivePriceButton price={livePrice} label={livePriceLabel} disabled={disabled} onApply={() => applyLive(k)} />}
        </div>
      </Field>
    );
  };

  const strip: [string, ReactNode][] = [
    ["P&L", x.pnl == null ? "–" : <MotionNumber value={x.pnl} decimals={2} signed tone="auto" suffix={` ${cur}`} aria-label={`${signed(x.pnl)} ${cur}`} />],
    ["R-Multiple", x.r == null ? "–" : <MotionNumber value={x.r} decimals={2} signed tone="auto" suffix=" R" />],
    ["Kursbewegung", x.move == null ? "–" : <MotionNumber value={x.move * 100} decimals={1} signed tone="auto" suffix=" %" />],
    [
      "Risiko",
      x.risk == null ? (
        "–"
      ) : (
        <>
          <MotionNumber value={x.risk} decimals={0} /> <span className="text-xs text-mute">{capital ? `(${n1((x.risk / capital) * 100)} %)` : ""}</span>
        </>
      ),
    ],
    ["Geplantes CRV", x.rr == null ? "–" : `1 : ${n2(x.rr)}`],
  ];

  return (
    <Sheet open={editor.open} onClose={closeEditor} title={trade ? "Trade bearbeiten" : "Trade eintragen"} size="lg" layoutId={editor.fromFab && !trade ? "new-trade" : undefined} footer={footer}>
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
              <Input id="f-date" type="datetime-local" value={d.date} onChange={setStr("date")} />
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
              <Input id="f-size" numeric autoComplete="off" value={d.size} onChange={setStr("size")} />
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
            <button type="button" onClick={() => (onNewSetup ? onNewSetup() : openSetupEditor({ fromTrade: true }))} className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12.5px] text-mute hover:text-fg">
              + Neue Grundlage
            </button>
          </div>
          <Field label="Begründung" htmlFor="f-reason">
            <Textarea id="f-reason" rows={3} className="leading-relaxed" value={d.reason} onChange={setStr("reason")} placeholder="z. B. 4H-Schluss unter 84.500, Delta rot, S&P lehnt ab" />
          </Field>
        </Section>

        <Section title="Checkliste" sub={items.length ? `${checked} von ${items.length} erfüllt` : undefined}>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#5f5f5f] to-white"
              style={{ transformOrigin: "left", width: "100%" }}
              initial={false}
              animate={{ scaleX: items.length ? checked / items.length : 0 }}
              transition={spring.bar}
              aria-hidden="true"
            />
          </div>
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
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gefühl beim Einstieg">
                {EMOTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={t.emotion === e}
                    onClick={() => patchT({ emotion: t.emotion === e ? "" : e })}
                    className={cn("rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors", t.emotion === e ? "border-white/60 bg-white/10 text-fg" : "border-line-2 text-mute hover:text-fg")}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Review">
          <Field label="Learnings & Notizen" htmlFor="f-notes">
            <Textarea id="f-notes" rows={3} className="leading-relaxed" value={d.notes} onChange={setStr("notes")} placeholder="Was lief gut, was mache ich nächstes Mal anders?" />
          </Field>
          <Field label="Chart-Link (TradingView)" htmlFor="f-chart">
            <Input id="f-chart" type="url" value={d.chart} onChange={setStr("chart")} placeholder="https://www.tradingview.com/x/…" autoComplete="off" />
          </Field>
        </Section>
      </form>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- pieces */

/** Bundle `Pc`: form section with `h3` + optional sub. */
export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3.5 border-t border-line py-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold">
        {title}
        {sub && <span className="text-xs font-normal text-faint">{sub}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Setup chip toggle (`aria-pressed`; account-matching setups bright, others dimmed). */
function SetupToggle({ setup, account, selected, onToggle }: { setup: Setup; account: AccountId; selected: boolean; onToggle: () => void }) {
  const fits = setup.account === account || setup.account === "both";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-200",
        selected ? "text-fg" : fits ? "border-line-2 text-fg/85 hover:border-white/40" : "border-line text-faint hover:text-mute",
      )}
      style={selected ? { borderColor: setup.color + "aa", background: setup.color + "22" } : undefined}
    >
      <span className="size-2 rounded-full" style={{ background: setup.color }} aria-hidden="true" />
      {setup.name}
    </button>
  );
}

/**
 * `Live-Preis übernehmen` (Plan 6.5): writes the last price into the field, then shows `✓ {price}` for 800 ms
 * (`AnimatePresence mode="wait"`). Rendered only while a price exists; disabled together with `Ausstieg`.
 */
export function LivePriceButton({ price, label, disabled, onApply, className }: { price: number; label: string; disabled?: boolean; onApply: () => void; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), LIVE_PRICE_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onApply();
        setDone(true);
      }}
      className={cn("inline-flex h-7 items-center justify-center overflow-hidden rounded-lg border border-line-2 px-2 text-[11px] font-medium text-mute transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40", className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={done ? "done" : "idle"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: tween.exit }} transition={tween.fade} className={cn("num", done && "font-mono text-win")}>
          {done ? `✓ ${fmtPrice(price)}` : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
