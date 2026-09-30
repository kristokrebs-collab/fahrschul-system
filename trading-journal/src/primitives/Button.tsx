import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";
import { usePressable } from "@/motion/usePressable";

export type ButtonVariant = "ghost" | "primary" | "danger";
export type ButtonSize = "sm" | "md";

export const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonVariant: Record<ButtonVariant, string> = {
  ghost: "border-line-2 bg-white/[0.03] text-fg hover:bg-white/[0.07] hover:border-steel/40",
  primary: "border-transparent bg-gradient-to-b from-white to-[#d6d6d6] text-ink-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] hover:to-white",
  danger: "border-signal/40 bg-signal/10 text-[#ff8a90] hover:bg-signal/20",
};
export const buttonSize: Record<ButtonSize, string> = { md: "px-4 py-2 text-[13px]", sm: "px-3 py-1.5 text-xs" };

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Bundle `Re`: `motion.button` with `whileTap {scale:.96}` on `spring.press` (none while disabled). */
export function Button({ variant = "ghost", size = "md", className, type = "button", disabled, ...props }: ButtonProps) {
  const press = usePressable({ disabled: Boolean(disabled) });
  return <motion.button type={type} disabled={disabled} {...press} className={cn(buttonBase, buttonSize[size], buttonVariant[variant], className)} {...props} />;
}
