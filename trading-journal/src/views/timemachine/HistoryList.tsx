/**
 * The earlier occasions of the set-up as a list: entry time, how it ended (shape + word, never colour alone), how long, the
 * result in R and under it the largest move against the position before the exit („Gegenzug“). Three columns so a phone shows
 * every row whole. Newest first; the first rows are shown, the rest on request. Every row is something that really happened in
 * the candles the card was given.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { durationText, rr, type TmEvent, type TmInterval } from "@/domain/timemachine";
import { EXIT_GLYPH, EXIT_WORD, TM } from "./strings";

const FIRST = 8;
const CAP = 400;

export function HistoryList({ events, interval }: { events: readonly TmEvent[]; interval: TmInterval }) {
  const [all, setAll] = useState(false);
  const newest = [...events].reverse();
  const rows = all ? newest.slice(0, CAP) : newest.slice(0, FIRST);
  if (!events.length) return null;
  return (
    <div className="grid gap-2" data-testid="tm-events">
      <table className="w-full table-fixed border-collapse text-left text-[12px]">
        <caption className="sr-only">Frühere Vorfälle, neueste zuerst</caption>
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
            <th scope="col" className="w-[24%] py-1 pr-2 font-semibold">{TM.history.colWhen}</th>
            <th scope="col" className="w-[34%] py-1 pr-2 font-semibold">{TM.history.colEnd}</th>
            <th scope="col" className="w-[42%] py-1 text-right font-semibold">{TM.history.colR}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.i}-${e.entryT}`} className="border-t border-line align-top" data-testid="tm-event" data-reason={e.reason}>
              <td className="num py-1.5 pr-2 font-mono text-[11.5px] leading-snug text-mute">
                {fmtDate(new Date(e.entryT))}
                <span className="block">{fmtTime(new Date(e.entryT))}</span>
              </td>
              <td className="py-1.5 pr-2">
                <span className="whitespace-nowrap text-fg">
                  <span aria-hidden="true" className="mr-1 text-mute">
                    {EXIT_GLYPH[e.reason]}
                  </span>
                  {EXIT_WORD[e.reason]}
                </span>
                <span className="block text-[11px] leading-snug text-faint">{durationText(e.bars, interval)}</span>
              </td>
              <td className="num py-1.5 text-right font-mono">
                <span className={cn("whitespace-nowrap text-[12.5px]", e.r > 0 ? "text-win" : e.r < 0 ? "text-loss" : "text-fg")}>{rr(e.r)}</span>
                <span className="block whitespace-nowrap text-[11px] text-faint">
                  {TM.history.colMae} {rr(-e.mae)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > FIRST && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="w-fit rounded-full border border-line-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-white/40 pointer-coarse:min-h-11" data-testid="tm-events-toggle">
          {all ? TM.history.showLess : TM.history.showAll(events.length)}
        </button>
      )}
      {all && events.length > CAP && <p className="text-[11.5px] text-faint">Gezeigt werden die neuesten {CAP}.</p>}
      <p className="text-[11px] leading-snug text-faint">{TM.history.maeNote}</p>
    </div>
  );
}
