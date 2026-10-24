/**
 * The answers of the navigation's finder: the best five functions for what was typed, each a navigation item with its name,
 * its task in plain words and where it lives. Its own chunk (the function register and its scorer load with it); nothing
 * is stored. No answer says so and points to the full list.
 */
import { useMemo } from "react";
import { groupOf, placeText, searchFeatures } from "@/app/featureQuery";
import { NAV_FINDER_STRINGS } from "@/app/NavFinder";

const SHOWN = 5;

export default function NavFinderResults({ query, onOpen, onAll }: { query: string; onOpen: (id: string) => void; onAll: () => void }) {
  const hits = useMemo(() => searchFeatures(query).slice(0, SHOWN), [query]);
  if (!hits.length) {
    return (
      <p className="text-[12.5px] leading-relaxed text-mute" data-testid="nav-finder-none" role="status">
        Dazu steht nichts in der Liste.{" "}
        <button type="button" data-cmd-item="" onClick={onAll} className="underline decoration-line-2 underline-offset-4 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-white pointer-coarse:min-h-11">
          {NAV_FINDER_STRINGS.allHint}
        </button>
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5" data-testid="nav-finder-results" aria-label={`${hits.length} Treffer`}>
      {hits.map((h) => (
        <li key={h.entry.id}>
          <button
            type="button"
            data-cmd-item=""
            data-feature={h.entry.id}
            onClick={() => onOpen(h.entry.id)}
            className="grid w-full min-w-0 gap-0.5 rounded-xl border border-line-2 bg-ink-900 px-3 py-2.5 text-left outline-none transition-colors duration-200 hover:border-white/30 focus-visible:border-white/60 pointer-coarse:min-h-12"
          >
            <span className="truncate text-[14.5px] font-medium text-fg">{h.entry.name}</span>
            <span className="truncate text-[12px] text-mute">{h.entry.task ?? groupOf(h.entry).name}</span>
            <span className="truncate font-mono text-[11px] text-mute">
              {groupOf(h.entry).name} · {placeText(h.entry)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
