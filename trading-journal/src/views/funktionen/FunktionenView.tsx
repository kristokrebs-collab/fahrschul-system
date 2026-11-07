/**
 * Page "Funktionen" (`h1 Funktionen`): everything the app can do, found in seconds – by what you want to DO. The register
 * (`src/app/features.ts`) is the one source; this page, the global search, the command navigation and the assistant read it.
 *
 *   header      PageHeader (title, lead, count)
 *   search      one large field "Was willst du tun?" – words, whole phrases, typos ("warum verliere ich", "Wochenbricht");
 *               results replace everything below, Enter opens the best one
 *   weiter      "Zuletzt benutzt" (this browser's recent list) and "Empfohlen" (what the assistant's counters point at, what
 *               is new, a few starting points) – at most three + four rows, never an empty box
 *   Aufgaben    ten large tiles, one per task of a trader's day (icon, name, one sentence, a dot for the honest state);
 *               a tile opens the group: its functions under sub headings, each a row that opens the place, with the details
 *               (what is missing, what it needs, "Siehe auch") one fold away
 *
 * Favourites (a star on every row) and "Zuletzt benutzt" are kept in `settings.funktionen` (versioned, `shelf.ts`: backup and
 * cloud sync carry them; every way of opening a function counts, `featureOpen.ts`), next to the search's recent list. "Empfohlen"
 * reads `settings.assistant.interests` (counters the assistant keeps anyway). Every row says what you can do with the function
 * right now – verfügbar / Einrichtung nötig / im höheren Tarif, with the next step (`status.ts`). Nothing is sent. The open group is also a
 * back entry (`openBackEntry`): the system back button returns to the tiles instead of leaving the page. Motion: the page
 * header's words and the staggered fade-in (`Reveal`, reduced motion → static). Registered as page `funktionen` (not in the
 * dock, not a dashboard card): reached via the command navigation, the search, `g f`, the settings and the assistant.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { featureSearchId, groupFeatures, recentFeatures, searchFeatures, STRONG_HIT, subGroups, suggestFeatures } from "@/app/featureQuery";
import { FEATURE_COUNT, FEATURE_REGISTRY, featureById, type FeatureEntry, type FeatureGroupId } from "@/app/features";
import { openFeature } from "@/app/featureOpen";
import { preloadPage } from "@/app/pages";
import { memoryOf } from "@/assistant/memory";
import { openAssistant } from "@/assistant/open";
import { openUpgrade, useBillingMode, useEffectivePlan } from "@/billing/store";
import { useCloudSession } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { Reveal } from "@/motion/Reveal";
import { gridCell, useGridCols, useRich } from "@/motion/rich";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { Icon } from "@/primitives/icons";
import { SearchField } from "@/primitives/SearchField";
import { Label } from "@/primitives/Label";
import { useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { openBackEntry } from "@/store/backStack";
import { storageKey } from "@/store/storage";
import { openDemo } from "@/views/demo/demoStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { FeatureRow } from "./FeatureRow";
import { GroupTile } from "./GroupTile";
import { ResultItem } from "./ResultItem";
import { shelfOf } from "./shelf";
import { toggleFavoriteFunction } from "./shelfStore";
import { availabilityOf } from "./status";
import { FUNKTIONEN } from "./strings";

export const FUNKTIONEN_LEAD_FILL = { storageKey: storageKey("fill-funktionen"), highlight: FUNKTIONEN.highlight } as const;

/** Rows shown for a query (the best ones – a longer list is not an answer). */
const RESULT_MAX = 12;
/** Favourites shown before "Alle … zeigen". */
const FAVORITES_SHOWN = 6;

/** Hover / focus warms the target page's chunk (the lazy pages), exactly like the command navigation does. */
function warm(id: string): void {
  const f = FEATURE_REGISTRY.find((x) => x.id === id);
  if (f && !f.action) preloadPage(f.page);
}

