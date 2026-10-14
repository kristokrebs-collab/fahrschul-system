import { AnimatePresence } from "motion/react";
import { lazy, Suspense } from "react";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { takePending, useSearchOpen } from "./searchStore";

/** The overlay and the index builder load on the first open (own chunk) – the app never pays for them before. */
const GlobalSearch = lazy(() => import("./GlobalSearch").then((m) => ({ default: m.GlobalSearch })));
const loadActions = () => import("./actions");

/** Warm the chunks (e.g. on the first `/` key or pointer over a search button) without opening anything. */
export function preloadSearch(): void {
  void import("./GlobalSearch");
  void loadActions();
}

/**
 * Leaf host of the global search (P13): mount once in `App` (after `<SetupEditor/>`, before `<Celebrate/>`). Opening
 * is done by the shortcut host (`/`, ⌘⇧F / Ctrl+⇧F), the command navigation or `openSearch()`. The chosen hit runs
 * after the overlay's exit, so the next dialog (trade detail, editor) never stacks on a closing one.
 */
export function GlobalSearchHost() {
  const open = useSearchOpen();
  return (
    <NoLayoutCascade>
      <AnimatePresence
        onExitComplete={() => {
          const action = takePending();
          if (action) void loadActions().then((m) => m.runSearchAction(action));
        }}
      >
        {open && (
          <Suspense key="search" fallback={null}>
            <GlobalSearch />
          </Suspense>
        )}
      </AnimatePresence>
    </NoLayoutCascade>
  );
}
