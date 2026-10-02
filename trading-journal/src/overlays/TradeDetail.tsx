import { AnimatePresence, motion, type Variants } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CONVICTION_LEVELS } from "@/domain/defaults";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { colorClass, date, n0, n1, n2, pct, price, r as fmtR, signed, time } from "@/lib/format";
import type { Candle } from "@/market/types";
import { useDialogBehaviour } from "@/motion/a11y";
import { MotionNumber } from "@/motion/MotionNumber";
import { BODY_REVEAL_AT, STAGGER_HIDDEN, STAGGER_SHOWN, StaggerItem, sectionDelay } from "@/motion/Stagger";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button, Skeleton } from "@/primitives";
import { useEnriched, useJournal } from "@/store/journalStore";
import { pushToast, useUi } from "@/store/uiStore";
import { HoldConfirm, confirmSwapMotion, useConfirmFocus } from "@/motion/HoldConfirm";
import { useOverlayLane } from "@/primitives/toastStore";

/** Lazy: keeps `lightweight-charts` in its own chunk (loaded the first time a detail with candles opens). */
const MiniTradeChart = lazy(() => import("@/chart/MiniTradeChart").then((m) => ({ default: m.MiniTradeChart })));
const MINI_CHART_HEIGHT = 160;

export interface TradeDetailProps {
  /**
   * 1h candles around the trade (±3 days) for the `MiniTradeChart` slot; the integrator slices the market cache.
   * Without candles the chart is not rendered.
   */
  candles?: Candle[];
  /** `Bearbeiten` override (default: `useUi().editFromDetail(id)` – the editor opens over the detail's fading dim). */
  onEdit?: (id: string) => void;
  className?: string;
}

/**
 * Trade detail dialog (bundle `q$`, Plan 6.2 / 2.5 "Trade-Detail"): backdrop `z-[58] bg-black/70`, panel `z-[59]`
 * `max-w-[460px]` `borderRadius 28` with `layoutId="trade-{id}"` (shared with the recent-trades row, the table ghost,
 * the mobile card or the chart-marker ghost) on `spring.detail`; `trade-side-{id}` / `trade-pnl-{id}` travel along.
 * Facts, setups, checklist (`CheckRow` discs), conviction/plan/emotion, `Warum`/`Learning`, optional mini chart,
 * `Chart öffnen ↗`, `Schließen | Bearbeiten | Löschen` (inline confirm). Escape/backdrop close, focus trap.
 * Like `MorphDialog`: the fixed wrapper is the backdrop click target (the dim layer is decorative), the drop shadow
 * lives on an unscaled sibling that fades in once the morph settled, and `inert` / the focus return wait for the
 * morph (open) and the exit (close) via `useDialogBehaviour(…, { settled })`.
 *
 * Motion: the body sections cascade in a beat into the morph (`stagger.sections`) – fact tiles one by one, then the
 * checklist with its discs popping (`spring.pop`, `stagger.rows`), then meta and actions. `Löschen` is a
 * `HoldConfirm`: a click still asks inline, holding it deletes right away; the footer swaps between the actions and
 * the confirmation out-then-in (`AnimatePresence mode="wait"`, fixed min height), never in one frame (TR-06).
 *
 * `Bearbeiten` (TR-05) hands off in one store update (`editFromDetail`): while the detail panel fades out ABOVE the
 * editor's dim (its wrapper is lifted over the sheet layer for the exit and its own dim leaves at once), the sheet's
 * dim starts at this dim's level and the editor panel enters after the exit – the page never shows through.
 * The mini chart (the heaviest part of the body) mounts once the morph has settled (PF-01).
 */
