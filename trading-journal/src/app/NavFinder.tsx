/**
 * "Was willst du tun?" inside the command navigation (⌘K / Ctrl+K, the header menu): a field that finds any FUNCTION of the
 * app – not just a page – and a clear way to the full list ("Alle Funktionen"). The field and the link are part of the first
 * load (a few lines); the answers come from the function register, a lazy chunk that is fetched with the first typed letter
 * (`NavFinderResults`). Enter opens the best hit; the hits are navigation items (↑ ↓) like the page links around them.
 */
import { lazy, Suspense, useId, useState, type KeyboardEvent } from "react";
import { Icon } from "@/primitives/icons";

const Results = lazy(() => import("./NavFinderResults"));

export const NAV_FINDER_STRINGS = {
  label: "Was willst du tun?",
  placeholder: "Funktion suchen: Strategie testen, Wochenbericht …",
  all: "Alle Funktionen",
  allHint: "Alle Funktionen ansehen",
} as const;

export interface NavFinderProps {
  /** a function was chosen: close the navigation and open it */
  onOpen: (id: string) => void;
  /** the full list: close the navigation and show the page `Funktionen` */
  onAll: () => void;
}

export function NavFinder({ onOpen, onAll }: NavFinderProps) {
  const [q, setQ] = useState("");
  const id = useId();
  const query = q.trim();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && query) {
      e.preventDefault();
      void import("@/app/featureQuery").then((m) => {
        const first = m.searchFeatures(query)[0];
        if (first) onOpen(first.entry.id);
      });
    }
    if (e.key === "Escape" && q) {
      // the first Escape clears the field, only the next one closes the navigation
      e.preventDefault();
      e.stopPropagation();
      setQ("");
    }
  };
  return (
    <div className="grid gap-2" data-testid="nav-finder">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mute">
          {NAV_FINDER_STRINGS.label}
        </label>
        <a
          href="#funktionen"
          data-cmd-item=""
          data-testid="nav-all-functions"
          onClick={(e) => {
            e.preventDefault();
            onAll();
          }}
          className="inline-flex items-center gap-1 rounded-md text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 outline-none transition-colors hover:text-fg hover:decoration-fg focus-visible:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:min-h-11"
        >
          {NAV_FINDER_STRINGS.all}
          <span aria-hidden="true">→</span>
        </a>
      </div>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute [&>svg]:size-4">
          <Icon name="search" />
        </span>
        <input
          id={id}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={NAV_FINDER_STRINGS.placeholder}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          data-cmd-item=""
          data-testid="nav-finder-input"
          className="h-12 w-full rounded-xl border border-line-2 bg-ink-900 pl-10 pr-3 text-[16px] text-fg outline-none transition-colors duration-200 placeholder:text-mute hover:border-white/30 focus:border-white/50 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      {query && (
        <Suspense fallback={null}>
          <Results query={query} onOpen={onOpen} onAll={onAll} />
        </Suspense>
      )}
    </div>
  );
}
