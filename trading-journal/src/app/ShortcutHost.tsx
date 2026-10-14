import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PAGE_LABELS } from "@/app/Dock";
import { Kbd } from "@/app/Kbd";
import { CHORD_MS, isEditableTarget, isSearchCombo, matchKey, modalOpen, useShortcutSheet, type ChordState } from "@/app/shortcuts";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { preloadSearch } from "@/search/GlobalSearchHost";
import { PAGE_KEYS, PAGES } from "@/store/uiStore";

const ShortcutSheet = lazy(() => import("@/app/ShortcutSheet"));

/**
 * Leaf host of the keyboard shortcuts (P13): one `keydown` listener for the registry in `shortcuts.ts` (guards:
 * editable focus, open modal, composition, modifiers – ⌘K stays CommandNav's) plus the chord hint – after `g` a small
 * pill above the dock lists the page letters for `CHORD_MS` – and the lazily loaded cheat sheet. Mount once in `App`
 * after `<SetupEditor/>`, before `<Celebrate/>`.
 */
export function ShortcutHost() {
  const sheetLoaded = useShortcutSheet((s) => s.loaded);
  const [chordAt, setChordAt] = useState<number | null>(null);
  const chord = useRef<ChordState>({ g: null });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const clearChord = () => {
      chord.current = { g: null };
      setChordAt(null);
      clearTimeout(timer.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const search = isSearchCombo(e);
      if (!search && (isEditableTarget(e.target) || modalOpen())) {
        if (chord.current.g !== null) clearChord();
        return;
      }
      if (search && modalOpen()) return;
      const now = performance.now();
      const { result, chord: next } = matchKey(
        { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat, altGraph: e.getModifierState?.("AltGraph") ?? false },
        chord.current,
        now,
      );
      chord.current = next;
      if (result.kind === "chord") {
        e.preventDefault();
        preloadSearch();
        setChordAt(now);
        clearTimeout(timer.current);
        timer.current = setTimeout(clearChord, CHORD_MS);
        return;
      }
      clearChord();
      if (result.kind === "run") {
        e.preventDefault();
        result.def.run?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <>
      <NoLayoutCascade>
        <AnimatePresence>{chordAt !== null && <ChordHint key="chord" />}</AnimatePresence>
      </NoLayoutCascade>
      {sheetLoaded && (
        <Suspense fallback={null}>
          <ShortcutSheet />
        </Suspense>
      )}
    </>
  );
}

/** `g …` hint: which letter opens which page (decorative – the cheat sheet carries the same list for assistive tech). */
function ChordHint() {
  const reduced = useReducedFx();
  const labels = PAGE_LABELS as Partial<Record<string, string>>;
  return (
    <motion.div
      aria-hidden="true"
      data-layer="Tastenkürzel-Hinweis"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+96px)] z-[74] flex justify-center px-4"
      initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: spring.pop }}
      exit={{ opacity: 0, transition: tween.exit }}
    >
      <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-line-2 bg-ink-900 px-3.5 py-2 shadow-tooltip">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-mute">
          <Kbd size="sm">G</Kbd> dann
        </span>
        {PAGES.map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5 text-[12px] text-fg">
            <Kbd size="sm">{((PAGE_KEYS as Record<string, string>)[p] ?? "?").toUpperCase()}</Kbd>
            {labels[p] ?? p}
          </span>
        ))}
      </div>
    </motion.div>
  );
}
