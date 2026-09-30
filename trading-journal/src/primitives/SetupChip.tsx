import { cn } from "@/lib/cn";

export interface SetupChipProps {
  name: string;
  color: string;
  className?: string;
}

/** Bundle `oT` chip: `inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-2 bg-white/[0.03] px-2 py-0.5 text-[11.5px]` + colour dot. */
export function SetupChip({ name, color, className }: SetupChipProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-2 bg-white/[0.03] px-2 py-0.5 text-[11.5px]", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface SetupChipsProps {
  items: readonly { id: string; name: string; color: string }[];
  /** Chips shown before the `+n` overflow pill (default 2). */
  max?: number;
  className?: string;
}

/** Row of chips with `+n` overflow; empty → `ohne Grundlage`. */
export function SetupChips({ items, max = 2, className }: SetupChipsProps) {
  if (items.length === 0) return <span className="text-xs text-faint">ohne Grundlage</span>;
  return (
    <span className={cn("flex min-w-0 flex-nowrap gap-1.5 overflow-hidden", className)}>
      {items.slice(0, max).map((s) => (
        <SetupChip key={s.id} name={s.name} color={s.color} />
      ))}
      {items.length > max && <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11.5px] text-mute">+{items.length - max}</span>}
    </span>
  );
}
