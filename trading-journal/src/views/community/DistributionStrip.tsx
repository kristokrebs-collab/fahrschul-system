import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { useFirstInView } from "@/motion/inView";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import type { CommunityDistribution } from "@/social/contract";
import { metricText } from "@/social/format";
import type { SocialMetric } from "@/social/metrics";

/** Linear position (0–100 %) of `v` on the strip's domain. */
export function stripPos(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/**
 * Where the trader stands in the community (P12): the k-anonymous distribution as a strip – p10–p90 band, the middle
 * half (p25–p75), the median tick – and the own value as a red marker that slides in from the median on first view
 * (transform only; the band opens with `scaleX`). Reduced motion: the final picture.
 */
export function DistributionStrip({ dist, metric, value, className }: { dist: CommunityDistribution; metric: SocialMetric; value: number | null; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref);
  const span = dist.p90 - dist.p10 || 1;
  const lo = Math.min(dist.p10, value ?? dist.p10) - span * 0.12;
  const hi = Math.max(dist.p90, value ?? dist.p90) + span * 0.12;
  const at = (v: number) => stripPos(v, lo, hi);
  const me = value == null ? null : at(value);
  const median = at(dist.p50);
  const show = reduced || seen;
  return (
    <div ref={ref} className={cn("grid gap-1.5", className)} data-testid="distribution-strip">
      <div className="relative h-9" role="img" aria-label={`Median ${metricText(metric, dist.p50)}, mittlere Hälfte ${metricText(metric, dist.p25)} bis ${metricText(metric, dist.p75)}${value != null ? `, du ${metricText(metric, value)}` : ""}`}>
        <span aria-hidden="true" className="absolute inset-x-0 top-[22px] h-px bg-line-2" />
        <motion.span
          aria-hidden="true"
          className="absolute top-[19px] h-[7px] origin-center rounded-full bg-white/[0.09]"
          style={{ left: `${at(dist.p10)}%`, width: `${at(dist.p90) - at(dist.p10)}%` }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={show ? { scaleX: 1, transitionEnd: { transform: "none" } } : undefined}
          transition={spring.bar}
        />
        <motion.span
          aria-hidden="true"
          className="absolute top-[19px] h-[7px] origin-center rounded-full bg-white/25"
          style={{ left: `${at(dist.p25)}%`, width: `${at(dist.p75) - at(dist.p25)}%` }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={show ? { scaleX: 1, transitionEnd: { transform: "none" } } : undefined}
          transition={{ ...spring.bar, delay: 0.08 }}
        />
        <span aria-hidden="true" className="absolute top-[15px] h-[15px] w-px -translate-x-1/2 bg-fg" style={{ left: `${median}%` }} />
        {me != null && (
          // full-width layer moved by its own width in % → the dot at its left edge lands on the value (transform only)
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-full"
            initial={reduced ? false : { x: `${median}%`, opacity: 0 }}
            animate={show ? { x: `${me}%`, opacity: 1 } : undefined}
            transition={{ x: { ...spring.enter, delay: 0.25 }, opacity: { ...tween.fade, delay: 0.25 } }}
          >
            <span className="absolute left-0 top-0 -translate-x-1/2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-signal">Du</span>
            <span className="absolute left-0 top-[16px] size-[13px] -translate-x-1/2 rounded-full border-2 border-ink-900 bg-signal shadow-[0_0_0_3px_rgb(229_32_46/0.25)]" />
          </motion.span>
        )}
      </div>
      <div className="relative h-4 font-mono text-[10px] text-faint">
        <span className="absolute left-0">{metricText(metric, dist.p10)}</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-mute" style={{ left: `${Math.max(18, Math.min(82, median))}%` }}>
          Median {metricText(metric, dist.p50)}
        </span>
        <span className="absolute right-0">{metricText(metric, dist.p90)}</span>
      </div>
    </div>
  );
}
