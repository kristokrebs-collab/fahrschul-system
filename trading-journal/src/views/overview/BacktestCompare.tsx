import { AnimatePresence, motion, useIsPresent, type Variants } from "motion/react";
import { useState, type Ref } from "react";
import { BACKTEST_CARD_TITLE, BACKTEST_COLUMNS, BACKTEST_SCOPE_ALL, BACKTEST_SCOPE_BT, BACKTEST_SETUP_DELETED, backtestCompare, explainBacktest, hasBacktestSetup, type BacktestScope } from "@/domain/backtest";
import { cn } from "@/lib/cn";
import { colorClass } from "@/lib/format";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { MorphCard } from "@/motion/MorphCard";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";

const SCOPES = [
  { v: "all", label: BACKTEST_SCOPE_ALL },
  { v: "bt", label: BACKTEST_SCOPE_BT },
] as const;

type BannerTone = "over" | "under" | "none";
const BANNER_TONES: readonly BannerTone[] = ["over", "under", "none"];
/** Pre-rendered banner surfaces, crossfaded by opacity (the scenario-box pattern) instead of swapping classes. */
const BANNER_LAYER: Record<BannerTone, string> = {
  over: "border-win/30 bg-win/[0.07]",
  under: "border-loss/30 bg-loss/[0.07]",
  none: "border-line bg-white/[0.02]",
};
const HEADLINE_TONE: Record<BannerTone, string> = { over: "text-win", under: "text-loss", none: "text-fg" };

/** `bt` reads as "forward" (new text rises from below), `all` as "back". */
const scopeDirection = (scope: BacktestScope): 1 | -1 => (scope === "bt" ? 1 : -1);

const SWAP: Variants = {
  enter: (d: number) => ({ opacity: 0, y: d * 8, filter: "blur(4px)" }),
  center: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { default: tween.reveal, y: spring.enter } },
  exit: (d: number) => ({ opacity: 0, y: d * -6, filter: "blur(4px)", transition: tween.exit }),
};
const SWAP_REDUCED: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: tween.crossfade },
  exit: { opacity: 0, transition: tween.exit },
};

function SwapItem({ text, className, dir, ref }: { text: string; className?: string; dir: number; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  const reduced = useReducedFx();
  return (
    <motion.span ref={ref} custom={dir} variants={reduced ? SWAP_REDUCED : SWAP} initial="enter" animate="center" exit="exit" aria-hidden={present ? undefined : true} className={cn("block", className)}>
      {text}
    </motion.span>
  );
}

/**
 * Multi-line label swap (blur-roll in the scope's direction). `TextRoll` keeps labels on one line
 * (`whitespace-pre`); the headline and the sub line must wrap on narrow cards, so they swap as whole blocks.
 */
function SwapLine({ text, dir, className }: { text: string; dir: 1 | -1; className?: string }) {
  return (
    <span className="relative block">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <SwapItem key={text} text={text} dir={dir} className={className} />
      </AnimatePresence>
    </span>
  );
}

/**
 * `Backtest-Vergleich` (Bundle `bhe`, Plan 6.1): scope toggle (hidden when `s_bt` was deleted, decision 14),
 * headline banner (tone surfaces crossfade, headline/sub blur-roll on change), `Kennzahl | Du | Backtest | Δ` rows
 * as MorphCards (`bt-{k}-{scope}`, hover pill `bt`, press feedback) whose values slot-roll on a scope change,
 * footnote.
 */
export function BacktestCompare() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const reduced = useReducedFx();
  const hasBt = hasBacktestSetup(settings);
  const [chosen, setScope] = useState<BacktestScope>("all");
  // without `s_bt` the comparison is always over all trades (decision 14)
  const scope: BacktestScope = hasBt ? chosen : "all";
  const cmp = backtestCompare(view.closed, settings.backtest, scope);
  const hover = useHoverGroup<string>();
  const tone: BannerTone = cmp.status ?? "none";
  const dir = scopeDirection(cmp.scope);
  const roll = dir > 0 ? "up" : "down";

  return (
    <Card title={BACKTEST_CARD_TITLE} action={hasBt ? <Segmented<BacktestScope> size="sm" aria-label="Vergleichsbasis" options={SCOPES} value={scope} onChange={setScope} /> : undefined}>
      <div className="relative isolate mb-4 flex items-center justify-between gap-3 rounded-xl p-3.5">
        {BANNER_TONES.map((t) => (
          <motion.span
            key={t}
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0 -z-10 rounded-[inherit] border", BANNER_LAYER[t])}
            initial={false}
            animate={{ opacity: t === tone ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : tween.crossfade}
          />
        ))}
        <div className="min-w-0">
          <SwapLine text={cmp.headline} dir={dir} className={cn("text-[15px] font-semibold", HEADLINE_TONE[tone])} />
          <SwapLine text={cmp.sub} dir={dir} className="mt-0.5 text-xs text-mute" />
        </div>
        <AnimatePresence initial={false}>
          {cmp.warnBadge && (
            <motion.span
              key="warn"
              className="shrink-0"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ default: tween.fade, scale: spring.pop }}
            >
              <Badge tone="warn">{cmp.warnBadge}</Badge>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {!hasBt && <p className="mb-3 text-[11.5px] text-faint">{BACKTEST_SETUP_DELETED}</p>}
      <div className="grid">
        <div className="label grid grid-cols-[1fr_auto_auto_auto] gap-x-5 pb-2 !text-faint">
          <span>{BACKTEST_COLUMNS[0]}</span>
          <span className="text-right">{BACKTEST_COLUMNS[1]}</span>
          <span className="text-right">{BACKTEST_COLUMNS[2]}</span>
          <span className="w-16 text-right">{BACKTEST_COLUMNS[3]}</span>
        </div>
        {cmp.rows.map((r) => (
          <div key={r.key} className="relative border-t border-line py-1" {...hover.bind(r.key)}>
            <HoverPill show={hover.hovered === r.key} group="bt" className="inset-y-1" />
            <MorphCard
              id={`bt-${r.key}-${cmp.scope}`}
              title={`Backtest · ${r.l}`}
              body={() => <ExplanationView bare d={explainBacktest(r.key, cmp.stats, settings)} />}
              className="relative z-10 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 px-2 py-2 text-[13px]"
            >
              <span className="flex items-center gap-2 text-mute">
                <span className="font-mono text-[13px] leading-none text-faint transition-[rotate,color] duration-300 group-hover:rotate-90 group-hover:text-fg" aria-hidden="true">
                  +
                </span>
                {r.l}
              </span>
              <span className={cn("num text-right font-mono font-medium", r.you == null ? "text-faint" : r.kind === "pp" ? "text-fg" : colorClass(r.you))}>
                <TextRoll text={r.youText} mode="roll" direction={roll} />
              </span>
              <span className="num text-right font-mono text-mute">
                <TextRoll text={r.refText} mode="roll" direction={roll} />
              </span>
              <span className="w-16 text-right">
                {r.delta == null ? (
                  <span className="text-faint">–</span>
                ) : (
                  <motion.span layout="position" layoutDependency={`${cmp.scope}:${r.deltaText}`} className="inline-block">
                    <Badge tone={r.tone === "mute" ? "mute" : r.tone} className="px-2">
                      <TextRoll text={r.deltaText} mode="roll" direction={roll} />
                    </Badge>
                  </motion.span>
                )}
              </span>
            </MorphCard>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">{cmp.footer}</p>
    </Card>
  );
}
