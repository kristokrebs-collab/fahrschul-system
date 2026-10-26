/**
 * The result list of the scanner: every hit with its rank, the sentence "why it is on the list", the data stand of the row,
 * a chart preview and the three actions – add to the watchlist, create a plan (only when the plan page exists) and pick the
 * ticker for the analysis sections. Sorting is the trader's choice and named next to the list; a rank is a position in that
 * sorting, never a quality grade.
 */
import { useMemo, useState } from "react";
import { planLinkHash } from "@/domain/plan/link";
import { rankHits, RANK_NAME, SETUP_SHORT, volumeText, type Hit, type RankBy } from "@/domain/scanner";
import { watchId, watchlistOfSettings, type WatchKind } from "@/domain/watchlist";
import { cn } from "@/lib/cn";
import { ddmmHHmm } from "@/market/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { PAGES } from "@/store/uiStore";
import { useJournal } from "@/store/journalStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { useAktien } from "./aktienStore";
import { MiniChart } from "./MiniChart";
import { AKTIEN } from "./strings";
import { CardNote, Mini, StampLine } from "./ui";
import { unwatch, watch, WRITE_TEXT } from "./watchlistWrites";

const R = AKTIEN.results;

/** The plan page is built elsewhere: the link exists only when its page does. */
export const planPageExists = (pages: readonly string[] = PAGES): boolean => pages.includes("plan");

/** `#plan?symbol=AAPL&side=long` – the Handelsplan reads exactly this (`@/domain/plan/link`). */
export const planHash = (symbol: string, side: "long" | "short"): string => planLinkHash(symbol, side);

