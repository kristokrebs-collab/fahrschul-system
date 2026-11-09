/**
 * Kosten- und Belastungstest (F20): the scenario table (the same run, one thing worse, side by side – computed on demand by
 * the extra job) and the loss-series stress test from the real trade order (instant, no new run). A scenario that needs data
 * the run does not have is NOT blocked: it runs with a named substitute (badge „Ersatz“) or says why it could not.
 */
import { useMemo } from "react";
import { lossStreakStress, MC_SEED, type ScenarioRow, type StreakStress, type TradeSpan } from "@/domain/lab/stress";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Block, dayText, deltaTone, Kv, ppText, RunBar, ScrollTable, signedText, TH, THL } from "./ExtraParts";
import { cancelExtra, runStress, useExtras } from "./extrasStore";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { numText, pctText, pfText, rText } from "./ui";

const X = LABOR.extras;
const S = X.stress;

export default function StressBody() {
  const result = useLabor((s) => s.result);
  const slice = useExtras((s) => s.stress);
  if (!result) return null;
  const rows = slice.result?.rows ?? [];
  const n = rows[0]?.stats?.n ?? result.stats.n;
  return (
    <div className="grid gap-5" data-testid="labor-stress">
      <Block title={S.title} sub={S.note} id="labor-stress-scenarios">
        <RunBar slice={slice} onRun={() => void runStress()} onCancel={() => cancelExtra("stress")} label="Szenarien rechnen" id="labor-stress" hint={X.prepNote} />
        {slice.status === "done" && rows.length > 0 && <ScenarioTable rows={rows} />}
        {slice.status === "done" && rows.length > 0 && <p className="text-[11.5px] leading-snug text-faint">{n < 20 ? S.few(n) : S.same}</p>}
        {slice.status === "done" && rows.length > 0 && <p className="text-[11.5px] leading-snug text-faint">{S.foot}</p>}
      </Block>
      <StreakBlock />
    </div>
  );
}

function ScenarioTable({ rows }: { rows: ScenarioRow[] }) {
  return (
    <ScrollTable label={S.table} min="40rem" testId="labor-stress-table">
      <thead>
        <tr>
          <th className={THL}>{S.scenario}</th>
          <th className={TH}>{S.trades}</th>
          <th className={TH}>{S.netR}</th>
          <th className={TH}>{S.dNetR}</th>
          <th className={TH}>{S.dd}</th>
          <th className={TH}>{S.dDd}</th>
          <th className={TH}>{S.pf}</th>
          <th className={TH}>{S.dPf}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={cn("border-t border-line align-top", r.id === "base" && "bg-white/[0.03]")} data-testid="labor-stress-row" data-scenario={r.id} data-status={r.status}>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium text-fg/90">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {r.label}
                {r.status === "approx" && (
                  <Badge tone="warn" title={S.approxTitle}>
                    {S.approx}
                  </Badge>
                )}
                {r.status === "unavailable" && <Badge tone="mute">{S.unavailable}</Badge>}
              </span>
              {r.note && <span className="mt-0.5 block max-w-[34rem] whitespace-normal text-[11px] font-normal leading-snug text-faint">{r.note}</span>}
            </th>
            {r.stats ? (
              <>
                <td className="num py-1.5 text-right font-mono">{r.stats.n}</td>
                <td className={cn("num py-1.5 text-right font-mono", r.stats.sumR > 0 ? "text-win" : r.stats.sumR < 0 ? "text-loss" : "")}>{rText(r.stats.sumR)}</td>
                <td className={cn("num py-1.5 text-right font-mono", deltaTone(r.dSumR, true, 0.005))}>{r.id === "base" ? "–" : signedText(r.dSumR)}</td>
                <td className="num py-1.5 text-right font-mono">{pctText(r.stats.maxDD, 1, false)}</td>
                <td className={cn("num py-1.5 text-right font-mono", deltaTone(r.dMaxDD, false, 0.0005))}>{r.id === "base" ? "–" : ppText(r.dMaxDD)}</td>
                <td className="num py-1.5 text-right font-mono">{pfText(r.stats.pf)}</td>
                <td className={cn("num py-1.5 text-right font-mono", deltaTone(r.dPf, true, 0.005))}>{r.id === "base" ? "–" : signedText(r.dPf)}</td>
              </>
            ) : (
              <td colSpan={7} className="py-1.5 text-right text-[11.5px] text-faint">
                –
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

const span = (s: TradeSpan): string => S.streaks.span(dayText(s.fromTime), dayText(s.toTime), s.trades);

function StreakBlock() {
  const result = useLabor((s) => s.result);
  const runCfg = useLabor((s) => s.runCfg);
  const t = S.streaks;
  const st: StreakStress | null = useMemo(() => (result ? lossStreakStress(result.trades, runCfg?.riskPct ?? 1) : null), [result, runCfg]);
  if (!st) return null;
  if (!st.n) return <Block title={t.title} sub={t.sub} id="labor-streaks"><p className="text-[12.5px] text-mute">{LABOR.noTrades}</p></Block>;
  return (
    <Block title={t.title} sub={`${t.sub} · ${st.n} Trades`} id="labor-streaks">
      <dl className="grid gap-0">
        <Kv
          k={
            <>
              {t.longest}
              {st.longestLosing && <span className="block text-[11px] text-faint">{span(st.longestLosing)}</span>}
            </>
          }
          v={st.longestLosing ? `${st.longestLosing.trades} Trades · ${rText(st.longestLosing.sumR)}` : t.none}
        />
        {st.worstWindows.map((w) => (
          <Kv
            key={w.k}
            k={
              <>
                {t.worst(w.k)}
                <span className="block text-[11px] text-faint">{span(w.span)}</span>
              </>
            }
            v={rText(w.span.sumR)}
          />
        ))}
        <Kv
          k={
            <>
              {t.dd}
              {st.drawdownR && <span className="block text-[11px] text-faint">{span(st.drawdownR.span)}</span>}
            </>
          }
          v={st.drawdownR ? `${numText(st.drawdownR.depth)} R${st.drawdownShare != null ? ` · ≈ ${pctText(st.drawdownShare, 1, false)}` : ""}` : "kein Rückgang"}
        />
      </dl>
      {st.drawdownShare != null && <p className="text-[11px] text-faint">{t.ddShare(runCfg?.riskPct ?? 1)}</p>}
      <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="labor-mc">
        <h4 className="text-[12.5px] font-semibold">{t.mcTitle}</h4>
        {st.mc ? (
          <>
            <p className="text-[11.5px] leading-snug text-faint">{t.mcNote(st.mc.runs, MC_SEED)}</p>
            <dl className="grid gap-0">
              <Kv k={t.mcDd} v={`${numText(st.mc.ddP50)} / ${numText(st.mc.ddP95)} / ${numText(st.mc.ddP99)} R`} />
              <Kv k={t.mcStreak} v={`${numText(st.mc.streakP50, 0)} / ${numText(st.mc.streakP95, 0)}`} />
            </dl>
            <p className="text-[12px] leading-snug text-fg/90" data-testid="labor-mc-place">
              {t.mcPlace(st.mc.shareAtLeastReal)} {st.mc.shareAtLeastReal < 0.05 ? t.mcPlaceLow : st.mc.shareAtLeastReal > 0.5 ? t.mcPlaceHigh : ""}
            </p>
          </>
        ) : (
          <p className="text-[12.5px] text-mute" data-testid="labor-mc-none">
            {st.mcNote}
          </p>
        )}
      </div>
    </Block>
  );
}
