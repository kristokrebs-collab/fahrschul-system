import { AnimatePresence, motion, type Variants } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { fillStats, FILL_KIND_LABELS } from "@/domain/fills";
import type { DecisionBy, MarginMode, MarketKind, Side, TradeStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { price as fmtPrice, signed } from "@/lib/format";
import { parseNumber } from "@/lib/parse";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Field, Input, Segmented } from "@/primitives";
import { AutoHeight } from "@/views/trades/AutoHeight";
import { FillsBar } from "../ui/FillsBar";
import { fillsOf, newFillRow, newStopRow, newTargetRow, originEditable, type FillRow, type JournalForm, type StopRow, type TargetRow } from "./form";

export interface ExecutionSectionProps {
  j: JournalForm;
  onChange: (patch: Partial<JournalForm>) => void;
  side: Side;
  status: TradeStatus;
  /** Entry time of the form (first fill / stop default). */
  date: string;
  entry: number | null;
  stop: number | null;
  currency: string;
}

type Tab = "fills" | "targets" | "stops";

const ORIGIN_SOURCE: Readonly<Record<string, string>> = { api: "Börsen-Sync", csv: "CSV-Import", webhook: "TradingView-Webhook" };

/**
 * „Herkunft“ (review F14): Manuell or Bot with its name – feeds the „Herkunft“ breakdown („Bot · Grid BTC“). Trades of
 * an exchange sync, a CSV import or the webhook show where they came from instead (their import owns the origin).
 */
function OriginField({ j, onChange }: { j: JournalForm; onChange: (patch: Partial<JournalForm>) => void }) {
  const reduced = useReducedFx();
  if (!originEditable(j)) {
    return (
      <Field label="Herkunft" className="col-span-2 md:col-span-4">
        <span className="text-[13px] text-mute" data-testid="origin-fixed">
          {ORIGIN_SOURCE[j.originSrc?.kind ?? ""] ?? j.originSrc?.kind}
        </span>
      </Field>
    );
  }
  return (
    <Field label="Herkunft" className="col-span-2 md:col-span-4" help="Bot-Trades getrennt auswerten (Analyse → Herkunft)">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<"manual" | "bot">
          aria-label="Herkunft"
          size="sm"
          value={j.botOn ? "bot" : "manual"}
          onChange={(v) => onChange({ botOn: v === "bot" })}
          options={[
            { v: "manual", label: "Manuell" },
            { v: "bot", label: "Bot" },
          ]}
        />
        <AnimatePresence initial={false}>
          {j.botOn && (
            <motion.div
              key="bot-name"
              className="min-w-0 flex-1 basis-40"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ x: spring.enter, opacity: tween.fade }}
            >
              <Input id="f-bot" aria-label="Bot-Name" autoComplete="off" value={j.bot} onChange={(e) => onChange({ bot: e.target.value })} placeholder="z. B. Grid BTC" maxLength={40} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Field>
  );
}

const ROW: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0 },
};

/**
 * `Ausführung` (Journal v3): exit time, quantity, funding, slippage, instrument (Perp / Spot), margin, liquidation, venue
 * and account label – plus three panels behind one segmented switch: the fills (position bar cut by every partial exit,
 * rows enter on `spring.enter`, the stats line counts), the take-profit ladder (with a mini ladder of entry, stop and the
 * rungs) and the stop history. Everything is optional; untouched it writes nothing.
 */
