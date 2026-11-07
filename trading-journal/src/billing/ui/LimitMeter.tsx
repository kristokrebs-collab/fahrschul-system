import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { useFirstInView } from "@/motion/inView";
import { RollingDigits } from "@/motion/RollingDigits";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useLimit } from "../entitlements";
import { LIMIT_INFO, PLAN_CATALOG, upgradePlanForLimit } from "../plans";
import { openUpgrade, useBillingMode, useEffectivePlan } from "../store";
import { UPGRADE } from "../strings";
import type { LimitKey } from "../types";

export interface LimitMeterProps {
  limitKey: LimitKey;
  /** How many the user already uses (the feature package counts – e.g. saved views, exchange connections). */
  used: number;
  className?: string;
}

/**
 * Usage counter of a plan limit (P10 "Zähler"): `2 / 3 Gespeicherte Ansichten` with rolling digits and a bar that
 * fills on first view (scaleX, `tween.bar`); at the limit it turns warn and offers the next plan (UpgradeSheet).
 * Unlimited (or nothing gated): `∞`, no bar.
 */
export function LimitMeter({ limitKey, used, className }: LimitMeterProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const limit = useLimit(limitKey);
  const mode = useBillingMode();
  const plan = useEffectivePlan();
  const info = LIMIT_INFO[limitKey];
  const unlimited = !Number.isFinite(limit);
  const full = !unlimited && used >= limit;
  const ratio = unlimited ? 0 : limit <= 0 ? 1 : Math.min(1, used / limit);
  const next = upgradePlanForLimit(limitKey, plan.plan, used);
  return (
    <div ref={ref} className={cn("grid gap-1.5", className)} data-testid={`limit-${limitKey}`} data-full={full ? "" : undefined}>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-mute">{info.label}</span>
        <span className={cn("num inline-flex items-baseline gap-1 font-mono", full ? "text-warn" : "text-fg")}>
          <RollingDigits value={used} aria-label={`${used} von ${unlimited ? "unbegrenzt" : limit}`} />
          <span aria-hidden="true" className="text-faint">
            / {unlimited ? "∞" : limit}
            {info.unit && !unlimited ? ` ${info.unit}` : ""}
          </span>
        </span>
      </div>
      {!unlimited && (
        <span aria-hidden="true" className="relative block h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.span
            className={cn("absolute inset-0 origin-left rounded-full", full ? "bg-warn" : "bg-fg/80")}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: seen ? ratio : 0 }}
            transition={tween.bar}
          />
        </span>
      )}
      {full && mode === "open" && (
        <button
          type="button"
          className="touch-hit justify-self-start text-[12px] font-semibold text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg"
          onClick={() => openUpgrade(null, next)}
        >
          {UPGRADE.limitReached} · {UPGRADE.more(PLAN_CATALOG[next].name)}
        </button>
      )}
    </div>
  );
}
