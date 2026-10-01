import { motion, useSpring, useTransform, useVelocity, type HTMLMotionProps } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type SwitchSize = "sm" | "md";
/** `fg`: white track when on (default) · `signal`: red track (e.g. live data toggles). */
export type SwitchTone = "fg" | "signal" | "win";

export interface SwitchProps extends Omit<HTMLMotionProps<"button">, "children" | "type" | "role" | "onChange" | "onClick" | "value"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: SwitchSize;
  tone?: SwitchTone;
}

const DIM: Record<SwitchSize, { track: string; thumb: string; travel: number }> = {
  md: { track: "h-6 w-[42px] p-[3px]", thumb: "size-[18px]", travel: 18 },
  sm: { track: "h-5 w-[34px] p-[3px]", thumb: "size-[14px]", travel: 14 },
};
const TRACK_ON: Record<SwitchTone, string> = { fg: "bg-fg border-transparent", signal: "bg-signal border-transparent", win: "bg-win border-transparent" };
const THUMB_ON: Record<SwitchTone, string> = { fg: "bg-ink-950", signal: "bg-white", win: "bg-ink-950" };

// Velocity → stretch, normalised by the travel: `spring.press` peaks at ≈10.5 travels/s for any size, so the thumb
// is ≈1.3× wider mid-travel and round at rest.
const STRETCH_MAX = 0.32;
const STRETCH_PER_TRAVEL_S = 0.0285;

/**
 * Elastic toggle switch (21st.dev "Elastic Toggle"): `role="switch"` + `aria-checked` on a native button (Space /
 * Enter toggle, labelable via `<label htmlFor>` or `aria-label`). The thumb travels on `spring.press` (transform
 * only) and stretches with its own velocity; pressing squashes it towards the travel direction; the track and thumb
 * colours crossfade as opacity layers (`tween.crossfade`). Reduced motion: instant.
 */
export function Switch({ checked, onCheckedChange, size = "md", tone = "fg", disabled, className, ...rest }: SwitchProps) {
  const reduced = useReducedFx();
  const dim = DIM[size];
  const target = checked ? dim.travel : 0;
  const x = useSpring(target, spring.press);
  const velocity = useVelocity(x);
  const stretch = useTransform(velocity, (v) => 1 + Math.min(STRETCH_MAX, (Math.abs(v) / dim.travel) * STRETCH_PER_TRAVEL_S));

  useEffect(() => {
    if (reduced) x.jump(target);
    else x.set(target);
  }, [x, target, reduced]);

  const fade = reduced ? { duration: 0 } : tween.crossfade;

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={checked ? "on" : "off"}
      onClick={() => onCheckedChange(!checked)}
      whileTap={disabled || reduced ? undefined : "press"}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-line-2 bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50",
        dim.track,
        className,
      )}
      {...rest}
    >
      <motion.span
        aria-hidden="true"
        className={cn("pointer-events-none absolute -inset-px rounded-full border", TRACK_ON[tone])}
        initial={false}
        animate={{ opacity: checked ? 1 : 0 }}
        transition={fade}
      />
      <motion.span aria-hidden="true" className="relative block" style={{ x }}>
        <motion.span
          className={cn("relative block", dim.thumb)}
          variants={{ press: { scaleX: 1.22 } }}
          style={{ originX: checked ? 1 : 0 }}
          transition={spring.press}
        >
          <motion.span className="absolute inset-0 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.35)]" style={reduced ? undefined : { scaleX: stretch }}>
            <span className="absolute inset-0 rounded-full bg-mute" />
            <motion.span className={cn("absolute inset-0 rounded-full", THUMB_ON[tone])} initial={false} animate={{ opacity: checked ? 1 : 0 }} transition={fade} />
          </motion.span>
        </motion.span>
      </motion.span>
    </motion.button>
  );
}
