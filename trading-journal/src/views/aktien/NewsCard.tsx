/**
 * The news monitor (F68, headlines): the Yahoo Finance headlines of the stocks on the watchlist – plus any further source
 * that registered itself (`@/market/stocks/news`) – merged so that one story is one line, rated by keywords in its title
 * (a hint what to read first, with the words that caused it), marked "Neu" when it is newer than the last visit of this
 * page (kept on this device only), with time, publisher and tickers on every line. Each source reports its own state; one
 * that cannot be reached says so ("Quelle nicht erreichbar", with the stand of what is still shown) and the others go on.
 */
import { useEffect, useMemo, useState } from "react";
import { markNew, mergeNews, orderNews, TAG_LABEL, withinWindow, type MonitorItem, type NewsOrder, type SourceItem } from "@/domain/newsmonitor";
import { stockSymbols, watchlistOfSettings } from "@/domain/watchlist";
import { cn } from "@/lib/cn";
import { ddmmHHmm } from "@/market/format";
import type { SourceStatus } from "@/market/stocks/news";
import "@/market/stocks/newsSources";
import { FAIL_LABEL } from "./strings";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { useJournal } from "@/store/journalStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { useNewsFeed } from "./feedStores";
import { AKTIEN, REASON_HINT } from "./strings";
import { CardNote } from "./ui";

const N = AKTIEN.news;
const SEEN_KEY = storageKey("aktien-news-seen");
const PAGE = 40;

type View = "all" | "important" | "new";
const WINDOWS = { "24h": 24 * 3_600_000, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000 } as const;
type WindowId = keyof typeof WINDOWS;

const agoText = (ms: number, now: number): string => {
  const d = Math.max(0, now - ms);
  if (d < 3_600_000) return `vor ${Math.max(1, Math.round(d / 60_000))} Min.`;
  if (d < 86_400_000) return `vor ${Math.round(d / 3_600_000)} Std.`;
  return `vor ${Math.round(d / 86_400_000)} T.`;
};

function sourceLine(s: SourceStatus): string {
  const when = s.asOf != null ? ` · jüngste Meldung ${ddmmHHmm(s.asOf)}` : "";
  const got = s.receivedAt != null ? ` · Abruf ${ddmmHHmm(s.receivedAt)}` : "";
  if (s.status === "ok") return `${s.label}: ${s.okSymbols} ${s.okSymbols === 1 ? "Aktie" : "Aktien"} gelesen${got}${when}`;
  if (s.status === "partial") return `${s.label}: ${s.okSymbols} gelesen, ${s.failedSymbols || "einige"} nicht (${s.reason ? (FAIL_LABEL[s.reason] ?? s.reason) : "Fehler"})${got}${when}`;
  if (s.status === "stale") return `${s.label}: Abruf fehlgeschlagen (${s.reason ? (FAIL_LABEL[s.reason] ?? s.reason) : "Fehler"}) – gezeigt wird der Zwischenspeicher${got}${when}`;
  return `${s.label}: Quelle nicht erreichbar (${s.reason ? (FAIL_LABEL[s.reason] ?? s.reason) : "Fehler"}) – keine Daten`;
}

function Story({ item, now, symbolOrder }: { item: MonitorItem; now: number; symbolOrder: readonly string[] }) {
  const r = item.rating;
  return (
    <article className="grid gap-1.5 rounded-xl border border-line bg-ink-950/30 px-3 py-2.5" data-testid="aktien-story" data-level={r.level} data-new={item.isNew ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {item.isNew && (
          <Badge tone="teal" dot>
            Neu
          </Badge>
        )}
        {r.level === "high" && <Badge tone="warn">Wichtig</Badge>}
        {r.level === "medium" && <Badge tone="steel">Mittel</Badge>}
        {r.tags.map((t) => (
          <Badge key={t} tone="mute">
            {TAG_LABEL[t]}
          </Badge>
        ))}
        {item.symbols
          .slice()
          .sort((a, b) => symbolOrder.indexOf(a) - symbolOrder.indexOf(b))
          .map((s) => (
            <span key={s} className="num rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-fg">
              {s}
            </span>
          ))}
      </div>
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[13.5px] font-medium leading-snug text-fg underline decoration-line-2 underline-offset-4 outline-none hover:decoration-fg focus-visible:decoration-fg pointer-coarse:py-1.5" data-testid="aktien-story-link">
        {item.title}
        <span aria-hidden="true" className="ml-1 text-faint">
          ↗
        </span>
        <span className="sr-only"> (öffnet die Meldung bei {item.publisher ?? "der Quelle"} in einem neuen Tab)</span>
      </a>
      {item.summary && <p className="line-clamp-2 max-w-[90ch] text-[12.5px] leading-relaxed text-mute">{item.summary}</p>}
      <p className="num flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
        <span>{item.publisher ?? "unbekannte Quelle"}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(item.publishedAt).toISOString()}>
          {ddmmHHmm(item.publishedAt)} ({agoText(item.publishedAt, now)})
        </time>
        {r.matched.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="aktien-story-words">Stichwörter: {r.matched.join(", ")}</span>
          </>
        )}
      </p>
    </article>
  );
}

