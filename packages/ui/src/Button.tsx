import type { ButtonHTMLAttributes } from "react";

/**
 * Minimales, aus der Prototyp-Design-DNA (dashboard.html/app.html
 * CSS-Variablen, siehe docs/prototype-audit.md) portiertes Primitiv. Wird in
 * Prompt 1-4 erweitert; hier bewusst schlank gehalten.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  const base = "fahrschul-btn";
  const variantClass = `fahrschul-btn--${variant}`;
  return <button className={[base, variantClass, className].filter(Boolean).join(" ")} {...rest} />;
}
