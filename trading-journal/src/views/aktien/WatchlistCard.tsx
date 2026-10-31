/**
 * The watchlist (F67/F68): stocks and crypto pairs, at most 50, saved in `settings.watchlist`. Each row shows the last
 * price and the change against the previous close with the source of the figure; a quote that cannot be fetched says why
 * ("–" with the reason, never an old price dressed as a new one). From a row: its headlines, the analysis sections, a plan
 * (when that page exists) and remove.
 */
import { useEffect, useMemo, useState } from "react";
import { MAX_WATCHLIST, watchlistOfSettings, type WatchItem, type WatchKind } from "@/domain/watchlist";
import { cn } from "@/lib/cn";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { useAktien } from "./aktienStore";
import { useQuotes, type Quote } from "./feedStores";
import { AKTIEN, REASON_HINT } from "./strings";
import { planHash, planPageExists } from "./ResultsCard";
import { StampLine } from "./ui";
import { unwatch, watch, WRITE_TEXT } from "./watchlistWrites";

const W = AKTIEN.watchlist;

const priceFmt = (v: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });

function Row({ item, quote, planOk, onRemove, onNews }: { item: WatchItem; quote: Quote | undefined; planOk: boolean; onRemove: () => void; onNews: () => void }) {
  const select = useAktien((s) => s.select);
  const selected = useAktien((s) => s.selected === item.symbol);
  const name = item.name ?? quote?.name ?? null;
  const up = (quote?.changePct ?? 0) >= 0;
  return (
    <div className={cn("grid gap-2 rounded-xl border bg-ink-950/30 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", selected ? "border-white/30" : "border-line")} data-testid="aktien-watch-row" data-symbol={item.symbol} data-kind={item.kind}>
      <div className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="num font-mono text-[14px] font-semibold text-fg">{item.symbol}</span>
          <Badge tone="mute">{item.kind === "stock" ? W.stock : W.crypto}</Badge>
          {name && <span className="min-w-0 max-w-[30ch] truncate text-[12px] text-mute">{name}</span>}
        </span>
        <span className="num text-[12.5px]" data-testid="aktien-watch-quote">
          {quote ? (
            <>
              <span className="font-mono text-fg">{priceFmt(quote.price)}</span>
              {quote.currency && <span className="ml-1 text-faint">{quote.currency}</span>}
              {quote.changePct != null && <span className={cn("ml-2 font-mono", up ? "text-win" : "text-loss")}>{`${quote.changePct > 0 ? "+" : quote.changePct < 0 ? "−" : ""}${Math.abs(quote.changePct).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`}</span>}
              {quote.stale && <span className="ml-2 text-warn">zuletzt gespeichert</span>}
            </>
          ) : (
            <span className="text-faint">–</span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.kind === "stock" && (
          <>
            <Button size="sm" variant="secondary" onClick={onNews} data-testid="aktien-watch-news">
              {W.news}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => select(item.symbol)} aria-pressed={selected} data-testid="aktien-watch-select">
              {W.select}
            </Button>
          </>
        )}
        {planOk && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              window.location.hash = planHash(item.symbol, "long");
            }}
            data-testid="aktien-watch-plan"
          >
            Plan →
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onRemove} aria-label={`${item.symbol} ${W.remove.toLowerCase()}`} data-testid="aktien-watch-remove">
          {W.remove}
        </Button>
      </div>
    </div>
  );
}

export function WatchlistCard({ onNews }: { onNews: (symbol: string) => void }) {
  const raw = useJournal((s) => s.settings.watchlist);
  const items = useMemo(() => watchlistOfSettings({ watchlist: raw }).items, [raw]);
  const [kind, setKind] = useState<WatchKind>("stock");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuotes();
  const listKey = items.map((i) => i.id).join("|");
  // one load per change of the list (the ids are its identity); the store keeps the answer and drops a late one
  useEffect(() => {
    void useQuotes.getState().load(items, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);
  const planOk = planPageExists();

  const add = async (): Promise<void> => {
    const r = await watch(kind, text);
    if (r === "ok") {
      setText("");
      setMsg(null);
    } else setMsg(WRITE_TEXT[r]);
  };

  return (
    <Card
      title={W.title}
      note={`${items.length} / ${MAX_WATCHLIST}`}
      className="h-full"
      data-testid="aktien-watchlist"
      action={
        <Button size="sm" variant="secondary" onClick={() => void useQuotes.getState().load(items, true)} disabled={q.loading || items.length === 0} data-testid="aktien-watch-refresh">
          {q.loading ? "Lädt …" : W.refresh}
        </Button>
      }
    >
      <div className="grid gap-3" data-count={items.length}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Segmented<WatchKind>
            aria-label="Art des Eintrags"
            size="sm"
            options={[
              { v: "stock", label: W.stock },
              { v: "crypto", label: W.crypto },
            ]}
            value={kind}
            onChange={setKind}
            className={SEG_TOUCH}
          />
          <label className="grid gap-1" htmlFor="aktien-watch-input">
            <span className="sr-only">Kürzel</span>
            <Input id="aktien-watch-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "stock" ? W.placeholderStock : W.placeholderCrypto} autoCapitalize="characters" autoComplete="off" spellCheck={false} wrapperClassName="w-40" invalid={msg != null} data-testid="aktien-watch-input" />
          </label>
          <Button size="sm" variant="primary" type="submit" disabled={!text.trim()} data-testid="aktien-watch-add">
            {W.add}
          </Button>
        </form>
        {msg && (
          <p className="text-[12px] text-warn" role="alert" data-testid="aktien-watch-msg">
            {msg}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-[13px] text-mute" data-testid="aktien-watch-empty">
            {W.empty}
          </p>
        ) : (
          <RevealGroup className="grid gap-2">
            {items.map((it) => (
              <RevealItem key={it.id}>
                <Row item={it} quote={q.quotes[it.id]} planOk={planOk} onRemove={() => void unwatch(it.id)} onNews={() => onNews(it.symbol)} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
        {items.length > 0 && (
          <>
            {q.failed && (
              <p className="max-w-[78ch] text-[12px] leading-relaxed text-warn" data-testid="aktien-watch-failed" data-reason={q.failed.reason}>
                Für {q.failed.n} {q.failed.n === 1 ? "Eintrag" : "Einträge"} gibt es gerade keinen Kurs: {q.failed.message}
                {REASON_HINT[q.failed.reason] ? ` ${REASON_HINT[q.failed.reason]}` : ""}
              </p>
            )}
            <StampLine stamp={q.stamp} lastBar={q.stamp?.asOf ?? null} lastLabel="Kurszeit" testId="aktien-watch-stand" />
          </>
        )}
      </div>
    </Card>
  );
}
