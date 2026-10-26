/**
 * „Börsenhistorie nachladen“ (F26/F07) – the explicit action inside the Datenarchiv card. It says what is loaded, from where,
 * what it costs (requests, entries, size, time), lets the user choose the span and the symbols, shows the progress while it
 * runs, cancels on request and keeps a log of the finished runs. Separate from the collector's switch: it works with the
 * archive switched off, and what it stores is its own series, labelled „nachgeladen“, never merged with the collected ones.
 *
 * Motion: the bar glides on `spring.smooth` (transform only); reduced motion jumps. Touch targets ≥ 44 px on coarse pointers.
 */
import { motion } from "motion/react";
import { memo, useMemo, useState } from "react";
import { ARCHIVE_MAX_SYMBOLS, BACKFILL_DAY_CHOICES, BACKFILL_MAX_SYMBOLS, DEFAULT_BACKFILL_DAYS, effectiveSymbols, observedSymbols, planBackfill, type BackfillRun } from "@/domain/archive";
import { boxesCfgOf } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { getBackfillLog } from "@/market/archive/backfillLog";
import { cancelBackfill, clearBackfillLog, startBackfill, useBackfillState } from "@/market/archive/backfillStore";
import { useArchiveCfg } from "@/market/archive/store";
import { tvSymbolToBinance } from "@/market/symbol";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { BACKFILL_STRINGS as S, DAYS_LABEL, previewText, problemLines, progressFraction, progressText, runSummary } from "./backfillModel";

type Days = "7" | "14" | "30";
/** The device clock, read in event handlers (never while rendering). */
const clockNow = (): number => Date.now();

function Bar({ fraction }: { fraction: number }) {
  const reduced = useReducedFx();
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
      <motion.div className="h-full w-full origin-left rounded-full bg-fg/80" initial={false} animate={{ scaleX: Math.max(0.02, fraction) }} transition={reduced ? { duration: 0 } : spring.smooth} />
    </div>
  );
}

function Problems({ run }: { run: BackfillRun }) {
  const lines = problemLines(run.res);
  if (!lines.length) return null;
  return (
    <ul className="grid gap-1 text-[12px] text-warn" data-testid="backfill-problems">
      {lines.map((l) => (
        <li key={l.symbol}>
          <span className="num font-medium">{l.symbol}</span>: {l.text}
        </li>
      ))}
    </ul>
  );
}

