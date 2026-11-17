/**
 * A required consent (Review F07): a real checkbox (native input, so forms, keyboard and screen readers work) with the
 * legal documents as links in its label – clicking a link opens the document and never toggles the box. The box pops
 * on `spring.pop` when checked (reduced motion: instant). Used at sign-up and before Stripe Checkout.
 */
import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { GlyphCheck } from "@/primitives/icons";

export function ConsentCheck({ checked, onChange, children, invalid, testId }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; invalid?: boolean; testId?: string }) {
  const reduced = useReducedFx();
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-200", invalid && !checked ? "border-loss/50" : "border-line")} data-testid={testId} data-checked={checked ? "true" : "false"}>
      <span className="relative mt-px grid size-[18px] shrink-0 place-items-center">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0" aria-invalid={invalid && !checked ? true : undefined} />
        <motion.span
          aria-hidden="true"
          className={cn("pointer-events-none grid size-[18px] place-items-center rounded-md border transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-white/40", checked ? "border-fg bg-fg text-ink-950" : "border-line-2")}
          animate={reduced ? undefined : { scale: checked ? [0.8, 1] : 1 }}
          transition={spring.pop}
        >
          {checked && <GlyphCheck className="size-3" />}
        </motion.span>
      </span>
      <label htmlFor={id} className="min-w-0 cursor-pointer text-[12px] leading-relaxed text-mute [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </label>
    </div>
  );
}
