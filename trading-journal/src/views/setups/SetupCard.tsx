import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import type { SetupStats } from "@/domain/account";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import type { SetupAccount } from "@/domain/types";
import { cn } from "@/lib/cn";
import { colorClass, pct0 } from "@/lib/format";
import { canObserveInView, useFirstInView } from "@/motion/inView";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Tilt } from "@/primitives/Tilt";

export type RankedSetupStats = SetupStats & { id: string };

export interface SetupCardProps {
  stats: RankedSetupStats;
  /** Position in the grid – drives the enter stagger (`stagger.cards`). */
  index: number;
  onEdit: (id: string) => void;
  /** `Alle Trades mit dieser Grundlage →` (disabled without trades). */
  onTrades: (id: string) => void;
  /** `visibility:hidden` while the editor sheet has morphed out of this card. */
  hidden?: boolean;
  /** Re-measure trigger for `layout` (account filter + sort key). */
  layoutDependency?: unknown;
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
 * Setup card (Bundle `G$` item, Plan 6.3): `motion.div layout layoutId="setup-card-{id}"` with
 * `borderRadius 16` → `Tilt` (factor 4) → spotlight `Card` (`gradientFrom` = setup colour) → article.
 * Enter `{opacity:0,y:8}` on `spring.cards` staggered, exit `{opacity:0,scale:.96}` (popLayout).
 * Numbers are `MotionNumber`s; the win bar animates `scaleX` only.
 *
 * Reveal (first time the card is on screen, after its enter): the tiles count up from 0 (`countOnReveal`, once per
 * session and setup via `revealKey`), the
 * checklist bullets pop one after another and their lines light up (`stagger.rows`), the win bar fills from 0
 * (`tween.bar`). Later stat changes flash the tiles win/loss. Reduced motion / no `IntersectionObserver`: static.
 */
export function SetupCard({ stats, index, onEdit, onTrades, hidden, layoutDependency, className }: SetupCardProps) {
  const reduced = useReducedFx();
  const { setup, n, winRate, net, avgR } = stats;
  const badge = SETUP_BADGE[setup.account] ?? SETUP_BADGE.both;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.cards;
  const reveal = !reduced && canObserveInView();
  const articleRef = useRef<HTMLElement>(null);
  const seen = useFirstInView(articleRef, reveal);
  // details start once the card itself has (mostly) arrived
  const detailDelay = delay + 0.15;

  return (
    <motion.div
      layout
      layoutId={`setup-card-${setup.id}`}
      layoutDependency={layoutDependency}
      data-testid={`setup-card-${setup.id}`}
      style={{ borderRadius: radius.card, visibility: hidden ? "hidden" : undefined }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: tween.exit }}
      transition={{ ...spring.cards, delay, layout: spring.layout }}
      aria-hidden={hidden || undefined}
      className={cn("h-full", className)}
    >
      <Tilt className="h-full" factor={4}>
        <Card bare className="h-full" gradientFrom={setup.color}>
          <article ref={articleRef} className="flex h-full flex-col gap-4 p-5" aria-label={setup.name}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex items-center gap-2.5 text-[15px] font-semibold leading-snug">
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

            <dl className="mt-auto grid grid-cols-4 gap-2">
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

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onEdit(setup.id)}>
                Bearbeiten
              </Button>
              <Button size="sm" disabled={!n} onClick={() => onTrades(setup.id)}>
                {TRADES_BUTTON_LABEL}
              </Button>
            </div>
          </article>
        </Card>
      </Tilt>
    </motion.div>
  );
}

function Tile({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className={cn("num mt-0.5 truncate font-mono text-[13.5px] font-medium", className)}>{children}</dd>
    </div>
  );
}
