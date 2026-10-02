import { frame, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Conviction } from "@/domain/types";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface ConvictionOption {
  v: Conviction;
  label: string;
  /** CSS colour; defaults use `--conv-1..5`. */
  color: string;
}

export const convictionOptions: readonly ConvictionOption[] = [
  { v: 1, label: "Schwach", color: "var(--conv-1)" },
  { v: 2, label: "Gering", color: "var(--conv-2)" },
  { v: 3, label: "Mittel", color: "var(--conv-3)" },
  { v: 4, label: "Hoch", color: "var(--conv-4)" },
  { v: 5, label: "Top", color: "var(--conv-5)" },
];

export interface ConvictionRadioProps {
  value: Conviction | null;
  /** Clicking the selected dot clears the value (Bundle). */
  onChange: (value: Conviction | null) => void;
  options?: readonly ConvictionOption[];
  className?: string;
}

const PARTICLES = 12;

/**
 * Bundle `c2`: 1–5 dots (`role="radiogroup" aria-label="Überzeugung"`), 12 particles burst on select
 * (`spring.burst`, stagger `.03`), glow `transition-[background] 500ms`, dots `hover:scale-110`.
 * Inactive labels use `--color-faint` (Plan 2.2). Particles are skipped under reduced motion.
 */
export function ConvictionRadio({ value, onChange, options = convictionOptions, className }: ConvictionRadioProps) {
  const reduced = useReducedFx();
  const box = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const [glow, setGlow] = useState<{ x: number; y: number } | null>(null);
  const idx = options.findIndex((o) => o.v === value);

  useEffect(() => {
    const dot = dots.current[idx];
    const root = box.current;
    if (idx < 0 || !dot || !root) {
      setGlow(null);
      return;
    }
    frame.read(() => {
      const d = dot.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      setGlow({ x: d.left + d.width / 2 - r.left, y: d.top + d.height / 2 - r.top });
    });
  }, [idx]);

  const selected = idx >= 0 ? options[idx] : undefined;

  return (
    <div ref={box} className={cn("relative overflow-hidden rounded-2xl border border-line bg-ink-950/60 px-5 pb-11 pt-6", className)}>
      {selected && glow && (
        <div
          className="pointer-events-none absolute inset-0 transition-[background] duration-500"
          aria-hidden="true"
          style={{
            background: `radial-gradient(circle at ${glow.x}px ${glow.y + 160}px, color-mix(in srgb, ${selected.color} 20%, transparent) 0%, color-mix(in srgb, ${selected.color} 8%, transparent) 32%, transparent 70%)`,
          }}
        />
      )}
      <div className="relative z-10 flex items-center" role="radiogroup" aria-label="Überzeugung">
        {options.map((o, i) => {
          const lit = idx >= i;
          const next = options[i + 1];
          const checked = value === o.v;
          return (
            <div key={o.v} className={cn("flex items-center", next && "flex-1")}>
              <button
                ref={(el) => {
                  dots.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={o.label}
                onClick={() => onChange(checked ? null : o.v)}
                className="relative grid size-7 shrink-0 place-items-center"
              >
                <span
                  className="rounded-full transition-all duration-300 hover:scale-110"
                  style={{
                    width: 11 + i * 1.5,
                    height: 11 + i * 1.5,
                    background: lit ? o.color : "rgb(255 255 255 / 0.16)",
                    boxShadow: lit ? `0 0 16px color-mix(in srgb, ${o.color} 25%, transparent)` : "none",
                  }}
                />
                {checked &&
                  !reduced &&
                  Array.from({ length: PARTICLES }, (_, k) => {
                    const a = (k / PARTICLES) * Math.PI * 2;
                    const px = Math.cos(a) * 16 - 2;
                    const py = Math.sin(a) * 16 - 2;
                    return (
                      <motion.span
                        key={k}
                        aria-hidden="true"
                        className="absolute left-1/2 top-1/2 size-1 rounded-full"
                        style={{ background: o.color }}
                        initial={{ opacity: 0, scale: 0.3, rotate: -90, x: px, y: py }}
                        animate={{ opacity: 1, scale: 1, rotate: 0, x: px, y: py }}
                        transition={{ ...spring.burst, delay: k * stagger.particles }}
                      />
                    );
                  })}
                <span
                  className="absolute left-1/2 top-[calc(100%+10px)] -translate-x-1/2 whitespace-nowrap text-[11.5px] font-semibold transition-colors"
                  style={{ color: lit ? o.color : "var(--color-faint)" }}
                  aria-hidden="true"
                >
                  {o.label}
                </span>
              </button>
              {next && (
                <span
                  className="mx-2 h-1 flex-1 rounded-full transition-[background] duration-300"
                  aria-hidden="true"
                  style={{ background: idx > i ? `linear-gradient(to right, ${o.color}, ${next.color})` : "rgb(255 255 255 / 0.10)" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
