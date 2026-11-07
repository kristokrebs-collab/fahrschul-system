import { PAGE_LABELS } from "@/app/navGroups";
import { Skeleton } from "@/primitives/Skeleton";
import type { Page } from "@/store/uiStore";

/**
 * Fallback of a lazy page while its chunk loads (P14): the page's own shape in the app's skeleton language – a title bar
 * where the `h1` will stand, the lead line, then card placeholders in the 12-column grid (fixed heights, no layout
 * shift when the cards arrive; the shimmer is the shared `Skeleton` band, a static tint under reduced motion). The
 * page switch itself animates the layer as for every page; the real page replaces this in place. Decorative only –
 * the loading line is for screen readers (no live region: the toast island stays the only one).
 */
export function PageSkeleton({ page }: { page: Page }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" aria-busy="true" data-page-skeleton={page}>
      <span className="sr-only">{`${PAGE_LABELS[page]} wird geladen …`}</span>
      <div className="grid gap-3 lg:col-span-12" aria-hidden="true">
        <Skeleton className="h-7 w-[min(240px,60%)] rounded-lg" />
        <Skeleton className="h-4 w-[min(460px,85%)] rounded-md" />
      </div>
      <Skeleton className="rounded-2xl lg:col-span-7" height={300} />
      <Skeleton className="rounded-2xl lg:col-span-5" height={300} />
      <Skeleton className="rounded-2xl lg:col-span-12" height={220} />
    </div>
  );
}
