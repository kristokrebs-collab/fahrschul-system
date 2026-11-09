/**
 * Indikator-Vertrag und -Abgleich (F64 / F14), one card in the TradingView section (its own lazy chunk):
 * - the CONTRACT of every indicator the lab calculates itself – Pine call, inputs, series, from which candle on it has a value
 *   (measured), how long a recursive smoothing needs to settle, never repainted, and what the number was checked against;
 * - the CHECK: the "Export chart data" CSV of TradingView is read IN THE BROWSER (nothing is uploaded) and each plot column is held
 *   against the lab's own calculation on the SAME candles, candle by candle.
 * It never feeds a run: the columns are only compared. What matches holds for this file's market, period, timeframe and inputs.
 */
import { useId, useMemo, useRef, useState } from "react";
import { cleanInputs, compareIndicator, defaultInputs, guessColumn, indicatorById, INDICATORS, intervalLabel, parseTvChart, VERDICT_LABEL, warmupOf, type ChartColumn, type IndicatorCompare, type IndicatorDef, type Verdict } from "@/domain/tvimport";
import { dateTime } from "@/lib/format";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { NumInput } from "@/views/plan/ui";
import { readFileText } from "./readFile";

export const IND = {
  title: "Indikator-Vertrag und Abgleich",
  note: "Was das Labor selbst rechnet – und ob es mit deinen TradingView-Werten übereinstimmt. Die Datei wird in deinem Browser gelesen, nichts wird hochgeladen.",
  contractTitle: "Vertrag der Indikatoren",
  contractLead: "Für jeden Indikator, den das Labor selbst rechnet: der Pine-Aufruf, die Eingaben, die Reihen, ab welcher Kerze es Werte gibt (gemessen, nicht behauptet), wann der Startwert einer Glättung keine Rolle mehr spielt und was die Zahl gestützt hat.",
  known: "Bekannt ab dem Schluss der Kerze. Der Wert einer Kerze ändert sich nicht, wenn später Kerzen dazukommen (getestet: kein Wiederzeichnen); nur die laufende Kerze ist vorläufig.",
  how: "In TradingView: Chart mit dem Indikator öffnen → Layout-Menü (Cloud-Symbol) → „Chartdaten exportieren …“ → CSV. Die Datei hat Kerzen und eine Spalte je Plot des Indikators. Exportiere möglichst viele Kerzen: Glättungen wie EMA und RSI schwingen erst nach einigen Hundert Kerzen ein.",
  pick: "Export wählen",
  another: "Andere Datei",
  readFailed: "Die Datei konnte nicht gelesen werden.",
  none: "– nicht vergleichen –",
  with: "Vergleichen mit",
  verdictNote: "Das Ergebnis gilt für diesen Markt, diesen Zeitraum, diese Zeiteinheit und diese Eingaben – es ist kein allgemeines Zertifikat. Die Spalten werden nur verglichen, nie als Baustein oder für einen Lauf verwendet.",
} as const;

const TONE: Record<Verdict, BadgeTone> = { equal: "win", differs: "loss", open: "warn", few: "warn" };
const ERRORS_SHOWN = 6;

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
/** A deviation with as many places as it needs to show something (never "0,00" for 0,0004). */
function devText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  const a = Math.abs(v);
  return dec(v, a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : Math.min(8, Math.max(4, Math.ceil(-Math.log10(a)) + 2)));
}
const valText = (v: number): string => dec(v, Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 4 : 6);
const decimalsText = (d: number): string => `${d} Nachkommastelle${d === 1 ? "" : "n"}`;