export function TradeDetail({ candles, onEdit, className }: TradeDetailProps) {
  const detail = useUi((s) => s.detail);
  const closeDetail = useUi((s) => s.closeDetail);
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const deleteTrade = useJournal((s) => s.deleteTrade);
  const editFromDetail = useUi((s) => s.editFromDetail);
  // the editor took over from this detail (exit variants read it through `AnimatePresence custom`)
  const handoff = useUi((s) => s.editor.open && s.editor.fromDetail === true);
  const trade = detail.id ? enriched.find((t) => t.id === detail.id) : undefined;
  const open = Boolean(trade);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => closeDetail(), [closeDetail]);
  // `settled`: false from the moment a trade opens until its morph (or plain enter) completes, and again from the
  // close until the exit completed – so `inert` and the focus return stay out of the morph / exit frames
  const shownId = trade?.id ?? null;
  const [phase, setPhase] = useState<{ id: string | null; settled: boolean }>({ id: null, settled: true });
  // adjust during render (open, switch or close): the effects of this very commit already see `settled: false`
  if (shownId !== phase.id) setPhase({ id: shownId, settled: false });
  const markSettled = (id: string) => setPhase((p) => (p.id === id && !p.settled ? { id, settled: true } : p));
  // after a delete the row that opened the detail is gone: focus its neighbour (or the list heading) instead of <body>
  const focusAfterDelete = useRef<HTMLElement | null>(null);
  const fallbackFocus = useCallback(() => {
    const el = focusAfterDelete.current;
    focusAfterDelete.current = null;
    return el?.isConnected && !el.closest("[inert]") ? el : null;
  }, []);
  useDialogBehaviour(panelRef, open, close, { settled: phase.settled, fallbackFocus });
  useOverlayLane(open);

  const edit = (id: string) => {
    if (onEdit) onEdit(id);
    else editFromDetail(id);
  };

  const remove = async (id: string) => {
    focusAfterDelete.current = deleteNeighbour(id);
    await deleteTrade(id);
    pushToast({ kind: "info", title: "Trade gelöscht" });
    closeDetail();
  };

  return (
    <AnimatePresence custom={handoff} onExitComplete={() => setPhase((p) => (p.id === null ? { id: null, settled: true } : p))}>
      {trade && (
        // decorative dim layer: clicks pass through to the wrapper below it in the DOM order (never made inert)
        <motion.div
          key="bg"
          className="pointer-events-none fixed inset-0 z-[58] bg-black/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          variants={DIM_VARIANTS}
          exit="exit"
          transition={tween.fade}
          aria-hidden="true"
        />
      )}
      {trade && (
        // the backdrop click target is this wrapper – an ancestor of the panel, so `useInertOutside` never disables it;
        // it is also the fixed `layoutRoot` (on the panel itself Motion would skip the row → detail morph)
        <motion.div
          key="wrap"
          layoutRoot
          className={cn("fixed inset-0 z-[59] grid place-items-center p-4", className)}
          variants={WRAP_VARIANTS}
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="pointer-events-none relative w-full max-w-[460px]">
            {/* the big shadow sits on an unscaled sibling and fades in after the morph: no per-frame shadow repaint */}
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 shadow-[0_30px_80px_rgb(0_0_0/0.6)]"
              style={{ borderRadius: radius.dialog }}
              initial={{ opacity: 0 }}
              animate={{ opacity: phase.settled && phase.id === trade.id ? 1 : 0 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={tween.fade}
            />
            <motion.div
              ref={panelRef}
              layoutId={`trade-${trade.id}`}
              // opaque take-over: the source (row ghost, card, recent row) hides instead of following the panel
              // translucently over its neighbours for as long as the detail is open
              layoutCrossfade={false}
              role="dialog"
              aria-modal="true"
              aria-label="Trade-Details"
              style={{ borderRadius: radius.dialog }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
              transition={{ ...spring.detail, layout: spring.detail }}
              onAnimationComplete={() => markSettled(trade.id)}
              onLayoutAnimationComplete={() => markSettled(trade.id)}
              className="pointer-events-auto relative max-h-[92vh] w-full overflow-y-auto rounded-[28px] border border-line-2 bg-gradient-to-b from-ink-750 to-ink-850 outline-none"
            >
              <DetailContent
                trade={trade}
                setups={settings.setups}
                currency={settings.currency}
                candles={candles}
                settled={phase.settled && phase.id === trade.id}
                onClose={close}
                onEdit={() => edit(trade.id)}
                onDelete={() => remove(trade.id)}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Dim level the editor's sheet dim starts from on a hand-off (black/70 ≈ ink-950/80 × .875). */
export const DETAIL_DIM_HANDOFF = 0.875;
/** On a hand-off the dim leaves at once (the sheet's dim has taken over its level) … */
const DIM_VARIANTS: Variants = {
  exit: (handoff: boolean) => ({ opacity: 0, transition: handoff ? { duration: 0 } : tween.exit }),
};
/** … and the leaving panel is lifted above the sheet layer (z 60) so its fade is never dimmed mid-way. */
const WRAP_VARIANTS: Variants = {
  exit: (handoff: boolean) => (handoff ? { zIndex: 61, transition: { duration: 0 } } : { zIndex: 59, transition: { duration: 0 } }),
};

/** Rendered (not `display:none`, e.g. the hidden keep-alive overview) and not on its way out. */
function shown(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.getClientRects().length > 0 && !el.closest("[data-exiting]");
}

/**
 * Focus target for after deleting trade `id`: the next shown `[data-trade-id]` element (table row, mobile card,
 * recent-trades row) in its `[data-trade-list]`, else the previous one, else the nearest heading above the list (made
 * programmatically focusable). `null` when the trade has no list element (e.g. opened from a chart marker).
 */
export function deleteNeighbour(id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const all = Array.from(document.querySelectorAll("[data-trade-id]")).filter(shown);
  const i = all.findIndex((el) => el.dataset.tradeId === id);
  if (i < 0) return null;
  const src = all[i] as HTMLElement;
  const list = src.closest("[data-trade-list]");
  if (!list) return null;
  const sameList = (el: HTMLElement | undefined) => (el && list.contains(el) ? el : null);
  const neighbour = sameList(all[i + 1]) ?? sameList(all[i - 1]);
  if (neighbour) return neighbour;
  let heading: HTMLElement | null = null;
  for (let node = list.parentElement; node && !heading; node = node.parentElement) heading = node.querySelector<HTMLElement>("h1, h2, h3");
  if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

/* --------------------------------------------------------------- content */

/** Body sections start revealing ≈ 65 % into the (time-defined) detail morph, like every overlay body (OV-06). */
const DETAIL_BODY_DELAY = Math.round(spring.detail.duration * BODY_REVEAL_AT * 1000) / 1000;
/** Body: orchestrates its `StaggerItem` sections from `DETAIL_BODY_DELAY` on. */
const BODY: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: { delayChildren: sectionDelay(DETAIL_BODY_DELAY) } },
};
/** Fact tiles cascade inside their section (`stagger.cards`). */
const TILES: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: { delayChildren: (i: number) => Math.min(i, stagger.max) * stagger.cards } },
};
/** Checklist discs pop one after another (`stagger.rows`) once their section is in. */
const DISCS: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: { delayChildren: (i: number) => Math.min(i, stagger.max) * stagger.rows } },
};
const DISC: Variants = {
  [STAGGER_HIDDEN]: { scale: 0.4, opacity: 0 },
  [STAGGER_SHOWN]: { scale: 1, opacity: 1, transition: { scale: spring.pop, opacity: tween.fade } },
};

interface DetailContentProps {
  trade: EnrichedTrade;
  setups: readonly Setup[];
  currency: string;
  candles?: Candle[];
  /** Open morph finished: heavy parts (mini chart) mount now. */
  settled: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

function DetailContent({ trade: e, setups, currency, candles, settled, onClose, onEdit, onDelete }: DetailContentProps) {
  const reduced = useReducedFx();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const { trigger: deleteTrigger, no: deleteNo } = useConfirmFocus(confirm);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingDelete = useRef<(() => void) | null>(null);
  // a confirmed hold is never lost: closing the dialog during the check beat deletes right away
  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      const run = pendingDelete.current;
      pendingDelete.current = null;
      run?.();
    },
    [],
  );
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
  // a completed hold lets the drawn check land before the dialog leaves
  const deleteAfterHold = () => {
    clearTimeout(holdTimer.current);
    pendingDelete.current = () => void onDelete().catch(() => {});
    holdTimer.current = setTimeout(() => {
      pendingDelete.current = null;
      void del();
    }, reduced ? 0 : tween.check.duration * 1000);
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

      <motion.div className="grid gap-4 px-5 pb-5" variants={BODY} initial={reduced ? false : STAGGER_HIDDEN} animate={STAGGER_SHOWN} exit={{ opacity: 0, transition: tween.exit }}>
        {/* numbers are never ellipsized (MO-01): two columns below `sm`, values keep their full width */}
        <motion.dl className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-4" variants={TILES}>
          {facts.map(([label, value]) => (
            <StaggerItem key={label} className="min-w-0 rounded-xl border border-line bg-ink-950/60 px-2.5 py-2">
              <dt className="label !text-[9.5px]">{label}</dt>
              <dd className="num mt-0.5 whitespace-nowrap font-mono text-[12.5px]">{value}</dd>
            </StaggerItem>
          ))}
        </motion.dl>
        <StaggerItem>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] min-[420px]:grid-cols-3">
            {more.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1">
                <dt className="text-faint">{label}</dt>
                <dd className="num whitespace-nowrap font-mono text-fg/85">{value}</dd>
              </div>
            ))}
          </dl>
        </StaggerItem>

        {used.length > 0 && (
          <StaggerItem className="flex flex-wrap gap-1.5" aria-label="Grundlagen">
            {used.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 text-[11.5px]">
                <span className="size-1.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </span>
            ))}
          </StaggerItem>
        )}

        <StaggerItem>
          <div className="mb-1.5 flex justify-between text-[11.5px]">
            <span className="label">Checkliste</span>
            <span className="font-mono text-mute">{`${e.checked}/${e.items.length}`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              className={cn("h-full rounded-full", e.complete ? "bg-win" : "bg-white")}
              style={{ transformOrigin: "left", width: "100%" }}
              variants={{ [STAGGER_HIDDEN]: { scaleX: 0 }, [STAGGER_SHOWN]: { scaleX: ratio, transition: tween.bar } }}
              aria-hidden="true"
            />
          </div>
          {e.items.length > 0 && (
            <motion.ul className="mt-2 grid gap-1" variants={DISCS}>
              {e.items.map((it) => (
                <CheckRow key={it.id} state={e.checks?.[it.id] ? "yes" : e.result === "open" ? "none" : "no"}>
                  {it.text}
                </CheckRow>
              ))}
            </motion.ul>
          )}
        </StaggerItem>

        <StaggerItem>
          <dl className="grid grid-cols-3 gap-2 text-[11.5px]">
            <Meta label="Überzeugung">{conviction ? `${conviction.v} · ${conviction.label}` : "–"}</Meta>
            <Meta label="Plan befolgt">{e.followedPlan == null ? "–" : e.followedPlan ? "Ja" : "Nein"}</Meta>
            <Meta label="Gefühl">{e.emotion || "–"}</Meta>
          </dl>
        </StaggerItem>

        {(e.reason || e.notes) && (
          <StaggerItem className="grid gap-2 text-[12.5px] leading-relaxed">
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
          </StaggerItem>
        )}

        {candles && candles.length > 0 && (
          <StaggerItem>
            {settled ? (
              <Suspense fallback={<Skeleton height={MINI_CHART_HEIGHT} />}>
                <MiniTradeChart candles={candles} trade={e} height={MINI_CHART_HEIGHT} />
              </Suspense>
            ) : (
              <Skeleton height={MINI_CHART_HEIGHT} />
            )}
          </StaggerItem>
        )}

        <StaggerItem className="flex items-center justify-between gap-2">
          {e.chart ? (
            <a href={e.chart} target="_blank" rel="noreferrer" className="label !text-fg underline-offset-4 hover:underline">
              Chart öffnen ↗
            </a>
          ) : (
            <span />
          )}
          <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
            {err && (
              <span role="alert" className="text-[12px] font-medium text-[#ff8a90]">
                {err}
              </span>
            )}
            <AnimatePresence mode="wait" initial={false}>
              {confirm ? (
                <motion.span key="confirm" className="flex flex-wrap items-center justify-end gap-2 text-[12.5px] text-[#ff8a90]" {...confirmSwapMotion(reduced)}>
                  Wirklich löschen?
                  <Button size="sm" variant="danger" onClick={() => void del()}>
                    Ja, löschen
                  </Button>
                  <Button ref={deleteNo} size="sm" onClick={() => setConfirm(false)}>
                    Nein
                  </Button>
                </motion.span>
              ) : (
                <motion.span key="actions" className="flex flex-wrap items-center justify-end gap-2" {...confirmSwapMotion(reduced)}>
                  <HoldConfirm ref={deleteTrigger} size="sm" onAsk={() => setConfirm(true)} onConfirm={deleteAfterHold}>
                    Löschen
                  </HoldConfirm>
                  <Button size="sm" onClick={onClose}>
                    Schließen
                  </Button>
                  <Button size="sm" variant="primary" onClick={onEdit}>
                    Bearbeiten
                  </Button>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </StaggerItem>
      </motion.div>
    </>
  );
}

/**
 * Bundle `F$` disc: ✓ (`bg-win/20 text-win`), ✕ (`bg-loss/15 text-loss`), · (`bg-white/10 text-mute`). Inside the
 * detail body the discs pop in one after another (`spring.pop`, `stagger.rows`); elsewhere they render statically.
 */
export function CheckRow({ state, children }: { state: "yes" | "no" | "none"; children: ReactNode }) {
  const disc = state === "yes" ? "bg-win/20 text-win" : state === "no" ? "bg-loss/15 text-loss" : "bg-white/10 text-mute";
  const glyph = state === "yes" ? "✓" : state === "no" ? "✕" : "·";
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <motion.span variants={DISC} className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold", disc)} aria-hidden="true">
        {glyph}
      </motion.span>
      <span className="sr-only">{state === "yes" ? "erfüllt" : state === "no" ? "nicht erfüllt" : "offen"}</span>
      <span className={state === "yes" ? "text-fg/85" : "text-mute"}>{children}</span>
    </li>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink-950/40 px-2.5 py-1.5">
      <dt className="label !text-[9.5px]">{label}</dt>
      <dd className="mt-0.5 break-words text-[12px] text-fg/85">{children}</dd>
    </div>
  );
}
