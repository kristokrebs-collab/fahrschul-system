import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { SetupStats } from "@/domain/account";
import { ACCOUNT_LABELS, MTF_SETUP_ID } from "@/domain/defaults";
import type { SetupAccount } from "@/domain/types";
import { cn } from "@/lib/cn";
import { colorClass, pct0 } from "@/lib/format";
import { canObserveInView, useFirstInView } from "@/motion/inView";
import { MorphCard } from "@/motion/MorphCard";
import { MotionNumber } from "@/motion/MotionNumber";
import { NotchedFrame, notchPath } from "@/motion/pulse/NotchedFrame";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Tilt } from "@/primitives/Tilt";
import { ExplanationView } from "@/views/overview/explainer";
import { MtfLiveStrip } from "./MtfLiveStrip";
import { adherenceText, explainPlaybook, fromStats, pfText, PLAYBOOK_STRINGS, pnlText, type PlaybookStats } from "./playbook";

export type RankedSetupStats = SetupStats & { id: string };

/** Card geometry and the morph hand-off timing (OV-07). */
export const CONFIG = {
  radius: radius.card,
  /** Notch edge (px) – the button row keeps this much room free on the right. */
  notch: 56,
  /** Card contents leave before the opaque surface morphs into the sheet (≤ 80 ms, never seen scaled). */
  contentOutS: 0.08,
  /** Safety net if the content fade never reports completion (ms). */
  leaveFallbackMs: 400,
  /** Contents come back once the surface has flown home (`spring.sheet` ≈ 90 % after ~0.26 s). */
  contentInDelayS: 0.24,
  /** Colour accent: radial wash in the setup colour, greyed at rest (NotchedFrame media). */
  washMix: "22%",
} as const;

export interface SetupCardProps {
  stats: RankedSetupStats;
  /** Position in the grid – drives the enter stagger (`stagger.cards`). */
  index: number;
  onEdit: (id: string) => void;
  /** `Alle Trades mit dieser Grundlage →` (disabled without trades). */
  onTrades: (id: string) => void;
  /** The editor sheet has morphed out of this card: contents faded out, inert, hidden from AT. */
  hidden?: boolean;
  /** Re-measure trigger for `layout` (account filter + sort key). */
  layoutDependency?: unknown;
  /**
   * Playbook figures (Tradezella playbook report: Erwartung, Profit-Faktor, Regel-Treue, Bester / Schwächster); the
   * block shows once the setup has closed trades and opens its explainer. Omitted → no block (additive).
   */
  playbook?: PlaybookStats;
  /** Currency of the playbook explainer (`settings.currency`). */
  currency?: string;
  className?: string;
}

/** Bundle: `Makro` steel, `Scalp` teal, `Beide` mute. */
export const SETUP_BADGE: Record<SetupAccount, { tone: BadgeTone; label: string }> = {
  makro: { tone: "steel", label: ACCOUNT_LABELS.makro },
  scalp: { tone: "teal", label: ACCOUNT_LABELS.scalp },
  both: { tone: "mute", label: "Beide" },
};

export const NO_RULES_TEXT = "Noch keine Regeln hinterlegt.";
export const TRADES_BUTTON_LABEL = "Alle Trades mit dieser Grundlage →";

/**
 * Clips the morph surface to the card's notched outline (one `clip-path: path()` per size, ResizeObserver – never per
 * frame), so the opaque surface under the card never fills the notch at rest.
 */
function useNotchClip(ref: RefObject<HTMLElement | null>, r: number, notch: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = "";
    const apply = (w: number, h: number) => {
      w = Math.round(w);
      h = Math.round(h);
      if (w < notch || h < notch) return;
      const key = `${w}x${h}`;
      if (key === last) return;
      last = key;
      el.style.clipPath = `path("${notchPath(w, h, r, notch)}")`;
    };
    apply(el.offsetWidth, el.offsetHeight);
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      if (box) apply(box.inlineSize, box.blockSize);
      else apply(el.offsetWidth, el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, r, notch]);
}

