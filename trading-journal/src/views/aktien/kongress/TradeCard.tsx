/**
 * One transaction row of a Periodic Transaction Report, as the filing states it: who (member, owner), what (asset, ticker, buy or
 * sell, option strike and expiry), when (trade date, filing date, the delay in days), how much (the RANGE as printed) and the
 * link to the original PDF. A row the reader could not read cleanly is a "Nicht lesbar" card with the reason and the same link –
 * never a guess. Presentation only: the values come from `@/domain/congress`.
 */
import { memo, type ReactNode } from "react";
import { ASSET_CODE_LABEL, amountDe, dayDe, delayText, isRange, optionLine, OWNER_LABEL, SIDE_LABEL, tickerKey, type TradeLine } from "@/domain/congress";
import { cn } from "@/lib/cn";
import { isStockSymbol } from "@/market/stocks/types";
import { Badge } from "@/primitives/Badge";
import { KONGRESS } from "./strings";

function Fact({ label, children, testId, tone }: { label: string; children: ReactNode; testId?: string; tone?: "warn" }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd data-testid={testId} className={cn("num min-w-0 break-words text-[12.5px] leading-snug text-fg", tone === "warn" && "text-warn")}>
        {children}
      </dd>
    </div>
  );
}

function PdfLink({ line }: { line: TradeLine }) {
  return (
    <a href={line.filing.url} target="_blank" rel="noopener noreferrer" className="num inline-flex items-center text-[11.5px] text-mute underline decoration-line-2 underline-offset-4 outline-none hover:text-fg hover:decoration-fg focus-visible:decoration-fg pointer-coarse:min-h-11" data-testid="kongress-pdf">
      {KONGRESS.openPdf} (DocID {line.docId}) ↗<span className="sr-only"> – öffnet die Meldung beim House Clerk in einem neuen Tab</span>
    </a>
  );
}

export const TradeCard = memo(function TradeCard({ line, selected, onSelect }: { line: TradeLine; selected: string | null; onSelect: (ticker: string) => void }) {
  const r = line.row;
  const who = (
    <p className="text-[12.5px] leading-snug text-mute" data-testid="kongress-who">
      <span className="font-medium text-fg">{line.filing.name}</span>
      {line.filing.district ? <span className="num"> · {line.filing.district}</span> : null}
      {r.ok ? <span data-testid="kongress-owner"> · {OWNER_LABEL[r.owner]}</span> : null}
    </p>
  );

  if (!r.ok) {
    return (
      <article className="grid gap-2 rounded-xl border border-dashed border-line-2 bg-ink-950/20 px-3 py-2.5" data-testid="kongress-row" data-kind="unreadable" data-new={line.isNew ? "1" : "0"}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone="warn">{KONGRESS.unreadable}</Badge>
          {line.isNew && (
            <Badge tone="teal" dot>
              Neu
            </Badge>
          )}
          <span className="num text-[11.5px] text-faint">gemeldet {dayDe(line.filed)}</span>
        </div>
        {who}
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-mute" data-testid="kongress-reason">
          {r.reason} {line.index >= 0 ? KONGRESS.unreadableHint : ""}
        </p>
        <PdfLink line={line} />
      </article>
    );
  }

  const ticker = r.ticker ? tickerKey(r.ticker) : "";
  const pickable = ticker !== "" && isStockSymbol(ticker);
  const code = r.assetCode ? (ASSET_CODE_LABEL[r.assetCode] ?? `Code ${r.assetCode}`) : null;
  const range = isRange(r);
  const d = line.delay;
  return (
    <article
      className={cn("grid gap-2 rounded-xl border bg-ink-950/30 px-3 py-2.5", line.watched ? "border-white/30" : "border-line")}
      data-testid="kongress-row"
      data-kind="trade"
      data-side={r.side}
      data-ticker={ticker || undefined}
      data-new={line.isNew ? "1" : "0"}
      data-watched={line.watched ? "1" : "0"}
      data-late={d?.late ? "1" : "0"}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {pickable ? (
          <button
            type="button"
            onClick={() => onSelect(ticker)}
            aria-pressed={selected === ticker}
            title="Auf dieser Seite auswählen (Analyse, DCF, Kaufthese)"
            data-testid="kongress-ticker"
            className={cn(
              "num rounded-md border px-2 py-0.5 font-mono text-[12px] font-medium outline-none transition-colors duration-200 focus-visible:border-white/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              selected === ticker ? "border-white/60 bg-ink-750 text-fg" : "border-line-2 text-fg hover:border-white/40",
            )}
          >
            {ticker}
            <span className="sr-only"> auf der Seite auswählen</span>
          </button>
        ) : (
          <span className="num rounded-md border border-line px-2 py-0.5 font-mono text-[12px] text-faint" data-testid="kongress-noticker">
            {ticker || KONGRESS.noTicker}
          </span>
        )}
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-fg" data-testid="kongress-asset">
          {r.asset || "–"}
        </span>
        <Badge tone={r.side === "buy" ? "teal" : "steel"} className="shrink-0">
          {SIDE_LABEL[r.side]}
        </Badge>
        {r.option && <Badge tone="steel">{r.option.kind === "call" ? "Call-Option" : r.option.kind === "put" ? "Put-Option" : "Option"}</Badge>}
        {!r.option && code && r.assetCode !== "ST" && <Badge tone="mute">{code}</Badge>}
        {line.watched && (
          <Badge tone="teal" dot>
            Auf deiner Watchlist
          </Badge>
        )}
        {line.isNew && (
          <Badge tone="teal" dot>
            Neu
          </Badge>
        )}
        {d?.late && <Badge tone="warn">über 45 Tage</Badge>}
      </div>

      {who}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Handel am" testId="kongress-trade-date">
          {dayDe(r.tradeDate)}
        </Fact>
        <Fact label="Gemeldet am" testId="kongress-filed-date">
          {dayDe(line.filed)}
        </Fact>
        <Fact label="Meldeverzug" testId="kongress-delay" {...(d?.late ? { tone: "warn" as const } : {})}>
          {d ? delayText(d) : "keine Daten"}
        </Fact>
        <Fact label={range ? "Betrag (Spanne)" : "Betrag laut Meldung"} testId="kongress-amount">
          {amountDe(r)}
        </Fact>
      </dl>

      {r.option && (
        <p className="num text-[12.5px] leading-relaxed text-fg" data-testid="kongress-option">
          {optionLine(r.option)}
        </p>
      )}
      {r.description && (
        <p className="max-w-[90ch] text-[12px] leading-relaxed text-mute" data-testid="kongress-description">
          „{r.description}“
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
        <PdfLink line={line} />
        {r.account ? <span className="text-[11.5px] text-faint">Konto: {r.account}</span> : null}
      </div>
    </article>
  );
});
