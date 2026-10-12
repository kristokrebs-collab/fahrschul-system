import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { useFirstInView } from "@/motion/inView";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { FEATURE_INFO, PLAN_CATALOG, upgradePlanFor } from "../plans";
import { openUpgrade, useTrialDays } from "../store";
import { BILLING, UPGRADE } from "../strings";
import type { Feature } from "../types";
import { LockGlyph } from "./parts";

export interface UpgradeTeaserProps {
  feature: Feature;
  className?: string;
  /** One line instead of the card (inline places, table cells). */
  compact?: boolean;
}

/**
 * The `<Gate fallback>` for a locked feature (P10): what it does, from which plan, one button that opens the
 * UpgradeSheet. The feature name gets the TactileHighlight marker wipe on first view; the lock hops in on `spring.pop`.
 * Only shown while payments are open (a `<Gate>` never renders it otherwise).
 */
export function UpgradeTeaser({ feature, className, compact }: UpgradeTeaserProps) {
  const reduced = useReducedFx();
  const info = FEATURE_INFO[feature];
  const plan = PLAN_CATALOG[upgradePlanFor(feature)];
  const trial = useTrialDays();
  const ref = useRef<HTMLElement>(null);
  const seen = useFirstInView(ref, !reduced && !compact);
  if (compact) {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-2 text-[13px]", className)} data-testid="upgrade-teaser" data-feature={feature}>
        <LockGlyph className="size-4 text-mute" />
        <span className="text-mute">{UPGRADE.teaserLine(plan.name)}</span>
        <button
          type="button"
          className="touch-hit rounded-full font-semibold text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg"
          onClick={() => openUpgrade(feature)}
        >
          {UPGRADE.teaserCta}
        </button>
      </span>
    );
  }
  return (
    <section
      ref={ref}
      aria-label={`${info.label} – ${UPGRADE.teaserLine(plan.name)}`}
      data-testid="upgrade-teaser"
      data-feature={feature}
      className={cn("relative isolate overflow-hidden rounded-2xl border border-line bg-ink-950/50 p-5", className)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1.4px)",
          backgroundSize: "18px 18px",
          maskImage: "linear-gradient(120deg, black, transparent 70%)",
        }}
      />
      <div className="flex items-start gap-4">
        <motion.span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-900 text-fg"
          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
          animate={seen ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
          transition={{ scale: spring.pop, opacity: tween.fade }}
        >
          <LockGlyph />
        </motion.span>
        <div className="grid min-w-0 gap-1.5">
          <span className="label flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
            {UPGRADE.teaserLine(plan.name)}
          </span>
          <h3 className="text-[17px] font-semibold leading-tight tracking-tight">
            <TactileHighlight playOnView tab={false} padX={0.12}>
              {info.label}
            </TactileHighlight>
          </h3>
          <p className="text-[13px] leading-relaxed text-mute">{info.pitch}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" size="sm" onClick={() => openUpgrade(feature)}>
          {UPGRADE.teaserCta}
        </Button>
        {trial > 0 && <span className="text-[12px] text-faint">{BILLING.trialDays(trial)}</span>}
      </div>
    </section>
  );
}