/**
 * Setup card (Bundle `G$` item, Plan 6.3) on the pulse-motion `notched-project-card`: `NotchedFrame` (notch bottom
 * right with the arrow disc – ink at rest, signal red on hover/focus; the setup-colour wash greyed at rest and in
 * colour on hover; hairline `outline` instead of a CSS border) inside `Tilt` (factor 4). The spotlight card was
 * dropped here: notch + tilt is the card's whole hover language.
 *
 * Morph into the `Grundlage bearbeiten` sheet (OV-07): `layoutId="setup-card-{id}"` sits on an EMPTY opaque surface
 * (ink-850 = the sheet's colour, clipped to the notched outline) behind the contents. `Bearbeiten` first fades the
 * contents out (80 ms), THEN opens the editor, so only that surface flies into the sheet – nothing of the card is ever scaled or seen
 * through the panel; on close the surface flies home and the contents fade back in once it has landed. The card is
 * lifted above its neighbours while its surface travels.
 *
 * Enter `{opacity:0,y:8}` on `spring.cards` staggered, exit `{opacity:0,scale:.96}` (popLayout). Numbers are
 * `MotionNumber`s; the win bar animates `scaleX` only. Reveal on first view: tiles count up (`countOnReveal`, once
 * per session and setup), checklist bullets pop and their lines light up (`stagger.rows`), the win bar fills.
 * Tiles never ellipsize a number (MO-01): 2 × 2 below a 22rem card body, 4 in a row above.
 */
