/**
 * Page "Funktionen" (`h1 Funktionen`): everything the app can do, grouped by the trader's task, with an honest status per
 * function (`src/app/features.ts` is the one source – this page, the global search and the assistant all read it).
 *
 *   header      PageHeader (title, lead, count)
 *   controls    search field · Stand (Alle / Fertig / Teilweise) · Tarif (Alle / Frei / Pro / Premium / Team)
 *   Für dich · Zuletzt benutzt   two short lists (no filter active): what the assistant's own counters point at, and what was
 *               opened here / in the search / via the assistant last – an honest empty line each, never a placeholder
 *   groups      one section per task group, cards in a 1 / 2 / 3 column grid; "Öffnen" navigates and scrolls to the card
 *
 * Nothing is stored or sent by this page: "Für dich" reads `settings.assistant.interests` (counters the assistant keeps
 * anyway), "Zuletzt benutzt" reads the search's recent list (`feature:<id>`, this browser only). Motion: the page header's
 * words and the cards' staggered fade-in (`Reveal`, reduced motion → static). Registered as page `funktionen` (not in the
 * dock, not a dashboard card): reached via the command navigation, the search, `g f`, the settings and the assistant.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { forYou, groupFeatures, filterFeatures, isFiltered, NO_FILTER, recentFeatures, type FeatureFilter, type StatusFilter, type TierFilter } from "@/app/featureQuery";
import { FEATURE_COUNT, FEATURE_GROUPS, FEATURE_REGISTRY, PLAN_TIERS, type FeatureEntry } from "@/app/features";
import { openFeature } from "@/app/featureOpen";
import { preloadPage } from "@/app/pages";
import { memoryOf } from "@/assistant/memory";
import { planIncludes } from "@/billing/plans";
import { useBillingMode, useEffectivePlan } from "@/billing/store";
import { cn } from "@/lib/cn";
import { Reveal } from "@/motion/Reveal";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { Input } from "@/primitives/Input";
import { Label } from "@/primitives/Label";
import { Segmented } from "@/primitives/Segmented";
import { useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";
import { FeatureCard } from "./FeatureCard";
import { FUNKTIONEN } from "./strings";

export const FUNKTIONEN_LEAD_FILL = { storageKey: storageKey("fill-funktionen"), highlight: FUNKTIONEN.highlight } as const;

const STATUS_OPTIONS = [
  { v: "alle", label: FUNKTIONEN.filters.all },
  { v: "fertig", label: FUNKTIONEN.status.fertig },
  { v: "teilweise", label: FUNKTIONEN.status.teilweise },
] as const satisfies readonly { v: StatusFilter; label: string }[];

const TIER_OPTIONS = [{ v: "alle", label: FUNKTIONEN.filters.all }, ...PLAN_TIERS.map((t) => ({ v: t, label: FUNKTIONEN.tierFilter[t] }))] as const satisfies readonly { v: TierFilter; label: string }[];

/** Phones and tablets: the segmented rows wrap instead of scrolling sideways. */
const SEGMENTS = "max-w-full flex-wrap";

/** Hover / focus warms the target page's chunk (the lazy pages), exactly like the command navigation does. */
function warm(id: string): void {
  const f = FEATURE_REGISTRY.find((x) => x.id === id);
  if (f && !f.action) preloadPage(f.page);
}