function HitRow({ hit, rank, market, onWatch, watched, timeZone, daily, planOk }: { hit: Hit; rank: number; market: WatchKind; onWatch: (h: Hit) => void; watched: boolean; timeZone: string; daily: boolean; planOk: boolean }) {
  const [open, setOpen] = useState(false);
  const select = useAktien((s) => s.select);
  const sid = `hit-${hit.id.replace(/[^A-Za-z0-9]/g, "-")}`;
  const long = hit.side === "long";
  return (
    <div className="grid gap-2.5 rounded-xl border border-line bg-ink-950/30 px-3 py-3" data-testid="aktien-hit" data-symbol={hit.symbol} data-setup={hit.setup} data-side={hit.side}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="num min-w-6 font-mono text-[12px] text-faint" aria-label={`Rang ${rank}`} data-testid="aktien-rank">
            {rank}
          </span>
          <span className="num font-mono text-[14px] font-semibold text-fg">{hit.symbol}</span>
          {hit.name && <span className="min-w-0 max-w-[26ch] truncate text-[12px] text-mute">{hit.name}</span>}
          <Badge tone={long ? "win" : "loss"}>{long ? "Long" : "Short"}</Badge>
          <Badge tone="mute">{SETUP_SHORT[hit.setup]}</Badge>
        </div>
        <div className="num whitespace-nowrap text-right font-mono text-[12.5px] text-fg">
          <span className="text-faint">{hit.metric.label} </span>
          {hit.metric.text}
          <span className="ml-2 text-faint">Kurs </span>
          {hit.price.toLocaleString("de-DE", { maximumFractionDigits: hit.price < 1 ? 4 : 2 })}
        </div>
      </div>
      <p className="max-w-[88ch] text-[13px] leading-relaxed text-fg/90" data-testid="aktien-why">
        <span className="sr-only">{R.why}: </span>
        {hit.reason}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StampLine stamp={{ source: hit.stand.source, receivedAt: hit.stand.receivedAt, ...(hit.stand.fetchedAt != null ? { fetchedAt: hit.stand.fetchedAt } : {}) }} lastBar={hit.stand.lastBar} className="!text-[11.5px]" testId="aktien-hit-stand" />
        {hit.stand.stale && (
          <Badge tone="warn" title={hit.stand.stale.message}>
            {R.stale} · {hit.stand.stale.message}
          </Badge>
        )}
        {hit.turnover != null && <span className="num text-[11.5px] text-faint">Umsatz ≈ {volumeText(hit.turnover)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={sid} data-testid="aktien-hit-chart">
          {open ? R.hideChart : R.chart}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onWatch(hit)} data-testid="aktien-hit-watch">
          {watched ? R.onWatchlist : R.toWatchlist}
        </Button>
        {market === "stock" && (
          <Button size="sm" variant="ghost" onClick={() => select(hit.symbol)} data-testid="aktien-hit-select">
            {AKTIEN.watchlist.select}
          </Button>
        )}
        {planOk && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.hash = planHash(hit.symbol, hit.side);
            }}
            data-testid="aktien-hit-plan"
          >
            {R.plan} →
          </Button>
        )}
      </div>
      {open && (
        <div id={sid} className="grid gap-3 border-t border-line pt-3 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-testid="aktien-hit-detail">
          <MiniChart candles={hit.preview} levels={hit.levels} marks={hit.marks} timeZone={timeZone} daily={daily} label={`${hit.symbol}: Kerzen, die die Regel gelesen hat (${hit.interval})`} />
          <div className="grid content-start gap-1.5">
            <Mini>{R.checks}</Mini>
            <ul className="grid gap-1 text-[12.5px] leading-relaxed text-mute">
              {hit.checks.map((c) => (
                <li key={c} className="flex gap-2">
                  <span aria-hidden="true" className="text-win">
                    ✓
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <p className="num text-[11.5px] text-faint" data-testid="aktien-hit-when">
              {daily ? `Regel passte auf der Kerze vom ${ddmmHHmm(hit.stand.lastBar ?? hit.at, "UTC").slice(0, 6)}` : `Regel passte um ${ddmmHHmm(hit.at, timeZone)} (${timeZone === "UTC" ? "UTC" : "New York"})`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultsCard() {
  const run = useAktien((s) => s.run);
  const rank = useAktien((s) => s.prefs.rank);
  const setPrefs = useAktien((s) => s.setPrefs);
  const watchRaw = useJournal((s) => s.settings.watchlist);
  const items = useMemo(() => watchlistOfSettings({ watchlist: watchRaw }).items, [watchRaw]);
  const [msg, setMsg] = useState<string | null>(null);
  const hits = run.status === "done" || run.status === "aborted" ? run.outcome.hits : null;
  const ranked = useMemo(() => (hits ? rankHits(hits, rank) : []), [hits, rank]);
  const market: WatchKind = run.status === "done" || run.status === "aborted" ? (run.meta.market === "crypto" ? "crypto" : "stock") : "stock";
  const planOk = planPageExists();

  const toggleWatch = async (h: Hit): Promise<void> => {
    const id = watchId(market, h.symbol);
    const r = items.some((i) => i.id === id) ? await unwatch(id) : await watch(market, h.symbol, h.name);
    setMsg(r === "ok" ? null : (WRITE_TEXT[r] ?? null));
  };

  const meta = run.status === "done" || run.status === "aborted" ? run.meta : null;
  const timeZone = meta?.market === "crypto" ? "UTC" : "America/New_York";
  return (
    <Card
      title={`${R.title}${hits ? ` (${hits.length})` : ""}`}
      className="h-full"
      data-testid="aktien-results"
      action={
        ranked.length > 1 ? (
          <Segmented<RankBy>
            aria-label={R.rankBy}
            size="sm"
            options={(["turnover", "metric", "symbol"] as const).map((v) => ({ v, label: RANK_NAME[v] }))}
            value={rank}
            onChange={(v) => setPrefs({ rank: v })}
            className={cn(SEG_TOUCH)}
          />
        ) : undefined
      }
    >
      <div className="grid gap-3" data-state={hits ? (hits.length ? "hits" : "none") : "idle"}>
        {!hits && (
          <p className="text-[13px] text-mute" data-testid="aktien-results-idle">
            {run.status === "running" ? "Der Scan läuft …" : run.status === "error" ? "Es gibt keine Treffer, weil der Scan nicht laufen konnte (siehe oben)." : R.idle}
          </p>
        )}
        {hits && hits.length === 0 && (
          <p className="text-[13px] text-mute" data-testid="aktien-results-none">
            {R.none}
          </p>
        )}
        {ranked.length > 1 && <p className="max-w-[78ch] text-[12px] leading-relaxed text-faint">{R.rankNote}</p>}
        {msg && (
          <p className="text-[12px] text-warn" role="alert">
            {msg}
          </p>
        )}
        {ranked.length > 0 && (
          <RevealGroup className="grid gap-2.5">
            {ranked.map((h, i) => (
              <RevealItem key={h.id}>
                <HitRow hit={h} rank={i + 1} market={market} onWatch={(x) => void toggleWatch(x)} watched={items.some((it) => it.id === watchId(market, h.symbol))} timeZone={timeZone} daily={h.interval === "1d"} planOk={planOk} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
        <CardNote lead={AKTIEN.disclaimerScan} />
      </div>
    </Card>
  );
}
