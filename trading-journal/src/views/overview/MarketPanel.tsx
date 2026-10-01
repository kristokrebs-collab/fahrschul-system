import { AnimatePresence, motion, useTransform } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { checkGlyph, evaluateTrigger, LONG_IN_REACH_LABEL, LONG_INVALIDATION_LABEL, scenario, SHORT_IN_REACH_LABEL, TRIGGER_FOOTER, type CheckRow, type Scenario, type ScenarioTone } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import { dateTime, n0, n1 } from "@/lib/format";
import { priceMv, setBookTop, SOURCE_NAME, STRINGS } from "@/market";
import { TextScramble } from "@/motion/TextScramble";
import { TextShimmer } from "@/motion/TextShimmer";
import { StatusPill } from "@/motion/StatusPill";
import { spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Skeleton } from "@/primitives/Skeleton";
import { useJournal } from "@/store/journalStore";
import { Bar } from "./Bar";
import { ChangeChip, ConnectingPill, FundingBlock, LivePill, LivePrice, OrderFlow, PreviewLine, TriggerDistances } from "./MarketLive";
import { orFallback, triggerFlagsKey } from "./marketMath";
import { jumpFromUnknownPrice, useForceRefresh, useGlide, useMarketPanelView, usePriceClass } from "./useMarket";

export const CHART_CARD_ID = "chart-card";
export const OPEN_CHART_LABEL = "Chart öffnen";
export const WEEKLY_TITLE = "Bärenmarkt-Ende bestätigt?";

const TONE_BOX: Record<ScenarioTone, string> = {
  win: "border-win/30 bg-win/[0.07]",
  loss: "border-loss/30 bg-loss/[0.07]",
  warn: "border-warn/30 bg-warn/[0.07]",
  mute: "border-line-2 bg-white/[0.03]",
};
/** One-shot sweep of a NEW scenario: a brighter tone wash, brightest at its leading edge. */
const TONE_SWEEP: Record<ScenarioTone, string> = {
  win: "border-win/70 bg-gradient-to-r from-win/[0.04] to-win/25",
  loss: "border-loss/70 bg-gradient-to-r from-loss/[0.04] to-loss/25",
  warn: "border-warn/70 bg-gradient-to-r from-warn/[0.04] to-warn/25",
  mute: "border-white/40 bg-gradient-to-r from-white/[0.02] to-white/[0.12]",
};
const TONE_TITLE: Record<ScenarioTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-fg" };
const TONES: ScenarioTone[] = ["win", "loss", "warn", "mute"];

const fadeIn = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } } as const;
/** Badges entering (a trigger comes into reach) pop once; leaving fades. */
const popIn = { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1, transition: spring.pop }, exit: { opacity: 0, transition: tween.exit } } as const;
/** The sweep wipes left → right while it holds, then fades out (second half of `tween.flash`). */
const SWEEP_OPACITY = [1, 1, 0];
const SWEEP_TIMES = [0, 0.55, 1];

/** Bundle `F$`: ✓ / ✕ / · disc + label + value. */
const CheckRowView = memo(function CheckRowView({ label, value, ok }: CheckRow) {
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      <span
        aria-hidden="true"
        className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold", ok == null ? "bg-white/10 text-mute" : ok ? "bg-win/20 text-win" : "bg-loss/15 text-loss")}
      >
        {checkGlyph(ok)}
      </span>
      <span className="min-w-0 flex-1 truncate text-mute">{label}</span>
      <span className="num font-mono text-fg">{value}</span>
    </div>
  );
});

const WeeklyChecks = memo(function WeeklyChecks({ rows, rsiBar, showBar }: { rows: readonly [CheckRow, CheckRow]; rsiBar: number; showBar: boolean }) {
  return (
    <div className="grid gap-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{WEEKLY_TITLE}</div>
      <CheckRowView {...rows[0]} />
      <CheckRowView {...rows[1]} />
      {showBar && <Bar value={rsiBar / 100} fill="bg-gradient-to-r from-[#3a3a3a] via-[#bdbdbd] to-white" />}
    </div>
  );
});

interface ScenarioBoxProps {
  sc: Scenario;
  close4h: number | null;
  close4hAt: number | null;
  /** count of scenario CHANGES since mount (0 = never changed → no sweep) */
  sweep: number;
}

/**
 * Scenario box: tone layers crossfade (`tween.crossfade`); the content swaps with a short y slide. On a scenario
 * change (never on mount) the new tone sweeps across the box (clip-path wipe, `tween.reveal`) and the title pops
 * (`spring.pop`). Reduced motion: crossfade only.
 */
