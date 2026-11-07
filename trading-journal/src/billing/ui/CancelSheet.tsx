import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { BUTTON_LABELS } from "@/legal/consentTexts";
import { Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Textarea } from "@/primitives/Input";
import { CANCEL_REASONS, type CancelReason } from "../contract";
import { formatDay } from "../format";
import { changeSubscription, closeCancel, openPortal, useBilling } from "../store";
import { CANCEL, CANCEL_REASON_LABEL } from "../strings";

type Step = "confirm" | "done";

/**
 * In-app cancellation (P10, B4, § 312k BGB): ONE confirmation page – the end date and the button "Jetzt kündigen", nothing in
 * front of it (no reason, no offer: a step the person has to pass before the cancellation is exactly what the law forbids) –
 * then "Gekündigt" with the mail note (the confirmation mail goes out when mail is set up; the sheet says honestly when it is
 * not). Only AFTER the confirmation come the optional parts: the reason (it goes to Stripe as the cancellation's feedback,
 * changes nothing), an offer to switch to a cheaper plan, "Kündigung zurücknehmen". The Stripe portal's cancel flow stays as an
 * alternative on the confirmation page. Steps slide sideways (`spring.enter`), the done tick draws itself.
 */
export function CancelSheet() {
  const open = useBilling((s) => s.cancelOpen);
  const account = useBilling((s) => s.account);
  const busy = useBilling((s) => s.busy);
  const mail = useBilling((s) => s.cancelMail);
  const reduced = useReducedFx();
  const [step, setStep] = useState<Step>("confirm");
  const [dir, setDir] = useState(1);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [comment, setComment] = useState("");
  const [thanks, setThanks] = useState(false);
  const sub = account?.subscription ?? null;
  const canDowngrade = sub?.plan === "premium" || sub?.plan === "team";
  const endDate = formatDay(sub?.cancelAt ?? (sub?.status === "trialing" ? sub.trialEnd : sub?.currentPeriodEnd));

  const go = (next: Step, d = 1) => {
    setDir(d);
    setStep(next);
  };
  const close = () => {
    closeCancel();
    // reset after the exit, so the sheet never flashes the first step while closing
    setTimeout(() => {
      setStep("confirm");
      setReason(null);
      setComment("");
      setThanks(false);
    }, 400);
  };
  const confirm = async () => {
    const ok = await changeSubscription("cancel");
    if (ok) go("done");
  };
  const sendReason = async () => {
    if (!reason && !comment.trim()) return;
    const ok = await changeSubscription("feedback", { ...(reason ? { reason } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
    if (ok) setThanks(true);
  };
  const undo = async () => {
    const ok = await changeSubscription("resume");
    if (ok) close();
  };

  const footer =
    step === "confirm" ? (
      <>
        <Button variant="ghost" onClick={close}>
          Abbrechen
        </Button>
        <span className="flex-1" />
        <Button variant="danger" disabled={!!busy} onClick={() => void confirm()} data-testid="cancel-now">
          {BUTTON_LABELS.cancelConfirm}
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
            {step === "confirm" && (
              <>
                <p className="text-[15px] font-semibold">{CANCEL.stepConfirm}</p>
                <p className="text-[13.5px] leading-relaxed text-fg/90" data-testid="cancel-end">
                  {CANCEL.confirmText(endDate)}
                </p>
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
              <div className="grid gap-5 py-2">
                <div className="grid justify-items-start gap-3">
                  <svg aria-hidden="true" viewBox="0 0 48 48" className="size-12 text-fg" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <motion.circle cx="24" cy="24" r="21" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.draw} className="opacity-40" />
                    <motion.path d="M15 24.5l6.5 6.5L34 18" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...tween.draw, delay: 0.35 }} />
                  </svg>
                  <p className="text-[17px] font-semibold">{CANCEL.done}</p>
                  <p className="text-[13.5px] text-mute">{CANCEL.doneText(formatDay(account?.subscription?.cancelAt ?? null) || endDate)}</p>
                  <p className="text-[12.5px] text-mute" data-testid="cancel-mail">
                    {mail === "sent" ? CANCEL.mailSent : CANCEL.mailOff}
                  </p>
                </div>

                {/* only now – AFTER the confirmation – the optional parts */}
                <div className="grid gap-3 rounded-2xl border border-line bg-ink-950/50 p-4" data-testid="cancel-after">
                  {thanks ? (
                    <p className="text-[13.5px] text-win" role="status">
                      {CANCEL.thanks}
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-1">
                        <p className="text-[14px] font-semibold">{CANCEL.afterTitle}</p>
                        <p className="text-[12.5px] text-faint">{CANCEL.afterLead}</p>
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
                              className={cn("touch-hit rounded-full border px-3 py-1.5 text-[13px] transition-colors", on ? "border-fg bg-fg text-ink-950" : "border-line-2 bg-white/[0.03] text-mute hover:text-fg")}
                            >
                              {CANCEL_REASON_LABEL[r]}
                            </button>
                          );
                        })}
                      </div>
                      <label className="grid gap-1.5 text-[12.5px] text-mute">
                        {CANCEL.comment}
                        <Textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} placeholder={CANCEL.commentPlaceholder} rows={2} />
                      </label>
                      <Button size="sm" className="justify-self-start" disabled={!!busy || (!reason && !comment.trim())} onClick={() => void sendReason()} data-testid="cancel-feedback">
                        {CANCEL.send}
                      </Button>
                    </>
                  )}
                  {canDowngrade && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                      <span className="text-[12.5px] text-mute">{CANCEL.offerDowngradeText}</span>
                      <Button size="sm" disabled={!!busy} onClick={() => void openPortal("update")}>
                        {CANCEL.offerDowngrade}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
