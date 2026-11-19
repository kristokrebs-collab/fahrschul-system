import { cn } from "@/lib/cn";

/** A key cap (`<kbd>`): mono, hairline border, a 1 px bottom lip – used by the search, the shortcut sheet and the tour. */
export function Kbd({ children, className, size = "md" }: { children: string; className?: string; size?: "sm" | "md" }) {
  return (
    <kbd
      className={cn(
        "inline-grid min-w-[1.6em] place-items-center rounded-md border border-line-2 bg-white/[0.04] px-1 font-mono font-medium leading-none text-fg shadow-[inset_0_-1px_0_var(--color-line-2)]",
        size === "sm" ? "h-[18px] text-[10.5px]" : "h-[22px] text-[11.5px]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A key combo (`["g", "t"]` → G then T, `["⌘", "K"]`). `then` puts a faint "dann" between sequential keys. */
export function KeyCombo({ keys, then = false, size }: { keys: readonly string[]; then?: boolean; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 && then && <span className="text-[10.5px] text-mute">dann</span>}
          <Kbd size={size}>{k.length === 1 ? k.toUpperCase() : k}</Kbd>
        </span>
      ))}
    </span>
  );
}
