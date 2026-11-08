/**
 * Labor · „1.000 Varianten. Eine bleibt.“: the real strategy search in the Frost block (`SearchStage`): title, counters, four stages, the stage
 * with the real curves, the result over the stage, „Nochmal ansehen“ / „Neue Stichprobe“. Set-up (family, candle length, seed; market and period
 * are the Versuchsaufbau's) under the block; while the worker computes, the stage shows its real count („412 von 1.000 Varianten · 1.236 Läufe“).
 * Below: the result (verdict, „Was machen wir wann?“, drawdown risk, stop management, criteria, legal line), the current candidate, the saved
 * searches. Own lazy chunk of `LaborView`. Works with real candles and with fixtures (`fixture` prop: tests, demo preview – labelled as demo).
 * Reduced motion: final picture at once; no loop; the stage keeps its aspect ratio (no layout shift).
 */
import { useDeferredValue, useMemo, useState } from "react";
import { STOP_NAME, type SearchInterval } from "@/domain/lab/search";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { CandidateCard } from "./CandidateCard";
import { idText, SearchStage, type StageStats } from "./SearchStage";
import { SearchResultCard } from "./SearchResultCard";
import { cancelSearch, startSearch, useSearch, type FamilyChoice, type SearchFixture } from "./searchStore";
import { SEARCH } from "./strings";
import { sceneOf } from "./timeline";
import { useLabor } from "../laborStore";
import { LABOR } from "../strings";
import { FieldRow, numText, rText } from "../ui";

const F = SEARCH.frost;
const COARSE = "pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:justify-center";
const FAMILIES: { v: FamilyChoice; label: string }[] = [
  { v: "both", label: SEARCH.families.both },
  { v: "trend", label: SEARCH.families.trend },
  { v: "orb", label: SEARCH.families.orb },
];
const INTERVALS: { v: SearchInterval; label: string }[] = [
  { v: "1h", label: "1h" },
  { v: "4h", label: "4h" },
  { v: "1d", label: "1T" },
];
/** the worker's phases on the stage chips: training (score) = „Prüfen“, winner fixed + its final test (seal) = „Kristallisieren“, the others' final test (rank) = „Endtest“ */
const PHASE_STAGE: Record<string, number> = { prepare: 1, score: 1, seal: 2, rank: 3, done: 3 };

const phaseText = (phase: string): string => (SEARCH.phase as Record<string, string>)[phase] ?? SEARCH.phase.load;
const fmt = (n: number): string => n.toLocaleString("de-DE");

/** The worker's real progress in the middle of the stage (a progressbar, never a live region – the toast island is the only one). */
function Busy() {
  const status = useSearch((s) => s.status);
  const load = useSearch((s) => s.load);
  const checked = useSearch((s) => s.checked);
  const progress = useSearch((s) => s.progress);
  const loading = status === "loading";
  const pct = Math.max(0, Math.min(99, Math.floor(progress * 100)));
  const training = checked.phase === "score" || checked.phase === "prepare";
  const line = loading ? SEARCH.loading(load.done, load.total) : training ? SEARCH.checked(checked.done, checked.total) : phaseText(checked.phase);
  // in training one variant = three runs (fixed, break-even, trailing), counted by the worker
  const sub = loading ? SEARCH.phase.load : training ? `${phaseText(checked.phase)} · ${F.busyLine(checked.done * 3)}` : phaseText(checked.phase);
  return (
    <div className="sx-center" data-testid="search-busy">
      <div className="grid justify-items-center gap-3 text-center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${line}. ${sub}`} aria-label="Strategiesuche läuft">
        <span className="dot-num num text-[34px] font-extrabold leading-none text-fg" style={{ fontSize: "clamp(26px, 6vw, 44px)" }} data-testid="search-count">
          {line}
        </span>
        <span className="font-mono text-[12px] text-mute">{sub}</span>
        <span aria-hidden="true" className="h-[3px] w-48 overflow-hidden rounded-full bg-white/[0.06]">
          <span className="block h-full origin-left rounded-full bg-fg" style={{ width: `${pct}%` }} />
        </span>
      </div>
    </div>
  );
}

