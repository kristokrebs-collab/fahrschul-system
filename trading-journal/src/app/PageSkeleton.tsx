import { PAGE_LABELS } from "@/app/navGroups";
import { retryChunksNow, useOffline } from "@/lib/chunkLoad";
import { Button } from "@/primitives/Button";
import { Skeleton } from "@/primitives/Skeleton";
import type { Page } from "@/store/uiStore";

/**
 * Fallback of a lazy page while its chunk loads (P14): the page's own shape in the app's skeleton language – a title bar
 * where the `h1` will stand, the lead line, then card placeholders in the 12-column grid (fixed heights, no layout
 * shift when the cards arrive; the shimmer is the shared `Skeleton` band, a static tint under reduced motion). The
 * page switch itself animates the layer as for every page; the real page replaces this in place. Decorative only –
 * the loading line is for screen readers (no live region: the toast island stays the only one).
 * Offline (`useOffline`) the first big block becomes an honest note of the same size: the page loads as soon as the
 * connection is back (`loadChunk` waits for `online`), „Wiederholen“ lets it try at once. No layout change, no error.
 */
export function PageSkeleton({ page }: { page: Page }) {
  const offline = useOffline();
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" aria-busy="true" data-page-skeleton={page}>
      <span className="sr-only">{offline ? `${PAGE_LABELS[page]}: Du bist offline – diese Seite lädt, sobald du wieder verbunden bist.` : `${PAGE_LABELS[page]} wird geladen …`}</span>
      <div className="grid gap-3 lg:col-span-12" aria-hidden="true">
        <Skeleton className="h-7 w-[min(240px,60%)] rounded-lg" />
        <Skeleton className="h-4 w-[min(460px,85%)] rounded-md" />
      </div>
      {offline ? (
        <div className="flex flex-col items-start justify-center gap-4 rounded-2xl border border-line bg-ink-950/50 p-6 lg:col-span-7" style={{ height: 300 }} data-offline-note>
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-fg">Du bist offline – diese Seite lädt, sobald du wieder verbunden bist.</p>
          <Button variant="secondary" size="sm" onClick={retryChunksNow}>
            Wiederholen
          </Button>
        </div>
      ) : (
        <Skeleton className="rounded-2xl lg:col-span-7" height={300} />
      )}
      <Skeleton className="rounded-2xl lg:col-span-5" height={300} />
      <Skeleton className="rounded-2xl lg:col-span-12" height={220} />
    </div>
  );
}
