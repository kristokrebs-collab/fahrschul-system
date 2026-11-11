/**
 * "Auch hier:" / "Siehe auch:" – a quiet row of text links from one page to related functions that would otherwise be found by
 * chance (the training sheet, the what-if of a trade, a card at the bottom of a long page, the archive behind the squeeze). Each
 * link opens a function of the register (`featureOpen.ts`, a lazy chunk – this component imports nothing of the register itself).
 * Never on the dashboard; `FeatureLinks` is one row per page at most, `SeeAlso` one row under a card with its links from the
 * table `seeAlso.ts` (at most three).
 */
import { SEE_ALSO, type SeeAlsoKey } from "@/app/seeAlso";
import { cn } from "@/lib/cn";

export interface FeatureLinkItem {
  /** register id (`src/app/features.ts`) */
  id: string;
  label: string;
}

export function FeatureLinks({
  items,
  lead = "Auch hier",
  label,
  testId = "feature-links",
  at,
  className,
}: {
  items: readonly FeatureLinkItem[];
  lead?: string;
  /** the name of the landmark when the page holds several rows (they must differ) */
  label?: string;
  testId?: string;
  /** the key of the row in `seeAlso.ts` (for tests and the e2e) */
  at?: string;
  className?: string;
}) {
  return (
    <nav aria-label={label ?? lead} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-mute", className)} data-testid={testId} data-at={at}>
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mute">{lead}</span>
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

/**
 * "Siehe auch" under a card (or under a page header): the links of `SEE_ALSO[at]`. `inCard` sets the row off with a hairline, the way
 * the notes at the foot of a card are.
 */
export function SeeAlso({ at, inCard = false, className }: { at: SeeAlsoKey; inCard?: boolean; className?: string }) {
  const row = SEE_ALSO[at];
  return (
    <FeatureLinks
      items={row.links}
      lead="Siehe auch"
      label={`Siehe auch: ${row.links.map((l) => l.label).join(", ")}`}
      testId="see-also"
      at={at}
      className={cn(inCard && "border-t border-line pt-3", className)}
    />
  );
}
