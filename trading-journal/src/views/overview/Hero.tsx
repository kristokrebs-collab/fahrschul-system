import { animate } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { explain, HERO_TILES, heroSubline, heroTileValue, type ExplainKey } from "@/domain/explain";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { colorClass, n0, pct } from "@/lib/format";
import { MorphCard } from "@/motion/MorphCard";
import { TextPrism } from "@/motion/pulse/TextPrism";
import { MotionNumber, useAnimatedNumber } from "@/motion/MotionNumber";
import { TextRoll } from "@/motion/TextRoll";
import { radius, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { HeroBackdrop } from "@/primitives/HeroBackdrop";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton, SkeletonSwap } from "@/primitives/Skeleton";
import { rollDirection, StatTile } from "@/primitives/StatTile";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi, type AccFilter } from "@/store/uiStore";
import { ExplanationView } from "./explainer";
import { MarketPanel } from "./MarketPanel";
import { SignalStrip } from "./SignalStrip";

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));
/** NEW (Plan 6.1): sixth/seventh tile – both explainers existed in `Jl` but were never wired. */
const XL_TILES: readonly { key: ExplainKey; label: string }[] = [
  { key: "exp", label: "Erwartungswert" },
  { key: "streak", label: "Serie" },
];
const TILES = [...HERO_TILES, ...XL_TILES];
/**
 * The prism lens box clips: 0.12 em of padding (cancelled by a negative margin, no layout change) keeps the glyphs
 * inside it at `leading-none`. (TextPrism itself gives every copy its layer colour over the number's win/loss tone.)
 */
const PRISM_PAD = "-my-[0.12em] py-[0.12em]";
/** Peak opacity of the Netto-P&L glow when the figure changes. */
const GLOW_PEAK = 0.55;

/** Tile value as one string (rolls / counts as a unit); `trades` carries its open count as a separate suffix. */
function tileText(key: ExplainKey, view: AccountView, cur: string): string {
  const g = view.g;
  if (key === "trades") return String(g.n);
  if (key === "exp") return `${heroTileValue("exp", view)}${g.exp == null ? "" : ` ${cur}`}`;
  if (key === "streak") return view.streak ? `${view.streak}× ${view.streakType === "win" ? "Gewinn" : view.streakType === "loss" ? "Verlust" : "Break-even"}` : "–";
  return heroTileValue(key, view);
}

/**
 * Value-change glow behind the Netto-P&L: a pre-rendered blurred wash (green when the figure rose, red when it fell)
 * whose opacity decays on `tween.flash`. Only for changes within the same account after loading – switching the
 * account is not a gain or a loss. Off under reduced motion.
 */
function NetGlow({ net, acc, loaded }: { net: number; acc: AccFilter; loaded: boolean }) {
  const reduced = useReducedFx();
  const up = useRef<HTMLSpanElement>(null);
  const down = useRef<HTMLSpanElement>(null);
  const last = useRef<{ acc: AccFilter; net: number } | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = loaded ? { acc, net } : null;
    if (!prev || reduced || prev.acc !== acc || prev.net === net) return;
    const rising = net > prev.net;
    const on = rising ? up.current : down.current;
    const off = rising ? down.current : up.current;
    if (off) animate(off, { opacity: 0 }, { duration: 0 });
    if (on) animate(on, { opacity: [GLOW_PEAK, 0] }, tween.flash);
  }, [net, acc, loaded, reduced]);
  return (
    <>
      <span ref={up} aria-hidden="true" className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-full bg-win/30 opacity-0 blur-3xl" />
      <span ref={down} aria-hidden="true" className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-full bg-loss/30 opacity-0 blur-3xl" />
    </>
  );
}

/** Return badge (`+12,3 %`): the figure rolls in the direction of the change, the tone follows the sign. */
const ReturnBadge = memo(function ReturnBadge({ ret }: { ret: number }) {
  const text = pct(ret);
  const [state, setState] = useState({ text, dir: "up" as "up" | "down" });
  if (state.text !== text) setState({ text, dir: rollDirection(state.text, text) });
  return (
    <Badge tone={ret >= 0 ? "win" : "loss"}>
      <TextRoll text={text} mode="roll" direction={state.dir} />
    </Badge>
  );
});

/**
 * Hero (Bundle `yhe`, Plan 6.1): account Segmented → `uiStore.acc`, `Startkapital`, Netto-P&L `MotionNumber`
 * (shared MotionValue with the `Details +` fact dialog, tone crossfades with the sign, green/red glow on change,
 * shimmering placeholder until the journal is loaded, pulse `text-prism-split` lens on hover devices), return badge roll, subline, KPI tiles (`StatTile`,
 * `morph-fact-{key}`, count-up on reveal, roll on change) wrapping into rows of 2 / 3 / 4 so every label and value
 * stays readable, living dot-matrix backdrop, right column `MarketPanel`.
 */
