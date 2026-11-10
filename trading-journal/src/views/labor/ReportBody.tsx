/**
 * Strategie-Prüfbericht (F18): what the other robustness cards do not say – dependence on a few trades, data holes, the
 * signals' fate, and which stretches of the period were tested unseen. Computed instantly from the shown run (`auditRun`);
 * the Labor's overfitting verdict, walk-forward and parameter stability are linked, not repeated.
 */
import { useMemo } from "react";
import { auditRun, type Audit, type OutlierRow } from "@/domain/lab/report";
import { cn } from "@/lib/cn";
import { n0 } from "@/lib/format";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Block, dayText, Kv, ScrollTable, TH, THL } from "./ExtraParts";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { pctText, pfText, rText } from "./ui";

const R = LABOR.extras.report;
const VERDICT_TONE: Record<Audit["outliers"]["verdict"], BadgeTone> = { tragfaehig: "mute", abhaengig: "warn", verlust: "mute", zuwenig: "warn" };

export function useAudit(): Audit | null {
  const result = useLabor((s) => s.result);
  const bars = useLabor((s) => s.bars);
  return useMemo(() => (result ? auditRun(result, bars) : null), [result, bars]);
}

export default function ReportBody() {
  const a = useAudit();
  if (!a) return null;
  return (
    <div className="grid gap-5" data-testid="labor-report">
      <p className="text-[12.5px] leading-relaxed text-mute">{R.note}</p>
      <Outliers a={a} />
      <DataBlock a={a} />
      <SignalsBlock a={a} />
      <PeriodsBlock a={a} />
    </div>
  );
}

