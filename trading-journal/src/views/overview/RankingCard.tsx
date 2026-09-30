import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { explainSetup } from "@/domain/explain";
import { DEFAULT_RANK_KEY, RANK_KEYS, RANKING_EMPTY_TEXT, rankSetupStats, splitRanked, type RankKey } from "@/domain/rank";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { useMorphDialog } from "@/motion/MorphDialog";
import { spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { Bar } from "./Bar";
import { ExplanationView } from "./explainer";

export const RANKING_TITLE = "Entscheidungsgrundlagen";
export const RANKING_TRADES_BUTTON = "Alle Trades mit dieser Grundlage →";
const HEAD = ["Grundlage", "Trades", "Win-Rate", "P&L", "Ø R"] as const;
const GRID = "grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)_56px]";

/**
 * `Entscheidungsgrundlagen` ranking (Bundle `Phe`, Plan 6.1): sort Segmented, ranking grid rows (`layout`,
 * `layoutDependency={sortKey+acc}`, `AnimatePresence popLayout`), hover pill `rank`, MorphCard
 * `setup-rank-{id}` → `explainSetup` + `Alle Trades mit dieser Grundlage →`, unused setups as chips.
 */
export function RankingCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const [key, setKey] = useState<RankKey>(DEFAULT_RANK_KEY);
  const { close } = useMorphDialog();
  const hover = useHoverGroup<string>();

  const { used, unused } = useMemo(() => splitRanked(rankSetupStats(view.setups, key)), [view.setups, key]);
  const dep = `${key}:${acc}:${used.map((c) => c.id).join(",")}`;

  const goTrades = (id: string) => {
    close();
    navigate("trades", { setup: id });
  };

  return (
    <Card title={RANKING_TITLE} action={<Segmented<RankKey> size="sm" aria-label="Sortierung" options={RANK_KEYS} value={key} onChange={setKey} />}>
      {used.length === 0 && <p className="mb-3 text-[13px] text-mute">{RANKING_EMPTY_TEXT}</p>}
      {used.length > 0 && (
        <div className="grid">
          <div className={cn("label grid gap-3 px-2 pb-2 !text-faint", GRID)}>
            <span>{HEAD[0]}</span>
            <span>{HEAD[1]}</span>
            <span>{HEAD[2]}</span>
            <span className="text-right">{HEAD[3]}</span>
            <span className="hidden text-right sm:block">{HEAD[4]}</span>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {used.map((c, i) => (
              <motion.div
                key={c.id}
                layout
                layoutDependency={dep}
                transition={{ layout: spring.layout }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: tween.exit }}
                className="relative border-t border-line"
                {...hover.bind(c.id)}
              >
                <HoverPill show={hover.hovered === c.id} group="rank" className="inset-y-0.5" />
                <MorphCard
                  id={`setup-rank-${c.id}`}
                  title={c.setup.name}
                  body={() => (
                    <>
                      <ExplanationView bare d={explainSetup(c, view.list, settings.currency)} />
                      <Button size="sm" className="mt-3" onClick={() => goTrades(c.id)}>
                        {RANKING_TRADES_BUTTON}
                      </Button>
                    </>
                  )}
                  className={cn("relative z-10 grid w-full items-center gap-3 px-2 py-2.5", GRID)}
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium">
                    <span className="num w-4 shrink-0 font-mono text-[11px] text-faint transition-colors group-hover:text-fg">{String(i + 1).padStart(2, "0")}</span>
                    <motion.span layoutId={`morph-dot-${c.id}`} className="size-2 shrink-0 rounded-full" style={{ background: c.setup.color, borderRadius: 9999 }} aria-hidden="true" />
                    <MorphTitle id={`setup-rank-${c.id}`} as="span" className="truncate">
                      {c.setup.name}
                    </MorphTitle>
                  </span>
                  <span className="num font-mono text-[13px] text-mute">{c.n}</span>
                  <span className="grid gap-1">
                    <span className="flex justify-between text-xs">
                      <b className="num font-mono font-medium">{pct0(c.winRate)}</b>
                      <span className="num font-mono text-faint">
                        {c.wins}/{c.losses}
                      </span>
                    </span>
                    <Bar value={c.winRate ?? 0} track="bg-loss/25" />
                  </span>
                  <span className={cn("num text-right font-mono text-[13px] font-medium", colorClass(c.net))}>{signed(c.net, 0)}</span>
                  <span className={cn("num hidden text-right font-mono text-[13px] sm:block", colorClass(c.avgR))}>{c.avgR == null ? "–" : signed(c.avgR)}</span>
                </MorphCard>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {unused.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {unused.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-faint">
              <span className="size-1.5 rounded-full" style={{ background: c.setup.color }} aria-hidden="true" />
              {c.setup.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
