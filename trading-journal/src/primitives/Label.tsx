import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface LabelProps {
  children: ReactNode;
  /** Heading level / element, default `h2` (section labels). Use `label` for form labels with `htmlFor`. */
  as?: "h2" | "h3" | "span" | "div" | "label" | "dt";
  htmlFor?: string;
  /** Red signal dot (default true for section labels). */
  dot?: boolean;
  className?: string;
  id?: string;
}

/** Section / form label: `<h2 class="label">` with the `size-1.5 rounded-full bg-signal` dot (Plan 2.4). */
export function Label({ children, as = "h2", htmlFor, dot = true, className, id }: LabelProps) {
  const Tag = as;
  return (
    <Tag id={id} htmlFor={htmlFor} className={cn("label flex items-center gap-2", className)}>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />}
      {children}
    </Tag>
  );
}
