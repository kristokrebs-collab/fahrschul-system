/**
 * Strategy suggestion of the trade being edited (P07 `classifyTrade`, P14 slot under the setup chips of the
 * TradeEditor): while no Entscheidungsgrundlage is picked, the most likely one of the trader's setups (rules, texts,
 * the box context and what similar trades were filed under) – only from "mittel" on ("trade the best"). One tap on
 * "Übernehmen" selects it; the reasons sit behind the chip's title. The chip pops in (`spring.pop`) and leaves on
 * `tween.exit`; reduced motion: static. Lazy chunk of the editor (the classifier stays out of the first load).
 */
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { BACKTEST_SETUP_ID } from "@/domain/defaults";
import { classifyTrade, historyModel, LEVEL_MIN, type Suggestion } from "@/domain/strategy/classify";
import type { Trade } from "@/domain/types";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useJournal } from "@/store/journalStore";

export type ClassifyDraft = Pick<Trade, "side" | "pair" | "timeframe" | "account" | "date"> & Partial<Pick<Trade, "createdAt" | "boxSnap" | "signal">>;

export interface ClassifyChipSlotProps {
  draft: ClassifyDraft;
  /** setups already picked: the chip only shows while none is */
  picked: readonly string[];
  onApply: (setupId: string) => void;
}

export const CLASSIFY_CHIP_STRINGS = {
  label: "Vorschlag",
  apply: "Übernehmen",
  level: (s: Suggestion) => `${s.level} · ${Math.round(s.confidence * 100)} %`,
} as const;

/** Pure: the suggestion worth showing (best one, at least "mittel"), or null. */
export function bestSuggestion(list: readonly Suggestion[]): Suggestion | null {
  const best = list[0];
  return best && best.confidence >= LEVEL_MIN.mittel ? best : null;
}

export default function ClassifyChipSlot({ draft, picked, onApply }: ClassifyChipSlotProps) {
  const reduced = useReducedFx();
  const trades = useJournal((s) => s.trades);
  const setups = useJournal((s) => s.settings.setups);
  const history = useMemo(() => historyModel(trades), [trades]);
  const key = `${draft.side}|${draft.pair}|${draft.timeframe}|${draft.account}|${draft.date}`;
  const best = useMemo(
    () => (picked.length ? null : bestSuggestion(classifyTrade({ createdAt: "", ...draft }, setups, { history, exclude: [BACKTEST_SETUP_ID] }))),
    // `key` fingerprints the draft (a new object per keystroke); boxSnap / signal only change with it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, picked.length, setups, history],
  );
  return (
    <AnimatePresence initial={false}>
      {best && (
        <motion.div
          key={best.setupId}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px]"
          data-testid="classify-chip"
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
          exit={{ opacity: 0, transition: reduced ? { duration: 0 } : tween.exit }}
          transition={{ scale: spring.pop, opacity: tween.fade }}
          title={best.reasons.map((r) => `${r.ok ? "✓" : "–"} ${r.text}`).join("\n")}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{CLASSIFY_CHIP_STRINGS.label}</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-fg">
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: best.color }} />
            {best.name}
          </span>
          <span className="font-mono text-[11.5px] text-mute">{CLASSIFY_CHIP_STRINGS.level(best)}</span>
          <button
            type="button"
            onClick={() => onApply(best.setupId)}
            className="ml-auto rounded-full border border-line-2 px-2.5 py-1 text-[12px] font-medium text-fg transition-colors hover:border-white/40 pointer-coarse:min-h-11"
          >
            {CLASSIFY_CHIP_STRINGS.apply}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