export const BackfillSection = memo(function BackfillSection() {
  const cfg = useArchiveCfg();
  const run = useBackfillState();
  const liveRaw = useJournal((s) => s.settings.market.symbol);
  const watch = useJournal((s) => (s.settings as { boxes?: unknown }).boxes);
  const observed = useMemo(() => observedSymbols(tvSymbolToBinance(liveRaw), boxesCfgOf(watch).watchlist), [liveRaw, watch]);
  const archiveSymbols = effectiveSymbols(cfg, observed);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [days, setDays] = useState<number>(DEFAULT_BACKFILL_DAYS);
  const [cancelling, setCancelling] = useState(false);
  const symbols = picked ?? archiveSymbols;
  const running = run.phase === "running";
  // the preview only sizes the sentence (the run takes its own „now“ at the click); it is refreshed when the choice changes
  const [previewAt, setPreviewAt] = useState(clockNow);
  const plan = useMemo(() => planBackfill(symbols, days, previewAt), [symbols, days, previewAt]);
  const last = getBackfillLog()[0] ?? null; // the log lives outside React; the store's emit (logRev) re-renders us when it changes
  const p = run.progress;
  const finished = !running && p && p.state !== "running" ? p : null;

  const toggle = (s: string) => {
    const has = symbols.includes(s);
    if (!has && symbols.length >= BACKFILL_MAX_SYMBOLS) return;
    setPicked(has ? symbols.filter((x) => x !== s) : [...symbols, s]);
    setPreviewAt(clockNow());
  };

  const start = () => {
    setCancelling(false);
    void startBackfill(symbols, days);
  };
  const cancel = () => {
    setCancelling(true);
    cancelBackfill();
  };

  const chips = [...new Set([...observed, ...archiveSymbols, ...symbols])].slice(0, ARCHIVE_MAX_SYMBOLS + 4);

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3.5" aria-labelledby="archive-backfill-h" data-testid="archive-backfill">
      <h3 id="archive-backfill-h" className="label">
        {S.title}
      </h3>
      <div className="grid gap-1.5 text-[12px] leading-relaxed text-mute">
        <p data-testid="backfill-lead">{S.lead}</p>
        <p data-testid="backfill-separate">{S.separate}</p>
        <p data-testid="backfill-window">{S.window}</p>
        <p data-testid="backfill-noserver">{S.noServer}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <span id="backfill-days-label" className="label">
            {S.days}
          </span>
          <Segmented<Days>
            aria-labelledby="backfill-days-label"
            size="sm"
            className="justify-self-start"
            value={`${days}` as Days}
            onChange={(v) => {
              setDays(Number(v));
              setPreviewAt(clockNow());
            }}
            options={BACKFILL_DAY_CHOICES.map((d) => ({ v: `${d}` as Days, label: DAYS_LABEL(d), disabled: running }))}
          />
        </div>
        <div className="grid content-start gap-2">
          <span className="label">
            {S.symbols} · {symbols.length}/{BACKFILL_MAX_SYMBOLS}
          </span>
          <ul className="flex flex-wrap gap-2" aria-label={S.symbols}>
            {chips.map((s) => {
              const on = symbols.includes(s);
              const full = !on && symbols.length >= BACKFILL_MAX_SYMBOLS;
              return (
                <li key={s}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={running || full}
                    onClick={() => toggle(s)}
                    data-testid={`backfill-symbol-${s}`}
                    className={cn(
                      "num rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 pointer-coarse:min-h-11",
                      on ? "border-fg/50 bg-white/[0.08] text-fg" : "border-line text-mute hover:border-white/25 hover:text-fg",
                      (running || full) && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {s}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11.5px] leading-snug text-mute">{S.symbolsHelp}</p>
        </div>
      </div>

      <p className="num text-[12.5px] text-fg" data-testid="backfill-preview">
        {previewText(plan)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button variant="primary" size="sm" className="pointer-coarse:min-h-11" disabled={!symbols.length} onClick={start} data-testid="backfill-start">
            {S.start}
          </Button>
        ) : (
          <Button size="sm" className="pointer-coarse:min-h-11" disabled={cancelling} onClick={cancel} data-testid="backfill-cancel">
            {cancelling ? S.cancelling : S.cancel}
          </Button>
        )}
      </div>

      {running && (
        <div className="grid gap-1.5" role="progressbar" aria-label={S.runningLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressFraction(p) * 100)} aria-valuetext={progressText(p)} data-testid="backfill-progress">
          <Bar fraction={progressFraction(p)} />
          <p className="num text-[12px] text-mute" data-testid="backfill-progress-text">
            {progressText(p)}
          </p>
        </div>
      )}

      {run.error && (
        <p className="text-[12px] text-warn" role="alert" data-testid="backfill-error">
          {run.error}
        </p>
      )}

      {finished && (
        <div className="grid gap-1.5" role="status" data-testid="backfill-result" data-state={finished.state}>
          <p className="text-[12.5px] text-fg">
            {finished.state === "done" ? S.doneText : finished.state === "cancelled" ? S.cancelledText : (finished.stopped ?? "Das Nachladen wurde vorzeitig beendet.")}
          </p>
          <p className="num text-[12px] text-mute">{progressText({ ...finished, symbol: null, series: null })}</p>
          {last && <Problems run={last} />}
        </div>
      )}

      <div className="grid gap-1" data-testid="backfill-log">
        <span className="label">{S.lastRun}</span>
        {last ? (
          <>
            <p className="num text-[12px] text-mute" data-testid="backfill-last">
              {runSummary(last)}
            </p>
            {!finished && <Problems run={last} />}
            <div>
              <Button size="sm" className="pointer-coarse:min-h-11" disabled={running} onClick={clearBackfillLog} data-testid="backfill-clear-log">
                {S.clearLog}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-mute" data-testid="backfill-nolog">
            {S.noLog}
          </p>
        )}
      </div>
    </section>
  );
});

export default BackfillSection;
