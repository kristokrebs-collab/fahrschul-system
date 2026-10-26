/**
 * TradingView in the lab (F14), one lazy chunk:
 * - `AdapterStatusCard` (`labor-tv-status`): what works with TradingView, what only as a forward test over an alert, and what
 *   is not supported – with the limits. No login to TradingView, no foreign code.
 * - `TvCompareCard` (`labor-tv-compare`): the strategy-tester export "List of trades" (CSV) is read IN THE BROWSER (nothing is
 *   uploaded) and compared with the shown lab run: pairing of trades, net difference, and observations on where the two may
 *   differ (costs, the order of high and low inside a candle, delay). Read errors name the line of the file.
 */
import { useId, useMemo, useRef, useState } from "react";
import { STATUS_LABEL, TV_ADAPTERS, barMsOf, compareTrades, parseTvTrades, type AdapterStatus, type ComparePair, type Comparison } from "@/domain/tvimport";
import { date as fmtDate, dateTime } from "@/lib/format";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Expander } from "@/primitives/Expander";
import { useLabor } from "./laborStore";
import { IndicatorCheckCard } from "./IndicatorCheckCard";
import { PineCard } from "./PineCard";
import { readFileText } from "./readFile";
import { Cell, ChipPick, Kpi, moneyText } from "./ui";

export const TV = {
  statusTitle: "Was mit TradingView geht",
  statusNote: "Ehrlich: kein Login, kein Auslesen der Seite, kein fremder Code.",
  compareTitle: "Export gegen Labor-Lauf",
  compareNote: "Die Datei wird in deinem Browser gelesen. Nichts wird hochgeladen.",
  how: "In TradingView: Strategietester → „Liste der Trades“ → Export als CSV. Die Datei nennt weder Markt noch Zeiteinheit; wähle im Labor denselben Markt, dieselbe Zeiteinheit und einen Zeitraum, der die Trades enthält.",
  pick: "CSV wählen",
  another: "Andere Datei",
  zone: "Zeitzone der Datei",
  zoneHint: "So steht die Uhrzeit im Chart von TradingView (Standard bei Krypto: UTC).",
  noRun: "Noch kein Labor-Lauf. Starte oben einen Lauf mit demselben Markt und Zeitraum; die Datei bleibt geladen.",
  readFailed: "Die Datei konnte nicht gelesen werden.",
} as const;

const TONE: Record<AdapterStatus, BadgeTone> = { supported: "win", forward: "warn", unsupported: "mute" };
const ZONES = [
  { v: 0, label: "UTC" },
  { v: 60, label: "UTC+1" },
  { v: 120, label: "UTC+2" },
  { v: 180, label: "UTC+3" },
] as const;
const ERRORS_SHOWN = 8;
const PAIRS_SHOWN = 6;