export function ExecutionSection({ j, onChange, side, status, date, entry, stop, currency }: ExecutionSectionProps) {
  const [tab, setTab] = useState<Tab>(j.fills.length ? "fills" : j.targets.length ? "targets" : j.stops.length ? "stops" : "fills");
  const open = status === "open";
  const set = (k: keyof JournalForm) => (e: { target: { value: string } }) => onChange({ [k]: e.target.value } as Partial<JournalForm>);
  const isSpot = j.market === "spot";

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Field label="Ausstiegszeit" htmlFor="f-exit-date" className="col-span-2" help={open ? "Erst beim Schließen" : "Für Haltedauer und MAE/MFE"}>
          <Input id="f-exit-date" type="datetime-local" value={j.exitDate} onChange={set("exitDate")} disabled={open} />
        </Field>
        <Field label="Menge" htmlFor="f-qty" help="Stück / Kontrakte">
          <Input id="f-qty" numeric autoComplete="off" value={j.qty} onChange={set("qty")} placeholder="aus Größe" />
        </Field>
        <Field label={`Funding (${currency})`} htmlFor="f-funding" help="+ bezahlt · − erhalten">
          <Input id="f-funding" numeric autoComplete="off" value={j.fundingFees} onChange={set("fundingFees")} placeholder="0" />
        </Field>
        <Field label="Markt" className="col-span-2">
          <Segmented<MarketKind>
            aria-label="Markt"
            size="sm"
            value={j.market || null}
            onChange={(market) => onChange({ market, marginMode: market === "spot" ? "" : j.marginMode })}
            options={[
              { v: "perp", label: "Perp" },
              { v: "spot", label: "Spot" },
            ]}
          />
        </Field>
        <Field label="Margin-Modus" className="col-span-2">
          <Segmented<MarginMode>
            aria-label="Margin-Modus"
            size="sm"
            value={j.marginMode || null}
            onChange={(marginMode) => onChange({ marginMode, market: j.market === "spot" ? "perp" : j.market })}
            options={[
              { v: "isolated", label: "Isoliert", disabled: isSpot },
              { v: "cross", label: "Cross", disabled: isSpot },
            ]}
          />
        </Field>
        <Field label={`Margin (${currency})`} htmlFor="f-margin">
          <Input id="f-margin" numeric autoComplete="off" value={j.margin} onChange={set("margin")} disabled={isSpot} />
        </Field>
        <Field label="Liq.-Preis" htmlFor="f-liq">
          <Input id="f-liq" numeric autoComplete="off" value={j.liqPrice} onChange={set("liqPrice")} disabled={isSpot} />
        </Field>
        <Field label={`Slippage (${currency})`} htmlFor="f-slip">
          <Input id="f-slip" numeric autoComplete="off" value={j.slippage} onChange={set("slippage")} placeholder="0" />
        </Field>
        <Field label="Geplanter Einstieg" htmlFor="f-planned">
          <Input id="f-planned" numeric autoComplete="off" value={j.plannedEntry} onChange={set("plannedEntry")} placeholder="Limit" />
        </Field>
        <Field label="Börse" htmlFor="f-exchange">
          <Input id="f-exchange" autoComplete="off" value={j.exchange} onChange={set("exchange")} placeholder="z. B. Bitunix" maxLength={40} />
        </Field>
        <Field label="Börsenkonto" htmlFor="f-exacc" className="col-span-1 md:col-span-3">
          <Input id="f-exacc" autoComplete="off" value={j.exchangeAccount} onChange={set("exchangeAccount")} placeholder="z. B. Haupt oder Sub-Konto 2" maxLength={40} />
        </Field>
        <OriginField j={j} onChange={onChange} />
        <Field label="Entscheidung" className="col-span-2 md:col-span-4" help="Wer hat entschieden? Für den Vergleich unter Analyse → Vergleich">
          <Segmented<"" | DecisionBy>
            aria-label="Entscheidung von"
            size="sm"
            value={j.decision}
            onChange={(v) => onChange({ decision: v })}
            options={[
              { v: "", label: "Offen" },
              { v: "own", label: "Ich" },
              { v: "rules", label: "Regelwerk" },
              { v: "ai", label: "KI" },
            ]}
          />
        </Field>
      </div>

      <div className="grid gap-3 rounded-2xl border border-line bg-ink-950/40 p-3 sm:p-3.5">
        <Segmented<Tab>
          aria-label="Ausführungsdetails"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { v: "fills", label: <TabLabel text="Fills" n={j.fills.length} /> },
            { v: "targets", label: <TabLabel text="TP-Leiter" n={j.targets.length} /> },
            { v: "stops", label: <TabLabel text="Stop-Verlauf" n={j.stops.length} /> },
          ]}
        />
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: tween.exit }} transition={{ opacity: tween.fade, y: spring.enter }}>
              {tab === "fills" ? (
                <FillsEditor rows={j.fills} onChange={(fills) => onChange({ fills })} side={side} date={date} currency={currency} />
              ) : tab === "targets" ? (
                <TargetsEditor rows={j.targets} onChange={(targets) => onChange({ targets })} side={side} entry={entry} stop={stop} />
              ) : (
                <StopsEditor rows={j.stops} onChange={(stops) => onChange({ stops })} date={date} />
              )}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
      </div>
    </div>
  );
}

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {n > 0 && <span className="rounded-full bg-white/10 px-1.5 font-mono text-[10px] leading-4 text-fg/80">{n}</span>}
    </span>
  );
}