function Outliers({ a }: { a: Audit }) {
  const o = a.outliers;
  const t = R.outliers;
  const label = (r: OutlierRow) => (r.kind === "best" ? t.best(r.k) : t.worst(r.k));
  return (
    <Block title={t.title} sub={`${t.sub} · ${o.n} Trades`} id="labor-outliers">
      {o.rows.length > 0 && (
        <ScrollTable label={t.title} min="32rem" testId="labor-outlier-table">
          <thead>
            <tr>
              <th className={THL}>{t.row}</th>
              <th className={TH}>{t.trades}</th>
              <th className={TH}>{t.netR}</th>
              <th className={TH}>{t.avgR}</th>
              <th className={TH}>{t.pf}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line bg-white/[0.03]">
              <th scope="row" className="py-1.5 text-left font-medium">
                {t.all}
              </th>
              <td className="num py-1.5 text-right font-mono">{o.n}</td>
              <td className="num py-1.5 text-right font-mono">{rText(o.sumR)}</td>
              <td className="num py-1.5 text-right font-mono">{rText(o.avgR)}</td>
              <td className="num py-1.5 text-right font-mono">{pfText(o.pf)}</td>
            </tr>
            {o.rows.map((r) => (
              <tr key={`${r.kind}${r.k}`} className="border-t border-line" data-testid="labor-outlier-row" data-kind={r.kind} data-k={r.k}>
                <th scope="row" className="py-1.5 pr-2 text-left font-medium text-fg/90">
                  {label(r)}
                  {r.thin && (
                    <span className="block text-[11px] font-normal text-faint" title={t.thin}>
                      {t.thin}
                    </span>
                  )}
                </th>
                <td className="num py-1.5 text-right font-mono">{r.remainN}</td>
                <td className={cn("num py-1.5 text-right font-mono", r.flipsSign && "text-warn")}>{rText(r.remainSumR)}</td>
                <td className="num py-1.5 text-right font-mono">{rText(r.remainAvgR)}</td>
                <td className="num py-1.5 text-right font-mono">{pfText(r.remainPf)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={VERDICT_TONE[o.verdict]}>{t.verdict[o.verdict]}</Badge>
        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg/90" data-testid="labor-outlier-text">
          {o.text}
        </p>
      </div>
    </Block>
  );
}

function DataBlock({ a }: { a: Audit }) {
  const d = a.data;
  const t = R.data;
  return (
    <Block title={t.title} sub={t.sub} id="labor-datagaps">
      <dl className="grid gap-0">
        <Kv k={t.candles} v={`${n0(d.expected)} / ${n0(d.received)}${d.receivedShare != null ? ` · ${pctText(d.receivedShare, 0, false)}` : ""}`} />
        <Kv k={t.gaps} v={d.gaps ? `${d.gaps} (${n0(d.missing)})` : t.none} tone={d.gaps ? "text-warn" : undefined} />
        <Kv k={t.warmup} v={`${n0(d.warmupWanted)} / ${n0(d.warmupGot)}`} tone={d.warmupGot < d.warmupWanted ? "text-warn" : undefined} />
        {d.tradesOverGap != null && <Kv k={t.over} v={`${d.tradesOverGap} von ${a.n}`} tone={d.tradesOverGap ? "text-warn" : undefined} />}
      </dl>
      {d.rows.length > 1 && (
        <ScrollTable label={t.tf} min="20rem">
          <thead>
            <tr>
              <th className={THL}>{t.tf}</th>
              <th className={TH}>{t.loaded}</th>
              <th className={TH}>{t.gaps}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.interval} className="border-t border-line">
                <th scope="row" className="py-1.5 text-left font-medium text-fg/90">
                  {r.interval === "1d" ? "1D" : r.interval}
                </th>
                <td className="num py-1.5 text-right font-mono">{n0(r.bars)}</td>
                <td className="num py-1.5 text-right font-mono">{r.gaps ? `${r.gaps} (${n0(r.missing)})` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {d.spans.length > 0 && (
        <div className="grid gap-1" data-testid="labor-gap-list">
          <h4 className="text-[12px] font-semibold text-mute">{t.biggest}</h4>
          <ul className="grid gap-0.5">
            {d.spans.map((g) => (
              <li key={g.fromMs} className="num font-mono text-[12px] text-fg/90">
                {dayText(g.fromMs)} bis {dayText(g.toMs)} · {t.missing(g.missing)}
              </li>
            ))}
            {d.spanCount > d.spans.length && <li className="text-[11.5px] text-faint">{t.more(d.spanCount - d.spans.length)}</li>}
          </ul>
        </div>
      )}
      <ul className="grid gap-1">
        {d.notes.map((n) => (
          <li key={n} className="text-[12px] leading-snug text-mute">
            {n}
          </li>
        ))}
      </ul>
    </Block>
  );
}

function SignalsBlock({ a }: { a: Audit }) {
  const s = a.signals;
  const t = R.signals;
  const v = (x: number | null): string => (x == null ? t.unknown : n0(x));
  return (
    <Block title={t.title} sub={t.sub} id="labor-signals">
      <dl className="grid gap-0">
        <Kv k={t.examined} v={n0(s.examined)} />
        {s.edges != null && <Kv k={t.edges} v={v(s.edges)} />}
        {s.conflicts ? <Kv k={t.conflicts} v={v(s.conflicts)} /> : null}
        {s.candidates != null && <Kv k={t.candidates} v={v(s.candidates)} />}
        {s.blockedByPosition ? <Kv k={t.blocked} v={v(s.blockedByPosition)} /> : null}
        <Kv k={t.handed} v={n0(s.handed)} />
        {s.skippedGap > 0 && <Kv k={t.skippedGap} v={n0(s.skippedGap)} />}
        {s.skippedRisk > 0 && <Kv k={t.skippedRisk} v={n0(s.skippedRisk)} />}
        <Kv k={t.executed} v={n0(s.executed)} />
        <Kv k={t.late} v={t.lateValue} tone="text-mute" />
      </dl>
      <p className="text-[12px] leading-snug text-mute" data-testid="labor-late-text">
        {s.late.text}
      </p>
    </Block>
  );
}

function Seg({ share, className, label }: { share: number; className: string; label: string }) {
  if (!(share > 0)) return null;
  return (
    <span className={cn("grid h-6 min-w-0 place-items-center overflow-hidden whitespace-nowrap text-[10.5px] font-medium", className)} style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} title={`${label} · ${Math.round(share * 100)} %`}>
      {share >= 0.14 ? label : ""}
    </span>
  );
}

function PeriodsBlock({ a }: { a: Audit }) {
  const p = a.periods;
  const t = R.periods;
  const wf = p.walkForward;
  return (
    <Block title={t.title} sub={`${t.sub} · ${dayText(p.from)} bis ${dayText(p.to)}`} id="labor-periods">
      <div className="grid gap-3">
        {wf && (
          <div className="grid gap-1" data-testid="labor-period-wf">
            <span className="text-[11px] text-faint">{t.walkForward}</span>
            <span className="flex overflow-hidden rounded-md border border-line" role="img" aria-label={`${t.walkForward}: ${Math.round((wf.trainOnlyShare ?? 0) * 100)} % ${t.trainOnly}, ${Math.round((wf.testShare ?? 0) * 100)} % ${t.tested}`}>
              <Seg share={wf.trainOnlyShare ?? 0} label={t.trainOnly} className="bg-white/[0.06] text-mute" />
              <Seg share={wf.testShare ?? 0} label={t.tested} className="bg-white/[0.2] text-fg" />
            </span>
            <span className="text-[11.5px] text-faint">{wf.emptyWindows > 0 ? t.emptyWindows(wf.emptyWindows, wf.windows) : `${wf.testTrades} Trades in ${wf.windows} Test-Fenstern`}</span>
          </div>
        )}
        {p.oos.share != null && (
          <div className="grid gap-1" data-testid="labor-period-oos">
            <span className="text-[11px] text-faint">{t.oos}</span>
            <span className="flex overflow-hidden rounded-md border border-line" role="img" aria-label={`${t.oos}: ${Math.round((1 - p.oos.share) * 100)} % ${t.selection}, ${Math.round(p.oos.share * 100)} % ${t.unseen}`}>
              <Seg share={1 - p.oos.share} label={t.selection} className="bg-white/[0.06] text-mute" />
              <Seg share={p.oos.share} label={t.unseen} className={p.oos.used ? "bg-white/[0.2] text-fg" : "border-l border-dashed border-line-2 text-faint"} />
            </span>
            {p.oos.n != null && <span className="text-[11.5px] text-faint">{t.oosTrades(p.oos.n)}</span>}
          </div>
        )}
      </div>
      {p.quiet.length > 0 && (
        <div className="grid gap-1" data-testid="labor-quiet">
          <h4 className="text-[12px] font-semibold text-mute">{t.quiet}</h4>
          <ul className="grid gap-0.5">
            {p.quiet.map((q) => (
              <li key={q.fromMs} className="num font-mono text-[12px] text-fg/90">
                {t.quietRow(dayText(q.fromMs), dayText(q.toMs), q.days, q.share)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1" data-testid="labor-thirds">
        <h4 className="text-[12px] font-semibold text-mute">{t.thirds}</h4>
        <p className="text-[11.5px] text-faint">{t.thirdsNote}</p>
        <dl className="grid gap-0">
          {p.thirds.map((x, k) => (
            <Kv key={x.from} k={`${t.third(k + 1)} · ${dayText(x.from)}`} v={`${x.n} Trades · ${rText(x.sumR)}`} />
          ))}
        </dl>
      </div>
      <ul className="grid gap-1">
        {p.notes.map((n) => (
          <li key={n} className="text-[12px] leading-snug text-mute">
            {n}
          </li>
        ))}
      </ul>
      <div className="grid gap-1 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="labor-report-robust">
        <h4 className="text-[12px] font-semibold">
          {t.robust}: {a.robust.text}
        </h4>
        <p className="text-[11.5px] text-faint">{t.robustNote}</p>
      </div>
    </Block>
  );
}