export function AdapterStatusCard({ className }: { className?: string }) {
  return (
    <Card title={TV.statusTitle} note={TV.statusNote} className={className} data-testid="labor-tv-status">
      <ul className="grid gap-3">
        {TV_ADAPTERS.map((a) => (
          <li key={a.id} className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3" data-testid="labor-tv-adapter" data-adapter={a.id} data-status={a.status}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <h3 className="min-w-0 text-[13px] font-semibold leading-snug">{a.title}</h3>
              <Badge tone={TONE[a.status]} dot>
                {STATUS_LABEL[a.status]}
              </Badge>
            </div>
            <p className="text-[12.5px] leading-relaxed text-fg/85">{a.what}</p>
            <p className="text-[12px] leading-relaxed text-mute">{a.limits}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export { readFileText };

const pct = (v: number | null, d = 2): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d).replace(".", ",")} %`);
const when = (ms: number | null): string => (ms == null ? "–" : dateTime(new Date(ms)));

function PairRow({ p }: { p: ComparePair }) {
  const d = p.entryBars;
  return (
    <li className="grid gap-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12px]" data-testid="labor-tv-pair">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-semibold">
          #{p.tv.no} · {p.tv.side === "long" ? "Long" : "Short"} · {when(p.tv.entryTime)}
        </span>
        <span className="num font-mono text-mute">{d === 0 ? "gleiche Kerze" : `TradingView ${Math.abs(d).toFixed(1).replace(".", ",")} Kerze${Math.abs(d) === 1 ? "" : "n"} ${d > 0 ? "später" : "früher"}`}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-mute">
        <span>
          Bewegung TV <span className="num font-mono text-fg">{pct(p.tvMovePct)}</span>
        </span>
        <span>
          Labor <span className="num font-mono text-fg">{pct(p.labMovePct)}</span>
        </span>
        <span>
          Einstiegspreis <span className="num font-mono text-fg">{pct(p.entryDiffPct, 3)}</span>
        </span>
        {p.lab.ambiguous && <span>Stop und Ziel in einer Kerze</span>}
      </div>
    </li>
  );
}

function Result({ c, currency, labLabel }: { c: Comparison; currency: string; labLabel: string }) {
  const [more, setMore] = useState(false);
  const id = useId();
  const net = (v: number | null): string => (v == null ? "–" : moneyText(v, currency));
  const sorted = [...c.pairs].sort((a, b) => Math.abs((b.tvMovePct ?? b.labMovePct) - b.labMovePct) - Math.abs((a.tvMovePct ?? a.labMovePct) - a.labMovePct));
  const shown = more ? sorted : sorted.slice(0, PAIRS_SHOWN);
  return (
    <div className="grid gap-4" data-testid="labor-tv-result">
      <p className="text-[12px] text-mute">
        Verglichen: {labLabel}
        {c.window ? ` · gemeinsamer Zeitraum ${fmtDate(new Date(c.window.from))} bis ${fmtDate(new Date(c.window.to))}` : " · kein gemeinsamer Zeitraum"}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Gepaart" sub={c.matchRate == null ? "keine Trades" : `${Math.round(c.matchRate * 100)} % der TradingView-Trades`}>
          {c.pairs.length} / {c.tv.inWindow}
        </Kpi>
        <Kpi label="Nur TradingView" sub="ohne Gegenstück">
          {c.onlyTv.length}
        </Kpi>
        <Kpi label="Nur Labor" sub="ohne Gegenstück">
          {c.onlyLab.length}
        </Kpi>
        <Kpi label="Netto TradingView" sub={`${c.pairs.length} gepaart: ${net(c.net.tvPaired)}`}>
          {net(c.net.tvAll)}
        </Kpi>
        <Kpi label="Netto Labor" sub={`${c.pairs.length} gepaart: ${net(c.net.labPaired)}`}>
          {net(c.net.labAll)}
        </Kpi>
      </div>
      <div className="grid gap-1 rounded-xl border border-line-2 bg-white/[0.02] px-3.5 py-3 text-[12.5px] leading-relaxed" data-testid="labor-tv-diff">
        <p>
          <span className="text-mute">Differenz Netto (Labor − TradingView): </span>
          <span className="num font-mono font-medium" data-testid="labor-tv-diff-all">
            {net(c.net.diffAll)}
          </span>
          <span className="text-mute"> alle verglichenen, </span>
          <span className="num font-mono font-medium">{net(c.net.diffPaired)}</span>
          <span className="text-mute"> nur gepaarte.</span>
        </p>
        <p className="text-mute">
          Summe der Preisbewegungen der gepaarten Trades: TradingView <span className="num font-mono text-fg">{pct(c.moves.tv)}</span>, Labor <span className="num font-mono text-fg">{pct(c.moves.lab)}</span> (ohne Gebühren, unabhängig von der Positionsgröße).
        </p>
      </div>
      <section className="grid gap-2" aria-label="Mögliche Gründe für Abweichungen">
        <h3 className="label">Mögliche Gründe für Abweichungen</h3>
        <ul className="grid gap-2">
          {c.reasons.map((r) => (
            <li key={r.id} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/40 px-3.5 py-2.5" data-testid="labor-tv-reason" data-reason={r.id}>
              <span className="text-[12.5px] font-semibold">{r.title}</span>
              <span className="text-[12.5px] leading-relaxed text-mute">{r.text}</span>
            </li>
          ))}
        </ul>
      </section>
      {sorted.length > 0 && (
        <section className="grid gap-2" aria-label="Gepaarte Trades">
          <div className="flex items-center justify-between gap-2">
            <h3 className="label">Gepaarte Trades · größte Abweichung zuerst</h3>
            {sorted.length > PAIRS_SHOWN && <Expander open={more} onToggle={() => setMore((m) => !m)} label={`Alle ${sorted.length} gepaarten Trades`} controls={id} />}
          </div>
          <ul className="grid gap-1.5" id={id}>
            {shown.map((p) => (
              <PairRow key={`${p.tv.no}-${p.lab.entryTime}`} p={p} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function TvCompareCard({ className }: { className?: string }) {
  const result = useLabor((s) => s.result);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [allErrors, setAllErrors] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const parsed = useMemo(() => (text == null ? null : parseTvTrades(text, { utcOffsetMinutes: offset })), [text, offset]);
  const cmp = useMemo(() => {
    if (!parsed || !parsed.trades.length || !result) return null;
    return compareTrades(parsed.trades, result.trades, { barMs: barMsOf(result.interval), labFrom: result.from, labTo: result.to });
  }, [parsed, result]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    try {
      setText(await readFileText(file));
      setName(file.name);
      setAllErrors(false);
    } catch {
      setReadError(TV.readFailed);
    }
  };
  const labLabel = result ? `${result.symbol} · ${result.interval === "1d" ? "1D" : result.interval} · ${result.name ?? result.strategy}` : "";
  const errors = parsed?.errors ?? [];
  return (
    <Card title={TV.compareTitle} note={TV.compareNote} className={className} data-testid="labor-tv-compare">
      <div className="grid gap-4">
        <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{TV.how}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            aria-label={TV.pick}
            data-testid="labor-tv-file"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant={text == null ? "primary" : "ghost"} size="sm" onClick={() => input.current?.click()} data-testid="labor-tv-pick">
            {text == null ? TV.pick : TV.another}
          </Button>
          {name && (
            <span className="min-w-0 truncate text-[12px] text-mute" data-testid="labor-tv-name">
              {name}
            </span>
          )}
        </div>
        {readError && (
          <p role="alert" className="text-[12.5px] text-loss">
            {readError}
          </p>
        )}
        <div className="grid gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
            {TV.zone}
          </span>
          <ChipPick value={offset} options={ZONES.map((z) => ({ v: z.v, label: z.label }))} onChange={setOffset} label={TV.zone} id="tv-zone" />
          <span className="text-[11px] text-faint">{TV.zoneHint}</span>
        </div>

        {parsed && (
          <div className="grid gap-2" data-testid="labor-tv-read">
            <p className="text-[12.5px]" data-testid="labor-tv-summary">
              <span className="num font-mono font-medium">{parsed.trades.length}</span> Trade{parsed.trades.length === 1 ? "" : "s"} gelesen
              {parsed.trades.some((t) => t.open) ? `, davon ${parsed.trades.filter((t) => t.open).length} offen` : ""}
              {parsed.language !== "unknown" ? ` · Kopfzeile ${parsed.language === "de" ? "deutsch" : "englisch"}` : ""}
              {parsed.currency ? ` · ${parsed.currency}` : ""}
              {errors.length ? ` · ${errors.length}${parsed.errorsCut ? "+" : ""} Zeile${errors.length === 1 ? "" : "n"} nicht lesbar` : ""}.
            </p>
            {parsed.warnings.map((w) => (
              <p key={w} className="text-[12px] text-warn">
                {w}
              </p>
            ))}
            {errors.length > 0 && (
              <div className="grid gap-1.5 rounded-xl border border-loss/30 bg-loss/[0.04] px-3.5 py-3" data-testid="labor-tv-errors">
                <h3 className="text-[12px] font-semibold text-loss">Das konnte ich nicht lesen</h3>
                <ul className="grid gap-1">
                  {(allErrors ? errors : errors.slice(0, ERRORS_SHOWN)).map((e, i) => (
                    <li key={`${e.line}-${i}`} className="text-[12px] leading-snug">
                      <span className="num font-mono text-loss">Zeile {e.line}</span> <span className="text-mute">{e.message}</span>
                    </li>
                  ))}
                </ul>
                {errors.length > ERRORS_SHOWN && (
                  <button type="button" className="touch-hit justify-self-start text-[12px] text-mute hover:text-fg" onClick={() => setAllErrors((a) => !a)} aria-expanded={allErrors}>
                    {allErrors ? "Weniger zeigen" : `+ ${errors.length - ERRORS_SHOWN} weitere`}
                  </button>
                )}
                {parsed.trades.length > 0 && <p className="text-[11.5px] text-faint">Die übrigen Zeilen werden verglichen.</p>}
              </div>
            )}
          </div>
        )}

        {parsed && parsed.trades.length > 0 && !result && (
          <p className="text-[12.5px] text-mute" data-testid="labor-tv-norun">
            {TV.noRun}
          </p>
        )}
        {cmp && result && <Result c={cmp} currency="USDT" labLabel={labLabel} />}
      </div>
    </Card>
  );
}

/** The section's cells (lazy chunk, mounted by `LaborView`). */
export default function TvSection() {
  return (
    <>
      <Cell index={0} span="lg:col-span-12">
        <PineCard />
      </Cell>
      <Cell index={0} span="lg:col-span-6">
        <AdapterStatusCard />
      </Cell>
      <Cell index={1} span="lg:col-span-6">
        <TvCompareCard />
      </Cell>
      <Cell index={2} span="lg:col-span-12">
        <IndicatorCheckCard />
      </Cell>
    </>
  );
}

