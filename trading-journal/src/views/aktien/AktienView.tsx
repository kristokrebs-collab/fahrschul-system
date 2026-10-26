/**
 * Aktien (`#aktien`, `h1 Aktien`): the stock module next to the crypto core (F67, part of F68).
 *   Scanner     ScannerCard (what to scan, rules, run, honest summary) · ResultsCard (hits with rank, reason, stand, chart)
 *   Watchlist   WatchlistCard (stocks and crypto pairs, quotes with source)
 *   News        NewsCard (headlines of the watchlist, keyword hint, "neu seit dem letzten Besuch")
 *   Analyse     AnalystSlot (Quartalszahlen · DCF · Kaufthese – `src/views/analyst`)
 *   Kongress    CongressSlot (the STOCK Act reports of members of the House, `kongress/`)
 * Every number comes from a data source named next to it; a source that cannot be reached is an empty state with the
 * reason. The app never sends an order.
 */
import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { watchlistOfSettings } from "@/domain/watchlist";
import { cn } from "@/lib/cn";
import { stockData } from "@/market/stocks/client";
import { SectionNav } from "@/primitives/SectionNav";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { AnalysisNote } from "@/ui/AnalysisNote";
import { SectionTitle } from "@/views/analyse/ui";
import { Cell } from "@/views/labor/ui";
import { PageHeader } from "@/views/setups/PageHeader";
import { useAktien } from "./aktienStore";
import { NewsCard } from "./NewsCard";
import { ResultsCard } from "./ResultsCard";
import { ScannerCard } from "./ScannerCard";
import { AnalystSlot, CongressSlot } from "./Slots";
import { AKTIEN } from "./strings";
import { WatchlistCard } from "./WatchlistCard";
import { watch } from "./watchlistWrites";

export const AKTIEN_LEAD_FILL = { storageKey: storageKey("fill-aktien"), highlight: AKTIEN.highlight } as const;

const NAV = [
  { id: "aktien-scanner", label: "Scanner" },
  { id: "aktien-watchlist", label: "Watchlist" },
  { id: "aktien-news", label: "News" },
  { id: "aktien-analyse", label: "Analyse" },
  { id: "aktien-kongress", label: "Kongress" },
] as const;

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="contents">
      <SectionTitle id={`${id}-h`} section={id} title={title} sub={sub} className="lg:col-span-12" />
      {children}
    </section>
  );
}

function SlotFallback({ id }: { id: string }) {
  return (
    <div className="rounded-xl border border-line-2 bg-ink-950/40 p-4 text-[12px] text-faint" data-testid={`${id}-loading`}>
      Wird geladen …
    </div>
  );
}

export function AktienView({ className }: { className?: string }) {
  const raw = useJournal((s) => s.settings.watchlist);
  const items = useMemo(() => watchlistOfSettings({ watchlist: raw }).items, [raw]);
  const stocks = useMemo(() => items.filter((i) => i.kind === "stock"), [items]);
  const selected = useAktien((s) => s.selected);
  const [newsFocus, setNewsFocus] = useState<string | null>(null);
  const T = AKTIEN.sections;

  const showNews = useCallback((symbol: string) => {
    setNewsFocus(symbol);
    requestAnimationFrame(() => document.querySelector('[data-section="aktien-news"]')?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);
  const slotProps = useMemo(
    () => ({
      watchlist: stocks,
      symbol: selected,
      data: stockData(),
      onWatch: async (symbol: string, name?: string | null) => (await watch("stock", symbol, name ?? null)) === "ok",
    }),
    [stocks, selected],
  );

  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="aktien-view">
      <PageHeader className="lg:col-span-12" title={AKTIEN.title} lead={AKTIEN.lead} leadFill={AKTIEN_LEAD_FILL} />
      <SectionNav items={NAV} className="lg:col-span-12" />
      <Section id="aktien-scanner" title={T.scanner.title} sub={T.scanner.sub}>
        <Cell index={0} span="lg:col-span-12">
          <ScannerCard />
        </Cell>
        <Cell index={0} span="lg:col-span-12">
          <ResultsCard />
        </Cell>
      </Section>
      <Section id="aktien-watchlist" title={T.watchlist.title} sub={T.watchlist.sub}>
        <Cell index={0} span="lg:col-span-12">
          <WatchlistCard onNews={showNews} />
        </Cell>
      </Section>
      <Section id="aktien-news" title={T.news.title} sub={T.news.sub}>
        <Cell index={0} span="lg:col-span-12">
          <NewsCard focus={newsFocus} onFocus={setNewsFocus} />
        </Cell>
      </Section>
      <Section id="aktien-analyse" title={T.analyse.title} sub={T.analyse.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<SlotFallback id="aktien-analyse" />}>
            <AnalystSlot {...slotProps} />
          </Suspense>
        </Cell>
      </Section>
      <Section id="aktien-kongress" title={T.kongress.title} sub={T.kongress.sub}>
        <Cell index={0} span="lg:col-span-12">
          <Suspense fallback={<SlotFallback id="aktien-kongress" />}>
            <CongressSlot {...slotProps} />
          </Suspense>
        </Cell>
      </Section>
      <AnalysisNote className="lg:col-span-12" lead="Regeln und Schlagzeilen zeigen, was auf Charts und in Meldungen steht – keine Prognose und kein Handelssignal. Die App sendet nie Orders." />
    </div>
  );
}
