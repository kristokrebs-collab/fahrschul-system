import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Textarea } from "@/primitives/Input";
import { CANCEL_REASONS, type CancelReason } from "../contract";
import { formatDay } from "../format";
import { changeSubscription, closeCancel, openPortal, useBilling } from "../store";
import { CANCEL, CANCEL_REASON_LABEL } from "../strings";

type Step = "reason" | "offer" | "confirm" | "done";

/**
 * In-app cancellation (P10, § 312k BGB): reason (optional) → an offer (pause / cheaper plan – only when it fits, always
 * skippable with "Weiter zur Kündigung") → confirmation with the end date and "Jetzt kündigen" (cancels at period end
 * right away, the reason goes to Stripe) → done (with "Kündigung zurücknehmen"). The Stripe portal's cancel flow is
 * offered as an alternative. Steps slide sideways (`spring.enter`), the done tick draws itself.
 */
export function CancelSheet() {
  const open = useBilling((s) => s.cancelOpen);
  const account = useBilling((s) => s.account);
  const busy = useBilling((s) => s.busy);
  const reduced = useReducedFx();
  const [step, setStep] = useState<Step>("reason");
  const [dir, setDir] = useState(1);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [comment, setComment] = useState("");
  const sub = account?.subscription ?? null;
  const canPause = sub?.status === "active" && !sub.cancelAtPeriodEnd;
  const canDowngrade = sub?.plan === "premium" || sub?.plan === "team";
  const hasOffer = canPause || canDowngrade;
  const endDate = formatDay(sub?.cancelAt ?? (sub?.status === "trialing" ? sub.trialEnd : sub?.currentPeriodEnd));

  const go = (next: Step, d = 1) => {
    setDir(d);
    setStep(next);
  };
  const close = () => {
    closeCancel();
    // reset after the exit, so the sheet never flashes the first step while closing
    setTimeout(() => {
      setStep("reason");
      setReason(null);
      setComment("");
    }, 400);
  };
  const confirm = async () => {
    const ok = await changeSubscription("cancel", { ...(reason ? { reason } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
    if (ok) go("done");
  };
  const pause = async () => {
    const ok = await changeSubscription("pause", { months: 1 });
    if (ok) close();
  };
  const undo = async () => {
    const ok = await changeSubscription("resume");
    if (ok) close();
  };

  const footer =
    step === "reason" ? (
      <>
        <Button variant="ghost" onClick={close}>Abbrechen</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => go(hasOffer ? "offer" : "confirm")}>
          {CANCEL.next}
        </Button>
      </>
    ) : step === "offer" ? (
      <>
        <Button onClick={() => go("reason", -1)}>{CANCEL.back}</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => go("confirm")}>
          {CANCEL.next}
        </Button>
      </>
    ) : step === "confirm" ? (
      <>
        <Button onClick={() => go(hasOffer ? "offer" : "reason", -1)}>{CANCEL.back}</Button>
        <span className="flex-1" />
        <Button variant="danger" disabled={!!busy} onClick={() => void confirm()} data-testid="cancel-now">
          {CANCEL.confirm}
        </Button>
      </>
    ) : (
      <>
        <Button disabled={!!busy} onClick={() => void undo()}>
          {CANCEL.undo}
        </Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={close}>
          {CANCEL.close}
        </Button>
      </>
    );

  return (
    <Sheet open={open} onClose={close} title={CANCEL.title} size="md" dismissGuard={false} footer={footer}>
      <div className="relative overflow-x-clip" data-testid="cancel-sheet" data-step={step}>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            className="grid gap-4"
            initial={reduced ? false : { opacity: 0, x: 28 * dir }}
            animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -20 * dir, transition: tween.exit }}
            transition={{ x: spring.enter, opacity: tween.fade }}
          >
            {step === "reason" && (
              <>
                <div className="grid gap-1">
                  <p className="text-[15px] font-semibold">{CANCEL.stepReason}</p>
                  <p className="text-[12.5px] text-faint">{CANCEL.reasonOptional}</p>
                </div>
                <div role="radiogroup" aria-label="Grund" className="flex flex-wrap gap-2">
                  {CANCEL_REASONS.map((r) => {
                    const on = reason === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setReason(on ? null : r)}
                        className={cn(
                          "touch-hit rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                          on ? "border-fg bg-fg text-ink-950" : "border-line-2 bg-white/[0.03] text-mute hover:text-fg",
                        )}
                      >
                        {CANCEL_REASON_LABEL[r]}
                      </button>
                    );
                  })}
                </div>
                <label className="grid gap-1.5 text-[12.5px] text-mute">
                  {CANCEL.comment}
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} placeholder={CANCEL.commentPlaceholder} rows={3} />
                </label>
              </>
            )}
            {step === "offer" && (
              <>
                <p className="text-[15px] font-semibold">{CANCEL.stepOffer}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {canPause && (
                    <OfferCard
                      title={CANCEL.offerPause}
                      text={CANCEL.offerPauseText}
                      action={CANCEL.offerPause}
                      disabled={!!busy}
                      onClick={() => void pause()}
                    />
                  )}
                  {canDowngrade && (
                    <OfferCard
                      title={CANCEL.offerDowngrade}
                      text={CANCEL.offerDowngradeText}
                      action={CANCEL.offerDowngrade}
                      disabled={!!busy}
                      onClick={() => void openPortal("update")}
                    />
                  )}
                </div>
              </>
            )}
            {step === "confirm" && (
              <>
                <p className="text-[15px] font-semibold">{CANCEL.stepConfirm}</p>
                <p className="text-[13.5px] leading-relaxed text-fg/90">{CANCEL.confirmText(endDate)}</p>
                <p className="text-[13px] text-mute">{CANCEL.confirmData}</p>
                <button
                  type="button"
                  className="touch-hit justify-self-start text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg"
                  disabled={!!busy}
                  onClick={() => void openPortal("cancel")}
                >
                  {CANCEL.viaPortal}
                </button>
              </>
            )}
            {step === "done" && (
              <div className="grid justify-items-start gap-3 py-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 48 48"
                  className="size-12 text-fg"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.circle
                    cx="24"
                    cy="24"
                    r="21"
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={tween.draw}
                    className="opacity-40"
                  />
                  <motion.path
                    d="M15 24.5l6.5 6.5L34 18"
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ ...tween.draw, delay: 0.35 }}
                  />
                </svg>
                <p className="text-[17px] font-semibold">{CANCEL.done}</p>
                <p className="text-[13.5px] text-mute">{CANCEL.doneText(formatDay(account?.subscription?.cancelAt ?? null) || endDate)}</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

function OfferCard({ title, text, action, onClick, disabled }: { title: string; text: string; action: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="grid content-between gap-3 rounded-2xl border border-line bg-ink-950/50 p-4">
      <div className="grid gap-1">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[12.5px] leading-relaxed text-mute">{text}</span>
      </div>
      <Button size="sm" disabled={disabled} onClick={onClick} className="justify-self-start">
        {action}
      </Button>
    </div>
  );
}
