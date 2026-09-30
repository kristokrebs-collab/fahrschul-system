import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { radius, spring } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";

export interface SegmentedOption<T extends string> {
  v: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Extra thumb classes per value (Long → `bg-win/15 border-win/30`, Short → `bg-loss/15 border-loss/30`). */
  tones?: Partial<Record<T, string>>;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * Bundle `or`/`YG`: `role="radiogroup"` with a shared-layout thumb (`layoutId="bg-{useId}"`,
 * `spring.segment`), roving tabindex + arrow/Home/End keys, `whileTap {scale:.97}` on items.
 */
export function Segmented<T extends string>({ options, value, onChange, size = "md", tones, className, ...aria }: SegmentedProps<T>) {
  const id = useId();
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const press = usePressable({ scale: 0.97 });

  const enabled = options.filter((o) => !o.disabled);
  const move = (from: T | null | undefined, step: number) => {
    if (enabled.length === 0) return;
    const i = enabled.findIndex((o) => o.v === from);
    const next = enabled[(i + step + enabled.length) % enabled.length] ?? enabled[0];
    if (!next) return;
    onChange(next.v);
    refs.current.get(next.v)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(value, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(value, -1);
        break;
      case "Home": {
        e.preventDefault();
        const first = enabled[0];
        if (first) {
          onChange(first.v);
          refs.current.get(first.v)?.focus();
        }
        break;
      }
      case "End": {
        e.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last) {
          onChange(last.v);
          refs.current.get(last.v)?.focus();
        }
        break;
      }
    }
  };

  const hasValue = options.some((o) => o.v === value);

  return (
    <div role="radiogroup" onKeyDown={onKeyDown} className={cn("inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1", className)} {...aria}>
      {options.map((o, i) => {
        const checked = o.v === value;
        return (
          <motion.button
            key={o.v}
            ref={(el) => {
              if (el) refs.current.set(o.v, el);
              else refs.current.delete(o.v);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            data-checked={checked ? "true" : "false"}
            tabIndex={checked || (!hasValue && i === 0) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.v)}
            {...press}
            className={cn(
              "relative inline-flex rounded-lg font-medium text-mute transition-colors hover:text-fg data-[checked=true]:text-fg disabled:opacity-40",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
            )}
          >
            <AnimatePresence initial={false}>
              {checked && (
                <motion.span
                  layoutId={`bg-${id}`}
                  aria-hidden="true"
                  className={cn("absolute inset-0 rounded-lg border border-line-2 bg-ink-750", tones?.[o.v])}
                  style={{ borderRadius: radius.thumb }}
                  transition={spring.segment}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
            </AnimatePresence>
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
