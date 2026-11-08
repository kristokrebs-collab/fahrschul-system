/**
 * Labor · „1.000 Varianten. Eine bleibt.“: the real strategy search. Set-up (family, candle length, seed; market and period are the Versuchsaufbau's),
 * start / cancel, the running count in real numbers („412 von 1.000 geprüft“), the replay of the finished search on a canvas (the real curves, a scanner,
 * the best so far flashes mint, the others step back, the winner runs dashed into the final test), then the result card and the current candidate.
 * Own lazy chunk of `LaborView`. Works with real candles and with fixtures (`fixture` prop: tests, showroom – labelled as demo).
 * Reduced motion: end state at once; no loop; the stage height is reserved (no layout shift).
 */
import { useMemo, useState } from "react";
import type { SearchInterval } from "@/domain/lab/search";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { CandidateCard } from "./CandidateCard";
import { STAGE_H, SearchCanvas } from "./SearchCanvas";
import { SearchResultCard } from "./SearchResultCard";
import { cancelSearch, startSearch, useSearch, type FamilyChoice, type SearchFixture } from "./searchStore";
import { SEARCH } from "./strings";
import { sceneOf } from "./timeline";
import { useLabor } from "../laborStore";
import { LABOR } from "../strings";
import { FieldRow } from "../ui";

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

const phaseText = (phase: string): string => (SEARCH.phase as Record<string, string>)[phase] ?? SEARCH.phase.load;

function Busy() {
  const status = useSearch((s) => s.status);
  const load = useSearch((s) => s.load);
  const checked = useSearch((s) => s.checked);
  const progress = useSearch((s) => s.progress);
  const loading = status === "loading";
  const pct = Math.max(0, Math.min(99, Math.floor(progress * 100)));
  const line = loading ? SEARCH.loading(load.done, load.total) : checked.phase === "score" || checked.phase === "prepare" ? SEARCH.checked(checked.done, checked.total) : phaseText(checked.phase);
  const sub = loading ? SEARCH.phase.load : phaseText(checked.phase);
  return (
    <div className="absolute inset-0 grid place-items-center p-4" data-testid="search-busy">
      {/* a progressbar, never a live region (the toast island is the only one) */}
      <div className="grid justify-items-center gap-3 text-center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${line}. ${sub}`} aria-label="Strategiesuche läuft">
        <span className="dot-num num text-[34px] font-extrabold leading-none text-fg" style={{ fontSize: "clamp(28px, 7vw, 48px)" }} data-testid="search-count">
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
  const busy = status === "loading" || status === "running";
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
  const stageLabel = result ? SEARCH.stageLabel(result.counts.variants, result.winner?.variant.id ?? null) : SEARCH.title;
  const seedValid = /^\d{1,10}$/.test(seedText) && Number(seedText) <= 4_294_967_295;
  const sameFamilyHint = cfg.family !== "orb";
  const sameMarket = saved.filter((s) => s.datasets[0]?.symbol === lab.symbol).length;
  const ready = !result || (doneKey >= runSeq * 1000 && doneKey < (runSeq + 1) * 1000);
  const start = () => void startSearch({ fixture });

  return (
    <div className="grid gap-5" data-testid="search-section" data-status={status}>
      <Card title={SEARCH.title} note={SEARCH.sub} data-testid="search-card">
        <div className="grid gap-4">
          <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute">{SEARCH.lead}</p>
          <p className="max-w-[72ch] text-[12.5px] font-medium leading-snug text-fg">{SEARCH.bias}</p>
          {fixture && (
            <p className="text-[12px] font-semibold text-fg" data-testid="search-fixture-note">
              {SEARCH.demo}.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
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
          </div>
          {!fixture && <p className="text-[12px] text-faint">{SEARCH.setupLine(lab.symbol, period)}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Button size="md" variant="secondary" onClick={cancelSearch} data-testid="search-cancel">
                {SEARCH.cancel}
              </Button>
            ) : (
              <Button size="md" variant="primary" fx={false} onClick={start} disabled={!seedValid} data-testid="search-start">
                {summary ? SEARCH.again : SEARCH.start}
              </Button>
            )}
            {result && !done && (
              <Button size="md" variant="ghost" onClick={() => setSkip((n) => n + 1)} data-testid="search-skip">
                {SEARCH.skip}
              </Button>
            )}
            {result && done && (
              <Button size="md" variant="ghost" onClick={() => setReplay((n) => n + 1)} data-testid="search-replay">
                {SEARCH.replay}
              </Button>
            )}
          </div>

          {/* the stage: its height is fixed, so nothing below moves while it changes */}
          <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-950/50" style={{ height: STAGE_H }} data-testid="search-stage-box">
            {busy ? (
              <Busy />
            ) : scene ? (
              <SearchCanvas scene={scene} playKey={playKey} skipKey={skip} label={stageLabel} onDone={setDoneKey} />
            ) : (
              <div className="absolute inset-0 grid place-items-center overflow-y-auto p-5 text-center">
                <p role={status === "error" ? "alert" : undefined} className={cn("max-w-[48ch] text-[13px]", status === "error" ? "text-(--color-danger-text)" : "text-mute")} data-testid="search-stage-text">
                  {status === "error" || status === "cancelled" ? error : summary ? SEARCH.restored : SEARCH.stageIdle}
                </p>
              </div>
            )}
          </div>
          {result && <p className="text-[11.5px] leading-snug text-faint">{SEARCH.replayNote}</p>}

          {summary && !busy && (
            <div style={{ visibility: ready ? "visible" : "hidden" }} aria-hidden={!ready} data-ready={ready ? "true" : "false"} data-testid="search-result-wrap">
              <SearchResultCard summary={summary} />
            </div>
          )}
          {stats && !busy && <span className="sr-only" data-testid="search-counts" data-variants={stats.variants} data-is-runs={stats.isRuns} data-oos-runs={stats.oosRuns} />}
        </div>
      </Card>
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
