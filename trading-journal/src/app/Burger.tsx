import { cn } from "@/lib/cn";

/**
 * The menu mark: three bars that turn into the cross when `open` (the header's menu button while the navigation is open, and the
 * navigation's own close button, which starts as the burger and turns into the cross as the panel comes in – the same place on
 * screen, one continuous gesture). Pure CSS on `translate` / `rotate` / `scale` (`shell-motion.css`), decorative (`aria-hidden`).
 */
export function Burger({ open, className }: { open: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("burger", className)} data-open={open ? "" : undefined}>
      <i />
      <i />
      <i />
    </span>
  );
}
