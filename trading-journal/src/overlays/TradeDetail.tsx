import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { CONVICTION_LEVELS } from "@/domain/defaults";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date, n0, n1, n2, pct, price, r as fmtR, signed, time } from "@/lib/format";
import type { Candle } from "@/market/types";
import { useDialogBehaviour } from "@/motion/a11y";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, Skeleton } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { pushToast, useUi } from "@/store/uiStore";

/** Lazy: keeps `lightweight-charts` in its own chunk (loaded the first time a detail with candles opens). */
const MiniTradeChart = lazy(() => import("@/chart/MiniTradeChart").then((m) => ({ default: m.MiniTradeChart })));
const MINI_CHART_HEIGHT = 160;

export interface TradeDetailProps {
  /**
   * 1h candles around the trade (±3 days) for the `MiniTradeChart` slot; the integrator slices the market cache.
   * Without candles the chart is not rendered.
   */
  candles?: Candle[];
  /** `Bearbeiten` override (default: close the detail, then `useUi().openEditor({ tradeId })` after the exit). */
  onEdit?: (id: string) => void;
  className?: string;
}

/**
 * Trade detail dialog (bundle `q$`, Plan 6.2 / 2.5 "Trade-Detail"): backdrop `z-[58] bg-black/70`, panel `z-[59]`
 * `max-w-[460px]` `borderRadius 28` with `layoutId="trade-{id}"` (shared with the recent-trades row, the table ghost,
 * the mobile card or the chart-marker ghost) on `spring.detail`; `trade-side-{id}` / `trade-pnl-{id}` travel along.
 * Facts, setups, checklist (`CheckRow` discs), conviction/plan/emotion, `Warum`/`Learning`, optional mini chart,
 * `Chart öffnen ↗`, `Schließen | Bearbeiten | Löschen` (inline confirm). Escape/backdrop close, focus trap.
 */