export default function StrategySearchSection({ fixture }: { fixture?: SearchFixture }) {
  const lab = useLabor((s) => s.cfg);
  const cfg = useSearch((s) => s.cfg);
  const setCfg = useSearch((s) => s.setCfg);
  const status = useSearch((s) => s.status);
  const error = useSearch((s) => s.error);
  const result = useSearch((s) => s.result);
  const summary = useSearch((s) => s.summary);
  const runSeq = useSearch((s) => s.runSeq);
  const saved = useSearch((s) => s.saved);
  const show = useSearch((s) => s.show);
  const checked = useSearch((s) => s.checked);
  const computeMs = useSearch((s) => s.computeMs);
  const busy = status === "loading" || status === "running";
  // the long result below the stage renders as an interruptible transition: the replay's first frames never wait for it
  const shown = useDeferredValue(summary);
  const scene = useMemo(() => (result ? sceneOf(result) : null), [result]);
  const [replay, setReplay] = useState(0);
  const [skip, setSkip] = useState(0);
  /** the play key whose end state is on screen; the result card waits for it (a restored summary has no replay and is shown at once) */
  const [doneKey, setDoneKey] = useState(-1);
  const [draft, setDraft] = useState<string | null>(null);
  const seedText = draft ?? String(cfg.seed);
  const playKey = runSeq * 1000 + replay;
  const done = doneKey === playKey;
  const period = LABOR.periods[lab.period];
  const stats = summary ? summary.counts : null;
  const w = summary?.winner ?? null;
  const stageLabel = result ? SEARCH.stageLabel(result.counts.variants, result.winner?.variant.id ?? null) : SEARCH.title;
  const seedValid = /^\d{1,10}$/.test(seedText) && Number(seedText) <= 4_294_967_295;
  const sameFamilyHint = cfg.family !== "orb";
  const sameMarket = saved.filter((s) => s.datasets[0]?.symbol === lab.symbol).length;
  const ready = !result || (doneKey >= runSeq * 1000 && doneKey < (runSeq + 1) * 1000);
  const start = () => void startSearch({ fixture });
  const reseed = () => {
    // a new sample is a new seed – shown, saved, reproducible; and one more trial
    setCfg({ seed: Math.floor(Math.random() * 4_294_967_295) });
    setDraft(null);
    void startSearch({ fixture });
  };

  const stageStats: StageStats = busy
    ? { label: "Geprüft", value: status === "loading" ? "–" : fmt(checked.phase === "score" || checked.phase === "prepare" ? checked.done : checked.total), best: "–", stage: status === "loading" ? -1 : (PHASE_STAGE[checked.phase] ?? -1) }
    : summary
      ? { label: "Geprüft", value: fmt(summary.counts.variants), best: idText(w?.variant.id ?? null), stage: 3 }
      : { label: "Geprüft", value: "–", best: "–", stage: -1 };

  const center = busy ? (
    <Busy />
  ) : (
    <div className="sx-center">
      <p role={status === "error" ? "alert" : undefined} className={cn("max-w-[48ch] text-[13px]", status === "error" ? "text-(--color-danger-text)" : "text-mute")} data-testid="search-stage-text">
        {status === "error" || status === "cancelled" ? error : summary ? SEARCH.restored : SEARCH.stageIdle}
      </p>
    </div>
  );

  const overlay = summary ? (
    w ? (
      <>
        <h3>
          {F.overlayTitle} <i>{idText(w.variant.id)}</i>
        </h3>
        <div className="sx-row">
          {F.overlayStop}
          <b>{STOP_NAME[w.stop]}</b>
        </div>
        <div className="sx-row">
          {F.overlayOosAvg}
          <b>{rText(w.oos.avgR)}</b>
        </div>
        <div className="sx-row">
          {F.overlayOosSum}
          <b>
            {rText(w.oos.sumR, 1)} · {w.oos.n} Trades
          </b>
        </div>
        <div className="sx-row">
          {F.overlayRank}
          <b>{summary.rank?.rank != null ? `${fmt(summary.rank.rank)} von ${fmt(summary.rank.of)}` : "–"}</b>
        </div>
        {w.risk && (
          <div className="sx-row">
            {SEARCH.risk.bad}
            <b>−{numText(w.risk.ddRq.p95, 1)} R</b>
          </div>
        )}
        <span className="sx-verdict" data-ok={summary.verdict.passed ? "1" : "0"}>
          {summary.verdict.passed ? F.overlayPassed : F.overlayRejected}
        </span>
        <p>{F.overlayNote}</p>
        {w.risk && <p>{F.bandNote(w.risk.n)}</p>}
      </>
    ) : (
      <p>{F.overlayNone}</p>
    )
  ) : null;

  const caption = stats && summary ? F.caption(stats.variants, stats.stopRules, stats.isRuns, stats.oosRuns, summary.seed, result ? computeMs : null, !!result) : F.captionIdle;

  const actions = busy ? (
    <Button size="md" variant="secondary" onClick={cancelSearch} data-testid="search-cancel">
      {SEARCH.cancel}
    </Button>
  ) : result && !done ? (
    <Button size="md" variant="ghost" onClick={() => setSkip((n) => n + 1)} data-testid="search-skip">
      {SEARCH.skip}
    </Button>
  ) : summary ? (
    <>
      {result && (
        <Button size="md" variant="secondary" onClick={() => setReplay((n) => n + 1)} data-testid="search-replay">
          {SEARCH.replay}
        </Button>
      )}
      <Button size="md" variant="secondary" onClick={reseed} title={SEARCH.reseedHint} data-testid="search-reseed">
        {SEARCH.reseed}
      </Button>
    </>
  ) : (
    <Button size="md" variant="primary" fx={false} onClick={start} disabled={!seedValid} data-testid="search-start">
      {SEARCH.start}
    </Button>
  );

  return (
    <div className="grid gap-5" data-testid="search-section" data-status={status}>
      <div className="grid gap-4" data-testid="search-card">
        <SearchStage scene={scene} playKey={playKey} skipKey={skip} label={stageLabel} onDone={setDoneKey} stats={stageStats} center={center} overlay={overlay} caption={caption} actions={actions}>
          <div className="mt-4 grid gap-3 border-t border-line pt-4">
            {fixture && (
              <p className="text-[12px] font-semibold text-fg" data-testid="search-fixture-note">
                {SEARCH.demo}.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
              {!fixture && (
                <FieldRow label={SEARCH.familyLabel}>
                  <Segmented size="sm" aria-label={SEARCH.familyLabel} className={COARSE} value={cfg.family} onChange={(family) => setCfg({ family })} options={FAMILIES} />
                </FieldRow>
              )}
              {sameFamilyHint && !fixture && (
                <FieldRow label={SEARCH.intervalLabel}>
                  <Segmented size="sm" aria-label={SEARCH.intervalLabel} className={COARSE} value={cfg.interval} onChange={(interval) => setCfg({ interval })} options={INTERVALS} />
                </FieldRow>
              )}
              <FieldRow label={SEARCH.seedLabel} htmlFor="search-seed" hint={SEARCH.seedHint}>
                <Input
                  id="search-seed"
                  numeric
                  value={seedText}
                  invalid={!seedValid}
                  disabled={busy}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (/^\d{1,10}$/.test(e.target.value) && Number(e.target.value) <= 4_294_967_295) setCfg({ seed: Number(e.target.value) });
                  }}
                  onBlur={() => setDraft(null)}
                  wrapperClassName="max-w-40"
                  data-testid="search-seed-input"
                />
              </FieldRow>
              {summary && !busy && (
                <Button size="md" variant="primary" fx={false} onClick={start} disabled={!seedValid} data-testid="search-start">
                  {SEARCH.again}
                </Button>
              )}
            </div>
            {!fixture && <p className="text-[12px] text-faint">{SEARCH.setupLine(lab.symbol, period)}</p>}
          </div>
        </SearchStage>
        <Card>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute">{SEARCH.lead}</p>
              <p className="max-w-[72ch] text-[12.5px] font-medium leading-snug text-fg">{SEARCH.bias}</p>
              {result && <p className="max-w-[72ch] text-[11.5px] leading-snug text-faint">{SEARCH.replayNote}</p>}
            </div>
            {shown && !busy && (
              <div style={{ visibility: ready ? "visible" : "hidden" }} aria-hidden={!ready} data-ready={ready && shown === summary ? "true" : "false"} data-testid="search-result-wrap">
                <SearchResultCard summary={shown} />
              </div>
            )}
          </div>
        </Card>
        {stats && !busy && <span className="sr-only" data-testid="search-counts" data-variants={stats.variants} data-candidates={stats.candidates} data-is-runs={stats.isRuns} data-oos-runs={stats.oosRuns} />}
      </div>
      {summary && !busy && ready && <CandidateCard />}
      <Card title={SEARCH.saved.title} note={SEARCH.saved.note} data-testid="search-saved">
        {saved.length === 0 ? (
          <p className="text-[12.5px] text-mute">{SEARCH.saved.empty}</p>
        ) : (
          <div className="grid gap-2">
            {sameMarket >= 2 && (
              <p className="text-[12px] leading-snug text-faint" data-testid="search-saved-count">
                {SEARCH.saved.count(sameMarket, lab.symbol, cfg.interval)}
              </p>
            )}
            <ul className="grid gap-2">
              {saved.map((s) => {
                const d = s.datasets[0]!;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]" data-testid="search-saved-item">
                    <span className="num min-w-0 text-fg">
                      {d.symbol} · {s.families.map((f) => SEARCH.familyName[f]).join(" + ")} · Seed {s.seed} · <b className="font-medium">{s.verdict.passed ? SEARCH.passed : SEARCH.rejected}</b>
                      {d.fixture ? ` · ${SEARCH.demo}` : ""}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => show(s.id)} disabled={busy}>
                      {SEARCH.saved.show}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
