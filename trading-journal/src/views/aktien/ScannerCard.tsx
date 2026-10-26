/**
 * The scanner card (F67): what to scan (market, kind of scan, setups, which charts, how many), the rules and thresholds, the
 * run with progress and cancel, and the honest summary of what happened – how many charts were asked for, scanned, left out
 * (with the reason of each) and failed (with the reason of each, and the error rate). A source that cannot be reached is
 * an empty state with the reason; there is no stand-in universe.
 */
import { useEffect, useMemo, useState } from "react";
import { clampCap, defaultParamsFor, type ScanMode, type ScanParams, type StockSource, type MarketKind } from "@/domain/scanner";
import { cn } from "@/lib/cn";
import { stockData } from "@/market/stocks/client";
import { SYMBOLS_KEY } from "@/market/stocks/cache";
import type { SymbolDirectory } from "@/market/stocks/types";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { Input, Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { SEG_TOUCH } from "@/views/insights/ui";
import { watchlistOfSettings, stockSymbols } from "@/domain/watchlist";
import { paramsKey, useAktien, type RunState } from "./aktienStore";
import { setupsOf } from "./scanRunner";
import { RulesPanel } from "./RulesPanel";
import { AKTIEN, FAIL_LABEL, REASON_HINT, SKIP_LABEL } from "./strings";
import { CheckChip, Figure, Mini, StampLine } from "./ui";

const S = AKTIEN.scanner;
const nf = new Intl.NumberFormat("de-DE");
const pct1 = (f: number): string => `${(f * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const fraction = total ? done / total : 0;
  const pct = Math.max(0, Math.min(99, Math.floor(fraction * 100)));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} %`} aria-label="Fortschritt des Scans" data-testid="aktien-progress" className="grid gap-1.5">
      <span className="num text-[12px] text-mute">{label}</span>
      <span aria-hidden="true" className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
        <span className="block h-full origin-left rounded-full bg-fg transition-transform duration-200" style={{ transform: `scaleX(${Math.max(0.02, fraction)})` }} />
      </span>
    </div>
  );
}