/** Small icon button that removes a row. */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition-colors hover:border-loss/50 hover:text-loss pointer-coarse:size-11"
    >
      <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  const reduced = useReducedFx();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={reduced || disabled ? undefined : { scale: 0.96 }}
      transition={spring.press}
      className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-[12px] text-mute transition-colors hover:border-white/40 hover:text-fg disabled:opacity-40 pointer-coarse:min-h-11"
    >
      {children}
    </motion.button>
  );
}

/** Rows container: rows rise in one after another on mount, new rows on their own; exits fade (`tween.exit`). */
function Rows<T extends { id: string }>({ rows, render, label }: { rows: readonly T[]; render: (row: T, i: number) => ReactNode; label: string }) {
  const reduced = useReducedFx();
  return (
    <ol className="grid gap-2" aria-label={label}>
      <AnimatePresence initial={false}>
        {rows.map((row, i) => (
          <motion.li
            key={row.id}
            layout="position"
            variants={ROW}
            initial={reduced ? false : "hidden"}
            animate="shown"
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ layout: spring.layout, y: { ...spring.enter, delay: Math.min(i, stagger.max) * stagger.rows }, opacity: tween.fade }}
            className="rounded-xl border border-line bg-ink-900/60 p-2"
            style={{ borderRadius: radius.input }}
          >
            {render(row, i)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/* ------------------------------------------------------------------ fills */

function FillsEditor({ rows, onChange, side, date, currency }: { rows: FillRow[]; onChange: (rows: FillRow[]) => void; side: Side; date: string; currency: string }) {
  const fills = useMemo(() => fillsOf(rows), [rows]);
  const stats = useMemo(() => fillStats(fills, side), [fills, side]);
  const kindOf = useMemo(() => new Map(fills.map((f) => [f.id, f.kind] as const)), [fills]);
  const openLabel = side === "short" ? "Verkauf" : "Kauf";
  const closeLabel = side === "short" ? "Kauf" : "Verkauf";
  const patch = (id: string, p: Partial<FillRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const hasOpen = rows.some((r) => r.side === "open");

  return (
    <div className="grid gap-3">
      {stats.openQty > 0 && (
        <div className="grid gap-2">
          <FillsBar stats={stats} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] sm:grid-cols-4">
            <Stat label="Ø Einstieg" value={fmtPrice(stats.avgEntry)} />
            <Stat label="Ø Ausstieg" value={stats.avgExit == null ? "–" : fmtPrice(stats.avgExit)} />
            <Stat label="Realisiert" value={<MotionNumber value={stats.realized} decimals={2} signed tone="auto" suffix={` ${currency}`} aria-label={`${signed(stats.realized)} ${currency}`} />} />
            <Stat label="Offen" value={stats.remaining > 0 ? `${trimNum(stats.remaining)} von ${trimNum(stats.openQty)}` : "flat"} />
            {stats.dca && <Stat label="DCA" value={`${stats.dca.entries} Einstiege · ${signed(stats.dca.improvement * 100, 1)} %`} wide />}
          </dl>
        </div>
      )}
      {rows.length > 0 && (
        <Rows
          rows={rows}
          label="Fills"
          render={(r, i) => (
            <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2 sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)_auto] sm:items-center">
              <button
                type="button"
                onClick={() => patch(r.id, { side: r.side === "open" ? "close" : "open" })}
                aria-label={`Fill ${i + 1}: ${r.side === "open" ? openLabel : closeLabel} – wechseln`}
                className={cn(
                  "min-w-[5.6rem] rounded-full border px-2.5 py-1 text-left text-[11.5px] font-semibold transition-colors pointer-coarse:min-h-11",
                  r.side === "open" ? "border-white/25 text-fg" : side === "short" ? "border-win/40 text-win" : "border-loss/40 text-(--color-danger-text)",
                )}
              >
                {r.side === "open" ? openLabel : closeLabel}
                <span className="block text-[9.5px] font-normal uppercase tracking-[0.1em] text-faint">{FILL_KIND_LABELS[kindOf.get(r.id) ?? (r.side === "open" ? "entry" : "exit")]}</span>
              </button>
              <Input type="datetime-local" aria-label={`Fill ${i + 1} Zeit`} value={r.at} onChange={(e) => patch(r.id, { at: e.target.value })} className="!px-2 text-[12px]" wrapperClassName="max-sm:col-span-1" />
              <span className="sm:hidden">
                <RemoveButton label={`Fill ${i + 1} entfernen`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} />
              </span>
              <Input numeric aria-label={`Fill ${i + 1} Preis`} placeholder="Preis" value={r.price} onChange={(e) => patch(r.id, { price: e.target.value })} wrapperClassName="max-sm:col-span-3" />
              <div className="grid grid-cols-2 gap-2 max-sm:col-span-3 sm:contents">
                <Input numeric aria-label={`Fill ${i + 1} Menge`} placeholder="Menge" value={r.qty} onChange={(e) => patch(r.id, { qty: e.target.value })} />
                <Input numeric aria-label={`Fill ${i + 1} Gebühr`} placeholder="Gebühr" value={r.fee} onChange={(e) => patch(r.id, { fee: e.target.value })} />
              </div>
              <span className="hidden sm:block">
                <RemoveButton label={`Fill ${i + 1} entfernen`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} />
              </span>
            </div>
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!hasOpen ? (
          <AddButton onClick={() => onChange([...rows, newFillRow("open", date)])}>+ Einstieg</AddButton>
        ) : (
          <>
            <AddButton onClick={() => onChange([...rows, newFillRow("open")])}>+ Nachkauf</AddButton>
            <AddButton onClick={() => onChange([...rows, newFillRow("close")])}>+ Teil-Exit</AddButton>
          </>
        )}
        <span className="text-[11px] text-faint">{rows.length ? "Einstieg, Ausstieg und Größe kommen aus den Fills." : "Mehrere Einstiege (DCA) oder Teil-Exits? Hier eintragen."}</span>
      </div>
    </div>
  );
}

function trimNum(v: number): string {
  return v.toLocaleString("de-DE", { maximumFractionDigits: 6 });
}

function Stat({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-2 border-b border-line/60 pb-1", wide && "col-span-2")}>
      <dt className="text-faint">{label}</dt>
      <dd className="num whitespace-nowrap font-mono text-fg/85">{value}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- targets */

function TargetsEditor({ rows, onChange, side, entry, stop }: { rows: TargetRow[]; onChange: (rows: TargetRow[]) => void; side: Side; entry: number | null; stop: number | null }) {
  const patch = (id: string, p: Partial<TargetRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const total = rows.reduce((a, r) => a + (parseNumber(r.pct) ?? 0), 0);
  return (
    <div className="grid gap-3">
      <Ladder rows={rows} side={side} entry={entry} stop={stop} />
      {rows.length > 0 && (
        <Rows
          rows={rows}
          label="TP-Leiter"
          render={(r, i) => (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,.7fr)_auto_auto] items-center gap-2">
              <Input numeric aria-label={`Ziel ${i + 1} Preis`} placeholder={`TP ${i + 1}`} value={r.price} onChange={(e) => patch(r.id, { price: e.target.value })} />
              <Input numeric aria-label={`Ziel ${i + 1} Anteil in Prozent`} placeholder="%" value={r.pct} onChange={(e) => patch(r.id, { pct: e.target.value })} />
              <button
                type="button"
                aria-pressed={r.hit}
                onClick={() => patch(r.id, { hit: !r.hit })}
                className={cn("rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors pointer-coarse:min-h-11", r.hit ? "border-win/50 bg-win/[0.12] text-win" : "border-line-2 text-mute hover:text-fg")}
              >
                {r.hit ? "✓ Erreicht" : "Erreicht?"}
              </button>
              <RemoveButton label={`Ziel ${i + 1} entfernen`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} />
            </div>
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <AddButton onClick={() => onChange([...rows, newTargetRow()])} disabled={rows.length >= 8}>
          + Ziel
        </AddButton>
        <span className={cn("text-[11px]", total > 100 ? "text-(--color-danger-text)" : "text-faint")}>{rows.length ? `${trimNum(total)} % der Position verteilt` : "Teilziele mit Anteil – z. B. 50 % bei TP 1."}</span>
      </div>
    </div>
  );
}

/** Mini ladder: stop, entry and the rungs on one price axis (hit rungs lit). Decorative. */
function Ladder({ rows, side, entry, stop }: { rows: TargetRow[]; side: Side; entry: number | null; stop: number | null }) {
  const reduced = useReducedFx();
  const prices = rows.map((r) => ({ id: r.id, p: parseNumber(r.price), hit: r.hit })).filter((x): x is { id: string; p: number; hit: boolean } => x.p != null && x.p > 0);
  const all = [...prices.map((x) => x.p), entry ?? NaN, stop ?? NaN].filter((v) => Number.isFinite(v) && v > 0);
  if (all.length < 2) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pos = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  // long: low → high reads left → right; short: mirrored so the targets always sit to the right
  const x = (v: number) => (side === "short" ? 100 - pos(v) : pos(v));
  return (
    <div aria-hidden="true" className="relative mx-2 h-9">
      <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      {stop != null && stop > 0 && <Tick x={x(stop)} tone="loss" label="SL" />}
      {entry != null && entry > 0 && <Tick x={x(entry)} tone="fg" label="E" />}
      {prices.map((t, i) => (
        <motion.span key={t.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(t.p)}%` }} initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={spring.pop}>
          <Tick x={0} tone={t.hit ? "win" : "mute"} label={`${i + 1}`} inline />
        </motion.span>
      ))}
    </div>
  );
}

function Tick({ x, tone, label, inline }: { x: number; tone: "win" | "loss" | "fg" | "mute"; label: string; inline?: boolean }) {
  const color = tone === "win" ? "bg-win" : tone === "loss" ? "bg-loss" : tone === "fg" ? "bg-fg" : "bg-mute";
  const text = tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : tone === "fg" ? "text-fg" : "text-mute";
  return (
    <span className={cn("grid justify-items-center gap-0.5", !inline && "absolute top-1/2 -translate-x-1/2 -translate-y-[30%]")} style={inline ? undefined : { left: `${x}%` }}>
      <span className={cn("size-2 rounded-full", color)} />
      <span className={cn("font-mono text-[9.5px] leading-none", text)}>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ stops */

function StopsEditor({ rows, onChange, date }: { rows: StopRow[]; onChange: (rows: StopRow[]) => void; date: string }) {
  const patch = (id: string, p: Partial<StopRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <div className="grid gap-3">
      {rows.length > 0 && (
        <Rows
          rows={rows}
          label="Stop-Verlauf"
          render={(r, i) => (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <Input type="datetime-local" aria-label={`Stop ${i + 1} Zeit`} value={r.at} onChange={(e) => patch(r.id, { at: e.target.value })} className="!px-2 text-[12px]" />
              <Input numeric aria-label={`Stop ${i + 1} Preis`} placeholder="Neuer Stop" value={r.price} onChange={(e) => patch(r.id, { price: e.target.value })} />
              <span className="sm:hidden">
                <RemoveButton label={`Stop ${i + 1} entfernen`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} />
              </span>
              <Input aria-label={`Stop ${i + 1} Notiz`} placeholder="Warum? (z. B. Break-even)" value={r.note} onChange={(e) => patch(r.id, { note: e.target.value })} wrapperClassName="max-sm:col-span-3" maxLength={80} />
              <span className="hidden sm:block">
                <RemoveButton label={`Stop ${i + 1} entfernen`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} />
              </span>
            </div>
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <AddButton onClick={() => onChange([...rows, newStopRow(rows.length ? "" : date)])} disabled={rows.length >= 12}>
          + Stop verschoben
        </AddButton>
        <span className="text-[11px] text-faint">{rows.length ? "Ältester zuerst." : "Hast du den Stop nachgezogen? Halte es fest."}</span>
      </div>
    </div>
  );
}