export function NewsCard({ focus, onFocus }: { focus: string | null; onFocus: (symbol: string | null) => void }) {
  const raw = useJournal((s) => s.settings.watchlist);
  const watch = useMemo(() => watchlistOfSettings({ watchlist: raw }).items, [raw]);
  const stocks = useMemo(() => stockSymbols(watch), [watch]);
  const crypto = watch.length - stocks.length;
  const key = stocks.join(",");
  const feed = useNewsFeed();
  const { batch, loading } = feed;
  const now = feed.at ?? 0;
  const [view, setView] = useState<View>("all");
  const [win, setWin] = useState<WindowId>("3d");
  const [order, setOrder] = useState<NewsOrder>("importance");
  const [shown, setShown] = useState(PAGE);
  // the last time this page's news were looked at – read once; written when the page is left or the trader says "alles gelesen"
  const [prevVisit, setPrevVisit] = useState<number | null>(() => {
    const v = readJson<{ lastVisit?: unknown } | null>(SEEN_KEY, null)?.lastVisit;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });

  // one load per change of the list of tickers; the store keeps the answer and drops a late one
  useEffect(() => {
    void useNewsFeed.getState().load(stocks, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const save = (): void => void writeJson(SEEN_KEY, { lastVisit: Date.now() });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  const stories = useMemo(() => {
    if (!batch) return [];
    const src: SourceItem[] = batch.items.map((i) => ({ id: i.id, symbol: i.symbol, title: i.title, url: i.url, publisher: i.publisher, publishedAt: i.publishedAt, summary: i.summary, origin: i.origin }));
    let list = withinWindow(markNew(mergeNews(src, stocks), prevVisit), now, WINDOWS[win]);
    if (focus) list = list.filter((s) => s.symbols.includes(focus));
    if (view === "important") list = list.filter((s) => s.rating.level !== "low");
    if (view === "new") list = list.filter((s) => s.isNew);
    return orderNews(list, order);
  }, [batch, stocks, prevVisit, now, win, focus, view, order]);

  const newCount = useMemo(() => stories.filter((s) => s.isNew).length, [stories]);
  const markRead = (): void => {
    const t = Date.now();
    writeJson(SEEN_KEY, { lastVisit: t });
    setPrevVisit(t);
  };

  return (
    <Card
      title={N.title}
      className="h-full"
      data-testid="aktien-news"
      action={
        <Button size="sm" variant="ghost" onClick={() => void useNewsFeed.getState().load(stocks, true)} disabled={loading || stocks.length === 0} data-testid="aktien-news-refresh">
          {loading ? "Lädt …" : N.refresh}
        </Button>
      }
    >
      <div className="grid gap-3" data-state={!stocks.length ? "empty" : loading && !batch ? "loading" : "ready"}>
        {stocks.length === 0 ? (
          <p className="text-[13px] text-mute" data-testid="aktien-news-empty">
            {crypto > 0 ? N.onlyCrypto : N.noStocks}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
              <Segmented<View>
                aria-label="Welche Schlagzeilen"
                size="sm"
                options={[
                  { v: "all", label: "Alle" },
                  { v: "important", label: "Wichtige" },
                  { v: "new", label: "Neue" },
                ]}
                value={view}
                onChange={setView}
                className={SEG_TOUCH}
              />
              <Segmented<WindowId>
                aria-label="Zeitraum"
                size="sm"
                options={[
                  { v: "24h", label: "24 Std." },
                  { v: "3d", label: "3 Tage" },
                  { v: "7d", label: "7 Tage" },
                ]}
                value={win}
                onChange={setWin}
                className={SEG_TOUCH}
              />
              <Segmented<NewsOrder>
                aria-label="Sortierung"
                size="sm"
                options={[
                  { v: "importance", label: "Wichtigkeit" },
                  { v: "newest", label: "Neueste" },
                ]}
                value={order}
                onChange={setOrder}
                className={SEG_TOUCH}
              />
              {focus && (
                <Button size="sm" variant="ghost" onClick={() => onFocus(null)} data-testid="aktien-news-unfocus">
                  Nur {focus} ✕
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute" data-testid="aktien-news-visit">
              {prevVisit == null ? <span>{N.firstVisit}</span> : <span>{newCount > 0 ? `${newCount} ${newCount === 1 ? "Meldung" : "Meldungen"} neu seit dem letzten Besuch (${ddmmHHmm(prevVisit)})` : `Nichts Neues seit dem letzten Besuch (${ddmmHHmm(prevVisit)})`}</span>}
              {prevVisit != null && newCount > 0 && (
                <button type="button" onClick={markRead} className="underline decoration-line-2 underline-offset-4 outline-none hover:decoration-fg focus-visible:decoration-fg pointer-coarse:min-h-11" data-testid="aktien-news-markread">
                  {N.markRead}
                </button>
              )}
            </div>
            {batch && batch.sources.some((s) => s.status !== "ok") && (
              <ul className="grid gap-1" data-testid="aktien-news-problems">
                {batch.sources
                  .filter((s) => s.status !== "ok")
                  .map((s) => (
                    <li key={s.id} className="max-w-[88ch] text-[12px] leading-relaxed text-warn" data-source={s.id} data-status={s.status}>
                      {sourceLine(s)}
                      {s.reason && REASON_HINT[s.reason] ? ` ${REASON_HINT[s.reason]}` : ""}
                    </li>
                  ))}
              </ul>
            )}
            {loading && !batch && (
              <p className="text-[13px] text-mute" data-testid="aktien-news-loading">
                Schlagzeilen werden geladen …
              </p>
            )}
            {batch && stories.length === 0 && batch.sources.some((s) => s.status !== "unavailable") && (
              <p className="text-[13px] text-mute" data-testid="aktien-news-none">
                {view === "new" ? "Keine neuen Meldungen." : view === "important" ? "Keine Meldungen mit auffälligen Stichwörtern im gewählten Zeitraum." : N.emptyList}
              </p>
            )}
            {stories.length > 0 && (
              <RevealGroup className={cn("grid gap-2")}>
                {stories.slice(0, shown).map((s) => (
                  <RevealItem key={s.key}>
                    <Story item={s} now={now} symbolOrder={stocks} />
                  </RevealItem>
                ))}
              </RevealGroup>
            )}
            {stories.length > shown && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)} data-testid="aktien-news-more">
                  Weitere {Math.min(PAGE, stories.length - shown)} anzeigen
                </Button>
              </div>
            )}
            {batch && (
              <ul className="grid gap-0.5 text-[11.5px] text-faint" data-testid="aktien-news-stand">
                {batch.sources.map((s) => (
                  <li key={s.id} className="num" data-source={s.id}>
                    Quelle: {s.label} · {s.status === "unavailable" ? "keine Daten" : `Abruf ${s.receivedAt != null ? ddmmHHmm(s.receivedAt) : "–"} · jüngste Meldung ${s.asOf != null ? ddmmHHmm(s.asOf) : "keine Daten"}`}
                  </li>
                ))}
              </ul>
            )}
            <p className="max-w-[82ch] text-[11.5px] leading-relaxed text-faint">{N.hint}</p>
            <CardNote lead={AKTIEN.disclaimerNews} />
          </>
        )}
        {stocks.length === 0 && <CardNote lead={AKTIEN.disclaimerNews} />}
      </div>
    </Card>
  );
}
