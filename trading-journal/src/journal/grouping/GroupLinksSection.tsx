/**
 * "Gruppe & Hedge" in the trade detail (Review F04): shows what the trade is linked to and offers the nearby trades of
 * the same pair – „Gruppieren“ (shared `groupId`, the Trades list folds them with „Gruppieren“ on) and, for the
 * opposite side, „Als Hedge“ (`hedgeOf`); „Lösen“ removes this trade's own links. Rows cascade in (`StaggerItem`),
 * a fresh link pops its badge (`spring.pop`, transform only; reduced motion: at rest).
 */
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { stripEnrichment } from "@/domain/csv";
import { groupTrades } from "@/domain/grouping";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, signed } from "@/lib/format";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { applyLinkPatch, groupPatches, hedgePatch, linkCandidates, unlinkPatch, type LinkPatch } from "./links";

export const GROUP_STRINGS = {
  title: "Gruppe & Hedge",
  none: "Mit keinem Trade verbunden.",
  inGroup: (n: number) => `In einer Gruppe mit ${n === 1 ? "1 Trade" : `${n} Trades`}`,
  hedgeOf: (what: string) => `Hedge von ${what}`,
  auto: "Automatisch als Hedge erkannt",
  candidates: "Trades desselben Paars (± 14 Tage)",
  noCandidates: "Kein anderer Trade dieses Paars in ± 14 Tagen.",
  group: "Gruppieren",
  hedge: "Als Hedge",
  unlink: "Lösen",
  grouped: "Gruppiert",
  hedged: "Als Hedge verbunden",
  unlinked: "Verbindung gelöst",
  failed: "Speichern fehlgeschlagen",
} as const;

const label = (t: EnrichedTrade) => `${t.side === "long" ? "Long" : "Short"} ${fmtDate(new Date(t.date))}`;

async function save(patches: readonly LinkPatch[], toast: string): Promise<void> {
  const { trades, saveTrade } = useJournal.getState();
  const now = new Date().toISOString();
  try {
    for (const p of patches) {
      const cur = trades.find((t) => t.id === p.id);
      if (cur) await saveTrade(applyLinkPatch(stripEnrichment(cur), p, now));
    }
    pushToast({ kind: "success", title: toast });
  } catch {
    pushToast({ kind: "error", title: GROUP_STRINGS.failed });
  }
}

export function GroupLinksSection({ trade, all, currency }: { trade: EnrichedTrade; all: readonly EnrichedTrade[]; currency: string }) {
  const reduced = useReducedFx();
  const candidates = useMemo(() => linkCandidates(trade, all), [trade, all]);
  const group = useMemo(() => groupTrades(all).groupOf.get(trade.id) ?? null, [all, trade.id]);
  const hedgeTarget = trade.hedgeOf ? all.find((t) => t.id === trade.hedgeOf) : undefined;
  const status = trade.hedgeOf
    ? GROUP_STRINGS.hedgeOf(hedgeTarget ? `${hedgeTarget.pair} · ${label(hedgeTarget)}` : "einem gelöschten Trade")
    : group
      ? group.auto
        ? GROUP_STRINGS.auto
        : GROUP_STRINGS.inGroup(group.members.length - 1)
      : GROUP_STRINGS.none;
  const linked = !!(trade.groupId || trade.hedgeOf);
  return (
    <div className="grid gap-2" data-testid="group-links">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{GROUP_STRINGS.title}</span>
        {linked && (
          <button
            type="button"
            className="touch-hit rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-mute hover:text-loss"
            onClick={() => {
              const p = unlinkPatch(trade);
              if (p) void save([p], GROUP_STRINGS.unlinked);
            }}
            data-testid="group-unlink"
          >
            {GROUP_STRINGS.unlink}
          </button>
        )}
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.p
          key={status}
          className={cn("text-[12px]", linked || group ? "text-fg" : "text-faint")}
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={{ default: spring.pop, opacity: tween.fade }}
          data-testid="group-status"
        >
          {status}
        </motion.p>
      </AnimatePresence>
      <span className="text-[10.5px] text-faint">{GROUP_STRINGS.candidates}</span>
      {candidates.length === 0 ? (
        <p className="text-[11.5px] text-faint">{GROUP_STRINGS.noCandidates}</p>
      ) : (
        <ul className="grid gap-1">
          {candidates.map((c) => {
            const same = !!trade.groupId && c.groupId === trade.groupId;
            const hedged = trade.hedgeOf === c.id || c.hedgeOf === trade.id;
            const hp = hedgePatch(trade, c);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-2.5 py-1.5 text-[11.5px]" data-testid="group-candidate" data-id={c.id}>
                <span className="min-w-0 truncate">
                  <span className={c.side === "long" ? "text-win" : "text-loss"}>{label(c)}</span>
                  {c.pnl != null && <span className="ml-2 font-mono text-mute">{`${signed(c.pnl, 0)} ${currency}`}</span>}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={same}
                    className="touch-hit rounded-full border border-line-2 px-2.5 py-0.5 text-fg hover:border-white/40 disabled:opacity-40"
                    onClick={() => void save(groupPatches(trade, c), GROUP_STRINGS.grouped)}
                    data-testid="group-join"
                  >
                    {same ? GROUP_STRINGS.grouped : GROUP_STRINGS.group}
                  </button>
                  {hp && (
                    <button
                      type="button"
                      disabled={hedged}
                      className="touch-hit rounded-full border border-line-2 px-2.5 py-0.5 text-fg hover:border-white/40 disabled:opacity-40"
                      onClick={() => void save([hp], GROUP_STRINGS.hedged)}
                      data-testid="group-hedge"
                    >
                      {GROUP_STRINGS.hedge}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
