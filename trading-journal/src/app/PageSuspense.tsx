/**
 * A page behind its skeleton (a lazy chunk that is still on its way). When the skeleton WAS on screen, the page that replaces it
 * brightens in once – the landing of `Later`, same token (`tween.fade`, opacity from `LATER_LAND_FROM`, never from zero: the page keeps
 * its place, the content arrives in it). Before, skeleton and page swapped in one frame (Bewegungsprüfung Runde 14: 18 pages, both
 * viewports), while every card below already had its entrance. A page whose chunk was there at once (every visit after the first, the
 * idle preload) never shows the skeleton and gets no extra fade: the page change itself is untouched.
 *
 * Opacity only, on the page's own root – nothing is measured, nothing moves, no layout change. Reduced motion: no fade.
 */
import { Suspense, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { PageSkeleton } from "@/app/PageSkeleton";
import { replay } from "@/motion/replay";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { LATER_LAND_FROM } from "@/primitives/Later";
import type { Page } from "@/store/uiStore";

export function PageSuspense({ page, children }: { page: Page; children: ReactNode }) {
  /** the skeleton was shown for this mount (set by the fallback, read once by the landing) */
  const waited = useRef(false);
  return (
    <Suspense
      fallback={
        <Waited flagRef={waited}>
          <PageSkeleton page={page} />
        </Waited>
      }
    >
      {children}
      <Landed flagRef={waited} />
    </Suspense>
  );
}

function Waited({ flagRef, children }: { flagRef: RefObject<boolean>; children: ReactNode }) {
  useLayoutEffect(() => {
    flagRef.current = true;
  }, [flagRef]);
  return children;
}

/** A hidden marker after the page: when it mounts the page has arrived; the element before it is the page's root. */
function Landed({ flagRef }: { flagRef: RefObject<boolean> }) {
  const mark = useRef<HTMLSpanElement>(null);
  const reduced = useReducedFx();
  useLayoutEffect(() => {
    if (!flagRef.current) return;
    flagRef.current = false;
    const el = mark.current?.previousElementSibling;
    if (reduced || !(el instanceof HTMLElement)) return;
    replay(el, { opacity: [LATER_LAND_FROM, 1] }, tween.fade);
  }, [flagRef, reduced]);
  return <span ref={mark} hidden data-page-landed="" />;
}
