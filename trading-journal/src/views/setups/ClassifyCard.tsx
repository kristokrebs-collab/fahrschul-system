/**
 * Bulk classification of trades without an Entscheidungsgrundlage (P07, additive on the Setups page). The card shows
 * how many trades have no setup and how many sure suggestions exist ("trade the best": only ≥ mittel, best first);
 * the sheet lists them with the suggested setup, a `ConfidenceMeter` and the reasons. "Übernehmen" assigns one trade
 * (the row leaves with a pixel `DissolveOut`), the `HoldButton` assigns every "hoch" suggestion at once.
 * Writes go through `saveTrade` (the stored trade with `setups: [id]`) – nothing else of the trade changes.
 */
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { BACKTEST_SETUP_ID } from "@/domain/defaults";
import { classifyUntagged, type BulkSuggestion } from "@/domain/strategy";
import type { EnrichedTrade, Trade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, signed } from "@/lib/format";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { DissolveOut } from "@/motion/fx/DissolveOut";
import { HoldButton } from "@/motion/HoldButton";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { radius, spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const CLASSIFY_STRINGS = {
  title: "Automatisch zuordnen",
  lead: (n: number, k: number) => `${n} Trade${n === 1 ? "" : "s"} ohne Grundlage. ${k ? `${k} sichere${k === 1 ? "r" : ""} Vorschlag${k === 1 ? "" : "e"}.` : "Noch kein sicherer Vorschlag."}`,
  hint: "Mehr Entry-Kriterien, Märkte oder Auto-Regeln im Editor machen die Zuordnung sicherer.",
  open: "Vorschläge ansehen",
  sheet: "Vorschläge zur Zuordnung",
  apply: "Übernehmen",
  applyAll: (n: number) => `Alle sicheren übernehmen (${n})`,
  holding: "Halten …",
  armed: "Nochmal tippen zum Übernehmen",
  done: (n: number) => `${n} Trade${n === 1 ? "" : "s"} zugeordnet`,
  empty: "Alles zugeordnet.",
  confidence: "Konfidenz",
} as const;

export function useClassify(): { untagged: number; suggestions: BulkSuggestion[]; byId: Map<string, EnrichedTrade> } {
  const enriched = useEnriched();
  const setups = useJournal((s) => s.settings.setups);
  return useMemo(() => {
    const untagged = enriched.filter((t) => !(t.setups || []).length).length;
    const suggestions = untagged ? classifyUntagged(enriched, setups, { exclude: [BACKTEST_SETUP_ID] }) : [];
    return { untagged, suggestions, byId: new Map(enriched.map((t) => [t.id, t])) };
  }, [enriched, setups]);
}

async function assign(ids: readonly { tradeId: string; setupId: string }[]): Promise<number> {
  const { trades, saveTrade } = useJournal.getState();
  const byId = new Map<string, Trade>(trades.map((t) => [t.id, t]));
  let n = 0;
  for (const { tradeId, setupId } of ids) {
    const t = byId.get(tradeId);
    if (!t || (t.setups || []).length) continue; // tagged meanwhile: never overwrite
    await saveTrade({ ...t, setups: [setupId] });
    n++;
  }
  return n;
}

export function ClassifyCard({ className }: { className?: string }) {
  const { untagged, suggestions, byId } = useClassify();
  const [open, setOpen] = useState(false);
  if (!untagged) return null;
  return (
    <>
      <Card title={CLASSIFY_STRINGS.title} className={className} data-testid="setup-classify">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-[13.5px] text-fg/90">{CLASSIFY_STRINGS.lead(untagged, suggestions.length)}</p>
            {!suggestions.length && <p className="text-[12px] text-faint">{CLASSIFY_STRINGS.hint}</p>}
          </div>
          <Button variant={suggestions.length ? "primary" : "ghost"} disabled={!suggestions.length} onClick={() => setOpen(true)} data-testid="setup-classify-open">
            {CLASSIFY_STRINGS.open}
          </Button>
        </div>
      </Card>
      <ClassifySheet open={open} onClose={() => setOpen(false)} suggestions={suggestions} byId={byId} />
    </>
  );
}

function ClassifySheet({ open, onClose, suggestions, byId }: { open: boolean; onClose: () => void; suggestions: BulkSuggestion[]; byId: Map<string, EnrichedTrade> }) {
  const pushToast = useUi((s) => s.pushToast);
  const setups = useJournal((s) => s.settings.setups);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const high = suggestions.filter((s) => s.best.level === "hoch");
  const one = (s: BulkSuggestion) => setLeaving((l) => new Set(l).add(s.tradeId));
  const commitOne = async (s: BulkSuggestion) => {
    const n = await assign([{ tradeId: s.tradeId, setupId: s.best.setupId }]);
    setLeaving((l) => {
      const next = new Set(l);
      next.delete(s.tradeId);
      return next;
    });
    if (n) pushToast({ kind: "success", title: CLASSIFY_STRINGS.done(n), detail: s.best.name });
  };
  const all = async () => {
    const n = await assign(high.map((s) => ({ tradeId: s.tradeId, setupId: s.best.setupId })));
    if (n) pushToast({ kind: "success", title: CLASSIFY_STRINGS.done(n) });
  };
  const colorOf = (id: string) => setups.find((s) => s.id === id)?.color ?? "#9b9b9b";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={CLASSIFY_STRINGS.sheet}
      size="lg"
      footer={
        high.length > 0 ? (
          <HoldButton variant="primary" onConfirm={() => void all()} holdLabel={CLASSIFY_STRINGS.holding} armedLabel={CLASSIFY_STRINGS.armed} data-testid="setup-classify-all">
            {CLASSIFY_STRINGS.applyAll(high.length)}
          </HoldButton>
        ) : undefined
      }
    >
      <div className="grid gap-3" data-testid="setup-classify-list">
        {!suggestions.length && <p className="text-[13px] text-mute">{CLASSIFY_STRINGS.empty}</p>}
        <AnimatePresence initial={false}>
          {suggestions.map((s) => {
            const t = byId.get(s.tradeId);
            if (!t) return null;
            return (
              <motion.div key={s.tradeId} layout style={{ borderRadius: radius.card }} exit={{ opacity: 0, transition: tween.exit }} transition={{ layout: spring.layout }}>
                <StaggerItem>
                  <DissolveOut active={leaving.has(s.tradeId)} onDone={() => void commitOne(s)}>
                    <article className="grid gap-3 rounded-2xl border border-line bg-ink-950/50 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto]" data-testid="setup-classify-row">
                      <div className="grid min-w-0 gap-1.5">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                          <span className={cn("font-mono", t.side === "short" ? "text-loss" : "text-win")}>{t.side === "short" ? "▼ Short" : "▲ Long"}</span>
                          <span className="font-medium">{t.pair}</span>
                          <span className="text-faint">{fmtDate(new Date(t.date))}</span>
                          {t.pnl != null && <span className={cn("num font-mono", t.pnl >= 0 ? "text-win" : "text-loss")}>{signed(t.pnl, 0)}</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span className="text-faint">→</span>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-0.5 text-fg">
                            <span className="size-2 rounded-full" style={{ background: colorOf(s.best.setupId) }} aria-hidden="true" />
                            {s.best.name}
                          </span>
                          {s.alternatives.map((a) => (
                            <span key={a.setupId} className="text-[11.5px] text-faint">
                              oder {a.name}
                            </span>
                          ))}
                        </span>
                        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
                          {s.best.reasons.slice(0, 3).map((r) => (
                            <li key={r.text} className={r.ok ? "text-mute" : "text-faint line-through decoration-white/20"}>
                              {r.ok ? "✓" : "✗"} {r.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:grid sm:justify-items-end">
                        <ConfidenceMeter value={Math.round(s.best.confidence * 100)} label={CLASSIFY_STRINGS.confidence} cols={12} />
                        <Button size="sm" onClick={() => one(s)} disabled={leaving.has(s.tradeId)}>
                          {CLASSIFY_STRINGS.apply}
                        </Button>
                      </div>
                    </article>
                  </DissolveOut>
                </StaggerItem>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
