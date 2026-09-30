import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { checkGlyph, countdownLabel, evaluateTrigger, livePreviewLabel, LONG_IN_REACH_LABEL, LONG_INVALIDATION_LABEL, SHORT_IN_REACH_LABEL, TRIGGER_FOOTER, type CheckRow, type ScenarioTone } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import { colorClass, dateTime, n0, n1, price as fmtPrice, signed } from "@/lib/format";
import { liveAgeLabel, refreshRingProgress, setBookTop, SOURCE_NAME, STRINGS, useStatusLabel, type MarketView } from "@/market";
import { RollingDigits } from "@/motion/RollingDigits";
import { StatusPill } from "@/motion/StatusPill";
import { spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { useJournal } from "@/store/journalStore";
import { Bar } from "./Bar";
import { useForceRefresh, useMarketPanelView, useNow, useRollingPrice } from "./useMarket";

export const CHART_CARD_ID = "chart-card";
export const OPEN_CHART_LABEL = "Chart öffnen";
export const WEEKLY_TITLE = "Bärenmarkt-Ende bestätigt?";

const TONE_BOX: Record<ScenarioTone, string> = {
  win: "border-win/30 bg-win/[0.07]",
  loss: "border-loss/30 bg-loss/[0.07]",
  warn: "border-warn/30 bg-warn/[0.07]",
  mute: "border-line-2 bg-white/[0.03]",
};
const TONE_TITLE: Record<ScenarioTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-fg" };
const TONES: ScenarioTone[] = ["win", "loss", "warn", "mute"];

const fadeIn = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } } as const;

/** Bundle `F$`: ✓ / ✕ / · disc + label + value. */
function CheckRowView({ row }: { row: CheckRow }) {
  const g = checkGlyph(row.ok);
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      <span
        aria-hidden="true"
        className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold", row.ok == null ? "bg-white/10 text-mute" : row.ok ? "bg-win/20 text-win" : "bg-loss/15 text-loss")}
      >
        {g}
      </span>
      <span className="min-w-0 flex-1 truncate text-mute">{row.label}</span>
      <span className="num font-mono text-fg">{row.value}</span>
    </div>
  );
}

/** Live price from `priceMv` (≤ 4 Hz) in the 42-px odometer; only this subtree re-renders per tick. */
function LivePrice({ fallback }: { fallback: number | null }) {
  const p = useRollingPrice(fallback);
  if (p === null) return null;
  return (
    <span className="dot-num text-[42px] leading-none text-fg">
      <RollingDigits value={p} />
    </span>
  );
}

/** Bundle `xhe`: the LivePill button – age label, 30-s ring (`ticker24h` cycle), spin while refreshing. */
function LivePill({ view, now }: { view: MarketView; now: number }) {
  const { refresh, refreshing, disabled } = useForceRefresh();
  const age = liveAgeLabel(view.updatedAt ?? undefined, now, refreshing);
  const ring = refreshRingProgress(view.nextTickerRefreshAt ?? undefined, now);
  return (
    <button type="button" onClick={refresh} disabled={disabled && !refreshing} title={STRINGS.refreshNow} aria-label={STRINGS.refreshNow} className="rounded-full disabled:cursor-default">
      <StatusPill tone={age.warn ? "warn" : "live"} expanded ring={ring} spinning={refreshing} label={age.text} feed="markPrice" />
    </button>
  );
}

/**
 * Market panel `Live-Status · Trigger-Level` (Bundle `vhe`, Plan 6.1 / 4.4 / 4.9): header `{pair} · Binance`,
 * status pill, live price (`RollingDigits` on `priceMv`), 24 h change, funding line + mini tiles (`sm+`),
 * scenario box with tone crossfade, live preview, trigger distances, weekly checks with RSI bar, zone warning,
 * source badge, `Jetzt aktualisieren`, BorderBeam on live + hover, `Chart öffnen`.
 */
