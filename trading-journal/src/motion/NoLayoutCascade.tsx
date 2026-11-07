import { LayoutGroup, LayoutGroupContext } from "motion/react";
import { useContext, useMemo, type ReactNode } from "react";

/**
 * Layout groups of the app: NONE at the root (`MotionRoot`), scoped ones where a subtree needs coordination.
 *
 * Motion's `LayoutGroup` provides two things, and both scale with the subtree they cover:
 * - the shared projection `group`: the `willUpdate` of ANY layout node in it snapshots EVERY other node of the group
 *   (`nodeGroup().dirty`), and after the commit all of them are measured again. Under an app-wide group a hover pill
 *   moving, a status pill relabelling, the dock indicator following a page switch or a tile's hover dependency
 *   flipping measured every `layout` / `layoutId` node of the app – two `getBoundingClientRect` per node, with transform
 *   resets in between (≈ 130 nodes on the Übersicht, measured on every page switch, hover and dialog open);
 * - `forceRender`: an `AnimatePresence` calls it once all its exits have finished, which re-renders every motion
 *   component under the group (≈ 1,700 on the Übersicht) after every finished exit.
 *
 * Shared `layoutId` morphs need neither: the projection tree has ONE root for the whole document, which keeps the
 * `layoutId` stacks; a new lead takes a fresh snapshot of the previous lead (`NodeStack.promote` → `updateSnapshot`), a
 * `layoutId` node snapshots itself on unmount (`projection.unmount` → `willUpdate`), and every morph source flips its own
 * `layoutDependency` (or unmounts / exits) in the commit that mounts its target, which starts the projection update.
 * Lists that close gaps (`popLayout`, the trades rows' `layoutDependency` from `onExitComplete`) measure themselves.
 * What a group adds is that a `layout` node which does NOT re-render still FLIPs when something else moves it – inside
 * a container that itself jumps (every card, every page) that only made the node lag behind its container.
 *
 * Subtrees whose nodes move each other and must glide together get a scoped group: `LayoutCascade`.
 */

/**
 * A scoped layout group: its own projection group and its own `forceRender`, both limited to this subtree (`layoutId`s
 * stay unprefixed – there is no id). Put it around content whose sync-mode `AnimatePresence` exits or growing nodes must
 * FLIP `layout` siblings that do not re-render themselves: sheet and dialog bodies (`Sheet`, `MorphDialogProvider` –
 * the panel resizes with its form), and the settings page (`PageHost cascade` – `Reorder` rules glide up after a
 * "Regel entfernen?" strip leaves). Everything else needs none.
 */
export function LayoutCascade({ children }: { children: ReactNode }) {
  return <LayoutGroup>{children}</LayoutGroup>;
}

/**
 * Drops the nearest group's `forceRender` for this subtree (its projection group stays, so a growing node still moves
 * its group siblings). Outside a `LayoutCascade` there is none to drop – a no-op. Inside one, wrap a presence whose exits
 * never move an in-flow sibling (`popLayout` swaps such as `TextRoll`, fixed overlays, `absolute` rings and pills), so
 * a finished exit does not re-render the cascade's subtree.
 */
export function NoLayoutCascade({ children }: { children: ReactNode }) {
  const ctx = useContext(LayoutGroupContext);
  const value = useMemo(() => (ctx.forceRender ? { ...ctx, forceRender: undefined } : ctx), [ctx]);
  return <LayoutGroupContext.Provider value={value}>{children}</LayoutGroupContext.Provider>;
}