function Contract({ def }: { def: IndicatorDef }) {
  const p = defaultInputs(def);
  const warm = useMemo(() => warmupOf(def, p), [def, p]);
  const settle = def.settle(p);
  const v = def.validation;
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3" data-testid="labor-tv-contract-item" data-indicator={def.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-[13px] font-semibold">{def.label}</h4>
        <Badge tone={v.kind === "tv" ? "win" : "mute"} dot>
          {v.kind === "tv" ? "gegen TradingView-Werte geprüft" : "nach Definition nachgebaut"}
        </Badge>
      </div>
      <code className="num block break-words font-mono text-[12px] text-fg/90">{def.pine(p)}</code>
      <dl className="grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Eingaben (Vorgabe)</dt>
          <dd className="text-mute">{def.params.map((q) => `${q.label} ${String(q.def).replace(".", ",")}`).join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Reihen</dt>
          <dd className="text-mute">{def.outputs.map((o) => o.label).join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Erster Wert</dt>
          <dd className="text-mute" data-testid="labor-tv-warmup">
            {warm == null ? "–" : `ab Kerze ${warm}`}
            {settle != null ? ` · eingeschwungen nach etwa ${settle} Kerzen` : " · keine Rekursion, kein Einschwingen"}
          </dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Geprüft gegen</dt>
          <dd className="text-mute">{v.note}</dd>
        </div>
      </dl>
      <p className="text-[12px] leading-relaxed text-mute">{def.start}</p>
    </li>
  );
}

function ContractList() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="grid gap-2" aria-labelledby={`${id}-h`} data-testid="labor-tv-contract">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="text-[13px] font-semibold">
          {IND.contractTitle} ({INDICATORS.length})
        </h3>
        <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-list`} data-testid="labor-tv-contract-toggle">
          {open ? "Zuklappen" : "Aufklappen"}
        </Button>
      </div>
      <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{IND.contractLead}</p>
      <p className="max-w-[72ch] text-[12px] leading-relaxed text-mute" data-testid="labor-tv-known">
        {IND.known}
      </p>
      {open && (
        <ul id={`${id}-list`} className="grid gap-2.5">
          {INDICATORS.map((d) => (
            <Contract key={d.id} def={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface Pick {
  /** `rsi:rsi`; "" = do not compare */
  sel: string;
  inputs: Record<string, number>;
}

function Result({ r, def, output }: { r: IndicatorCompare; def: IndicatorDef; output: string }) {
  const out = def.outputs.find((o) => o.key === output);
  const tail = r.tail;
  const head = r.head;
  const headOff = head && head.within < 1;
  return (
    <div className="grid gap-2.5" data-testid="labor-tv-ind-result" data-verdict={r.verdict}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[r.verdict]} dot>
          {VERDICT_LABEL[r.verdict]}
        </Badge>
        <span className="text-[12px] text-mute">
          {def.label} · {out?.label ?? output} · {def.pine(r.inputs)}
        </span>
      </div>
      {r.verdict === "few" ? (
        <p className="text-[12.5px] leading-relaxed text-mute">
          Nur {r.compared} Kerzen, auf denen TradingView und das Labor beide einen Wert haben (Spalte: {r.tvValues} Werte, Berechnung: {r.ourValues} Werte). Für ein Urteil braucht es mindestens 30 – exportiere mehr Kerzen oder prüfe die Eingaben.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed" data-testid="labor-tv-ind-text">
            {r.verdict === "equal" &&
              `Auf den letzten ${tail?.n ?? 0} gemeinsamen Werten stimmt die Berechnung des Labors innerhalb der Rundung des Exports (± ${devText(r.tolerance)}, ${decimalsText(r.decimals)}) mit TradingView überein.`}
            {r.verdict === "differs" && `Am Ende der Datei liegen ${Math.round((1 - (tail?.within ?? 0)) * (tail?.n ?? 0))} von ${tail?.n ?? 0} Werten außerhalb der Rundung des Exports (± ${devText(r.tolerance)}). Die größte Differenz steht unten. Mögliche Gründe: andere Eingaben als im Chart, andere Kerzen als die der Datei, eine andere Definition des Indikators – das entscheidet die Zahl allein nicht.`}
            {r.verdict === "open" && `Die Datei ist zu kurz, damit die Glättung eingeschwungen ist (nötig: etwa ${r.settle} Kerzen ab dem ersten Wert). Die Abweichung am Ende kann vom anderen Startwert kommen oder von der Formel – das lässt sich mit dieser Datei nicht trennen. Exportiere mehr Kerzen.`}
          </p>
          {headOff && (
            <p className="text-[12px] leading-relaxed text-mute" data-testid="labor-tv-ind-head">
              Der Anfang weicht ab (größte Differenz {devText(head.maxAbs)} in den ersten {head.n} gemeinsamen Werten){r.settle != null ? `: TradingView startete mit mehr Historie als die Datei zeigt, und die Glättung vergisst ihren Startwert erst nach etwa ${r.settle} Kerzen. Das ist ein anderer Startwert, keine andere Formel.` : "."}
            </p>
          )}
        </>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4" data-testid="labor-tv-ind-numbers">
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Verglichen</dt>
          <dd className="num font-mono">{r.compared} von {r.bars}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Erster Wert</dt>
          <dd className="num font-mono">TV {r.tvStart ?? "–"} · Labor {r.ourStart ?? "–"}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Größte Differenz</dt>
          <dd className="num font-mono">{devText(r.all?.maxAbs)}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Ø Differenz</dt>
          <dd className="num font-mono">{devText(r.all?.meanAbs)}</dd>
        </div>
      </dl>
      {r.worst.length > 0 && r.verdict !== "equal" && (
        <div className="grid gap-1" data-testid="labor-tv-ind-worst">
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Größte Abweichungen (Labor minus TradingView)</h4>
          <ul className="grid gap-1">
            {r.worst.map((w) => (
              <li key={w.time} className="num flex flex-wrap gap-x-3 font-mono text-[11.5px]">
                <span className="text-mute">{dateTime(new Date(w.time))}</span>
                <span>TV {valText(w.tv)}</span>
                <span>Labor {valText(w.ours)}</span>
                <span className="text-fg">Δ {devText(w.diff)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColumnRow({ col, pick, onPick, chart }: { col: ChartColumn; pick: Pick; onPick: (p: Pick) => void; chart: ReturnType<typeof parseTvChart> }) {
  const id = useId();
  const [indId, output] = pick.sel.split(":");
  const def = indId ? indicatorById(indId) : undefined;
  const inputs = useMemo(() => (def ? cleanInputs(def, { ...defaultInputs(def), ...pick.inputs }) : {}), [def, pick.inputs]);
  const result = useMemo(() => (def && output ? compareIndicator(chart, col, def, output, inputs) : null), [chart, col, def, output, inputs]);
  const options = useMemo(() => [{ value: "", label: IND.none }, ...INDICATORS.flatMap((d) => d.outputs.map((o) => ({ value: `${d.id}:${o.key}`, label: `${d.label} · ${o.label}` })))], []);
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3" data-testid="labor-tv-ind-col" data-column={col.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="min-w-0 break-words font-mono text-[13px] font-semibold">{col.name}</h4>
        <span className="text-[11.5px] text-mute">{col.filled} Werte · {decimalsText(col.decimals)}</span>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-sel`} className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">
          {IND.with}
        </label>
        <MorphSelect id={`${id}-sel`} size="sm" value={pick.sel} onChange={(sel) => onPick({ sel, inputs: {} })} options={options} wrap data-testid="labor-tv-ind-select" />
      </div>
      {def && (
        <div className="flex flex-wrap items-end gap-3" data-testid="labor-tv-ind-inputs">
          {def.params.map((q) => (
            <NumInput key={`${def.id}.${q.key}`} label={q.label} value={inputs[q.key] ?? q.def} onCommit={(v) => onPick({ ...pick, inputs: { ...pick.inputs, [q.key]: v ?? q.def } })} min={q.min} max={q.max} testId={`labor-tv-ind-in-${q.key}`} className="w-28" />
          ))}
        </div>
      )}
      {result && def && output && <Result r={result} def={def} output={output} />}
    </li>
  );
}