export function SetupCard({ stats, index, onEdit, onTrades, hidden = false, layoutDependency, playbook, currency = "USDT", className }: SetupCardProps) {
  const reduced = useReducedFx();
  const { setup, n, winRate, net, avgR } = stats;
  const badge = SETUP_BADGE[setup.account] ?? SETUP_BADGE.both;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.cards;
  const reveal = !reduced && canObserveInView();
  const articleRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(articleRef, reveal);
  // details start once the card itself has (mostly) arrived
  const detailDelay = delay + 0.15;
  useNotchClip(surfaceRef, CONFIG.radius, CONFIG.notch);

  // `Bearbeiten`: the contents fade out FIRST, the sheet opens (and the surface starts to fly) once they are gone
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const open = () => {
    clearTimeout(leaveTimer.current);
    // same batch: when the editor opens, `hidden` takes over; otherwise the contents simply come back
    setLeaving(false);
    onEdit(setup.id);
  };
  const edit = () => {
    if (reduced) return onEdit(setup.id);
    setLeaving(true);
    // the fade's own completion opens the editor; the timer only covers a fade that never reports back
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(open, CONFIG.leaveFallbackMs);
  };
  const away = hidden || leaving;

  // above the neighbours while the surface is away or flying home (state-from-props: set on open, cleared on landing)
  const [travelling, setTravelling] = useState(hidden);
  if (away && !travelling) setTravelling(true);

  const contentFade = reduced ? { duration: 0 } : away ? { duration: CONFIG.contentOutS, ease: "linear" as const } : { ...tween.fade, delay: CONFIG.contentInDelayS };
  const wash = (
    <span
      className="block h-28 w-full"
      style={{ background: `radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, ${setup.color || "transparent"} ${CONFIG.washMix}, transparent), transparent 62%), linear-gradient(90deg, ${setup.color || "transparent"}, transparent 72%) top / 100% 1px no-repeat` }}
    />
  );

  return (
    <motion.div
      layout
      layoutDependency={layoutDependency}
      data-testid={`setup-card-${setup.id}`}
      style={{ borderRadius: CONFIG.radius }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: tween.exit }}
      transition={{ ...spring.cards, delay, layout: spring.layout }}
      className={cn("relative h-full", travelling && "z-[1]", className)}
    >
      <motion.div
        ref={surfaceRef}
        layoutId={`setup-card-${setup.id}`}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-ink-850"
        style={{ borderRadius: CONFIG.radius }}
        onLayoutAnimationComplete={() => {
          if (!hidden) setTravelling(false);
        }}
      />
      <motion.div
        className="relative h-full"
        initial={false}
        animate={{ opacity: away ? 0 : 1 }}
        transition={contentFade}
        onAnimationComplete={() => {
          if (leaving) open();
        }}
        inert={hidden || undefined}
        aria-hidden={hidden || undefined}
      >
        <Tilt className="h-full" factor={4}>
          <NotchedFrame
            radius={CONFIG.radius}
            notchSize={CONFIG.notch}
            outline="var(--color-line)"
            media={wash}
            mediaClassName="pointer-events-none absolute inset-x-0 top-0 overflow-hidden rounded-t-2xl"
            className="bg-ink-850"
            wrapperClassName="h-full"
          >
            <article ref={articleRef} className="relative flex h-full flex-col gap-4 p-5" aria-label={setup.name}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
                  <motion.span
                    layoutId={`setup-dot-${setup.id}`}
                    layout="position"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: setup.color, borderRadius: radius.pill }}
                    aria-hidden="true"
                  />
                  <motion.span layoutId={`setup-name-${setup.id}`} layout="position">
                    {setup.name}
                  </motion.span>
                </h3>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>

              <p className="text-[12.5px] leading-relaxed text-mute">{setup.desc || NO_RULES_TEXT}</p>

              {setup.checklist.length > 0 && (
                <ul className="grid gap-1.5" aria-label={`Checkliste, ${setup.checklist.length} Punkte`}>
                  {setup.checklist.map((item, i) => {
                    const at = detailDelay + Math.min(i, stagger.max) * stagger.rows;
                    return (
                      <motion.li
                        key={item.id}
                        className="flex gap-2 text-[12px] text-fg/80"
                        initial={reveal ? { opacity: 0.35 } : false}
                        animate={{ opacity: seen ? 1 : 0.35 }}
                        transition={{ ...tween.fade, delay: at }}
                      >
                        <motion.span
                          className="mt-[7px] size-1 shrink-0 rounded-full bg-aqua/70"
                          aria-hidden="true"
                          initial={reveal ? { scale: 0 } : false}
                          animate={{ scale: seen ? 1 : 0 }}
                          transition={{ ...spring.pop, delay: at }}
                        />
                        {item.text}
                      </motion.li>
                    );
                  })}
                </ul>
              )}

              {/* the stat tiles are one morph source (tap / click / Enter → the setup's playbook explainer): nothing that
                  looks like a tile is dead on touch (tablet audit §2a.7) */}
              <MorphCard
                id={`setup-stats-${setup.id}`}
                title={`${PLAYBOOK_STRINGS.title} · ${setup.name}`}
                as="div"
                body={() => <ExplanationView bare d={explainPlaybook(stats, playbook ?? fromStats(stats), currency)} />}
                motionProps={{ "aria-label": `${PLAYBOOK_STRINGS.stats}: ${setup.name}` } as Record<string, string>}
                className="group/stats @container mt-auto rounded-xl"
              >
                <dl className="grid grid-cols-2 gap-2 @[22rem]:grid-cols-4">
                  <Tile label="Trades">
                    <MotionNumber value={n} decimals={0} countOnReveal revealKey={`setup-${setup.id}-n`} flash />
                  </Tile>
                  <Tile label="Win-Rate">
                    <MotionNumber value={winRate} format={(v) => pct0(v)} aria-label={pct0(winRate)} countOnReveal revealKey={`setup-${setup.id}-wr`} flash />
                  </Tile>
                  <Tile label="P&L" className={colorClass(n ? net : null)}>
                    <MotionNumber value={n ? net : null} decimals={0} signed countOnReveal revealKey={`setup-${setup.id}-net`} flash />
                  </Tile>
                  <Tile label="Ø R" className={colorClass(avgR)}>
                    <MotionNumber value={avgR} decimals={2} signed countOnReveal revealKey={`setup-${setup.id}-avgr`} flash />
                  </Tile>
                </dl>
              </MorphCard>

              {n > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-loss/25" role="img" aria-label={`Win-Rate ${pct0(winRate)}`}>
                  <motion.div
                    className="h-full rounded-full bg-win"
                    style={{ transformOrigin: "left" }}
                    initial={reveal ? { scaleX: 0 } : false}
                    animate={{ scaleX: seen ? (winRate ?? 0) : 0 }}
                    transition={{ ...tween.bar, delay: detailDelay }}
                  />
                </div>
              )}

              {playbook && playbook.agg.n > 0 && <PlaybookBlock stats={stats} playbook={playbook} currency={currency} />}

              {setup.id === MTF_SETUP_ID && <MtfLiveStrip />}

              {/* right padding keeps both buttons clear of the notch + disc */}
              <div className="flex flex-wrap gap-2 pointer-coarse:gap-3.5" style={{ paddingRight: CONFIG.notch - 16 }}>
                <Button size="sm" onClick={edit}>
                  Bearbeiten
                </Button>
                <Button size="sm" disabled={!n} onClick={() => onTrades(setup.id)}>
                  {TRADES_BUTTON_LABEL}
                </Button>
              </div>
            </article>
          </NotchedFrame>
        </Tilt>
      </motion.div>
    </motion.div>
  );
}

