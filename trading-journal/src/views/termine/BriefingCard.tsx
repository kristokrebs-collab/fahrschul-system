/**
 * Karte „Heute wichtig“ (F43): the Morgenbriefing. One page of what the app itself knows for today – appointments, movement of
 * the markets and the watchlist, key levels and plan, alarms, open check-in points – each line with its source and time,
 * what is missing as „keine Daten“. It reads the stores the other cards read (live ticker, daily candles of the watchlist,
 * key levels, the Zustellprotokoll, the day journal); nothing is estimated, nothing is sent, no trade is suggested.
 */
import { useMemo, useState } from "react";
import { buildBriefing, type BriefingLine, type BriefingTone } from "@/domain/events";
import { formatClock, offsetLabel } from "@/domain/events/zone";
import { cn } from "@/lib/cn";
import { useDeliveryLog } from "@/market/keylevels";
import { useKeyLevels } from "@/market/keylevels/store";
import { useMultiDaily } from "@/market/multiDaily";
import { useFeed } from "@/market/marketStore";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { Button } from "@/primitives/Button";
import { briefingInputOf, briefingSymbols } from "./briefingInput";
import { useZone } from "./prefs";
import { BRIEFING as B } from "./strings";
import { useNowMinute } from "./useNow";

const DOT: Record<BriefingTone, string> = { win: "bg-win", loss: "bg-loss", warn: "bg-warn", mute: "bg-faint", fg: "bg-steel" };

function Line({ line, tz }: { line: BriefingLine; tz: string }) {
  return (
    <li className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3" data-testid="briefing-line" data-missing={line.missing ? "true" : undefined}>
      <span aria-hidden="true" className={cn("mt-[0.45rem] size-1.5 rounded-full", DOT[line.tone])} />
      <span className="grid min-w-0 gap-0.5">
        <span className={cn("text-[13px] leading-snug", line.missing ? "text-mute" : "text-fg")}>{line.text}</span>
        <span className="text-[11px] leading-snug text-faint" data-testid="briefing-source">
          {B.source}: {line.source} · {line.at != null ? `${formatClock(line.at, tz)} Uhr` : B.noTime}
        </span>
      </span>
    </li>
  );
}

/** Lines of a section shown at first; the rest sits behind one button (eight markets that move alike are one long list). */
const SHOW_LINES = 4;

function Section({ id, title, lines, tz }: { id: string; title: string; lines: readonly BriefingLine[]; tz: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, SHOW_LINES);
  return (
    <section aria-label={title} className="grid gap-2" data-testid={`briefing-${id}`}>
      <h3 className="label">{title}</h3>
      <ul className="grid gap-2.5">
        {shown.map((l, i) => (
          <Line key={`${id}-${i}`} line={l} tz={tz} />
        ))}
      </ul>
      {lines.length > SHOW_LINES && (
        <Button size="sm" className="w-fit pointer-coarse:min-h-11" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? B.fewerLines : B.moreLines(lines.length)}
        </Button>
      )}
    </section>
  );
}

export function BriefingCard() {
  const tz = useZone();
  const now = useNowMinute();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  const keyLevels = useKeyLevels();
  const ticker = useFeed("ticker24h");
  const log = useDeliveryLog();
  const symbols = useMemo(() => briefingSymbols(settings, keyLevels.symbol), [settings, keyLevels.symbol]);
  const daily = useMultiDaily(symbols);
  const briefing = useMemo(() => buildBriefing(briefingInputOf({ now, tz, settings, days, ticker, liveSymbol: keyLevels.symbol, daily, keyLevels, log })), [now, tz, settings, days, ticker, keyLevels, daily, log]);
  return (
    <Card title={B.title} note={B.note} data-testid="briefing-card">
      <div className="grid gap-5">
        {briefing.sections.map((s) => (
          <Section key={s.id} id={s.id} title={s.title} lines={s.lines} tz={tz} />
        ))}
        <p className="text-[11.5px] leading-snug text-faint" data-testid="briefing-stand">
          {B.stand(formatClock(briefing.generatedAt, tz), `${tz}, ${offsetLabel(briefing.generatedAt, tz)}`)} · {B.note2}
        </p>
      </div>
    </Card>
  );
}
