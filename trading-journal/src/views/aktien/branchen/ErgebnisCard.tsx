/**
 * „Ergebnis eines Laufs prüfen“: the user picks the `megatest.json` a lab run wrote (or loads the shipped example), the app checks its shape and
 * shows the verdict the run itself came to – with the checks, the figures of the base and the candidate in the three periods, the scatter of
 * selection against end test (the picture of overfitting), the distribution and the Monte-Carlo fan.
 *
 * The app does NOT run the 12,000 variants (a Python script does, outside the browser, in about 20 minutes), does not pick a "best" set and
 * does not switch anything on: a rejected candidate is shown as rejected, with the checks that failed. The file never leaves the device.
 */
import { useId, useRef, useState, type ChangeEvent } from "react";
import { fmtDay, paramsText, verdictOf, MAX_RESULT_BYTES, type Kennzahlen, type MegatestResult } from "@/domain/industryTrend";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useUi } from "@/store/uiStore";
import { readFileText } from "@/views/labor/readFile";
import { CardNote } from "../ui";
import { FanChart, HistogramChart, ScatterChart } from "./charts";
import { copyText } from "./clipboard";
import { useBranchen } from "./store";
import { BRANCHEN } from "./strings";

const E = BRANCHEN.ergebnis;
const dec = (v: number, d = 2): string => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const pc = (v: number, d = 1): string => `${dec(v * 100, d)} %`;