/**
 * Playbook block (additive, Tradezella playbook report): Erwartung pro Trade, Profit-Faktor, Regel-Treue (all items of
 * THIS setup ticked) and best / worst trade, plus the most frequent mistake tag. One morph source (tap / click /
 * Enter) that opens the playbook explainer – the figures never look like dead tiles on touch. Plain text values (no
 * extra live counters), `tabular-nums`, never ellipsized: 2 columns below a 22rem card body, 4 above.
 */
function PlaybookBlock({ stats, playbook, currency }: { stats: RankedSetupStats; playbook: PlaybookStats; currency: string }) {
  const { agg, adherence, topMistake, signal } = playbook;
  const name = stats.setup.name;
  return (
    <MorphCard
      id={`setup-playbook-${stats.setup.id}`}
      title={`${PLAYBOOK_STRINGS.title} · ${name}`}
      as="div"
      body={() => <ExplanationView bare d={explainPlaybook(stats, playbook, currency)} />}
      motionProps={{ "aria-label": PLAYBOOK_STRINGS.open(name) } as Record<string, string>}
      className="@container rounded-xl border border-line bg-ink-950/50 px-3 py-2.5 transition-colors duration-200 hover:border-white/25 focus-visible:border-white/40"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{PLAYBOOK_STRINGS.title}</span>
        <span aria-hidden="true" className="grid size-4 place-items-center rounded-full border border-line-2 text-[10px] leading-none text-mute">
          +
        </span>
      </span>
      <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 @[22rem]:grid-cols-4" data-testid="setup-playbook">
        <PbValue label={PLAYBOOK_STRINGS.exp} value={pnlText(agg.exp)} className={colorClass(agg.exp)} />
        <PbValue label={PLAYBOOK_STRINGS.pf} value={pfText(agg.pf)} />
        <PbValue label={PLAYBOOK_STRINGS.adherence} value={adherenceText(adherence)} className={adherence.items ? undefined : "text-faint !text-[11.5px] font-sans"} />
        <PbValue
          label={PLAYBOOK_STRINGS.bestWorst}
          className="whitespace-normal"
          value={
            <>
              <span className={cn("whitespace-nowrap", colorClass(agg.best?.pnl))}>{pnlText(agg.best?.pnl)}</span>
              <span className="text-faint"> / </span>
              <span className={cn("whitespace-nowrap", colorClass(agg.worst?.pnl))}>{pnlText(agg.worst?.pnl)}</span>
            </>
          }
        />
      </span>
      {(topMistake || signal) && (
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-mute">
          {topMistake && (
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {PLAYBOOK_STRINGS.topMistake}: <span className="text-[#ff8a90]">{topMistake.tag}</span> · <span className="num font-mono">{topMistake.n}×</span>
            </span>
          )}
          {signal?.avgScore != null && (
            <span className="whitespace-nowrap">
              {PLAYBOOK_STRINGS.signal}: <span className="num font-mono text-fg/90">{Math.round(signal.avgScore)}</span>
            </span>
          )}
        </span>
      )}
    </MorphCard>
  );
}

function PbValue({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="text-[9px] font-semibold uppercase leading-tight tracking-[0.08em] text-faint">{label}</span>
      <span className={cn("num whitespace-nowrap font-mono text-[12.5px] font-medium", className)}>{value}</span>
    </span>
  );
}

function Tile({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink-950/50 px-2 py-2 transition-colors duration-200 group-hover/stats:border-white/20 @[22rem]:px-2.5">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className={cn("num mt-0.5 whitespace-nowrap font-mono text-[13.5px] font-medium", className)}>{children}</dd>
    </div>
  );
}
