/**
 * The leaderboard of one strategy (Bestenliste): the current version as the reference row, then the best variants by their
 * score on the TEST windows. Never the training number alone – the training part of the period is only named as a window.
 */
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import type { StrategySnapshot } from "@/domain/evolve";
import { dayShort, num, rText, toneOf } from "./fmt";
import { EVOLVE } from "./strings";

const L = EVOLVE.leaderboard;

export function WindowsStrip({ windows }: { windows: NonNullable<StrategySnapshot["windows"]> }) {
  const cells = [
    { label: L.windowTrain, w: windows.train, tone: "mute" as const },
    ...windows.tests.map((w, i) => ({ label: L.windowTest(i + 1), w, tone: "steel" as const })),
    { label: L.windowHold, w: windows.holdout, tone: "warn" as const },
  ];
  return (
    <div className="grid gap-1.5" data-testid="evolve-windows">
      <ol className="flex flex-wrap gap-1.5" aria-label={L.windowsTitle}>
        {cells.map((c) => (
          <li key={c.label} className="min-w-0">
            <Badge tone={c.tone} className="num">
              {c.label} · {dayShort(c.w.from)}–{dayShort(c.w.to)}
            </Badge>
          </li>
        ))}
      </ol>
      <p className="text-[11px] leading-relaxed text-faint">{L.windowsNote}</p>
    </div>
  );
}

export function Leaderboard({ snap }: { snap: StrategySnapshot }) {
  const b = snap.base;
  return (
    <div className="grid gap-2" data-testid="evolve-leaderboard" data-id={snap.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-[12.5px] font-semibold">{snap.name}</h4>
        <span className="text-[11px] text-faint">{L.sub}</span>
      </div>
      {b && (
        <div className="grid items-center gap-x-3 gap-y-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12px] sm:grid-cols-[minmax(0,1fr)_auto]" data-testid="evolve-base-row">
          <span className="min-w-0">
            <span className="font-medium">{L.current}</span>
            <span className="ml-2 whitespace-nowrap text-faint">{b.freedom} Freiheitsgrade</span>
          </span>
          <span className="num sm:text-right">
            {b.score != null ? `Score ${num(b.score)}` : "nicht gewertet"} · {b.n} Trades · <span className={toneOf(b.avgR)}>Ø {rText(b.avgR)}</span>
          </span>
        </div>
      )}
      {!snap.rows.length ? (
        <p className="text-[12px] text-faint">{L.none}</p>
      ) : (
        <ol className="grid gap-1.5">
          {snap.rows.map((r) => (
            <li key={r.key} className={cn("grid gap-1 rounded-xl border bg-ink-950/50 px-3 py-2 text-[12px]", r.gain > 0 ? "border-line-2" : "border-line")} data-testid="evolve-row" data-key={r.key} data-better={r.gain > 0 ? "yes" : "no"}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2">
                  <span className="num grid size-5 place-items-center rounded-full border border-line-2 text-[10.5px] text-mute">{r.rank}</span>
                  <span className="num font-medium">Score {num(r.score)}</span>
                  <span className={cn("num", r.gain > 0 ? "text-win" : "text-faint")}>{r.gain > 0 ? `+${num(r.gain)} besser` : `${num(r.gain)} (nicht besser)`}</span>
                </span>
                <span className="num text-mute">
                  {r.n} Trades · <span className={toneOf(r.avgR)}>Ø {rText(r.avgR)}</span> · {r.freedom} FG
                </span>
              </div>
              <ul className="grid gap-0.5 text-[11.5px] leading-snug text-mute">
                {r.changes.length ? r.changes.map((c) => <li key={c}>· {c}</li>) : <li>· (keine Änderung)</li>}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {b && snap.rows.length > 0 && snap.rows.every((r) => r.gain <= 0) && <p className="text-[12px] text-faint">{L.notBetter}</p>}
    </div>
  );
}