export function MarketPanel() {
  const settings = useJournal((s) => s.settings);
  const now = useNow(1000);
  const view = useMarketPanelView(now);
  const label = useStatusLabel("markPrice");
  const desktop = useIsDesktop();
  const reduced = useReducedFx();
  const [hover, setHover] = useState(false);
  const { refresh, refreshing, disabled } = useForceRefresh();

  // Bid/Ask tile → `bookTicker` stream only while the tile can be visible (sm+)
  useEffect(() => {
    setBookTop(desktop);
    return () => setBookTop(false);
  }, [desktop]);

  const levels = settings.market;
  const t = evaluateTrigger({ price: view.price, close4h: view.close4h, close4hLive: view.live4hClose, closeW: view.closeW, rsiW: view.rsiW, levels });
  const sc = t.scenario;
  const tone: ScenarioTone = sc?.tone ?? "mute";
  const source = view.priceSource?.source === "tradingview" ? "TradingView" : "Binance";
  const preview = t.livePreview && view.live4hCloseAt != null ? livePreviewLabel(t.livePreview, countdownLabel(view.live4hCloseAt - now)) : null;

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
      {view.status === "live" && hover && <BorderBeam size={110} duration={6} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mute">
          {settings.pair} · {source}
        </span>
        <span className="flex items-center gap-2">
          <AnimatePresence initial={false}>
            {view.sourceBadge && (
              <motion.span key="src" {...fadeIn}>
                <Badge tone="mute" title={view.message ?? label.detail}>
                  {view.sourceBadge}
                </Badge>
              </motion.span>
            )}
          </AnimatePresence>
          {view.status === "live" ? (
            <LivePill view={view} now={now} />
          ) : view.status === "connecting" ? (
            <StatusPill tone="muted" expanded label={STRINGS.connecting} feed="markPrice" />
          ) : (
            <StatusPill tone={view.status === "unavailable" ? "muted" : "error"} expanded label={STRINGS.noPrice} feed="markPrice" title={label.detail} />
          )}
        </span>
      </div>

      {view.price != null ? (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <LivePrice fallback={view.price} />
          {view.change != null && (
            <span className={cn("pb-1 font-mono text-sm", colorClass(view.change))}>
              {signed(view.change, 2)} % 24h
            </span>
          )}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-mute">{view.message || STRINGS.loading}</p>
      )}

      <AnimatePresence initial={false}>
        {view.fundingLine && (
          <motion.div key="funding" {...fadeIn} className="grid gap-2">
            <p className="num font-mono text-[11px] text-faint">{view.fundingLine.text}</p>
            <div className="hidden grid-cols-4 gap-2 sm:grid">
              {(
                [
                  ["Funding", view.fundingLine.fundingText.replace("Funding ", "")],
                  ["OI", view.openInterest != null ? n0(view.openInterest) : "–"],
                  ["Taker", view.taker ? signed(view.taker.takerDelta, 1) + " %" : "–"],
                  ["Bid/Ask", view.bid != null && view.ask != null ? `${fmtPrice(view.bid)} / ${fmtPrice(view.ask)}` : "–"],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="min-w-0 rounded-xl border border-line bg-ink-950/30 px-2.5 py-1.5">
                  <div className="label !text-[9.5px]">{l}</div>
                  <div className="num truncate font-mono text-[12.5px] text-fg">{v}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {sc && (
        <div className="relative rounded-xl border border-transparent p-3.5" data-testid="scenario-box">
          {TONES.map((k) => (
            <motion.span
              key={k}
              aria-hidden="true"
              className={cn("pointer-events-none absolute -inset-px rounded-xl border", TONE_BOX[k])}
              initial={false}
              animate={{ opacity: tone === k ? 1 : 0 }}
              transition={tween.crossfade}
            />
          ))}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sc.key} className="relative" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: spring.smooth }} exit={{ opacity: 0, y: -6, transition: tween.exit }}>
              <div className="flex items-center justify-between gap-2">
                <strong className={cn("text-[14px] font-semibold", TONE_TITLE[sc.tone])}>{sc.title}</strong>
                <span className="num font-mono text-xs text-mute">4H {n0(view.close4h)}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{sc.detail}</p>
              <p className="mt-1 text-[11px] text-faint">
                {TRIGGER_FOOTER}
                {view.close4hAt != null ? dateTime(new Date(view.close4hAt)) : "–"}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence initial={false}>
        {preview && (
          <motion.p key="preview" {...fadeIn} className="text-[11.5px] text-mute">
            {preview}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(t.distance.longLabel || t.distance.shortLabel) && (
          <motion.div key="dist" {...fadeIn} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-mute">
            {t.distance.longLabel && <span className="num font-mono">{t.distance.longLabel}</span>}
            {t.distance.shortLabel && <span className="num font-mono">{t.distance.shortLabel}</span>}
            {t.distance.longInReach && <Badge tone="warn">{LONG_IN_REACH_LABEL}</Badge>}
            {t.distance.shortInReach && <Badge tone="warn">{SHORT_IN_REACH_LABEL}</Badge>}
            {t.longInvalidated && <Badge tone="loss">{LONG_INVALIDATION_LABEL}</Badge>}
          </motion.div>
        )}
      </AnimatePresence>

      {t.weekly.show && (
        <div className="grid gap-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{WEEKLY_TITLE}</div>
          <CheckRowView row={t.weekly.rows[0]} />
          <CheckRowView row={t.weekly.rows[1]} />
          {view.rsiW != null && <Bar value={t.weekly.rsiBar / 100} fill="bg-gradient-to-r from-[#3a3a3a] via-[#bdbdbd] to-white" />}
        </div>
      )}

      {t.zone.warning && <p className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3 text-[12.5px] text-warn">{t.zone.warning}</p>}

      {view.status === "error" && view.price != null && view.message && <p className="text-[11.5px] text-warn">{view.message}</p>}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <button type="button" onClick={openChart} className="label !text-fg hover:!text-signal">
          {OPEN_CHART_LABEL} ↓
        </button>
        {view.status !== "live" && (
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