function Counts({ title, counts, labels, testId }: { title: string; counts: Readonly<Record<string, number | undefined>>; labels: Readonly<Record<string, string>>; testId: string }) {
  const rows = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0);
  if (!rows.length) return null;
  return (
    <div className="grid gap-1.5" data-testid={testId}>
      <Mini>{title}</Mini>
      <ul className="flex flex-wrap gap-1.5">
        {rows.map(([k, n]) => (
          <li key={k} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11.5px] text-mute">
            <span className="num font-mono text-fg">{n}×</span> {labels[k] ?? k}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The summary of a finished or cancelled run. */
export function RunSummary({ run }: { run: Extract<RunState, { status: "done" | "aborted" }> }) {
  const { outcome: o, meta: m } = run;
  const secs = Math.max(0, Math.round((o.finishedAt - o.startedAt) / 1000));
  const sample =
    m.market === "crypto"
      ? `Die ${nf.format(o.requested)} USDT-Perpetuals mit dem höchsten 24-h-Umsatz (Binance${m.cap > o.requested ? `, gewünscht waren ${nf.format(m.cap)}` : ""}).`
      : m.source === "directory"
        ? `Block ${m.block} von ${nf.format(m.blocks)} des Verzeichnisses – das sind ${nf.format(o.requested)} von ${nf.format(m.available)} US-Aktien. Der Scan liest nie den ganzen Markt auf einmal.`
        : m.source === "watchlist"
          ? `Aktien deiner Watchlist (${nf.format(m.available)}${m.available > m.cap ? `, die ersten ${nf.format(m.cap)} gelesen` : ""}).`
          : `Deine eigene Liste (${nf.format(m.available)} Kürzel${m.available > m.cap ? `, die ersten ${nf.format(m.cap)} gelesen` : ""}).`;
  return (
    <div className="grid gap-3" data-testid="aktien-summary" data-state={run.status}>
      {run.status === "aborted" && (
        <p className="text-[12.5px] font-medium text-warn" data-testid="aktien-aborted">
          Abgebrochen nach {nf.format(o.scanned + o.skipped + o.failed)} von {nf.format(o.requested)} Charts – die Treffer unten gelten nur für die geprüften.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Angefragt" value={nf.format(o.requested)} testId="aktien-n-requested" />
        <Figure label="Gescannt" value={nf.format(o.scanned)} testId="aktien-n-scanned" />
        <Figure label="Übersprungen" value={nf.format(o.skipped)} testId="aktien-n-skipped" />
        <Figure label="Fehlgeschlagen" value={nf.format(o.failed)} sub={`Fehlerquote ${pct1(o.errorRate)}`} testId="aktien-n-failed" />
        <Figure label="Treffer" value={nf.format(o.hits.length)} testId="aktien-n-hits" />
        <Figure label="Dauer" value={`${secs} s`} />
      </dl>
      <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute" data-testid="aktien-sample">
        {sample}
      </p>
      {m.sessionNote && (
        <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-mute" data-testid="aktien-session">
          {m.sessionNote}
        </p>
      )}
      <Counts title="Übersprungen, weil" counts={o.skippedBy} labels={SKIP_LABEL} testId="aktien-skipped-by" />
      <Counts title="Fehlgeschlagen, weil" counts={o.failedBy} labels={FAIL_LABEL} testId="aktien-failed-by" />
      {o.failures.length > 0 && (
        <p className="max-w-[78ch] text-[11.5px] leading-relaxed text-faint" data-testid="aktien-failed-list">
          {o.failures
            .slice(0, 8)
            .map((f) => f.symbol)
            .join(", ")}
          {o.failures.length > 8 ? ` und ${o.failures.length - 8} weitere` : ""} – {o.failures[0]!.message}
        </p>
      )}
      {o.stale > 0 && (
        <p className="text-[12px] text-warn" data-testid="aktien-stale-note">
          {nf.format(o.stale)} {o.stale === 1 ? "Chart beruht" : "Charts beruhen"} auf Kerzen aus dem Zwischenspeicher, weil der Abruf nicht klappte – das steht an der Zeile.
        </p>
      )}
      {(m.invalid.length > 0 || m.unlisted.length > 0) && (
        <p className="text-[12px] text-mute">
          {m.invalid.length > 0 && <>Kein US-Kürzel: {m.invalid.join(", ")}. </>}
          {m.unlisted.length > 0 && <>Nicht im Verzeichnis (trotzdem gelesen): {m.unlisted.join(", ")}.</>}
        </p>
      )}
      <StampLine stamp={m.universeStamp} lastBar={m.universeStamp?.asOf ?? null} lastLabel={m.market === "crypto" ? "Stand" : "Dateistand"} testId="aktien-universe-stand" />
    </div>
  );
}

function ErrorBox({ run }: { run: Extract<RunState, { status: "error" }> }) {
  const hint = run.reason ? REASON_HINT[run.reason] : undefined;
  return (
    <div className="grid gap-1.5 rounded-xl border border-dashed border-line-2 bg-ink-950/40 p-4" role="alert" data-testid="aktien-error" data-reason={run.reason ?? run.stage}>
      <p className="text-[13px] font-medium text-fg">{run.stage === "universe" ? "Kein Scan möglich" : "Nichts zu scannen"}</p>
      <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{run.message}</p>
      {hint && <p className="max-w-[72ch] text-[12px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

export function ScannerCard() {
  const prefs = useAktien((s) => s.prefs);
  const storedParams = useAktien((s) => s.params[paramsKey(s.prefs.market, s.prefs.mode)]);
  const run = useAktien((s) => s.run);
  const setPrefs = useAktien((s) => s.setPrefs);
  const setParams = useAktien((s) => s.setParams);
  const resetParams = useAktien((s) => s.resetParams);
  const start = useAktien((s) => s.start);
  const abort = useAktien((s) => s.abort);
  const watchRaw = useJournal((s) => s.settings.watchlist);
  const watchStocks = useMemo(() => stockSymbols(watchlistOfSettings({ watchlist: watchRaw }).items), [watchRaw]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dirTotal, setDirTotal] = useState<number | null>(null);

  // how big the directory is, when it is already cached (no request just to show a number)
  useEffect(() => {
    let alive = true;
    void stockData()
      .cache.get<SymbolDirectory>(SYMBOLS_KEY)
      .then((e) => {
        if (alive && e) setDirTotal(e.data.entries.length);
      });
    return () => {
      alive = false;
    };
  }, [run.status]);

  const { market, mode } = prefs;
  const running = run.status === "running";
  const params: ScanParams = storedParams ?? defaultParamsFor(market, mode);
  const setups = setupsOf(mode, prefs.daily);
  const interval = market === "stock" ? (mode === "orb" ? "5m" : "1d") : mode === "orb" ? "15m" : "1d";
  const cap = clampCap(market === "crypto" ? prefs.crypto.top : prefs.stock.cap);
  const blocksKnown = run.status === "done" || run.status === "aborted" ? run.meta.blocks : dirTotal ? Math.max(1, Math.ceil(dirTotal / cap)) : null;
  const progress = run.status === "running" ? run.progress : null;

  const startScan = (): void => void start(watchStocks);
  const stockSource = prefs.stock.source;

  return (
    <Card
      title={S.title}
      note={S.note}
      className="h-full"
      data-testid="aktien-scanner"
      action={
        running ? (
          <Button size="sm" variant="ghost" onClick={abort} data-testid="aktien-abort">
            {S.abort}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={startScan} disabled={setups.length === 0} data-testid="aktien-start">
            {S.start}
          </Button>
        )
      }
    >
      <div className="grid gap-4" data-state={run.status}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="grid gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.market}</span>
            <Segmented<MarketKind>
              aria-label="Markt"
              size="sm"
              options={[
                { v: "stock", label: S.stock },
                { v: "crypto", label: S.crypto },
              ]}
              value={market}
              onChange={(v) => setPrefs({ market: v })}
              className={SEG_TOUCH}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.mode}</span>
            <Segmented<ScanMode>
              aria-label="Art des Scans"
              size="sm"
              options={[
                { v: "daily", label: S.daily },
                { v: "orb", label: S.orb },
              ]}
              value={mode}
              onChange={(v) => setPrefs({ mode: v })}
              className={SEG_TOUCH}
            />
          </div>
          {mode === "daily" && (
            <div className="grid gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.setups}</span>
              <div className="flex flex-wrap gap-1.5">
                <CheckChip checked={prefs.daily.flag} onChange={(on) => setPrefs({ daily: { ...prefs.daily, flag: on } })} testId="aktien-setup-flag">
                  {S.flag}
                </CheckChip>
                <CheckChip checked={prefs.daily.rsi} onChange={(on) => setPrefs({ daily: { ...prefs.daily, rsi: on } })} testId="aktien-setup-rsi">
                  {S.rsi}
                </CheckChip>
              </div>
            </div>
          )}
        </div>

        {market === "stock" ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.source}</span>
                <Segmented<StockSource>
                  aria-label="Welche Aktien"
                  size="sm"
                  options={[
                    { v: "directory", label: S.directory },
                    { v: "watchlist", label: S.watchlist },
                    { v: "custom", label: S.custom },
                  ]}
                  value={stockSource}
                  onChange={(v) => setPrefs({ stock: { ...prefs.stock, source: v } })}
                  className={SEG_TOUCH}
                />
              </div>
              <label className="grid gap-1" htmlFor="aktien-cap">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.cap}</span>
                <Input id="aktien-cap" numeric value={String(prefs.stock.cap)} onChange={(e) => setPrefs({ stock: { ...prefs.stock, cap: Number(e.target.value.replace(/\D/g, "")) || 0 } })} onBlur={() => setPrefs({ stock: { ...prefs.stock, cap: clampCap(prefs.stock.cap) } })} wrapperClassName="max-w-[7rem]" />
              </label>
              {stockSource === "directory" && (
                <div className="grid gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.block}</span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" aria-label="Vorheriger Block" disabled={prefs.stock.block <= 1 || running} onClick={() => setPrefs({ stock: { ...prefs.stock, block: Math.max(1, prefs.stock.block - 1) } })} data-testid="aktien-block-prev">
                      ‹
                    </Button>
                    <span className="num min-w-[5.5rem] text-center font-mono text-[13px] text-fg" data-testid="aktien-block">
                      {prefs.stock.block}
                      {blocksKnown ? ` von ${nf.format(blocksKnown)}` : ""}
                    </span>
                    <Button size="sm" variant="ghost" aria-label="Nächster Block" disabled={running || (blocksKnown != null && prefs.stock.block >= blocksKnown)} onClick={() => setPrefs({ stock: { ...prefs.stock, block: prefs.stock.block + 1 } })} data-testid="aktien-block-next">
                      ›
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <p className="max-w-[78ch] text-[12px] leading-relaxed text-faint">{S.capHelp}</p>
            {stockSource === "custom" && (
              <label className="grid gap-1" htmlFor="aktien-custom">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.customLabel}</span>
                <Textarea id="aktien-custom" rows={2} value={prefs.stock.custom} onChange={(e) => setPrefs({ stock: { ...prefs.stock, custom: e.target.value.slice(0, 600) } })} placeholder="AAPL, MSFT, NVDA" data-testid="aktien-custom" />
              </label>
            )}
            {stockSource === "watchlist" && <p className="text-[12.5px] text-mute">{watchStocks.length ? `${watchStocks.length} ${watchStocks.length === 1 ? "Aktie" : "Aktien"} auf der Watchlist.` : "Auf der Watchlist steht noch keine Aktie."}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="grid gap-1" htmlFor="aktien-top">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{S.top}</span>
              <Input id="aktien-top" numeric value={String(prefs.crypto.top)} onChange={(e) => setPrefs({ crypto: { top: Number(e.target.value.replace(/\D/g, "")) || 0 } })} onBlur={() => setPrefs({ crypto: { top: Math.min(100, clampCap(prefs.crypto.top)) } })} wrapperClassName="max-w-[7rem]" />
            </label>
            <p className="max-w-[60ch] text-[12px] leading-relaxed text-faint">USDT-Perpetuals von Binance, nach dem Umsatz der letzten 24 Stunden. Die Kerzen kommen direkt von Binance.</p>
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Expander open={rulesOpen} onToggle={() => setRulesOpen((o) => !o)} label={S.rules} controls="aktien-rules-body" />
            <button type="button" onClick={() => setRulesOpen((o) => !o)} className={cn("text-[12.5px] font-medium text-mute outline-none transition-colors hover:text-fg focus-visible:text-fg pointer-coarse:min-h-11")} data-testid="aktien-rules-toggle">
              {S.rules}
            </button>
          </div>
          <Collapse open={rulesOpen} id="aktien-rules-body">
            <div className="pt-1">
              <RulesPanel market={market} mode={mode} setups={setups} params={params} interval={interval} onChange={(p) => setParams(market, mode, p)} onReset={() => resetParams(market, mode)} disabled={running} />
            </div>
          </Collapse>
        </div>

        {running && <ProgressBar done={progress?.processed ?? 0} total={progress?.requested ?? 0} label={progress ? `${nf.format(progress.processed)} von ${nf.format(progress.requested)} Charts · ${progress.scanned} gescannt · ${progress.skipped} übersprungen · ${progress.failed} Fehler · ${progress.hits} Treffer` : "Liste wird vorbereitet …"} />}
        {run.status === "error" && <ErrorBox run={run} />}
        {(run.status === "done" || run.status === "aborted") && <RunSummary run={run} />}
        {run.status === "idle" && setups.length === 0 && <p className="text-[12.5px] text-warn">Wähle mindestens ein Setup: Flagge oder RSI-Erholung.</p>}
      </div>
    </Card>
  );
}
