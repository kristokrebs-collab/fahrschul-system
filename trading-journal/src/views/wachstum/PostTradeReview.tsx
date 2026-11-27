/**
 * Post-trade review (P08): a short prompt after a trade closed – plan followed?, stress now, exit reason, execution
 * rating, one learning – written into the trade itself (`followedPlan`, `rating`, `psych.stress / exitReason /
 * postNote`; every other field kept). Reviewed trades feed the journal streak, the challenges and the coach.
 *
 *   PostTradeReview        the prompt for one trade (content only)
 *   PostTradeReviewSheet   the prompt in a sheet bound to `useGrowthUi.reviewId` (rendered once – `useSheetOwner`)
 *   PostTradeReviewHost    P14 leaf for App.tsx: watches the journal and, after a trade was closed by a real save
 *                          (fresh, ≤ `BULK_SAVE` records, a decision of the trader – the coach watcher's rules), queues
 *                          it; once the editor and the detail are closed the next waiting review opens. "Später" skips
 *                          a trade for the session; the switch in the sheet turns the automatic prompt off per device.
 */
import { useEffect, useMemo, useState } from "react";
import { reviewed } from "@/domain/coach/recommendations";
import type { EnrichedTrade, TradeRating } from "@/domain/types";
import { EXIT_REASONS } from "@/journal/editor/form";
import { Meter5, SCALE_LABELS } from "@/journal/editor/PsychSection";
import { RatingDots } from "@/journal/ui/RatingDots";
import { cn } from "@/lib/cn";
import { r as fmtR } from "@/lib/format";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Switch } from "@/motion/Switch";
import { tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { getEnriched, useEnriched, useJournal } from "@/store/journalStore";
import { pushToast, useUi } from "@/store/uiStore";
import { BULK_SAVE, changedIds, fresh } from "@/views/coach/CoachWatcher";
import { saveReview } from "./actions";
import { useGrowthUi, useSheetOwner } from "./growthStore";
import { WACHSTUM } from "./strings";

const R = WACHSTUM.review;
type Plan = "yes" | "no";

export interface PostTradeReviewProps {
  trade: EnrichedTrade;
  onDone: (saved: boolean) => void;
}

/** The prompt for one trade. */
export function PostTradeReview({ trade, onDone }: PostTradeReviewProps) {
  const [plan, setPlan] = useState<Plan | null>(trade.followedPlan == null ? null : trade.followedPlan ? "yes" : "no");
  const [stress, setStress] = useState<number | null>(trade.psych?.stress ?? null);
  const [exit, setExit] = useState<string>(trade.psych?.exitReason ?? "");
  const [rating, setRating] = useState<TradeRating | null>(trade.rating ?? null);
  const [note, setNote] = useState(trade.psych?.postNote ?? "");
  const [busy, setBusy] = useState(false);
  const something = plan != null || stress != null || !!exit.trim() || rating != null || !!note.trim();
  const tone = trade.result === "win" ? "text-win" : trade.result === "loss" ? "text-loss" : "text-mute";

  const save = async () => {
    if (!something || busy) return;
    setBusy(true);
    const ok = await saveReview(trade.id, { followedPlan: plan == null ? null : plan === "yes", stress, exitReason: exit, rating, postNote: note });
    setBusy(false);
    if (ok) {
      pushToast({ kind: "success", title: R.saved, detail: `${trade.pair} · ${trade.side === "long" ? "Long" : "Short"}` });
      onDone(true);
    }
  };

  return (
    <div className="grid gap-5" data-testid="post-trade-review" data-trade={trade.id}>
      <StaggerItem className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-ink-950/50 px-3.5 py-3">
        <span className="text-[13.5px] font-semibold">
          {trade.pair} · {trade.side === "long" ? "Long" : "Short"}
        </span>
        <span className={cn("num font-mono text-[13px]", tone)}>{trade.r != null ? fmtR(trade.r) : trade.result === "win" ? "Gewinn" : trade.result === "loss" ? "Verlust" : "Break-even"}</span>
        <p className="w-full text-[12px] text-mute">{R.lead}</p>
      </StaggerItem>
      <StaggerItem className="grid gap-4 sm:grid-cols-2">
        <Field label={R.plan}>
          <Segmented<Plan>
            aria-label={R.plan}
            options={[
              { v: "yes", label: "Ja" },
              { v: "no", label: "Nein" },
            ]}
            value={plan}
            onChange={setPlan}
            tones={{ yes: "bg-win/15 border-win/30", no: "bg-loss/15 border-loss/30" }}
          />
        </Field>
        <Field label={R.feeling}>
          <Meter5 label={R.feeling} value={stress} onChange={setStress} labels={SCALE_LABELS.stress} tone="loss" />
        </Field>
      </StaggerItem>
      <StaggerItem>
        <Field label={R.exit}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={R.exit}>
            {EXIT_REASONS.map((x) => {
              const on = exit === x;
              return (
                <button
                  key={x}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setExit(on ? "" : x)}
                  className={cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors pointer-coarse:min-h-11", on ? "border-white/50 bg-white/[0.1] text-fg" : "border-line text-mute hover:border-white/30 hover:text-fg")}
                >
                  {x}
                </button>
              );
            })}
          </div>
        </Field>
      </StaggerItem>
      <StaggerItem>
        <Field label={R.rating}>
          <RatingDots value={rating} onChange={setRating} label={R.rating} />
        </Field>
      </StaggerItem>
      <StaggerItem>
        <Field label={R.learning} htmlFor="ptr-note">
          <Textarea id="ptr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={R.placeholder} className="leading-relaxed" data-testid="post-trade-note" />
        </Field>
      </StaggerItem>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => onDone(false)} disabled={busy} data-testid="post-trade-later">
          {R.later}
        </Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => void save()} disabled={!something || busy} data-testid="post-trade-save">
          {R.save}
        </Button>
      </div>
    </div>
  );
}

