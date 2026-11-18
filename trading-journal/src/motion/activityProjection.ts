import { rootProjectionNode, type IProjectionNode } from "motion-dom";
import { useLayoutEffect, type RefObject } from "react";

/**
 * Keep-alive pages and Motion's projection (perf-120 phases B / C).
 *
 * Hiding a keep-alive page (React `<Activity mode="hidden">`) detaches every ref inside it, so each motion component's
 * VisualElement unmounts – and a `layoutId` projection node snapshots itself on unmount (`willUpdate` → measure): one
 * getBoundingClientRect per node of a page that is already `display: none`. The boxes are zero and are thrown away
 * (Motion drops zero snapshots), but every read forces the layout of the page being switched to (≈ 100 reads,
 * ≈ 55 ms on the first switch away from the Übersicht on the desktop probe, more on the tablet).
 *
 * `useHoldProjectionOnHide()` in a component that is the FIRST child of the hidden subtree (the page host puts one in
 * front of every keep-alive page; a page root works too): its layout cleanup runs before any later sibling or child
 * detaches its ref (React's disappear pass runs a component's cleanup before it descends and walks siblings in order;
 * the DOM is hidden only after the disappear effects) and blocks the document projection root's updates until the
 * commit's task has run its microtasks. Blocked, `willUpdate` returns without measuring (Motion's instant-transition
 * path); nothing on a page that is mounted or shown in the same commit animates its layout anyway. The cleanup cannot
 * tell a hide from an unmount – a kept-alive page unmounts only with the app.
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

/**
 * The show of a keep-alive page (perf-120 phase C). Every motion node of the page mounts again in the reveal commit, and
 * because the tree has animated before (`root.hasTreeAnimated`) each `layout` / `layoutId` node marks itself
 * layout-dirty on mount – so the very next projection update anywhere (the dock's markers re-render right after the
 * switch) measured ALL of them: a getBoundingClientRect per node, and every node inside a `content-visibility: auto`
 * cell of the Übersicht forced that skipped cell's style + layout (7–8 cells, ≈ 20 ms in the reveal task on the tablet
 * probe).
 *
 * Nothing on a page that has just appeared animates its layout from that measurement: a later layout change measures
 * again before it compares (`willUpdate` snapshots, the update measures the new box), a shared-layout morph measures its
 * source when it starts (`NodeStack.promote`). So after the page's nodes are mounted, their dirty flag is dropped –
 * except for nodes that take part in an animation right now (a snapshot or a resumed lead is pending, or a layout
 * animation runs). Returns how many nodes were settled (diagnostics / tests).
 */
export function settleRevealedProjection(container: HTMLElement | null): number {
  const root = rootProjectionNode.current;
  if (!container || !root?.nodes) return 0;
  let settled = 0;
  root.nodes.forEach((child) => {
    const node = child as IProjectionNode<unknown>;
    if (!node.isLayoutDirty || node.snapshot || node.resumeFrom || node.currentAnimation) return;
    const el = node.instance;
    if (el instanceof Element && container.contains(el)) {
      node.isLayoutDirty = false;
      settled += 1;
    }
  });
  return settled;
}

/**
 * `settleRevealedProjection(container)` in the layout effect of a component that is the LAST child of the shown
 * subtree: React re-runs a reappearing subtree's layout effects children first and siblings in order, so every ref
 * (VisualElement mount) and `MeasureLayout` mount of the page has run before it; Motion's projection update is queued
 * in a microtask after the commit.
 */
export function useSettleProjectionOnShow(container: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    settleRevealedProjection(container.current);
  }, [container]);
}
