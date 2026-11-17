import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { pushToast } from "@/store/uiStore";
import { ensureCloud } from "../runtime";
import { useSyncStatus } from "../sync/status";
import { totalOf, type TakeoverChoice, type TakeoverPreview, type TakeoverResult } from "../sync/takeover";
import { answerTakeover, closeTakeover, useTakeover } from "../takeover";
import { effectLine, leftLabel, records, summaryLine, TAKEOVER } from "./takeoverStrings";

/** Re-renders every second while the undo countdown is on screen. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Data takeover (B1): shown at the first login of a browser that already holds a journal. One `Sheet`, four phases:
 * choose (numbers of both sides, four options, recommended one preselected) → working (steps + upload progress, cannot
 * be dismissed) → done (summary, Rückgängig for `UNDO_WINDOW_MS`) or error. Closing while choosing = „Später
 * entscheiden“ (the journal stays local). The choice is a real radio group: arrows move, Enter applies.
 * Numbers come from `previewTakeover` – nothing is estimated.
 */
export function TakeoverDialog() {
  const phase = useTakeover((s) => s.phase);
  const preview = useTakeover((s) => s.preview);
  const open = phase !== "idle" && phase !== "undone";
  const title = phase === "done" ? TAKEOVER.done.title : phase === "error" ? TAKEOVER.error.title : phase === "working" ? TAKEOVER.working.title : preview?.otherOwner ? TAKEOVER.titleOther : TAKEOVER.title;
  return (
    <Sheet open={open} onClose={closeTakeover} title={title} size="md" dismissGuard={() => phase === "working"} onDismissAttempt={() => undefined}>
      {phase === "choose" && preview && <ChooseView preview={preview} />}
      {phase === "working" && <WorkingView />}
      {phase === "done" && <DoneView />}
      {phase === "error" && <ErrorView />}
    </Sheet>
  );
}

function Table({ preview }: { preview: TakeoverPreview }) {
  const rows: { label: string; here: string; cloud: string }[] = [
    { label: "Trades", here: String(preview.local.trades), cloud: String(preview.cloud.trades) },
    { label: "Messwerte", here: String(preview.local.hyblock), cloud: String(preview.cloud.hyblock) },
    { label: "Tagesnotizen", here: String(preview.local.days), cloud: String(preview.cloud.days) },
  ];
  const facts: [string, number][] = [
    [TAKEOVER.rows.same, totalOf(preview.same)],
    [TAKEOVER.rows.localOnly, totalOf(preview.localOnly)],
    [TAKEOVER.rows.cloudOnly, totalOf(preview.cloudOnly)],
    [TAKEOVER.rows.differ, totalOf(preview.differ)],
    [TAKEOVER.rows.duplicates, preview.duplicates],
  ];
  return (
    <div className="grid gap-3" data-testid="takeover-preview">
      <table className="w-full text-[13px]" aria-label={TAKEOVER.tableLabel}>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-faint">
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Art</span>
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {TAKEOVER.here}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {TAKEOVER.cloud}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal text-mute">
                {r.label}
              </th>
              <td className="py-1.5 text-right font-mono text-fg">{r.here}</td>
              <td className="py-1.5 text-right font-mono text-fg">{r.cloud}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="text-faint">{k}</dt>
            <dd className="font-mono text-mute">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChooseView({ preview }: { preview: TakeoverPreview }) {
  const [choice, setChoice] = useState<TakeoverChoice>(preview.recommended);
  const group = useId();
  const lead = preview.otherOwner ? TAKEOVER.leadOther : preview.cloudEmpty ? TAKEOVER.leadEmpty : TAKEOVER.lead;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        answerTakeover(choice);
      }}
      data-testid="takeover-choose"
    >
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{lead}</p>
      </StaggerItem>
      {!preview.cloudEmpty && !preview.otherOwner ? (
        <StaggerItem>
          <Table preview={preview} />
        </StaggerItem>
      ) : (
        <StaggerItem>
          <p className="text-[13px] text-fg">
            {TAKEOVER.here}: <span className="font-mono">{records(preview.local)}</span>
          </p>
        </StaggerItem>
      )}
      <StaggerItem>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.12em] text-faint">{TAKEOVER.radioLabel}</legend>
          {preview.allowed.map((c) => (
            <Option key={c} group={group} choice={c} checked={choice === c} recommended={preview.recommended === c} preview={preview} onPick={setChoice} />
          ))}
        </fieldset>
      </StaggerItem>
      <StaggerItem className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={closeTakeover}>
          {TAKEOVER.later}
        </Button>
        <Button type="submit" variant={choice === "keep" ? "secondary" : "primary"} data-testid="takeover-apply">
          {TAKEOVER.apply[choice]}
        </Button>
      </StaggerItem>
      <StaggerItem>
        <p className="text-[11.5px] text-faint">{TAKEOVER.laterHint}</p>
      </StaggerItem>
    </form>
  );
}

