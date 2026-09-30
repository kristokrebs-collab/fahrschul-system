/** Bundle `U$`: fixed gradient fade behind the dock (`z-[45] h-28 from-transparent via-ink-900/70 to-ink-900`). */
export function BottomFade() {
  return <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] h-28 bg-gradient-to-b from-transparent via-ink-900/70 to-ink-900" />;
}