/** The review sheet bound to the growth UI store (rendered by the first mounted instance only). */
export function PostTradeReviewSheet() {
  const owner = useSheetOwner("review");
  const id = useGrowthUi((s) => s.reviewId);
  const close = useGrowthUi((s) => s.closeReview);
  const auto = useGrowthUi((s) => s.reviewAuto);
  const setAuto = useGrowthUi((s) => s.setReviewAuto);
  const enriched = useEnriched();
  // keep the last trade while the sheet animates out
  const [last, setLast] = useState<EnrichedTrade | null>(null);
  const trade = useMemo(() => (id ? (enriched.find((t) => t.id === id) ?? null) : null), [id, enriched]);
  // derived state (set during render, React's documented pattern): the content stays while the sheet leaves
  if (trade && trade !== last) setLast(trade);
  if (!owner) return null;
  const shown = trade ?? last;
  return (
    <Sheet
      open={!!trade}
      onClose={() => close(true)}
      title={R.title}
      dismissGuard={false}
    >
      {shown ? (
        <div className="grid gap-5">
          <PostTradeReview key={shown.id} trade={shown} onDone={(saved) => close(!saved)} />
          <label className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[11.5px] text-faint">
            {R.auto}
            <Switch size="sm" checked={auto} onCheckedChange={setAuto} aria-label={R.auto} data-testid="post-trade-auto" />
          </label>
        </div>
      ) : (
        <div />
      )}
    </Sheet>
  );
}

/** Watches real saves for freshly closed, unreviewed trades and queues them (see the module comment). */
export function usePostTradeWatch(): void {
  useEffect(() => {
    let prev = useJournal.getState();
    return useJournal.subscribe((state) => {
      const before = prev;
      prev = state;
      if (!state.loaded || !before.loaded || state.trades === before.trades) return;
      if (!useGrowthUi.getState().reviewAuto) return;
      const now = Date.now();
      const ids = changedIds(before.trades, state.trades);
      if (!ids.length || ids.length > BULK_SAVE) return;
      const was = new Map(before.trades.map((t) => [t.id, t]));
      const byId = new Map(getEnriched(state.trades, state.settings).map((t) => [t.id, t]));
      const closedNow = ids.filter((id) => {
        const t = byId.get(id);
        const b = was.get(id);
        return !!t && t.result !== "open" && (!b || b.status === "open") && fresh(t, now) && !reviewed(t);
      });
      if (closedNow.length) useGrowthUi.getState().enqueueReview(closedNow);
    });
  }, []);
}

/** Opens the next waiting review once the editor and the detail are closed (after their exit). */
function useReviewOpener(): void {
  const editorOpen = useUi((s) => s.editor.open);
  const detailOpen = useUi((s) => s.detail.id != null);
  const queue = useGrowthUi((s) => s.queue);
  const current = useGrowthUi((s) => s.reviewId);
  useEffect(() => {
    if (editorOpen || detailOpen || current || !queue.length) return;
    const t = setTimeout(() => useGrowthUi.getState().nextReview(), (tween.page.duration + tween.sheetIos.duration) * 1000);
    return () => clearTimeout(t);
  }, [editorOpen, detailOpen, queue, current]);
}

/** P14 leaf for App.tsx (after SetupEditor, before Celebrate, with `data-layer`): the watcher + the review sheet. */
export function PostTradeReviewHost() {
  usePostTradeWatch();
  useReviewOpener();
  return <PostTradeReviewSheet />;
}
