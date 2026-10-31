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
 * Nothing is stored or sent by this page: "Empfohlen" reads `settings.assistant.interests` (counters the assistant keeps
 * anyway), "Zuletzt benutzt" reads the search's recent list (`feature:<id>`, this browser only). The open group is also a
 * back entry (`openBackEntry`): the system back button returns to the tiles instead of leaving the page. Motion: the page
 * header's words and the staggered fade-in (`Reveal`, reduced motion → static). Registered as page `funktionen` (not in the
 * dock, not a dashboard card): reached via the command navigation, the search, `g f`, the settings and the assistant.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { groupFeatures, recentFeatures, searchFeatures, STRONG_HIT, subGroups, suggestFeatures } from "@/app/featureQuery";
import { FEATURE_COUNT, FEATURE_REGISTRY, type FeatureEntry, type FeatureGroupId } from "@/app/features";
import { openFeature } from "@/app/featureOpen";
import { preloadPage } from "@/app/pages";
import { memoryOf } from "@/assistant/memory";
import { openAssistant } from "@/assistant/open";
import { planIncludes } from "@/billing/plans";
import { useBillingMode, useEffectivePlan } from "@/billing/store";
import { cn } from "@/lib/cn";
import { Reveal } from "@/motion/Reveal";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";
import { Label } from "@/primitives/Label";
import { useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { openBackEntry } from "@/store/backStack";
import { storageKey } from "@/store/storage";
import { openDemo } from "@/views/demo/demoStore";
import { PageHeader } from "@/views/setups/PageHeader";
import { FeatureRow } from "./FeatureRow";
import { GroupTile } from "./GroupTile";
import { FUNKTIONEN } from "./strings";

export const FUNKTIONEN_LEAD_FILL = { storageKey: storageKey("fill-funktionen"), highlight: FUNKTIONEN.highlight } as const;

/** Rows shown for a query (the best ones – a longer list is not an answer). */
const RESULT_MAX = 12;

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
  const settings = useJournal((s) => s.settings);
  const recent = useSearch((s) => s.recent);
  const mode = useBillingMode();
  const plan = useEffectivePlan();
  const inputId = useId();
  const groupHead = useRef<HTMLHeadingElement>(null);
  const groupTop = useRef<HTMLElement>(null);
  const tileFocus = useRef<FeatureGroupId | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const interests = useMemo(() => memoryOf(settings).interests, [settings]);
  const lastUsed = useMemo(() => recentFeatures(recent, 3), [recent]);
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
  const locked = (f: FeatureEntry): boolean => mode === "open" && !!f.gate && !planIncludes(plan.plan, f.gate);

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
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && query && shown[0]) {
      e.preventDefault();
      open(shown[0].entry.id);
    }
    if (e.key === "Escape" && q) {
      e.preventDefault();
      setQ("");
    }
  };
  const onPageKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" && !q && groupId && !(e.target instanceof HTMLInputElement)) back();
  };

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="funktionen-view" data-count={FEATURE_COUNT} data-view={view} onKeyDown={onPageKey}>
      <PageHeader title={FUNKTIONEN.title} lead={FUNKTIONEN.lead} leadFill={FUNKTIONEN_LEAD_FILL} count={FEATURE_COUNT} countUnit={FUNKTIONEN.unit} />

      <Reveal index={0} className="grid min-w-0 gap-2.5" role="search">
        <label htmlFor={inputId} className="text-[15px] font-medium text-fg">
          {FUNKTIONEN.search.label}
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-mute [&>svg]:size-[18px]">
            <Icon name="search" />
          </span>
          <Input
            ref={field}
            id={inputId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={FUNKTIONEN.search.placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            data-testid="feature-search"
            className="h-14 pl-11 pr-12 text-[16px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                field.current?.focus();
              }}
              aria-label={FUNKTIONEN.search.clear}
              data-testid="feature-search-clear"
              className="absolute right-1.5 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-mute outline-none transition-colors hover:text-fg [&>svg]:size-4"
            >
              <Icon name="x" />
            </button>
          )}
        </div>
        <p className="min-h-[18px] text-[12px] text-mute" role="status" aria-live="polite" data-testid="feature-results">
          {query ? (shown.length ? `${weak ? FUNKTIONEN.results.weak(shown.length) : FUNKTIONEN.results.some(hits.length)}${hits.length > shown.length ? ` · ${FUNKTIONEN.results.more(shown.length)}` : ""} · ${FUNKTIONEN.search.hint}` : "") : ""}
        </p>
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
                <li key={h.entry.id} className="min-w-0">
                  <FeatureRow entry={h.entry} locked={locked(h.entry)} now={now} onOpen={open} onIntent={warm} showGroup weak={weak} />
                </li>
              ))}
            </ul>
          </section>
        ))}

      {view === "tiles" && (
        <>
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
                        <FeatureRow entry={f} locked={locked(f)} now={now} onOpen={open} onIntent={warm} showGroup compact testId="feature-quick" />
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
                        <FeatureRow entry={p.entry} locked={locked(p.entry)} now={now} onOpen={open} onIntent={warm} showGroup compact testId="feature-quick" reason={p.reason} />
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
                <Reveal key={group.id} as="li" index={i % 3} className="min-w-0">
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
                  <Reveal key={f.id} as="li" index={(i + k) % 3} className="min-w-0">
                    <FeatureRow entry={f} locked={locked(f)} now={now} onOpen={open} onIntent={warm} />
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