function Option({ group, choice, checked, recommended, preview, onPick }: { group: string; choice: TakeoverChoice; checked: boolean; recommended: boolean; preview: TakeoverPreview; onPick: (c: TakeoverChoice) => void }) {
  const o = TAKEOVER.options[choice];
  return (
    <label
      className={cn(
        "grid min-h-[44px] cursor-pointer gap-1 rounded-2xl border px-3.5 py-3 transition-colors duration-200 has-[:focus-visible]:shadow-(--ring-glow-btn)",
        checked ? "border-line-2 bg-white/[0.06]" : "border-line hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center gap-2.5">
        <input type="radio" name={group} value={choice} checked={checked} onChange={() => onPick(choice)} className="size-4 shrink-0 accent-(--color-fg,currentColor)" data-testid={`takeover-${choice}`} />
        <span className="text-[14px] font-semibold text-fg">{o.title}</span>
        {recommended && <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em] text-mute">{TAKEOVER.recommended}</span>}
      </span>
      <span className="pl-[26px] text-[12.5px] leading-relaxed text-mute">{o.text}</span>
      <span className="pl-[26px] font-mono text-[11.5px] text-faint">{effectLine(choice, preview)}</span>
    </label>
  );
}

function WorkingView() {
  const step = useTakeover((s) => s.step);
  const progress = useSyncStatus((s) => s.progress);
  const reduced = useReducedFx();
  const order = ["snapshot", "merge", "upload"] as const;
  const at = step ? order.indexOf(step === "finish" ? "upload" : step) : 0;
  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <div className="grid gap-4" role="status" aria-live="polite" data-testid="takeover-working">
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{TAKEOVER.working.lead}</p>
      </StaggerItem>
      <StaggerItem>
        <ol className="grid gap-1.5">
          {order.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2.5 text-[13px]", i < at ? "text-mute" : i === at ? "text-fg" : "text-faint")}>
              <span aria-hidden="true" className={cn("grid size-5 place-items-center rounded-full border text-[10px]", i < at ? "border-win/50 text-win" : i === at ? "border-line-2" : "border-line")}>
                {i < at ? "✓" : i + 1}
              </span>
              {TAKEOVER.steps[s]}
              {s === "upload" && progress ? <span className="ml-auto font-mono text-[11.5px] text-faint">{TAKEOVER.progress(progress.done, progress.total)}</span> : null}
            </li>
          ))}
        </ol>
      </StaggerItem>
      <StaggerItem>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
          <motion.div className="h-full origin-left rounded-full bg-fg" initial={false} animate={{ scaleX: Math.max(0.04, pct) }} transition={reduced ? { duration: 0 } : spring.bar} />
        </div>
      </StaggerItem>
    </div>
  );
}

function DoneView() {
  const result = useTakeover((s) => s.result) as TakeoverResult | null;
  const until = useTakeover((s) => s.undoUntil);
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const open = !!until && Date.parse(until) > now;
  async function undo() {
    setBusy(true);
    const m = await ensureCloud().catch(() => null);
    const ok = m ? await m.undoTakeover().catch(() => false) : false;
    setBusy(false);
    pushToast(ok ? { kind: "success", title: TAKEOVER.undoDone.title, detail: TAKEOVER.undoDone.detail } : { kind: "error", title: TAKEOVER.undoFailed });
  }
  if (!result) return null;
  return (
    <div className="grid gap-4" data-testid="takeover-done">
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-fg" role="status">
          {summaryLine(result)}
        </p>
      </StaggerItem>
      <StaggerItem>
        <motion.p className="text-[12.5px] leading-relaxed text-mute" initial={false} animate={{ opacity: 1 }} transition={tween.fade}>
          {open ? `${TAKEOVER.done.undoHint(leftLabel(until!, now))} ${TAKEOVER.done.undoNote}` : TAKEOVER.done.expired}
        </motion.p>
      </StaggerItem>
      <StaggerItem className="flex flex-wrap items-center justify-between gap-2">
        {open ? (
          <Button variant="secondary" disabled={busy} onClick={() => void undo()} data-testid="takeover-undo">
            {TAKEOVER.done.undo}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={closeTakeover}>
          {TAKEOVER.done.close}
        </Button>
      </StaggerItem>
    </div>
  );
}

function ErrorView() {
  const error = useTakeover((s) => s.error);
  return (
    <div className="grid gap-4" data-testid="takeover-error">
      <StaggerItem>
        <p role="alert" className="text-[13px] leading-relaxed text-loss">
          {error}
        </p>
        <p className="mt-2 text-[12.5px] text-mute">{TAKEOVER.error.text}</p>
      </StaggerItem>
      <StaggerItem className="flex justify-end">
        <Button variant="primary" onClick={closeTakeover}>
          {TAKEOVER.error.close}
        </Button>
      </StaggerItem>
    </div>
  );
}
