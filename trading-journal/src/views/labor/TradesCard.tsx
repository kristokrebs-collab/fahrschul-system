/**
 * Trades of the run (P07): newest first, each row opens the replay of that trade (`LabReplayHost`). Rows rise in on
 * first view (`RevealGroup`, capped stagger); the first `LIST_MAX` are shown, the rest behind "+ N weitere".
 */
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { EXIT_LABEL, type BtTrade } from "@/domain/backtest/index";
import { cn } from "@/lib/cn";
import { date as fmtDate, price as fmtPrice } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { usePressable } from "@/motion/usePressable";
import { radius } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { rText } from "./ui";

export const LIST_MAX = 30;

export function TradesCard({ className }: { className?: string }) {
  const result = useLabor((s) => s.result);
  const runSeq = useLabor((s) => s.runSeq);
  const openReplay = useLabor((s) => s.openReplay);
  const [all, setAll] = useState(false);
  const trades = useMemo(() => [...(result?.trades ?? [])].reverse(), [result]);
  const shown = all ? trades : trades.slice(0, LIST_MAX);
  const press = usePressable({ scale: 0.985 });
  if (!result) return null;
  return (
    <Card title={LABOR.trades} note={trades.length ? LABOR.tradesNote : undefined} className={className} data-testid="labor-trades">
      {!trades.length ? (
        <p className="text-[13px] text-mute">{LABOR.noTrades}</p>
      ) : (
        <>
          <RevealGroup key={runSeq} as="ul" className="grid" aria-label={LABOR.trades}>
            {shown.map((t, i) => (
              <RevealItem as="li" key={t.id} className={cn(i > 0 && "border-t border-line")}>
                <motion.button
                  type="button"
                  onClick={() => openReplay(t.id)}
                  whileTap={press.whileTap}
                  transition={press.transition}
                  style={{ borderRadius: radius.hover }}
                  aria-label={`${LABOR.replay}: ${t.tag} am ${fmtDate(new Date(t.entryTime))}, ${rText(t.r)}`}
                  data-testid="labor-trade"
                  className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-1.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] pointer-coarse:min-h-11"
                >
                  <Side t={t} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                      <span className="truncate">{t.tag}</span>
                      {t.grade && <span className="shrink-0 rounded-full border border-line-2 px-1.5 font-mono text-[10px] text-mute">{t.grade}</span>}
                    </span>
                    <span className="num truncate font-mono text-[11px] text-faint">
                      {fmtDate(new Date(t.entryTime))} · {fmtPrice(t.entry)} → {fmtPrice(t.exit)} · {EXIT_LABEL[t.reason]}
                    </span>
                  </span>
                  <span className={cn("num font-mono text-[13px] font-semibold", t.r > 0 ? "text-win" : t.r < 0 ? "text-loss" : "text-mute")}>{rText(t.r)}</span>
                </motion.button>
              </RevealItem>
            ))}
          </RevealGroup>
          {trades.length > LIST_MAX && !all && (
            <Button size="sm" className="mt-3 justify-self-start" onClick={() => setAll(true)}>
              {LABOR.moreTrades(trades.length - LIST_MAX)}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function Side({ t }: { t: BtTrade }) {
  const long = t.side === "long";
  return (
    <span aria-hidden="true" className={cn("grid size-8 place-items-center rounded-full border font-mono text-[12px]", long ? "border-win/30 text-win" : "border-loss/30 text-loss")}>
      {long ? "▲" : "▼"}
    </span>
  );
}
