/**
 * The protocol drawer ("Versuchsprotokoll"): every tested variant of a strategy with its score, time and seed, the failed ones
 * too. Device-local, with an upper limit and rotation (`@/domain/evolve` `protocol.ts`); the counter of all tested variants never
 * shrinks. A lazy chunk – it loads when the drawer opens.
 */
import { useMemo, useState } from "react";
import type { LogBook } from "@/domain/evolve";
import { cn } from "@/lib/cn";
import { Sheet } from "@/motion/Sheet";
import { Badge } from "@/primitives/Badge";
import { num, rText, stampText, toneOf } from "./fmt";
import { EVOLVE } from "./strings";

const Pr = EVOLVE.protocol;
const SHOWN = 120;

export default function ProtocolSheet({ open, onClose, book, names }: { open: boolean; onClose: () => void; book: LogBook; names: Readonly<Record<string, string>> }) {
  const ids = Object.keys(book);
  const [pick, setPick] = useState<string | null>(null);
  const [order, setOrder] = useState<"new" | "best">("new");
  const sid = pick && book[pick] ? pick : (ids[0] ?? null);
  const log = sid ? book[sid] : undefined;
  const rows = useMemo(() => {
    const es = [...(log?.entries ?? [])];
    if (order === "new") return es.reverse().slice(0, SHOWN);
    return es.filter((e) => e.score != null).sort((a, b) => b.score! - a.score!).slice(0, SHOWN);
  }, [log, order]);
  return (
    <Sheet open={open} onClose={onClose} title={Pr.title} size="md" dismissGuard={false}>
      <div className="grid gap-3 pb-2" data-testid="evolve-protocol">
        <p className="text-[12.5px] leading-relaxed text-mute">{Pr.lead}</p>
        {ids.length > 1 && (
          <div role="radiogroup" aria-label="Strategie" className="flex flex-wrap gap-1.5">
            {ids.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={id === sid} onClick={() => setPick(id)} className={cn("min-h-9 rounded-full border px-3 text-[12px] font-medium pointer-coarse:min-h-11", id === sid ? "border-white/60 text-fg" : "border-line-2 text-mute")}>
                {names[id] ?? id}
              </button>
            ))}
          </div>
        )}
        {log ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="num text-[12px] text-mute" data-testid="evolve-protocol-total">
                {Pr.totals(log.total, log.dropped, log.entries.length)}
              </p>
              <div role="radiogroup" aria-label="Sortierung" className="flex gap-1.5">
                {(["new", "best"] as const).map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={order === o} onClick={() => setOrder(o)} className={cn("min-h-9 rounded-full border px-3 text-[12px] font-medium pointer-coarse:min-h-11", order === o ? "border-white/60 text-fg" : "border-line-2 text-mute")}>
                    {o === "new" ? Pr.newest : Pr.best}
                  </button>
                ))}
              </div>
            </div>
            <ol className="grid gap-1.5" data-testid="evolve-protocol-list">
              {rows.map((e) => (
                <li key={`${e.seed}-${e.i}-${e.key}-${e.via}-${e.at}`} className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12px]" data-testid="evolve-protocol-row" data-via={e.via}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="num text-faint">
                      {stampText(e.at)} · Nr. {e.i} · Seed {e.seed}
                    </span>
                    <Badge tone={e.via === "baseline" ? "steel" : e.via === "neighbor" ? "mute" : "teal"}>{Pr.via[e.via]}</Badge>
                  </div>
                  <p className="leading-snug">{e.text || "–"}</p>
                  <p className="num text-mute">
                    {e.score != null ? `Score ${num(e.score)}` : Pr.unqualified} · {e.n} Trades · <span className={toneOf(e.avgR)}>Ø {rText(e.avgR)}</span>
                  </p>
                </li>
              ))}
            </ol>
            <p className="text-[11.5px] leading-relaxed text-faint">{Pr.reproduce}</p>
          </>
        ) : (
          <p className="text-[12.5px] text-faint">{Pr.empty}</p>
        )}
      </div>
    </Sheet>
  );
}
