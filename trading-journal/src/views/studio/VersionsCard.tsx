/**
 * "Entwürfe und Versionen": every saved change of the open strategy is a version (v1, v2 …) – text, answers and the rules as
 * they were understood then; an old version never changes its meaning. A version can be taken back into the editor, can carry
 * a note, and two versions can be compared: what changed in the rules (plain language) and the figures – the stored ones, or
 * both calculated now on the same candles, window and costs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { diffVersions, PERIOD_LABEL, type StoredStats, type StoredStrategy, type StudioVersion } from "@/domain/strategytext";
import { sanitizeSignalCfg } from "@/domain/signals";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { FieldRow, pctText, pfText, rText } from "@/views/labor/ui";
import { CompareTable, type RowLabel } from "./CompareTable";
import { runStudioCompare, StudioRunError, type StudioComparison } from "./runner";
import { useStudio } from "./studioStore";
import { noteVersion, putStats } from "./studioWrites";
import { STUDIO } from "./strings";
import { Bar, Disclaimer, dateTimeText, Mini } from "./ui";

const V = STUDIO.versions;

const statsLine = (s: StoredStats): string => `${s.n} Trades · Ø ${rText(s.avgR)} · ${s.winRate == null ? "–" : `${Math.round(s.winRate * 100)} %`} · PF ${pfText(s.pf)} · DD ${pctText(-s.maxDD, 0, false)}`;
const statsCtx = (s: StoredStats): string => `${s.symbol} · ${s.interval} · ${PERIOD_LABEL[s.period]} · ${dateTimeText(s.at)}`;

function NoteField({ id, v }: { id: string; v: StudioVersion }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft == null) return;
    if (draft.trim() !== v.note) void noteVersion(id, v.n, draft);
    setDraft(null);
  };
  return (
    <Input value={draft ?? v.note} maxLength={140} placeholder={V.notePlaceholder} aria-label={`${V.note_} zu v${v.n}`} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="text-[12.5px]" data-testid={`studio-note-${v.n}`} />
  );
}

function VersionRow({ st, v, latest }: { st: StoredStrategy; v: StudioVersion; latest: boolean }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid={`studio-version-${v.n}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-medium text-fg">v{v.n}</span>
        {latest && <span className="text-[10.5px] uppercase tracking-[0.08em] text-faint">neueste</span>}
        <span className="text-[12px] text-faint">{V.at(dateTimeText(v.at))}</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            const s = useStudio.getState();
            if (s.editor.id !== st.id) return;
            s.setEditor({ text: v.text, answers: v.answers });
            s.understand();
            pushToast({ kind: "info", title: V.restored(v.n) });
          }}
          data-testid={`studio-restore-${v.n}`}
        >
          {V.restore}
        </Button>
      </div>
      {v.stats ? (
        <p className="num font-mono text-[12px] text-mute" data-testid={`studio-version-stats-${v.n}`}>
          {statsLine(v.stats)}
          <span className="block text-[11px] text-faint">{statsCtx(v.stats)}</span>
        </p>
      ) : (
        <p className="text-[12px] text-faint">{V.noFigures}</p>
      )}
      <NoteField id={st.id} v={v} />
    </li>
  );
}

function Figure({ title, v }: { title: string; v: StudioVersion }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid={`studio-vcmp-${title}`}>
      <Mini>
        {title === "a" ? V.a : V.b} · v{v.n}
      </Mini>
      {v.stats ? (
        <p className="num font-mono text-[12.5px] text-fg">
          {statsLine(v.stats)}
          <span className="block text-[11px] text-faint">{statsCtx(v.stats)}</span>
        </p>
      ) : (
        <p className="text-[12.5px] text-mute">{V.noFigures}</p>
      )}
    </div>
  );
}

function Compare({ st }: { st: StoredStrategy }) {
  const vs = st.versions;
  const [pair, setPair] = useState<{ a: number; b: number } | null>(null);
  const a = vs.find((v) => v.n === (pair?.a ?? vs[vs.length - 2]?.n)) ?? vs[vs.length - 2];
  const b = vs.find((v) => v.n === (pair?.b ?? vs[vs.length - 1]?.n)) ?? vs[vs.length - 1];
  const key = `${st.id}:${a?.n}:${b?.n}`;
  interface Run {
    key: string;
    status: "idle" | "busy" | "done" | "error";
    progress: number;
    run: StudioComparison | null;
    error: string | null;
  }
  const [stored, setState] = useState<Run>({ key, status: "idle", progress: 0, run: null, error: null });
  // a different pair or a different strategy: an old table would not belong to it
  const state: Run = stored.key === key ? stored : { key, status: "idle", progress: 0, run: null, error: null };
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = ctl;
    return () => c.current?.abort();
  }, [key]);
  const diff = useMemo(() => (a && b && a.n !== b.n ? diffVersions(a, b) : []), [a, b]);
  if (!a || !b) return null;
  const options = vs.map((v) => ({ value: String(v.n), label: `v${v.n} · ${dateTimeText(v.at)}` }));
  const same = a.n === b.n;

  const runBoth = async (): Promise<void> => {
    if (same) return;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setState({ key, status: "busy", progress: 0, run: null, error: null });
    try {
      const run = await runStudioCompare({
        items: [
          { id: `v${a.n}`, name: `v${a.n}`, config: a.config },
          { id: `v${b.n}`, name: `v${b.n}`, config: b.config },
        ],
        symbol: st.symbol,
        period: st.period,
        signal: sanitizeSignalCfg(useJournal.getState().settings.signals),
        abort: mine.signal,
        extraTrials: 0,
        onProgress: (f) => {
          if (ctl.current === mine) setState((s) => ({ ...s, progress: f }));
        },
      });
      if (ctl.current !== mine) return;
      setState({ key, status: "done", progress: 1, run, error: null });
      // the figures belong to the versions: the next look needs no run
      for (const [v, id] of [[a, `v${a.n}`], [b, `v${b.n}`]] as const) {
        const row = run.result.rows.find((r) => r.id === id);
        if (row?.status === "ok" && row.all) {
          const f = row.all;
          await putStats(st.id, v.n, { n: f.n, winRate: f.winRate, avgR: f.avgR, pf: f.pf, maxDD: f.maxDD, netPct: f.netPct, symbol: st.symbol, interval: v.config.interval, period: st.period, at: run.at });
        }
      }
    } catch (e) {
      if (ctl.current !== mine) return;
      setState({ key, status: "error", progress: 0, run: null, error: e instanceof StudioRunError ? e.message : STUDIO.backtest.errors.failed });
    }
  };

  const labels: Record<string, RowLabel> = { [`v${a.n}`]: { name: `v${a.n}`, tag: V.a }, [`v${b.n}`]: { name: `v${b.n}`, tag: V.b } };
  return (
    <div className="grid gap-3 border-t border-line pt-4" data-testid="studio-vcmp">
      <Mini>{V.compare}</Mini>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow label={V.a} htmlFor="studio-vcmp-a">
          <MorphSelect id="studio-vcmp-a" value={String(a.n)} onChange={(v) => setPair({ a: Number(v), b: b.n })} options={options} wrap data-testid="studio-vcmp-a" />
        </FieldRow>
        <FieldRow label={V.b} htmlFor="studio-vcmp-b">
          <MorphSelect id="studio-vcmp-b" value={String(b.n)} onChange={(v) => setPair({ a: a.n, b: Number(v) })} options={options} wrap data-testid="studio-vcmp-b" />
        </FieldRow>
      </div>
      {same ? (
        <p className="text-[12.5px] text-mute">{V.sameVersion}</p>
      ) : (
        <>
          <div className="grid gap-1.5" data-testid="studio-vcmp-diff">
            <Mini>{V.diff}</Mini>
            {diff.length === 0 ? (
              <p className="text-[12.5px] text-mute">{V.noDiff}</p>
            ) : (
              <ul className="grid gap-1 text-[12.5px] text-fg/90">
                {diff.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Figure title="a" v={a} />
            <Figure title="b" v={b} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void runBoth()} disabled={state.status === "busy"} data-testid="studio-vcmp-run">
              {V.runBoth}
            </Button>
            <span className="text-[12px] text-faint">{V.sameData}</span>
          </div>
          {state.status === "busy" && <Bar fraction={state.progress} label={STUDIO.compare.running(Math.floor(state.progress * 100))} testId="studio-vcmp-progress" />}
          {state.error && (
            <p role="alert" className="text-[13px] text-(--color-danger-text)">
              {state.error}
            </p>
          )}
          {state.run && state.status === "done" && (
            <div className="grid gap-2" data-testid="studio-vcmp-result">
              <CompareTable result={state.run.result} labels={labels} />
              <p className="text-[11.5px] leading-snug text-faint">{state.run.result.multiple.text}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function VersionsCard({ strategies, className }: { strategies: StoredStrategy[]; className?: string }) {
  const id = useStudio((s) => s.editor.id);
  const st = strategies.find((s) => s.id === id);
  const list = st ? [...st.versions].reverse() : [];
  return (
    <Card title={V.title} note={V.note} className={className} data-testid="studio-versions">
      <div className="grid gap-4">
        {!st || list.length === 0 ? (
          <p className="text-[13px] text-mute" data-testid="studio-versions-empty">
            {V.empty}
          </p>
        ) : (
          <>
            <ol className="grid gap-2" aria-label={V.title}>
              {list.map((v, i) => (
                <VersionRow key={v.id} st={st} v={v} latest={i === 0} />
              ))}
            </ol>
            {st.versions.length >= 2 && <Compare st={st} />}
          </>
        )}
        <Disclaimer past />
      </div>
    </Card>
  );
}