export function IndicatorCheckCard({ className }: { className?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [allErrors, setAllErrors] = useState(false);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const chart = useMemo(() => (text == null ? null : parseTvChart(text)), [text]);

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setReadError(null);
    try {
      setText(await readFileText(file));
      setName(file.name);
      setPicks({});
      setAllErrors(false);
    } catch {
      setReadError(IND.readFailed);
    }
  };
  /** the chosen mapping of a column: what the user picked, else the one plot name that fits (ambiguous names stay empty) */
  const pickOf = (c: ChartColumn): Pick => {
    const own = picks[c.index];
    if (own) return own;
    const g = guessColumn(c.name);
    return g ? { sel: `${g.id}:${g.output}`, inputs: g.inputs ?? {} } : { sel: "", inputs: {} };
  };
  const errors = chart?.errors ?? [];
  return (
    <Card title={IND.title} note={IND.note} className={className} data-testid="labor-tv-indicators">
      <div className="grid gap-5">
        <ContractList />
        <section className="grid gap-3 border-t border-line pt-4" aria-label="Abgleich mit einem Export" data-testid="labor-tv-check">
          <h3 className="text-[13px] font-semibold">Export gegen Berechnung</h3>
          <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{IND.how}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              id={inputId}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              aria-label={IND.pick}
              data-testid="labor-tv-ind-file"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button variant={text == null ? "primary" : "secondary"} size="sm" onClick={() => input.current?.click()} data-testid="labor-tv-ind-pick">
              {text == null ? IND.pick : IND.another}
            </Button>
            {name && (
              <span className="min-w-0 truncate text-[12px] text-mute" data-testid="labor-tv-ind-name">
                {name}
              </span>
            )}
          </div>
          {readError && (
            <p role="alert" className="text-[12.5px] text-loss">
              {readError}
            </p>
          )}
          {chart && (
            <div className="grid gap-3" data-testid="labor-tv-ind-read">
              <p className="text-[12.5px]" data-testid="labor-tv-ind-summary">
                <span className="num font-mono font-medium">{chart.bars.length}</span> Kerzen gelesen
                {chart.from != null && chart.to != null ? ` · ${dateTime(new Date(chart.from))} bis ${dateTime(new Date(chart.to))}` : ""} · Zeiteinheit {intervalLabel(chart.intervalSec)} · {chart.columns.length} Spalte{chart.columns.length === 1 ? "" : "n"} mit Werten
                {errors.length ? ` · ${errors.length}${chart.errorsCut ? "+" : ""} Zeile${errors.length === 1 ? "" : "n"} nicht lesbar` : ""}.
              </p>
              {chart.warnings.map((w) => (
                <p key={w} className="text-[12px] text-warn">
                  {w}
                </p>
              ))}
              {errors.length > 0 && (
                <div className="grid gap-1.5 rounded-xl border border-loss/30 bg-loss/[0.04] px-3.5 py-3" data-testid="labor-tv-ind-errors">
                  <h4 className="text-[12px] font-semibold text-loss">Das konnte ich nicht lesen</h4>
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
                  {chart.bars.length > 0 && <p className="text-[11.5px] text-faint">Die übrigen Zeilen werden verglichen.</p>}
                </div>
              )}
              {chart.bars.length > 0 && chart.columns.length > 0 && (
                <>
                  <ul className="grid gap-3">
                    {chart.columns.map((c) => (
                      <ColumnRow key={c.index} col={c} chart={chart} pick={pickOf(c)} onPick={(p) => setPicks((prev) => ({ ...prev, [c.index]: p }))} />
                    ))}
                  </ul>
                  <p className="max-w-[72ch] text-[11.5px] leading-snug text-faint" data-testid="labor-tv-ind-note">
                    {IND.verdictNote}
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
