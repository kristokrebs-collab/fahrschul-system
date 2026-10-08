import { LayoutGroup, LayoutGroupContext } from "motion/react";
import { useContext, useMemo, type ReactNode } from "react";

/**
 * Root layout group WITHOUT the app-wide re-render (`MotionRoot`).
 *
 * Motion's `LayoutGroup` provides two things. The shared projection `group`: a layout node's `willUpdate` snapshots every
 * other node, so siblings outside an `AnimatePresence` can FLIP the moment an exit starts (popLayout) and shared
 * `layoutId`s always have a box to morph from. And `forceRender`: an `AnimatePresence` calls it once ALL its exits have
 * finished, so `layout` nodes OUTSIDE the presence re-render, snapshot and glide into the gap a sync-mode exit left
 * behind. Under an id-less root group that second part re-renders every motion component of the app (≈ 1,700 on the
 * overview) after EVERY exit – a hover pill, a card's spot ring, a label roll, a toast, a segment ghost. Measured on the
 * Übersicht: 6–11 k component renders per scroll from presences exiting under a resting pointer (hover elements
 * passing under the mouse), several 1,500-component commits per dialog open / close.
 *
 * The root therefore keeps the group and drops `forceRender`. The morph contracts do not need it: a `layoutId` node
 * snapshots itself on unmount (`projection.unmount` → `willUpdate`) and a new stack lead takes the previous lead's
 * snapshot (`NodeStack.promote`), a popLayout exit dirties the group when it starts (`isPresent` flips → `willUpdate`),
 * and the trades lists feed their rows' `layoutDependency` from their own `onExitComplete`. The few subtrees whose
 * sync-mode exits must move `layout` siblings outside the presence get their own, scoped cascade: `LayoutCascade`.
 */
export function RootLayoutGroup({ children }: { children: ReactNode }) {
  return (
    <LayoutGroup>
      <NoLayoutCascade>{children}</NoLayoutCascade>
    </LayoutGroup>
  );
}

/**
 * Drops the nearest group's `forceRender` for this subtree (the `id` and `group` stay, so shared `layoutId`s still live in
 * the same group). Under `MotionRoot` the root already has none, so this only matters inside a `LayoutCascade`: wrap a
 * presence there whose exits never move an in-flow sibling (`popLayout` swaps such as `TextRoll`, fixed overlays,
 * `absolute` rings and pills), so a finished exit does not re-render the cascade's subtree.
 */
export function NoLayoutCascade({ children }: { children: ReactNode }) {
  const ctx = useContext(LayoutGroupContext);
  const value = useMemo(() => (ctx.forceRender ? { ...ctx, forceRender: undefined } : ctx), [ctx]);
  return <LayoutGroupContext.Provider value={value}>{children}</LayoutGroupContext.Provider>;
}

/**
 * A scoped cascade: a nested `LayoutGroup` that inherits the root's `group` (and its absent id – `layoutId`s stay
 * unprefixed), but owns a `forceRender` limited to this subtree. Put it around content whose sync-mode
 * `AnimatePresence` exits must FLIP `layout` siblings outside the presence: sheet and dialog bodies, and the settings
 * page (`Reorder` rules glide up when a "Regel entfernen?" strip leaves). Everything else needs none.
 */
export function LayoutCascade({ children }: { children: ReactNode }) {
  return <LayoutGroup>{children}</LayoutGroup>;
}