function MiniList({ title, note, empty, entries, testId, onOpen }: { title: string; note: string; empty: string; entries: readonly FeatureEntry[]; testId: string; onOpen: (id: string) => void }) {
  return (
    <section className="grid content-start gap-2.5 rounded-2xl border border-line bg-ink-850 p-4" aria-label={title} data-testid={testId} data-n={entries.length}>
      <div className="grid gap-0.5">
        <Label as="h2">{title}</Label>
        <p className="text-[12px] text-faint">{note}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-mute">{empty}</p>
      ) : (
        <ul className="grid gap-1.5">
          {entries.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpen(f.id)}
                onPointerEnter={() => warm(f.id)}
                onFocus={() => warm(f.id)}
                className="group/row flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-left outline-none transition-colors duration-200 hover:border-white/25 focus-visible:border-white/60 pointer-coarse:min-h-11"
                data-testid="feature-quick"
                data-feature={f.id}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[13.5px] font-medium text-fg [overflow-wrap:anywhere]">{f.name}</span>
                  <span className="text-[11.5px] text-mute">{FEATURE_GROUPS.find((g) => g.id === f.group)?.name}</span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-mute transition-transform duration-200 group-hover/row:translate-x-0.5">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FunktionenView({ className }: { className?: string }) {
  const [filter, setFilter] = useState<FeatureFilter>(NO_FILTER);
  const settings = useJournal((s) => s.settings);
  const recent = useSearch((s) => s.recent);
  const mode = useBillingMode();
  const plan = useEffectivePlan();

  const interests = useMemo(() => memoryOf(settings).interests, [settings]);
  const mine = useMemo(() => forYou(interests, 4).map((x) => x.entry), [interests]);
  const lastUsed = useMemo(() => recentFeatures(recent, 4), [recent]);

  const shown = useMemo(() => filterFeatures(filter), [filter]);
  const groups = useMemo(() => (filter.q.trim() ? [{ group: { id: "treffer", name: "Treffer", lead: "" }, items: shown }] : groupFeatures(shown)), [filter.q, shown]);
  const filtered = isFiltered(filter);
  const locked = (f: FeatureEntry): boolean => mode === "open" && !!f.gate && !planIncludes(plan.plan, f.gate);

  const open = (id: string): void => void openFeature(id);
  const set = (patch: Partial<FeatureFilter>): void => setFilter((f) => ({ ...f, ...patch }));
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && filter.q.trim() && shown[0]) {
      e.preventDefault();
      open(shown[0].id);
    }
    if (e.key === "Escape" && filter.q) set({ q: "" });
  };

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="funktionen-view" data-count={shown.length}>
      <PageHeader title={FUNKTIONEN.title} lead={FUNKTIONEN.lead} leadFill={FUNKTIONEN_LEAD_FILL} count={FEATURE_COUNT} countUnit={FUNKTIONEN.unit} />

      <Reveal index={0} className="grid min-w-0 gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_auto_auto] lg:items-end">
          <label className="grid min-w-0 gap-1.5">
            <span className="sr-only">{FUNKTIONEN.search.label}</span>
            <Input
              type="search"
              value={filter.q}
              onChange={(e) => set({ q: e.target.value })}
              onKeyDown={onSearchKey}
              placeholder={FUNKTIONEN.search.placeholder}
              aria-label={FUNKTIONEN.search.label}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              data-testid="feature-search"
            />
          </label>
          <div className="grid min-w-0 gap-1.5">
            <span id="fn-status" className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">
              {FUNKTIONEN.filters.status}
            </span>
            <Segmented<StatusFilter> size="sm" aria-labelledby="fn-status" options={STATUS_OPTIONS} value={filter.status} onChange={(v) => set({ status: v })} className={SEGMENTS} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span id="fn-tier" className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">
              {FUNKTIONEN.filters.tier}
            </span>
            <Segmented<TierFilter> size="sm" aria-labelledby="fn-tier" options={TIER_OPTIONS} value={filter.tier} onChange={(v) => set({ tier: v })} className={SEGMENTS} />
          </div>
        </div>
        <p className="text-[12px] text-faint" data-testid="feature-results">
          {FUNKTIONEN.results(shown.length, FEATURE_COUNT)}
          {filter.q.trim() && shown.length > 0 ? ` · ${FUNKTIONEN.search.hint}` : ""}
        </p>
      </Reveal>

      {!filtered && (
        <Reveal index={1} className="grid min-w-0 gap-3 md:grid-cols-2">
          <MiniList title={FUNKTIONEN.forYou.title} note={FUNKTIONEN.forYou.note} empty={FUNKTIONEN.forYou.empty} entries={mine} testId="funktionen-for-you" onOpen={open} />
          <MiniList title={FUNKTIONEN.recent.title} note={FUNKTIONEN.recent.note} empty={FUNKTIONEN.recent.empty} entries={lastUsed} testId="funktionen-recent" onOpen={open} />
        </Reveal>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={FUNKTIONEN.empty.title}
          text={FUNKTIONEN.empty.text}
          line={false}
          action={
            <Button size="sm" onClick={() => setFilter(NO_FILTER)}>
              {FUNKTIONEN.empty.reset}
            </Button>
          }
        />
      ) : (
        groups.map(({ group, items }) => (
          <section key={group.id} aria-labelledby={`fn-g-${group.id}`} className="grid min-w-0 gap-3" data-testid="funktionen-group" data-group={group.id}>
            <Reveal index={0} className="grid gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <Label as="h2" id={`fn-g-${group.id}`}>
                  {group.name}
                </Label>
                <span className="font-mono text-[11px] text-faint">{items.length}</span>
              </div>
              {group.lead && <p className="text-[12.5px] text-mute">{group.lead}</p>}
            </Reveal>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((f, i) => (
                <Reveal key={f.id} as="li" index={i % 3} className="min-w-0">
                  <FeatureCard entry={f} locked={locked(f)} onOpen={open} onIntent={warm} />
                </Reveal>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="text-center text-[12px] text-faint">{FUNKTIONEN.stand}</p>
    </div>
  );
}
