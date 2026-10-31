import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { storageKey } from "@/store/storage";

/**
 * `Fold` – a whole card folded into one calm row ("Mehr anzeigen") for what is set once or looked at now and then, so a long
 * page reads in a few screens. Nothing is removed: the card stays in the DOM (a native `details`: find-in-page, readers and the
 * function register see it), a jump to anything inside it (`revealCard` / `revealSection`, `reveal.ts`) opens the fold first, and
 * the choice is remembered per browser (`tj2-folds`, the ids that are open).
 *
 *   <Fold id="markt-phasen" title="Ereignisphasen" hint="Wann der Markt wegen Terminen unruhig wird" className="lg:col-span-12"><PhasenCard /></Fold>
 *
 * Closed: one row (title, one line of what is inside, a chevron), ≥ 56 px, the whole row is the target. Open: the card, and a quiet
 * "Zuklappen" row above it. No height animation (nothing springs, nothing is measured); the chevron turns by `transform` only.
 */
export const FOLDS_KEY = storageKey("folds");
/** `"*"` among the ids opens every fold (the e2e seed uses it, so specs that are not about folds see the whole page). */
export const FOLD_ALL = "*";

function readOpen(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(FOLDS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    const set = new Set(readOpen());
    if (open) set.add(id);
    else set.delete(id);
    set.delete(FOLD_ALL);
    localStorage.setItem(FOLDS_KEY, JSON.stringify([...set]));
  } catch {
    /* no storage: the fold simply starts closed next time */
  }
}

export function isFoldOpen(id: string): boolean {
  const s = readOpen();
  return s.has(FOLD_ALL) || s.has(id);
}

export interface FoldProps {
  /** stable id (also `data-fold`) */
  id: string;
  title: string;
  /** one honest line of what is inside */
  hint: string;
  children: ReactNode;
  /** grid placement (`lg:col-span-12`) – the fold is the grid item */
  className?: string;
}

export function Fold({ id, title, hint, children, className }: FoldProps) {
  const [open, setOpen] = useState(() => isFoldOpen(id));
  return (
    <details
      data-fold={id}
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen((was) => {
          if (was !== now) writeOpen(id, now);
          return now;
        });
      }}
      className={cn("group/fold min-w-0", className)}
    >
      <summary
        className={cn(
          "touch-hit flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl border border-line bg-ink-950/40 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.04] focus-visible:outline-none! focus-visible:shadow-(--ring-glow-btn) [&::-webkit-details-marker]:hidden",
          // open: a quiet line above the card instead of a second heading
          "group-open/fold:mb-3 group-open/fold:min-h-11 group-open/fold:border-transparent group-open/fold:bg-transparent group-open/fold:px-1 group-open/fold:py-1",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[13.5px] font-medium text-fg group-open/fold:hidden">{title}</span>
          <span className="line-clamp-2 text-[12px] text-mute group-open/fold:hidden">{hint}</span>
          <span className="hidden text-[12px] text-mute group-open/fold:inline">Zuklappen: {title}</span>
        </span>
        <svg viewBox="0 0 12 12" className="size-3 shrink-0 text-mute transition-transform duration-150 group-open/fold:rotate-180 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </summary>
      {children}
    </details>
  );
}