function Verdict({ r }: { r: MegatestResult }) {
  const v = verdictOf(r);
  const rejected = v.state === "verworfen";
  const base = paramsText(r.basis.parameter);
  const cand = paramsText(r.kandidatin.parameter);
  return (
    <section
      aria-labelledby="branchen-verdict-h"
      className={cn("grid gap-3 rounded-2xl border p-4", rejected ? "border-loss/40 bg-loss/[0.06]" : "border-win/35 bg-win/[0.05]")}
      data-testid="branchen-verdict"
      data-state={v.state}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="branchen-verdict-h" className="num font-mono text-[22px] font-semibold leading-none tracking-wide text-fg" data-testid="branchen-verdict-word">
          {rejected ? E.verdict.verworfen : E.verdict.uebernommen}
        </h3>
        <Badge tone="mute">Rückblick · Papier</Badge>
      </div>
      <p className="max-w-[80ch] text-[13.5px] leading-relaxed text-fg" data-testid="branchen-verdict-lead">
        {rejected ? E.verdict.verworfenLead(base, cand) : E.verdict.uebernommenLead(cand)}
      </p>
      {!v.consistent && (
        <p className="text-[12.5px] leading-relaxed text-warn" role="note" data-testid="branchen-verdict-inconsistent">
          {E.verdict.inconsistent(r.entscheidung === "VERWORFEN" ? E.verdict.verworfen : E.verdict.uebernommen, rejected ? E.verdict.verworfen : E.verdict.uebernommen)}
        </p>
      )}
      {rejected && (
        <p className="text-[12.5px] leading-relaxed text-mute" data-testid="branchen-verdict-failed">
          <span className="font-medium text-fg">{E.verdict.failedLead}</span> {v.failed.map((c) => c.name).join(" · ")}
        </p>
      )}
      <div className="grid gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{E.verdict.checksTitle}</h4>
        <ul className="grid gap-2" data-testid="branchen-checks">
          {r.checks.map((c, i) => (
            <li key={i} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border p-3", c.ok ? "border-win/25" : "border-loss/35")} data-testid="branchen-check" data-ok={c.ok}>
              <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-[13px] font-semibold leading-none", c.ok ? "border-win/40 text-win" : "border-loss/50 text-loss")}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className="sr-only">{c.ok ? E.verdict.passed : E.verdict.failed}: </span>
              <span className="min-w-0 flex-1 basis-56 text-[13px] leading-snug text-fg">{c.name}</span>
              <code className="num font-mono text-[12px] text-mute">{c.wert}</code>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[12.5px] leading-relaxed text-mute" data-testid="branchen-rank">
        {E.verdict.rank(dec(r.rang_korrelation))}
      </p>
    </section>
  );
}

function KzCell({ k, worse }: { k: Kennzahlen; worse?: boolean }) {
  return (
    <div className={cn("num grid gap-0.5 text-[12px] leading-snug", worse && "text-loss")}>
      <span>
        {E.kz.sharpe} <span className="font-mono text-[13px] font-medium text-fg">{dec(k.sharpe)}</span>
      </span>
      <span>
        {E.kz.cagr} <span className="font-mono text-fg">{pc(k.cagr)}</span>
      </span>
      <span>
        {E.kz.dd} <span className="font-mono text-fg">{pc(k.maxdd)}</span>
      </span>
    </div>
  );
}

function Kennzahlen_({ r }: { r: MegatestResult }) {
  const b = r.basis.kennzahlen;
  const c = r.kandidatin.kennzahlen;
  const rows = [
    { id: "entw", label: E.kz.rows.entw, span: `${fmtDay(r.daten_von)} – ${fmtDay(r.schnitt.entw_bis)}` },
    { id: "valid", label: E.kz.rows.valid, span: `bis ${fmtDay(r.schnitt.valid_bis)}` },
    { id: "endtest", label: E.kz.rows.endtest, span: `bis ${fmtDay(r.daten_bis)}` },
    { id: "gesamt", label: E.kz.rows.gesamt, span: `${fmtDay(r.daten_von)} – ${fmtDay(r.daten_bis)}` },
  ] as const;
  return (
    <section aria-labelledby="branchen-kz-h" className="grid gap-2" data-testid="branchen-kennzahlen">
      <h3 id="branchen-kz-h" className="text-[13px] font-medium text-fg">
        {E.kz.title}
      </h3>
      <div className="overflow-x-auto" role="region" aria-label={E.kz.title} tabIndex={0}>
        <table className="w-full min-w-[420px] border-separate border-spacing-y-1.5 text-left">
          <caption className="sr-only">{E.kz.title}</caption>
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              <th scope="col" className="px-2 py-1 font-semibold">
                {E.kz.period}
              </th>
              <th scope="col" className="px-2 py-1 font-semibold">
                {E.kz.base}
                <span className="block normal-case tracking-normal text-faint">{paramsText(r.basis.parameter)}</span>
              </th>
              <th scope="col" className="px-2 py-1 font-semibold">
                {E.kz.cand}
                <span className="block normal-case tracking-normal text-faint">{paramsText(r.kandidatin.parameter)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} data-testid={`branchen-kz-${x.id}`} className="align-top">
                <th scope="row" className="rounded-l-xl border-y border-l border-line bg-ink-950/40 px-2 py-2 text-[12.5px] font-medium text-fg">
                  {x.label}
                  <span className="num block text-[11px] font-normal text-faint">{x.span}</span>
                </th>
                <td className="border-y border-line bg-ink-950/40 px-2 py-2">
                  <KzCell k={b[x.id]} />
                </td>
                <td className="rounded-r-xl border-y border-r border-line bg-ink-950/40 px-2 py-2">
                  <KzCell k={c[x.id]} worse={x.id === "endtest" && c.endtest.sharpe < b.endtest.sharpe} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="num text-[12px] leading-relaxed text-mute" data-testid="branchen-kz-market">
        <span className="font-medium text-fg">{E.kz.market}:</span> {E.kz.sharpe} {dec(r.markt.endtest.sharpe)} · {E.kz.cagr} {pc(r.markt.endtest.cagr)} · {E.kz.dd} {pc(r.markt.endtest.maxdd)}.{" "}
        <span className="font-medium text-fg">Kandidatin nach 10 Basispunkten Kosten (Endtest):</span> {E.kz.sharpe} {dec(r.kandidatin.kosten10bp_endtest.sharpe)} · {E.kz.cagr} {pc(r.kandidatin.kosten10bp_endtest.cagr)}.
      </p>
      <p className="text-[11.5px] leading-relaxed text-faint">{E.kz.note}</p>
    </section>
  );
}

function TopTable({ r }: { r: MegatestResult }) {
  const rows = r.top.slice(0, 10);
  const base = r.basis.kennzahlen.endtest.sharpe;
  if (!rows.length) return null;
  return (
    <section aria-labelledby="branchen-top-h" className="grid gap-2" data-testid="branchen-top">
      <h3 id="branchen-top-h" className="text-[13px] font-medium text-fg">
        {E.top.title}
      </h3>
      <div className="overflow-x-auto" role="region" aria-label={E.top.title} tabIndex={0}>
        <table className="w-full min-w-[380px] text-left text-[12.5px]">
          <caption className="sr-only">{E.top.title}</caption>
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                {E.top.param}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                {E.top.sel}
              </th>
              <th scope="col" className="py-1.5 pl-2 text-right font-semibold">
                {E.top.end}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i} className="border-t border-line" data-testid="branchen-top-row">
                <td className="num py-1.5 pr-2 text-mute">{paramsText(t.parameter)}</td>
                <td className="num px-2 py-1.5 text-right font-mono text-fg">{dec(t.devval)}</td>
                <td className={cn("num py-1.5 pl-2 text-right font-mono", t.endtest < base ? "text-loss" : "text-win")}>
                  {dec(t.endtest)}
                  {t.endtest < base && <span className="sr-only"> (unter der Basis)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-mute">{E.top.note(dec(base), pc(r.anteil_endtest_besser_als_basis, 0))}</p>
    </section>
  );
}

export function ErgebnisCard() {
  const result = useBranchen((s) => s.result);
  const resultName = useBranchen((s) => s.resultName);
  const resultError = useBranchen((s) => s.resultError);
  const loadText = useBranchen((s) => s.loadResultText);
  const setError = useBranchen((s) => s.setResultError);
  const clear = useBranchen((s) => s.clearResult);
  const pushToast = useUi((s) => s.pushToast);
  const input = useRef<HTMLInputElement>(null);
  const cmd = useRef<HTMLElement>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const fileId = useId();

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_RESULT_BYTES) {
      setError(E.tooBig);
      return;
    }
    try {
      loadText(await readFileText(f), f.name.slice(0, 80));
    } catch {
      setError(E.readFail);
    }
  };

  const loadExample = async (): Promise<void> => {
    setLoadingExample(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}branchen-trend/beispiel-megatest.json`, { credentials: "omit" });
      const text = res.ok ? await res.text() : "";
      // a host without the file answers with its app page: that is not the example
      if (!text || text.trimStart().startsWith("<")) setError(E.exampleFail);
      else loadText(text, "beispiel-megatest.json");
    } catch {
      setError(E.exampleFail);
    } finally {
      setLoadingExample(false);
    }
  };

  const copyCommand = async (): Promise<void> => {
    const ok = await copyText(E.command, cmd.current);
    pushToast(ok ? { kind: "success", title: E.commandCopied } : { kind: "error", title: E.commandCopyFail });
  };

  return (
    <Card title={E.title} className="h-full" data-testid="branchen-ergebnis">
      <div className="grid min-w-0 gap-4">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-mute" data-testid="branchen-ergebnis-lead">
          {E.lead}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input id={fileId} ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label={E.fileLabel} onChange={(e) => void onFile(e)} data-testid="branchen-file" />
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()} data-testid="branchen-pick">
            {E.pick}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void loadExample()} disabled={loadingExample} data-testid="branchen-example">
            {loadingExample ? E.exampleLoading : E.example}
          </Button>
          {result && (
            <Button variant="ghost" size="sm" onClick={clear} data-testid="branchen-clear">
              {E.clear}
            </Button>
          )}
        </div>
        <p className="text-[12px] text-faint">{E.privacy}</p>
        {resultError && (
          <p className="rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px] leading-snug text-fg" role="alert" data-testid="branchen-result-error">
            {resultError}
          </p>
        )}

        <section aria-labelledby="branchen-cmd-h" className="grid gap-2 rounded-xl border border-line bg-ink-950/30 p-3" data-testid="branchen-command">
          <h3 id="branchen-cmd-h" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {E.commandTitle}
          </h3>
          <p className="text-[12.5px] text-mute">{E.commandLead}</p>
          <div className="flex flex-wrap items-start gap-2">
            <code ref={cmd} className="num min-w-0 flex-1 basis-72 break-all rounded-lg border border-line bg-ink-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg" data-testid="branchen-command-text">
              {E.command}
            </code>
            <Button variant="ghost" size="sm" onClick={() => void copyCommand()} data-testid="branchen-command-copy">
              {E.commandCopy}
            </Button>
          </div>
          <ul className="grid gap-1.5">
            {E.commandNotes.map((n) => (
              <li key={n} className="text-[12px] leading-relaxed text-mute">
                {n}
              </li>
            ))}
          </ul>
        </section>

        {result && (
          <div className="grid min-w-0 gap-6" data-testid="branchen-result" data-name={resultName ?? ""}>
            <Verdict r={result} />
            <Kennzahlen_ r={result} />
            <section aria-labelledby="branchen-scatter-h" className="grid gap-2">
              <h3 id="branchen-scatter-h" className="text-[13px] font-medium text-fg">
                {E.scatter.title}
              </h3>
              <ScatterChart result={result} />
            </section>
            <section aria-labelledby="branchen-hist-h" className="grid gap-2">
              <h3 id="branchen-hist-h" className="text-[13px] font-medium text-fg">
                {E.hist.title}
              </h3>
              <HistogramChart result={result} />
            </section>
            <FanChart result={result} />
            <TopTable r={result} />
            <p className="num text-[11.5px] leading-relaxed text-faint" data-testid="branchen-meta">
              {E.meta(result.erstellt.slice(0, 10).split("-").reverse().join("."), result.laufzeit_s === null ? "unbekannt" : `${result.laufzeit_s.toLocaleString("de-DE")} s`, result.n_varianten.toLocaleString("de-DE"), result.branchen, dec(result.kosten_bp, 0))}
              {result.hinweis ? ` · ${result.hinweis}` : ""}
            </p>
          </div>
        )}
        <CardNote lead={BRANCHEN.note} />
      </div>
    </Card>
  );
}
