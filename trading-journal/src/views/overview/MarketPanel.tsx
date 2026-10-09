import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { weeklyConfigured, zoneConfigured } from "@/domain/defaults";
import { ED } from "@/domain/edition";
import { checkGlyph, evaluateTrigger, scenario, type CheckRow } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import { n1 } from "@/lib/format";
import { setBookTop, SOURCE_NAME, STRINGS } from "@/market";
import { TextScramble } from "@/motion/TextScramble";
import { TextShimmer } from "@/motion/TextShimmer";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { StatusPill } from "@/motion/StatusPill";
import { tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Skeleton } from "@/primitives/Skeleton";
import { Explainer } from "@/primitives/VerdictPanel";
import { useJournal } from "@/store/journalStore";
import { Bar } from "./Bar";
import { DayRange } from "./DayRange";
import { LagePanel, useLageBand } from "./LagePanel";
import { ChangeChip, FundingBlock, LivePill, LivePrice, OrderFlow } from "./MarketLive";
import { weeklyExplain } from "./marketExplain";
import { triggerFlagsKey } from "./marketMath";
import { useForceRefresh, useMarketPanelView, usePriceClass } from "./useMarket";

export const CHART_CARD_ID = "chart-card";
export const OPEN_CHART_LABEL = "Chart öffnen";
export const WEEKLY_TITLE: string = ED.COPY.weeklyTitle;
const fadeIn = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } } as const;

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

/**
 * Weekly confirmation (title + two ✓/✕ rows + RSI bar). The whole block is a morph source: a tap opens what the two
 * checks mean, so the ✕ discs never read as "dismiss" buttons that do nothing (tablet audit 2a.5).
 */
const WeeklyChecks = memo(function WeeklyChecks({ rows, rsiBar, showBar, body }: { rows: readonly [CheckRow, CheckRow]; rsiBar: number; showBar: boolean; body: () => ReactNode }) {
  return (
    <MorphCard id="weekly-check" title={WEEKLY_TITLE} as="div" borderRadius={12} body={body} className="-m-2 !w-auto rounded-xl p-2 hover:bg-white/[0.03]">
      <div className="grid gap-2">
        <MorphTitle id="weekly-check" className="flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">
          <span>{WEEKLY_TITLE}</span>
          <span aria-hidden="true" className="text-faint transition-colors group-hover:text-fg">
            +
          </span>
        </MorphTitle>
        <CheckRowView {...rows[0]} />
        <CheckRowView {...rows[1]} />
        {showBar && <Bar value={rsiBar / 100} fill="bg-gradient-to-r from-[#3a3a3a] via-[#bdbdbd] to-white" />}
      </div>
    </MorphCard>
  );
});

/**
 * Market panel (Bundle `vhe` "Live-Status · Trigger-Level", Plan 6.1 / 4.4 / 4.9). Zero React renders per tick:
 * - live leaves (`MarketLive.tsx`): odometer price with tick flash, live 24 h change chip, order-flow meter,
 *   funding line + tiles, LivePill age / ring / trade pings;
 * - React re-renders only for structural changes (`useMarketPanelView` keys, `usePriceClass` trigger flags,
 *   hover), and everything below the root is memoised; `BorderBeam` loop on live + hover;
 * - the automatic Lage-Ampel (`LagePanel`, decisions 19 / 23) replaced the manual trigger scenario and the
 *   `Long-Trigger in +x %` row: the stored levels stay untouched (chart lines, weekly checks, zone note);
 * - `24 Stunden` (`DayRange`, design pass v3): the last 24 h of 15m closes with a live dot, filling the panel's free
 *   height in the stretched hero column.
 */
export function MarketPanel() {
  const settings = useJournal((s) => s.settings);
  const levels = settings.market;
  const weeklyOn = weeklyConfigured(settings);
  const zoneOn = zoneConfigured(settings);
  const view = useMarketPanelView(levels);
  const desktop = useIsDesktop();
  // lg+: the Lage is the hero's band (Hero.tsx), so the two hero columns keep their balance; below: here
  const lageBand = useLageBand();
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

  const source = view.priceSource?.source === "tradingview" ? "TradingView" : "Binance";
  const live = view.status === "live";
  /** the trade stream delivers: the LivePill with the trade's age; every other mode shows the honest pill from `legacyStatus` */
  const streaming = live && view.priceMode === "stream";
  const connecting = view.status === "connecting";
  /** placeholders for the live rows (order flow, funding) while a cached price shows and the feed connects */
  const reserve = connecting && view.price != null;
  const loadingText = view.message || STRINGS.loading;

  const openChart = () => {
    document.getElementById(CHART_CARD_ID)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <div
      className="group/market relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-ink-900 p-5"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-testid="market-panel"
    >
      {live && hover && <BorderBeam size={110} duration={6} />}

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
          {streaming ? (
            <LivePill receivedAt={view.updatedAt} ringEndsAt={view.nextTickerRefreshAt} />
          ) : (
            // one pill for every other state, so `Verbinde …` → `Kurs per Abfrage · 5 s` → `Kein Live-Kurs` morphs (grows first,
            // never clips); the text comes from `legacyStatus`: `Kein Live-Kurs` only when neither the stream nor a REST poll
            // delivered for 2 minutes, `Kurs per Abfrage · 5 s` while the socket is down and the ticker stands in
            <StatusPill tone={view.pill.tone} expanded label={view.pill.text} feed="markPrice" title={view.pill.detail ?? (connecting ? undefined : view.statusDetail)} />
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

      {/* the last 24 h as a line with a live dot; in the stretched hero column it takes the panel's free height (lg+: no
          empty band above "Chart öffnen", design pass v3) */}
      {view.price != null && <DayRange className="flex-1" />}

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
              base={settings.pair.split("/")[0] || "BTC"}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* automatic Lage-Ampel (decisions 19 / 23): replaces the manual trigger scenario and the long-trigger distance */}
      {!lageBand && <LagePanel />}

      {weeklyOn && t.weekly.show && (
        <WeeklyChecks
          rows={t.weekly.rows}
          rsiBar={t.weekly.rsiBar}
          showBar={view.rsiW != null}
          body={() => <Explainer bare d={weeklyExplain(WEEKLY_TITLE, levels.lowerHigh, levels.rsiWeekly, view.closeW, view.rsiW)} />}
        />
      )}

      <AnimatePresence initial={false}>
        {zoneOn && t.zone.warning && (
          <motion.p key="zone" {...fadeIn} className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 text-[12.5px] text-warn">
            {t.zone.warning}
          </motion.p>
        )}
      </AnimatePresence>

      {view.status === "error" && view.price != null && view.message && <p className="text-[11.5px] text-warn">{view.message}</p>}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <button type="button" onClick={openChart} className="touch-hit label !text-fg hover:!text-signal">
          {OPEN_CHART_LABEL} ↓
        </button>
        {!live && (
          <button type="button" onClick={refresh} disabled={disabled} className="touch-hit text-mute hover:text-fg disabled:opacity-50">
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
