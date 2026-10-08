import { rootProjectionNode } from "motion-dom";
import { useLayoutEffect } from "react";

/**
 * Keep-alive pages and Motion's projection (perf-120 phase B).
 *
 * Hiding a keep-alive page (React `<Activity mode="hidden">`) detaches every ref inside it, so each motion component's
 * VisualElement unmounts – and a `layoutId` projection node snapshots itself on unmount (`willUpdate` → measure): one
 * getBoundingClientRect per node of a page that is already `display: none`. The boxes are zero and are thrown away
 * (Motion drops zero snapshots), but every read forces the layout of the page being switched to (≈ 100 reads,
 * ≈ 55 ms on the first switch away from the Übersicht on the desktop probe, more on the tablet).
 *
 * `useHoldProjectionOnHide()` in the page's ROOT component: its layout cleanup runs before any child detaches its ref (a
 * parent's cleanup runs first; React hides the DOM only after the disappear effects) and blocks the document projection
 * root's updates until the commit's task has run its microtasks. Blocked, `willUpdate` returns without measuring
 * (Motion's instant-transition path); nothing on a page that is mounted or shown in the same commit animates its layout
 * anyway. The cleanup cannot tell a hide from an unmount – a kept-alive page unmounts only with the app.
 */
export function holdProjectionForHide(): void {
  const root = rootProjectionNode.current;
  if (!root || root.isUpdateBlocked()) return;
  root.blockUpdate();
  queueMicrotask(() => root.unblockUpdate());
}

export function useHoldProjectionOnHide(): void {
  useLayoutEffect(() => holdProjectionForHide, []);
}
