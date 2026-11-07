/**
 * "Was willst du tun?" inside the command navigation (⌘K / Ctrl+K, the header menu): a field that finds any FUNCTION and any PAGE
 * of the app ("Einstellungen" leads to the page, not only to a card of it) and a clear way to the full list ("Alle Funktionen").
 * It is the shared `SearchField` (clay glass, combobox: ↑ ↓ Enter Esc, status line, filter chips Alles / Seiten / Funktionen); this
 * file only wires it. The field and the link are part of the first load; the answers come from the function register, a lazy chunk
 * (`navFinderHits.ts`) that is fetched with the first typed letter. Enter opens the best hit.
 *
 * No hit is a dead end and none is a toast: the empty answer stays in the box and offers the full list and the assistant. Opening a
 * hit is `openFeature` (`featureOpen.ts`): it opens what covers the target and – when the card is not there – leaves the arrival
 * note on the page it landed on.
 */
import { useEffect, useMemo, useState } from "react";
import { SearchField, type SearchChip, type SearchOption } from "@/primitives/SearchField";

export const NAV_FINDER_STRINGS = {
  label: "Was willst du tun?",
  placeholder: "Was suchst du? z. B. Einstellungen, Wochenbericht, Daten sichern",
  all: "Alle Funktionen",
  allHint: "Alle Funktionen ansehen",
  ask: "Assistent fragen",
  none: "Dazu steht nichts in der Liste.",
  searching: "Suche …",
  chips: "Treffer eingrenzen",
  chipAll: "Alles",
  chipPages: "Seiten",
  chipFeatures: "Funktionen",
} as const;

type Filter = "all" | "page" | "feature";

export interface NavFinderProps {
  /** a function or page was chosen (`page:<page>` for a page): close the navigation and open it */
  onOpen: (id: string) => void;
  /** the full list: close the navigation and show the page `Funktionen` */
  onAll: () => void;
  /** nothing fits: close the navigation and open the assistant */
  onAsk?: () => void;
}

export function NavFinder({ onOpen, onAll, onAsk }: NavFinderProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = q.trim();
  // the answers of the last finished lookup; `done` is the query they belong to (until it catches up, the field says "Suche …")
  const [found, setFound] = useState<{ done: string; options: { option: SearchOption; kind: "page" | "feature" }[] }>({ done: "", options: [] });

  useEffect(() => {
    if (!query) return;
    let live = true;
    void import("@/app/navFinderHits").then((m) => {
      if (!live) return;
      const options = m.findHits(query).map((h) => ({ option: m.toOption(h), kind: m.kindOf(h) }));
      setFound({ done: query, options });
    });
    return () => {
      live = false;
    };
  }, [query]);

  const ready = found.done === query;
  const all = useMemo(() => (ready ? found.options : []), [ready, found.options]);
  const visible = useMemo(() => all.filter((x) => filter === "all" || x.kind === filter).slice(0, 6), [all, filter]);
  // the chips are always there (no row that appears and pushes the answers); the counts come with the answers
  const chips: SearchChip[] = useMemo(() => {
    const n = (k?: "page" | "feature"): number | undefined => (query && ready ? all.filter((x) => !k || x.kind === k).length : undefined);
    return [
      { id: "all", label: NAV_FINDER_STRINGS.chipAll, count: n() },
      { id: "page", label: NAV_FINDER_STRINGS.chipPages, count: n("page") },
      { id: "feature", label: NAV_FINDER_STRINGS.chipFeatures, count: n("feature") },
    ];
  }, [all, query, ready]);

  const empty = ready ? (
    <p className="pb-1 pt-2 text-[12.5px] leading-relaxed text-mute" data-testid="nav-finder-none">
      {NAV_FINDER_STRINGS.none}{" "}
      <button type="button" data-cmd-item="" onClick={onAll} className="min-h-11 underline decoration-line-2 underline-offset-4 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-white">
        {NAV_FINDER_STRINGS.allHint}
      </button>
      {onAsk && (
        <>
          {" · "}
          <button type="button" data-cmd-item="" onClick={onAsk} data-testid="nav-finder-ask" className="min-h-11 underline decoration-line-2 underline-offset-4 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-white">
            {NAV_FINDER_STRINGS.ask}
          </button>
        </>
      )}
    </p>
  ) : null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span aria-hidden="true" className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mute">
          {NAV_FINDER_STRINGS.label}
        </span>
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
      <SearchField
        testId="nav-finder"
        size="lg"
        label={NAV_FINDER_STRINGS.label}
        labelHidden
        placeholder={NAV_FINDER_STRINGS.placeholder}
        value={q}
        onChange={(v) => {
          setQ(v);
          if (!v.trim()) setFilter("all");
        }}
        options={visible.map((x) => x.option)}
        onSelect={(id) => onOpen(id)}
        listLabel="Treffer"
        status={query && !ready ? NAV_FINDER_STRINGS.searching : undefined}
        empty={empty}
        chips={chips}
        chipValue={filter}
        onChipChange={(id) => setFilter(id as Filter)}
        chipsLabel={NAV_FINDER_STRINGS.chips}
        inputProps={{ "data-cmd-item": "" }}
      />
    </div>
  );
}
