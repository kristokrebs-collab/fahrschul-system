import { themePaint } from "@/lib/themePaint";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { displayPrice } from "@/billing/format";
import { PLAN_CATALOG } from "@/billing/plans";
import { startCheckout, useBilling, useBillingMode, useTrialDays } from "@/billing/store";
import { Mark, PriceDigits } from "@/billing/ui/parts";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { LaunchGrid, LaunchSlot } from "@/motion/pulse/LaunchGrid";
import { Button } from "@/primitives/Button";
import { PREISE } from "./strings";

/** A deterministic mini equity curve (decorative art for the launch wall). */
function CurveThumb({ seed, win, label }: { seed: number; win?: boolean; label?: string }) {
  const pts = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const trend = win ? -i * 2.2 : Math.sin(i * 0.5 + seed) * 4;
        const y = 58 - Math.sin(i * 0.9 + seed) * 12 - Math.cos(i * 0.37 + seed * 2) * 8 + trend;
        return `${((i / 15) * 160).toFixed(1)},${Math.max(6, Math.min(86, y)).toFixed(1)}`;
      }).join(" "),
    [seed, win],
  );
  const tone = win ? themePaint("#3ddc84") : themePaint("#5f5f5f");
  return (
    <div className="relative aspect-[3/4] w-full bg-ink-900">
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={`preise-thumb-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tone} stopOpacity="0.28" />
            <stop offset="1" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={`0,90 ${pts} 160,90`} fill={`url(#preise-thumb-${seed})`} stroke="none" />
        <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      {label && <span className="absolute left-2 top-1.5 font-mono text-[9.5px] tracking-[0.1em] text-mute">{label}</span>}
    </div>
  );
}

/**
 * Pricing hero (P10): the LaunchGrid stage – the dot field lights up radially, "PRO" cascades in as an ASCII
 * wordmark, the headline slot cuts Gefühl → FOMO → Zufall → System, a wall of equity cards collapses onto the one A+
 * curve, the Pro price panel flies in and the trial line blurs in last (≈ 4 s, then rest). Reduced motion: rest frame.
 */
export function PricingHero({ className }: { className?: string }) {
  const mode = useBillingMode();
  const interval = useBilling((s) => s.interval);
  const config = useBilling((s) => s.config);
  const busy = useBilling((s) => s.busy);
  const trial = useTrialDays();
  const pro = PLAN_CATALOG.pro;
  const price = displayPrice("pro", interval, config?.prices);
  const slots = useMemo(
    () =>
      PREISE.heroSlots.map((w, i) => (
        <span key={w} className={cn("rounded-lg px-2 py-0.5", i === PREISE.heroSlots.length - 1 ? "bg-fg text-ink-950" : "bg-ink-700 text-fg")}>
          {w}
        </span>
      )),
    [],
  );
  const cards = useMemo(
    () => Array.from({ length: 7 }, (_, i) => <CurveThumb key={i} seed={i * 2 + 1} win={i === 0} label={i === 0 ? "A+ SETUP" : undefined} />),
    [],
  );
  return (
    <LaunchGrid
      className={className}
      label={PREISE.heroEyebrow}
      slots={slots}
      cards={cards}
      aside={
        <div className="grid h-full content-between gap-6 p-6 sm:p-7" data-testid="hero-aside">
          <span className="label flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
            {PREISE.heroAsideLabel}
          </span>
          <div className="grid gap-1.5">
            <PriceDigits cents={price.perMonth} className="text-[64px]" />
            <span className="text-[12.5px] text-mute">
              {PREISE.perMonth} · {interval === "year" ? PREISE.yearly.toLowerCase() : PREISE.monthly.toLowerCase()} abgerechnet
            </span>
          </div>
          <ul className="grid gap-2.5 text-[13.5px]">
            {pro.highlights.slice(0, 3).map((h, i) => (
              <li key={h} className="flex items-start gap-2.5">
                <Mark on delay={2.4 + i * 0.12} className="mt-px shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      }
      hud={
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-line bg-ink-900 px-5 py-4">
          <span className="text-[14px] text-fg/90">{mode === "open" ? PREISE.heroHud(trial) : PREISE.heroHud(0)}</span>
          {mode === "open" && (
            <Button variant="primary" disabled={!!busy} onClick={() => void startCheckout({ plan: "pro", interval })} data-testid="hero-cta">
              {PREISE.heroCta(trial)}
            </Button>
          )}
        </div>
      }
    >
      <span className="label">{PREISE.heroEyebrow}</span>
      <AsciiCascade text="PRO" as="p" className="font-dot text-[clamp(56px,13vw,112px)] font-extrabold leading-[0.85] tracking-[0.02em] text-fg" />
      <h2 className="text-[clamp(28px,5.2vw,46px)] font-semibold leading-[1.05] tracking-[-0.02em]">
        {PREISE.heroLead} <LaunchSlot />
      </h2>
      <p className="max-w-[42ch] text-[14px] leading-relaxed text-mute">{PREISE.heroText}</p>
    </LaunchGrid>
  );
}