export function FunktionenView({ className }: { className?: string }) {
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState<FeatureGroupId | null>(null);
  const [now] = useState(() => Date.now());
  const reduced = useReducedFx();
  const rich = useRich();
  // the tile grid has 1 / 2 / 3 columns (`md:grid-cols-2 xl:grid-cols-3`): the wave runs along its diagonals
  const cols = useGridCols(2, 3);
  const settings = useJournal((s) => s.settings);
  const recent = useSearch((s) => s.recent);
  const mode = useBillingMode();
  const plan = useEffectivePlan();
  const signedIn = useCloudSession((st) => st.phase === "signedIn");
  const [allFavs, setAllFavs] = useState(false);
  const inputId = useId();
  const groupHead = useRef<HTMLHeadingElement>(null);
  const groupTop = useRef<HTMLElement>(null);
  const tileFocus = useRef<FeatureGroupId | null>(null);

  const interests = useMemo(() => memoryOf(settings).interests, [settings]);
  const shelf = useMemo(() => shelfOf(settings), [settings]);
  // the page's own list (settings, synced) first, then what the search remembers in this browser
  const lastUsed = useMemo(() => recentFeatures([...shelf.recent.map((r) => featureSearchId(r.id)), ...recent], 3), [shelf, recent]);
  const favorites = useMemo(() => shelf.favorites.map((f) => featureById(f.id)).filter((f): f is FeatureEntry => !!f), [shelf]);
  const favIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);
  const shownFavorites = allFavs ? favorites : favorites.slice(0, FAVORITES_SHOWN);
  // four at most; on a phone the first two – the tiles below are the page
  const picks = useMemo(() => suggestFeatures({ interests, now, skip: lastUsed.map((f) => f.id), k: 4 }), [interests, now, lastUsed]);
  const both = lastUsed.length > 0 && picks.length > 0;
  const grouped = useMemo(() => groupFeatures(FEATURE_REGISTRY), []);
  const query = q.trim();
  const hits = useMemo(() => (query ? searchFeatures(query) : []), [query]);
  const shown = hits.slice(0, RESULT_MAX);
  const weak = shown.length > 0 && shown[0]!.score < STRONG_HIT;
  const current = groupId ? grouped.find((g) => g.group.id === groupId) : undefined;
  const view = query ? "search" : current ? "group" : "tiles";
  const status = (f: FeatureEntry) => availabilityOf(f, { open: mode === "open", plan: plan.plan, signedIn });
  const upgrade = (f: FeatureEntry): void => openUpgrade(f.gate, status(f).plan);
  // the staggered fade-in belongs to the rich page; elsewhere (and under reduced motion) everything is simply there
  const stagger = (i: number): number => (rich ? i % 3 : 0);
  const rowProps = (f: FeatureEntry) => ({ entry: f, availability: status(f), now, onOpen: open, onIntent: warm, onUpgrade: upgrade, favorite: favIds.has(f.id), onToggleFavorite: toggleFavoriteFunction });

  // an open group is a back entry: the system back button returns to the tiles instead of leaving the page
  useEffect(() => {
    if (!groupId) return;
    return openBackEntry(() => setGroupId(null));
  }, [groupId]);

  // entering a group: its heading takes the reading position; leaving it: the tile it came from takes the focus back
  useLayoutEffect(() => {
    if (current) {
      groupHead.current?.focus({ preventScroll: true });
      groupTop.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    } else if (tileFocus.current) {
      const tile = document.querySelector<HTMLElement>(`[data-testid="funktionen-tile"][data-group="${tileFocus.current}"]`);
      tileFocus.current = null;
      tile?.focus({ preventScroll: true });
      tile?.scrollIntoView({ block: "nearest" });
    }
  }, [current, reduced]);

  // opening a function leaves the page; the query and the open group are cleared with it (the page stays mounted, so coming
  // back would otherwise show yesterday's query)
  const open = (id: string): void => {
    void openFeature(id);
    setQ("");
    setGroupId(null);
  };
  const back = (): void => {
    tileFocus.current = groupId;
    setGroupId(null);
  };
  const onPageKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" && !q && groupId && !(e.target instanceof HTMLInputElement)) back();
  };

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="funktionen-view" data-count={FEATURE_COUNT} data-view={view} onKeyDown={onPageKey}>
      <PageHeader ghost="Finden" title={FUNKTIONEN.title} lead={FUNKTIONEN.lead} leadFill={FUNKTIONEN_LEAD_FILL} count={FEATURE_COUNT} countUnit={FUNKTIONEN.unit} />

      <Reveal index={0} className="grid min-w-0 gap-2.5" role="search">
        {/* the shared clay field (`SearchField`, A6): the results are the page's own rows below, so the field is the plain mode (no answer list of its own);
            Enter opens the best hit, Escape clears, the status line says how many were found */}
        <SearchField
          testId="feature-search"
          size="lg"
          label={FUNKTIONEN.search.label}
          placeholder={FUNKTIONEN.search.placeholder}
          value={q}
          onChange={setQ}
          clearLabel={FUNKTIONEN.search.clear}
          onSubmit={() => shown[0] && open(shown[0].entry.id)}
          status={query && shown.length ? `${weak ? FUNKTIONEN.results.weak(shown.length) : FUNKTIONEN.results.some(hits.length)}${hits.length > shown.length ? ` · ${FUNKTIONEN.results.more(shown.length)}` : ""} · ${FUNKTIONEN.search.hint}` : ""}
        />
      </Reveal>

      {view === "search" &&
        (shown.length === 0 ? (
          <EmptyState
            title={FUNKTIONEN.empty.title}
            text={FUNKTIONEN.empty.text}
            line={false}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setQ("")}>
                  {FUNKTIONEN.empty.reset}
                </Button>
                <Button size="sm" onClick={() => openAssistant()}>
                  {FUNKTIONEN.empty.assistant}
                </Button>
              </div>
            }
          />
        ) : (
          <section aria-label={FUNKTIONEN.results.some(shown.length)} className="grid min-w-0 gap-2.5" data-testid="funktionen-results" data-n={hits.length}>
            <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
              {shown.map((h) => (
                <ResultItem key={h.entry.id}>
                  <FeatureRow {...rowProps(h.entry)} showGroup weak={weak} />
                </ResultItem>
              ))}
            </ul>
          </section>
        ))}

      {view === "tiles" && (
        <>
          {favorites.length > 0 && (
            <Reveal index={1} className="grid min-w-0 gap-2.5" data-testid="funktionen-favorites" data-n={favorites.length}>
              <section aria-labelledby={`${inputId}-favs`} className="grid min-w-0 gap-2.5">
                <div className="grid gap-0.5">
                  <Label as="h2" id={`${inputId}-favs`}>
                    {FUNKTIONEN.favorites.title}
                    <span className="ml-1 font-mono text-[11px] font-normal text-mute">{favorites.length}</span>
                  </Label>
                  <p className="text-[12px] text-mute">{FUNKTIONEN.favorites.note}</p>
                </div>
                <ul className="grid gap-2 md:grid-cols-2">
                  {shownFavorites.map((f, i) => (
                    <Reveal key={f.id} as="li" index={stagger(i)} className="min-w-0">
                      <FeatureRow {...rowProps(f)} showGroup compact testId="feature-favorite" />
                    </Reveal>
                  ))}
                </ul>
                {favorites.length > FAVORITES_SHOWN && (
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setAllFavs((v) => !v)} aria-expanded={allFavs} data-testid="funktionen-favorites-more">
                      {allFavs ? FUNKTIONEN.favorites.less : FUNKTIONEN.favorites.more(favorites.length)}
                    </Button>
                  </div>
                )}
              </section>
            </Reveal>
          )}

          {(lastUsed.length > 0 || picks.length > 0) && (
            <Reveal index={1} className={cn("grid min-w-0 gap-4", both && "lg:grid-cols-2")} data-testid="funktionen-weiter">
              {lastUsed.length > 0 && (
                <section aria-labelledby={`${inputId}-recent`} className="grid min-w-0 content-start gap-2.5" data-testid="funktionen-recent" data-n={lastUsed.length}>
                  <div className="grid gap-0.5">
                    <Label as="h2" id={`${inputId}-recent`}>
                      {FUNKTIONEN.recent.title}
                    </Label>
                    <p className="text-[12px] text-mute">{FUNKTIONEN.recent.note}</p>
                  </div>
                  <ul className="grid gap-2">
                    {lastUsed.map((f, i) => (
                      <li key={f.id} className={cn(i >= 2 && "max-md:hidden")}>
                        <FeatureRow {...rowProps(f)} showGroup compact testId="feature-quick" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {picks.length > 0 && (
                <section aria-labelledby={`${inputId}-picks`} className="grid min-w-0 content-start gap-2.5" data-testid="funktionen-picks" data-n={picks.length}>
                  <div className="grid gap-0.5">
                    <Label as="h2" id={`${inputId}-picks`}>
                      {FUNKTIONEN.picks.title}
                    </Label>
                    <p className="text-[12px] text-mute">{FUNKTIONEN.picks.note}</p>
                  </div>
                  <ul className={cn("grid gap-2", !both && "md:grid-cols-2")}>
                    {picks.map((p, i) => (
                      <li key={p.entry.id} className={cn(i >= 2 && "max-md:hidden")}>
                        <FeatureRow {...rowProps(p.entry)} showGroup compact testId="feature-quick" reason={p.reason} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </Reveal>
          )}

          <section aria-labelledby={`${inputId}-tiles`} className="grid min-w-0 gap-3" data-testid="funktionen-tiles">
            <Reveal index={0} className="grid gap-0.5">
              <Label as="h2" id={`${inputId}-tiles`}>
                {FUNKTIONEN.tiles.title}
              </Label>
              <p className="text-[12.5px] text-mute">{FUNKTIONEN.tiles.note}</p>
            </Reveal>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {grouped.map(({ group, items }, i) => (
                <Reveal key={group.id} as="li" index={i % 3} wave={rich ? gridCell(i, cols) : undefined} className="min-w-0">
                  <GroupTile
                    group={group}
                    items={items}
                    onOpen={(id) => {
                      tileFocus.current = id;
                      setGroupId(id);
                    }}
                    onIntent={() => items.forEach((f) => warm(f.id))}
                  />
                </Reveal>
              ))}
            </ul>
          </section>

          {/* F58: the quiet way into the demo – a dashed box, no accent colour, nothing starts by itself */}
          <Reveal index={0} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-2 px-4 py-3.5" data-testid="funktionen-demo">
            <div className="grid min-w-0 gap-0.5">
              <p className="text-[14px] font-medium text-fg">{FUNKTIONEN.demo.title}</p>
              <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-mute">{FUNKTIONEN.demo.text}</p>
            </div>
            <Button size="sm" onClick={() => openDemo()} data-testid="funktionen-demo-open">
              {FUNKTIONEN.demo.action}
            </Button>
          </Reveal>
        </>
      )}

      {view === "group" && current && (
        <section ref={groupTop} aria-labelledby={`${inputId}-group`} className="grid min-w-0 gap-5" data-testid="funktionen-group-view" data-group={current.group.id} data-n={current.items.length}>
          <Reveal index={0} className="grid gap-3">
            <div>
              <Button variant="ghost" size="sm" onClick={back} aria-label={FUNKTIONEN.group.backLabel} data-testid="funktionen-back">
                <span aria-hidden="true">←</span>
                {FUNKTIONEN.group.back}
              </Button>
            </div>
            <div className="grid gap-1">
              <h2 id={`${inputId}-group`} ref={groupHead} tabIndex={-1} className="flex items-center gap-3 text-[clamp(20px,5.4vw,24px)] font-semibold tracking-tight outline-none">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute [&>svg]:size-5">
                  <Icon name={current.group.icon} />
                </span>
                {current.group.name}
              </h2>
              <p className="text-[13.5px] text-mute">{current.group.lead}</p>
            </div>
          </Reveal>
          {subGroups(current.items).map((sg, k) => (
            <div key={sg.sub ?? "all"} className="grid min-w-0 gap-2.5" data-testid="funktionen-sub" data-sub={sg.sub ?? ""}>
              {sg.sub && (
                <Reveal index={0}>
                  <Label as="h3">
                    {sg.sub}
                    <span className="ml-1 font-mono text-[11px] font-normal text-mute">{sg.items.length}</span>
                  </Label>
                </Reveal>
              )}
              <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                {sg.items.map((f, i) => (
                  <Reveal key={f.id} as="li" index={stagger(i + k)} className="min-w-0">
                    <FeatureRow {...rowProps(f)} />
                  </Reveal>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className="text-center text-[12px] text-mute">{FUNKTIONEN.stand}</p>
    </div>
  );
}