export function TradeDetail({ candles, onEdit, className }: TradeDetailProps) {
  const detail = useUi((s) => s.detail);
  const closeDetail = useUi((s) => s.closeDetail);
  const openEditor = useUi((s) => s.openEditor);
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const deleteTrade = useJournal((s) => s.deleteTrade);
  const trade = detail.id ? enriched.find((t) => t.id === detail.id) : undefined;
  const open = Boolean(trade);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingEdit = useRef<string | null>(null);

  const close = useCallback(() => closeDetail(), [closeDetail]);
  useDialogBehaviour(panelRef, open, close);

  const edit = (id: string) => {
    if (onEdit) {
      onEdit(id);
      return;
    }
    // Plan 3.3 "Detail → Editor": no shared layoutId; the sheet enters after the detail's exit completed.
    pendingEdit.current = id;
    closeDetail();
  };

  const remove = async (id: string) => {
    await deleteTrade(id);
    pushToast({ kind: "info", title: "Trade gelöscht" });
    closeDetail();
  };

  return (
    <AnimatePresence
      onExitComplete={() => {
        const id = pendingEdit.current;
        if (!id) return;
        pendingEdit.current = null;
        openEditor({ tradeId: id });
      }}
    >
      {trade && (
        <motion.div key="bg" className="fixed inset-0 z-[58] bg-black/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade} onClick={close} aria-hidden="true" />
      )}
      {trade && (
        <div key="wrap" className={cn("pointer-events-none fixed inset-0 z-[59] grid place-items-center p-4", className)}>
          <motion.div
            ref={panelRef}
            layoutId={`trade-${trade.id}`}
            layoutRoot
            role="dialog"
            aria-modal="true"
            aria-label="Trade-Details"
            style={{ borderRadius: radius.dialog }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
            transition={{ ...spring.detail, layout: spring.detail }}
            className="pointer-events-auto max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-[28px] border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 shadow-[0_30px_80px_rgb(0_0_0/0.6)] outline-none"
          >
            <DetailContent trade={trade} setups={settings.setups} currency={settings.currency} candles={candles} onClose={close} onEdit={() => edit(trade.id)} onDelete={() => remove(trade.id)} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------------- content */

interface DetailContentProps {
  trade: EnrichedTrade;
  setups: readonly Setup[];
  currency: string;
  candles?: Candle[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

function DetailContent({ trade: e, setups, currency, candles, onClose, onEdit, onDelete }: DetailContentProps) {
  const reduced = useReducedFx();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const used = setups.filter((s) => (e.setups || []).includes(s.id));
  const d = tradeTime(e);
  const ratio = e.items.length ? e.checked / e.items.length : 0;
  const conviction = e.conviction ? CONVICTION_LEVELS.find((c) => c.v === e.conviction) : undefined;

  const facts: [string, string][] = [
    ["Einstieg", price(e.entry)],
    ["Ausstieg", e.result === "open" ? "–" : price(e.exit)],
    ["R", fmtR(e.r)],
    ["Bewegung", pct(e.move)],
  ];
  const more: [string, string][] = [
    ["Stop", e.stop == null ? "–" : price(e.stop)],
    ["Ziel", e.target == null ? "–" : price(e.target)],
    ["Größe", e.size == null ? "–" : `${n0(e.size)} ${currency}`],
    ["Hebel", e.leverage == null ? "–" : `${n1(e.leverage).replace(",0", "")}x`],
    ["Gebühren", e.fees == null ? "–" : `${n2(e.fees)} ${currency}`],
    ["CRV", e.rr == null ? "–" : `1 : ${n2(e.rr)}`],
  ];

  const del = async () => {
    try {
      await onDelete();
    } catch {
      setErr("Löschen fehlgeschlagen.");
      setConfirm(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div>
          <motion.div layoutId={`trade-side-${e.id}`} layout="position" className={cn("font-mono text-xs font-semibold uppercase tracking-[0.12em]", e.side === "short" ? "text-loss" : "text-win")}>
            {e.side === "short" ? "▼ Short" : "▲ Long"} · {e.account === "makro" ? "Makro" : "Scalp"}
          </motion.div>
          <div className="mt-1 text-[12px] text-mute">
            {date(d)} {time(d)}
            {e.timeframe ? ` · ${e.timeframe}` : ""} · {e.pair}
          </div>
        </div>
        <motion.div layoutId={`trade-pnl-${e.id}`} layout="position" className={cn("dot-num text-[30px] leading-none", colorClass(e.pnl))} data-testid="detail-pnl">
          {e.pnl == null ? "offen" : <MotionNumber value={e.pnl} decimals={2} signed tone="auto" aria-label={signed(e.pnl)} />}
        </motion.div>
      </div>

      <motion.div className="grid gap-4 px-5 pb-5" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.body}>
        <dl className="grid grid-cols-4 gap-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-ink-950/60 px-2.5 py-2">
              <dt className="label !text-[9.5px]">{label}</dt>
              <dd className="num mt-0.5 truncate font-mono text-[12.5px]">{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11.5px]">
          {more.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1">
              <dt className="text-faint">{label}</dt>
              <dd className="num truncate font-mono text-fg/85">{value}</dd>
            </div>
          ))}
        </dl>

        {used.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Grundlagen">
            {used.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 text-[11.5px]">
                <span className="size-1.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </span>
            ))}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex justify-between text-[11.5px]">
            <span className="label">Checkliste</span>
            <span className="font-mono text-mute">{`${e.checked}/${e.items.length}`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className={cn("h-full rounded-full", e.complete ? "bg-win" : "bg-white")}
              style={{ transformOrigin: "left", width: "100%" }}
              initial={reduced ? false : { scaleX: 0 }}
              animate={{ scaleX: ratio }}
              transition={{ ...tween.bar, delay: reduced ? 0 : 0.2 }}
              aria-hidden="true"
            />
          </div>
          {e.items.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {e.items.map((it) => (
                <CheckRow key={it.id} state={e.checks?.[it.id] ? "yes" : e.result === "open" ? "none" : "no"}>
                  {it.text}
                </CheckRow>
              ))}
            </ul>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-[11.5px]">
          <Meta label="Überzeugung">{conviction ? `${conviction.v} · ${conviction.label}` : "–"}</Meta>
          <Meta label="Plan befolgt">{e.followedPlan == null ? "–" : e.followedPlan ? "Ja" : "Nein"}</Meta>
          <Meta label="Gefühl">{e.emotion || "–"}</Meta>
        </dl>

        {(e.reason || e.notes) && (
          <div className="grid gap-2 text-[12.5px] leading-relaxed">
            {e.reason && (
              <p>
                <span className="label mr-2">Warum</span>
                <span className="text-fg/85">{e.reason}</span>
              </p>
            )}
            {e.notes && (
              <p>
                <span className="label mr-2">Learning</span>
                <span className="text-fg/85">{e.notes}</span>
              </p>
            )}
          </div>
        )}

        {candles && candles.length > 0 && (
          <Suspense fallback={<Skeleton height={MINI_CHART_HEIGHT} />}>
            <MiniTradeChart candles={candles} trade={e} height={MINI_CHART_HEIGHT} />
          </Suspense>
        )}

        <div className="flex items-center justify-between gap-2">
          {e.chart ? (
            <a href={e.chart} target="_blank" rel="noreferrer" className="label !text-fg underline-offset-4 hover:underline">
              Chart öffnen ↗
            </a>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {err && (
              <span role="alert" className="text-[12px] font-medium text-[#ff8a90]">
                {err}
              </span>
            )}
            {confirm ? (
              <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]">
                Wirklich löschen?
                <Button size="sm" variant="danger" onClick={() => void del()}>
                  Ja, löschen
                </Button>
                <Button size="sm" onClick={() => setConfirm(false)}>
                  Nein
                </Button>
              </span>
            ) : (
              <>
                <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
                  Löschen
                </Button>
                <Button size="sm" onClick={onClose}>
                  Schließen
                </Button>
                <Button size="sm" variant="primary" onClick={onEdit}>
                  Bearbeiten
                </Button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

/** Bundle `F$` disc: ✓ (`bg-win/20 text-win`), ✕ (`bg-loss/15 text-loss`), · (`bg-white/10 text-mute`). */
export function CheckRow({ state, children }: { state: "yes" | "no" | "none"; children: ReactNode }) {
  const disc = state === "yes" ? "bg-win/20 text-win" : state === "no" ? "bg-loss/15 text-loss" : "bg-white/10 text-mute";
  const glyph = state === "yes" ? "✓" : state === "no" ? "✕" : "·";
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold", disc)} aria-hidden="true">
        {glyph}
      </span>
      <span className="sr-only">{state === "yes" ? "erfüllt" : state === "no" ? "nicht erfüllt" : "offen"}</span>
      <span className={state === "yes" ? "text-fg/85" : "text-mute"}>{children}</span>
    </li>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/40 px-2.5 py-1.5">
      <dt className="label !text-[9.5px]">{label}</dt>
      <dd className="mt-0.5 truncate text-[12px] text-fg/85">{children}</dd>
    </div>
  );
}