const ScenarioBox = memo(function ScenarioBox({ sc, close4h, close4hAt, sweep }: ScenarioBoxProps) {
  const reduced = useReducedFx();
  return (
    <div className="relative rounded-xl border border-transparent p-3.5" data-testid="scenario-box">
      {TONES.map((k) => (
        <motion.span
          key={k}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px rounded-xl border", TONE_BOX[k])}
          initial={false}
          animate={{ opacity: sc.tone === k ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      {sweep > 0 && !reduced && (
        <motion.span
          key={sweep}
          aria-hidden="true"
          className={cn("pointer-events-none absolute -inset-px rounded-xl border", TONE_SWEEP[sc.tone])}
          initial={{ clipPath: "inset(0 100% 0 0 round 12px)", opacity: 1 }}
          animate={{ clipPath: "inset(0 0% 0 0 round 12px)", opacity: SWEEP_OPACITY }}
          transition={{ clipPath: tween.reveal, opacity: { ...tween.flash, times: SWEEP_TIMES } }}
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={sc.key} className="relative" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: spring.smooth }} exit={{ opacity: 0, y: -6, transition: tween.exit }}>
          <div className="flex items-center justify-between gap-2">
            <motion.strong
              className={cn("origin-left text-[14px] font-semibold", TONE_TITLE[sc.tone])}
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              transition={spring.pop}
            >
              {sc.title}
            </motion.strong>
            <span className="num font-mono text-xs text-mute">4H {n0(close4h)}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{sc.detail}</p>
          <p className="mt-1 text-[11px] text-faint">
            {TRIGGER_FOOTER}
            {close4hAt != null ? dateTime(new Date(close4hAt)) : "–"}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
});

/**
 * Market panel `Live-Status · Trigger-Level` (Bundle `vhe`, Plan 6.1 / 4.4 / 4.9). Zero React renders per tick:
 * - live leaves (`MarketLive.tsx`): odometer price with tick flash, live 24 h change chip, order-flow meter,
 *   funding line + tiles, LivePill age / ring / trade pings, trigger distances, preview countdown;
 * - React re-renders only for structural changes (`useMarketPanelView` keys, `usePriceClass` trigger flags,
 *   hover), and everything below the root is memoised;
 * - scenario change: sweep + title pop + one BorderBeam lap; `BorderBeam` loop on live + hover.
 */
export function MarketPanel() {
  const settings = useJournal((s) => s.settings);
  const levels = settings.market;
  const view = useMarketPanelView(levels);
  const desktop = useIsDesktop();
  const reduced = useReducedFx();
  const [hover, setHover] = useState(false);
  const { refresh, refreshing, disabled } = useForceRefresh();

  // Bid/Ask tile → `bookTicker` stream only while the tile can be visible (sm+)
  useEffect(() => {
    setBookTop(desktop);
    return () => setBookTop(false);
  }, [desktop]);

  // the trigger engine runs on a price SAMPLE taken whenever a price-dependent flag flips (reach, zone, invalidation)
  const closedKey = scenario(view.close4h, levels)?.key ?? null;
  const classify = useCallback((p: number | null) => triggerFlagsKey(p, levels, closedKey), [levels, closedKey]);
  const sample = usePriceClass(classify, view.price);
  const t = useMemo(
    () => evaluateTrigger({ price: sample.price, close4h: view.close4h, close4hLive: view.live4hClose, closeW: view.closeW, rsiW: view.rsiW, levels }),
    [sample.price, view.close4h, view.live4hClose, view.closeW, view.rsiW, levels],
  );
  const sc = t.scenario;

  // scenario changes since mount (the first scenario after loading is not a change)
  const [sweep, setSweep] = useState<{ key: string | null; n: number }>({ key: sc?.key ?? null, n: 0 });
  const scKey = sc?.key ?? null;
  if (scKey !== sweep.key) setSweep({ key: scKey, n: sweep.key !== null && scKey !== null ? sweep.n + 1 : sweep.n });

  const livePrice = useTransform(priceMv, (v) => orFallback(v, view.price));
  const glidePrice = useGlide(livePrice, { enabled: !reduced, jump: jumpFromUnknownPrice });

  const source = view.priceSource?.source === "tradingview" ? "TradingView" : "Binance";
  const live = view.status === "live";
  const connecting = view.status === "connecting";
  /** placeholders for the live rows (order flow, funding) while a cached price shows and the feed connects */
  const reserve = connecting && view.price != null;
  const loadingText = view.message || STRINGS.loading;

  const openChart = () => {
    document.getElementById(CHART_CARD_ID)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <div
      className="group/market relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 p-5"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-testid="market-panel"
    >
      {live && hover && <BorderBeam size={110} duration={6} />}
      {sweep.n > 0 && <BorderBeam fire={sweep.n} size={110} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* no remount key: the title decodes once per text (a remount on "live" played a second decode right after the first) */}
        <TextScramble text={`${settings.pair} · ${source}`} className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mute" />
        <span className="flex items-center gap-2">
          <AnimatePresence initial={false}>
            {view.sourceBadge && (
              <motion.span key="src" {...fadeIn}>
                <Badge tone="mute" title={view.message ?? view.statusDetail}>
                  {view.sourceBadge}
                </Badge>
              </motion.span>
            )}
          </AnimatePresence>
          {live ? (
            <LivePill receivedAt={view.updatedAt} ringEndsAt={view.nextTickerRefreshAt} />
          ) : connecting ? (
            <ConnectingPill />
          ) : (
            <StatusPill tone={view.status === "unavailable" ? "muted" : "error"} expanded label={STRINGS.noPrice} feed="markPrice" title={view.statusDetail} />
          )}
        </span>
      </div>

      {view.price != null ? (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <LivePrice fallback={view.price} />
          {view.change != null && (
            <span className="pb-1">
              <ChangeChip fallback={view.change} />
            </span>
          )}
        </div>
      ) : connecting || !view.message ? (
        <TextShimmer as="p" className="text-[13px] leading-relaxed">
          {loadingText}
        </TextShimmer>
      ) : (
        <p className="text-[13px] leading-relaxed text-mute">{loadingText}</p>
      )}

      {/* settled geometry from the first paint: while a cached price shows and the feed is still connecting, the order-flow
          row and the funding block are reserved by same-height placeholders, so the panel (which sets the hero row height)
          does not grow by ~190 px in one frame when the live data lands */}
      {reserve && <Skeleton className="h-11" />}
      <AnimatePresence initial={false}>
        {live && view.price != null && !view.sourceBadge && (
          <motion.div key="flow" {...fadeIn}>
            <OrderFlow />
          </motion.div>
        )}
      </AnimatePresence>

      {reserve && !view.fundingLine && (
        <div aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-4 w-4/5 rounded-md" />
          <div className="hidden grid-cols-2 gap-2 sm:grid">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[47px]" />
            ))}
          </div>
        </div>
      )}
      <AnimatePresence initial={false}>
        {view.fundingLine && (
          <motion.div key="funding" {...fadeIn} className="grid gap-2">
            <FundingBlock
              mark={view.mark?.markPrice ?? 0}
              fundingRate={view.fundingLine.fundingRate}
              nextFundingTime={view.fundingLine.nextFundingTime}
              price={view.price}
              openInterest={view.openInterest}
              takerDelta={view.taker?.takerDelta ?? null}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sc && <ScenarioBox sc={sc} close4h={view.close4h} close4hAt={view.close4hAt} sweep={sweep.n} />}

      <AnimatePresence initial={false}>
        {t.livePreview && view.live4hCloseAt != null && (
          <motion.p key="preview" {...fadeIn} className="text-[11.5px] text-mute">
            <PreviewLine preview={t.livePreview} closesAt={view.live4hCloseAt} />
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(t.distance.longLabel || t.distance.shortLabel) && (
          <motion.div key="dist" {...fadeIn} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-mute">
            <TriggerDistances price={glidePrice} longTrigger={levels.longTrigger} shortTrigger={levels.shortTrigger} />
            <AnimatePresence initial={false}>
              {t.distance.longInReach && (
                <motion.span key="long-reach" {...popIn}>
                  <Badge tone="warn" ping>
                    {LONG_IN_REACH_LABEL}
                  </Badge>
                </motion.span>
              )}
              {t.distance.shortInReach && (
                <motion.span key="short-reach" {...popIn}>
                  <Badge tone="warn" ping>
                    {SHORT_IN_REACH_LABEL}
                  </Badge>
                </motion.span>
              )}
              {t.longInvalidated && (
                <motion.span key="invalid" {...popIn}>
                  <Badge tone="loss" dot>
                    {LONG_INVALIDATION_LABEL}
                  </Badge>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {t.weekly.show && <WeeklyChecks rows={t.weekly.rows} rsiBar={t.weekly.rsiBar} showBar={view.rsiW != null} />}

      <AnimatePresence initial={false}>
        {t.zone.warning && (
          <motion.p key="zone" {...fadeIn} className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 text-[12.5px] text-warn">
            {t.zone.warning}
          </motion.p>
        )}
      </AnimatePresence>

      {view.status === "error" && view.price != null && view.message && <p className="text-[11.5px] text-warn">{view.message}</p>}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <button type="button" onClick={openChart} className="label !text-fg hover:!text-signal">
          {OPEN_CHART_LABEL} ↓
        </button>
        {!live && (
          <button type="button" onClick={refresh} disabled={disabled} className="text-mute hover:text-fg disabled:opacity-50">
            {refreshing ? STRINGS.refreshing : STRINGS.refreshNow}
          </button>
        )}
        {view.rsiW != null && (
          <span className="text-faint" title={view.priceSource?.source === "tradingview" ? "TradingView" : "eigene Berechnung, Wilder 14"}>
            RSI W {n1(view.rsiW)} · {view.priceSource?.source === "tradingview" ? "TradingView" : `${SOURCE_NAME.binance} · Wilder 14`}
          </span>
        )}
      </div>
    </div>
  );
}
