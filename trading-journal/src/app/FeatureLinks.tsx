/**
 * "Auch hier:" – a quiet row of text links from one page to related functions that would otherwise be found by chance
 * (the training sheet, the what-if of a trade, a card at the bottom of a long page). Each link opens a function of the
 * register (`featureOpen.ts`, a lazy chunk – this component imports nothing of the register itself). Never on the
 * dashboard; one row per page at most.
 */
import { cn } from "@/lib/cn";

export interface FeatureLinkItem {
  /** register id (`src/app/features.ts`) */
  id: string;
  label: string;
}

export function FeatureLinks({ items, lead = "Auch hier", className }: { items: readonly FeatureLinkItem[]; lead?: string; className?: string }) {
  return (
    <nav aria-label={lead} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-mute", className)} data-testid="feature-links">
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{lead}</span>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => void import("@/app/featureOpen").then((m) => m.openFeature(it.id))}
          className="inline-flex items-center gap-1 underline decoration-line-2 underline-offset-4 outline-none transition-colors hover:text-fg hover:decoration-fg focus-visible:text-fg focus-visible:decoration-fg pointer-coarse:min-h-11"
          data-feature-link={it.id}
        >
          {it.label}
          <span aria-hidden="true">→</span>
        </button>
      ))}
    </nav>
  );
}