export function Hero() {
  const acc = useUi((s) => s.acc);
  const setAcc = useUi((s) => s.setAcc);
  const settings = useJournal((s) => s.settings);
  const loaded = useJournal((s) => s.loaded);
  const view = useAccountView(acc);
  const g = view.g;
  const cur = settings.currency;
  const ret = view.start ? g.net / view.start : null;
  const [active, setActive] = useState<number | null>(null);
  const net = useAnimatedNumber(loaded ? g.net : 0);

  // stable per data change, so hovering re-renders only the two tiles whose `active` flips
  const tiles = useMemo(
    () =>
      TILES.map((t, i) => {
        const d = explain(t.key, view, settings);
        return {
          key: t.key,
          label: t.label,
          value: tileText(t.key, view, cur),
          suffix: t.key === "trades" && view.open.length ? <span className="text-faint"> +{view.open.length} offen</span> : undefined,
          suffixLength: t.key === "trades" && view.open.length ? ` +${view.open.length} offen`.length : 0,
          verdict: d.verdict,
          body: () => <ExplanationView bare d={d} />,
          activate: () => setActive(i),
        };
      }),
    [view, settings, cur],
  );

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-line" aria-labelledby="hero-net-label">
      <HeroBackdrop />
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.3fr_1fr] lg:gap-8 lg:p-8">
        {/* top-anchored (no justify-between): later MarketPanel growth only adds space above the tiles (`mt-auto`), it
            never moves the P&L headline */}
        <div className="flex min-w-0 flex-col gap-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span data-hero-mask="box" className="inline-flex">
              <Segmented<AccFilter> aria-label="Konto" options={ACC_OPTIONS} value={acc} onChange={setAcc} />
            </span>
            <span data-hero-mask="text" className="text-xs text-mute">
              Startkapital {n0(view.start)} {cur}
            </span>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-3" data-hero-mask="text">
              <span id="hero-net-label" className="label">
                Netto-P&L · {ACCOUNT_LABELS[acc]}
              </span>
              <MorphCard
                id="fact-net"
                title="Netto-P&L"
                borderRadius={radius.pill}
                className="touch-hit !w-auto rounded-full border border-line-2 px-2.5 py-0.5 hover:border-white/50"
                body={() => (
                  <div className="grid gap-4">
                    <div className={cn("dot-num text-[34px] leading-none", colorClass(g.net))}>
                      <MotionNumber source={net} decimals={2} signed aria-label={heroTileValue("net", view)} /> <span className="font-sans text-base font-medium text-mute">{cur}</span>
                    </div>
                    <ExplanationView bare d={explain("net", view, settings)} />
                  </div>
                )}
              >
                <span className="label !text-[9.5px] group-hover:!text-fg">Details +</span>
              </MorphCard>
            </div>
            {/* `w-fit`: the row hugs the figure, so the dot mask follows its width; one line from lg (the figure shrinks
                with the column instead of pushing `USDT` under it at ~1024 px) */}
            <div
              className="dot-num relative isolate flex w-fit max-w-full flex-wrap items-baseline gap-x-3 text-[clamp(44px,8vw,78px)] leading-none lg:flex-nowrap lg:text-[clamp(44px,calc(5.6vw+14px),78px)]"
              data-testid="hero-net"
              data-celebrate-anchor="hero-net"
              data-hero-mask="text"
            >
              <NetGlow net={g.net} acc={acc} loaded={loaded} />
              <SkeletonSwap ready={loaded} skeleton={<Skeleton className="h-[0.78em] w-[5.2ch] rounded-2xl" />}>
                {/* prism lens over the figure on hover devices (its copies count with the same MotionValue); touch: plain */}
                <TextPrism className={PRISM_PAD}>
                  <MotionNumber source={net} decimals={2} signed tone="auto" aria-label={heroTileValue("net", view)} />
                </TextPrism>
              </SkeletonSwap>
              <span className="shrink-0 font-sans text-lg font-medium text-mute">{cur}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute" data-hero-mask="text">
              {ret != null && g.n > 0 && <ReturnBadge ret={ret} />}
              <span>{heroSubline(view)}</span>
            </div>
          </div>
          {/* lg+: the live entry check fills the band the market panel leaves above the tiles (landscape tablets) */}
          <SignalStrip className="mt-auto hidden lg:grid" />
          <dl className="mt-auto flex flex-wrap gap-2 border-t border-white/10 pt-5 lg:mt-0" onMouseLeave={() => setActive(null)}>
            {tiles.map((t, i) => (
              <StatTile
                key={t.key}
                fact={t.key}
                label={t.label}
                value={t.value}
                suffix={t.suffix}
                suffixLength={t.suffixLength}
                verdict={t.verdict}
                active={active === i}
                onActivate={t.activate}
                body={t.body}
                loading={!loaded}
              />
            ))}
          </dl>
        </div>
        <MarketPanel />
      </div>
    </section>
  );
}
