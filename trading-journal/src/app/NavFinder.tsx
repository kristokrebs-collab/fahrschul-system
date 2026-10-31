/**
 * "Was willst du tun?" inside the command navigation (⌘K / Ctrl+K, the header menu): a field that finds any FUNCTION of the
 * app – not just a page – and a clear way to the full list ("Alle Funktionen"). The field and the link are part of the first
 * load (a few lines); the answers come from the function register, a lazy chunk that is fetched with the first typed letter
 * (`NavFinderResults`). Enter opens the best hit; the hits are navigation items (↑ ↓) like the page links around them.
 *
 * Motion (Runde 10): the field warms up when it takes focus (a soft ring, the magnifier brightens and leans in), and the answers
 * open under it – the box grows on a spring (`grid-template-rows` 0fr → 1fr, so what is below is pushed smoothly instead of
 * jumping) while the hits rise one after the other and the selection glides between them. Emptying the field folds the box shut
 * on the same spring with the last answers still in it.
 */
import { lazy, Suspense, useEffect, useId, useState, type KeyboardEvent } from "react";
import { NF_VARS } from "@/app/shellFx";
import { cn } from "@/lib/cn";
import { Icon } from "@/primitives/icons";

const Results = lazy(() => import("./NavFinderResults"));

export const NAV_FINDER_STRINGS = {
  label: "Was willst du tun?",
  placeholder: "Funktion suchen: Strategie testen, Wochenbericht …",
  all: "Alle Funktionen",
  allHint: "Alle Funktionen ansehen",
} as const;

/** How long the folded-shut box keeps the last answers inside (ms): a little longer than its spring needs. */
const FOLD_MS = 480;

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
  // the last answers stay in the box while it folds shut (state from props; cleared by the timer below)
  const [kept, setKept] = useState(query);
  if (query && query !== kept) setKept(query);
  useEffect(() => {
    if (query) return;
    const t = setTimeout(() => setKept(""), FOLD_MS);
    return () => clearTimeout(t);
  }, [query]);
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
    <div data-testid="nav-finder" style={NF_VARS}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
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
          className="inline-flex items-center gap-1 rounded-md text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 outline-none transition-colors hover:text-fg hover:decoration-fg focus-visible:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white min-h-tap"
        >
          {NAV_FINDER_STRINGS.all}
          <span aria-hidden="true">→</span>
        </a>
      </div>
      <div className="group/field relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute transition-[color,translate] duration-300 ease-out group-focus-within/field:translate-x-0.5 group-focus-within/field:text-fg [&>svg]:size-4">
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
          className="h-12 w-full rounded-xl border border-line-2 bg-ink-900 pl-10 pr-3 text-[16px] text-fg outline-none transition-[border-color,box-shadow] duration-300 placeholder:text-mute hover:border-white/30 focus:border-white/50 focus:shadow-[0_0_0_4px_rgb(255_255_255/0.05)] [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      {/* the answers open under the field: the row grows on a spring, the content only translates / fades (inside `overflow: hidden`) */}
      <div className={cn("grid [transition-duration:var(--nf-ms)] [transition-property:grid-template-rows] [transition-timing-function:var(--nf-ease)]", query ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div inert={!query} className="min-h-0 overflow-hidden">
          <div className="pt-2">
            {kept && (
              <Suspense fallback={null}>
                <Results query={kept} onOpen={onOpen} onAll={onAll} />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
