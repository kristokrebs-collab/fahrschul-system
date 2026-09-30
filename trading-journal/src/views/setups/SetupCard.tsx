import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { SetupStats } from "@/domain/account";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import type { SetupAccount } from "@/domain/types";
import { cn } from "@/lib/cn";
import { colorClass, pct0 } from "@/lib/format";
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
 */
export function SetupCard({ stats, index, onEdit, onTrades, hidden, layoutDependency, className }: SetupCardProps) {
  const reduced = useReducedFx();
  const { setup, n, winRate, net, avgR } = stats;
  const badge = SETUP_BADGE[setup.account] ?? SETUP_BADGE.both;
  const delay = reduced ? 0 : Math.min(index, stagger.max) * stagger.cards;

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
          <article className="flex h-full flex-col gap-4 p-5" aria-label={setup.name}>
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
                {setup.checklist.map((item) => (
                  <li key={item.id} className="flex gap-2 text-[12px] text-fg/80">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-aqua/70" aria-hidden="true" />
                    {item.text}
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-auto grid grid-cols-4 gap-2">
              <Tile label="Trades">
                <MotionNumber value={n} decimals={0} />
              </Tile>
              <Tile label="Win-Rate">
                <MotionNumber value={winRate} format={(v) => pct0(v)} aria-label={pct0(winRate)} />
              </Tile>
              <Tile label="P&L" className={colorClass(n ? net : null)}>
                <MotionNumber value={n ? net : null} decimals={0} signed />
              </Tile>
              <Tile label="Ø R" className={colorClass(avgR)}>
                <MotionNumber value={avgR} decimals={2} signed />
              </Tile>
            </dl>

            {n > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-loss/25" role="img" aria-label={`Win-Rate ${pct0(winRate)}`}>
                <motion.div
                  className="h-full rounded-full bg-win"
                  style={{ transformOrigin: "left" }}
                  initial={false}
                  animate={{ scaleX: winRate ?? 0 }}
                  transition={tween.bar}
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
