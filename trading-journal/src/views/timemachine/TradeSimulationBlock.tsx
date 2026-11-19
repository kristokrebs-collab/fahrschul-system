/**
 * „Gespeicherte Zeitmaschine“ at the trade (A3): the simulation that was saved for this trade – id, when, seed, model, the stand of
 * the candles, the key figures and where it is kept. It comes from IndexedDB, so a reload or a restart of the browser shows the same
 * simulation without a network. Nothing is shown for a trade that has none. A simulation, not a forecast.
 * Lazy chunk (the trade detail loads it with `lazy`); `onOpen` opens the sheet „Zeitmaschine für diesen Trade“.
 */
import { pc, rr } from "@/domain/timemachine";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { Button } from "@/primitives/Button";
import { useTradeSimulation } from "./simulations";
import { TM } from "./strings";

const when = (iso: string | number): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${fmtDate(d)} ${fmtTime(d)}` : "–";
};

export function TradeSimulationBlock({ tradeId, onOpen, className }: { tradeId: string; onOpen?: () => void; className?: string }) {
  const sim = useTradeSimulation(tradeId);
  if (sim.status !== "found") return null;
  const r = sim.record;
  const m = r.metrics;
  const S = TM.saved;
  const stored = r.sync === "synced" ? S.synced : r.sync === "pending" ? S.pending : S.local;
  return (
    <section className={cn("grid gap-2.5 rounded-2xl border border-line bg-ink-950/40 p-3.5", className)} aria-label="Gespeicherte Zeitmaschine" data-testid="trade-simulation" data-sim-id={r.simulationId} data-sync={r.sync}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">Gespeicherte Zeitmaschine</h3>
        <span className="num font-mono text-[11px] text-faint" data-testid="trade-simulation-when">
          {when(r.createdAt)}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-fg" data-testid="trade-simulation-verdict">
        {m.verdict}
      </p>
      <dl className="num grid grid-cols-3 gap-2 font-mono text-[12.5px]">
        {[
          [TM.odds.target, pc(m.targetP), "trade-simulation-target"],
          [TM.odds.stop, pc(m.stopP), "trade-simulation-stop"],
          ["Ø je Trade", rr(m.expectancyR), "trade-simulation-exp"],
        ].map(([label, value, id]) => (
          <div key={id} className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-950/50 px-2.5 py-2">
            <dt className="font-sans text-[10px] uppercase tracking-[0.06em] text-faint">{label}</dt>
            <dd className="whitespace-nowrap text-fg" data-testid={id}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="num break-all font-mono text-[11px] leading-snug text-mute" data-testid="trade-simulation-meta">
        {r.simulationId} · {S.seed} {r.seed} · {r.modelVersion} · {r.size.runs.toLocaleString("de-DE")} Läufe · Kerzen bis {r.dataToMs ? when(r.dataToMs) : "–"} · Hash {r.dataHash.slice(0, 12)}…
      </p>
      <p className="text-[11.5px] leading-snug text-mute" data-testid="trade-simulation-stored">
        {stored}. Eine Simulation ist keine Prognose.
      </p>
      {onOpen && (
        <Button size="sm" variant="secondary" onClick={onOpen} className="w-fit" data-testid="trade-simulation-open">
          Zeitmaschine öffnen
        </Button>
      )}
    </section>
  );
}

export default TradeSimulationBlock;
