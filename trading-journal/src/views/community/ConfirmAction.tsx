import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";

/**
 * A destructive action the community way (leave, delete, remove): HOLD acts at once, a tap asks inline
 * ("Wirklich? Ja / Nein") – keyboard and screen readers keep the two-step path. Focus moves to "Nein" and back.
 */
export function ConfirmAction({ label, question, onConfirm, disabled, testId }: { label: string; question: string; onConfirm: () => void; disabled?: boolean; testId?: string }) {
  const reduced = useReducedFx();
  const [asking, setAsking] = useState(false);
  const { trigger, no } = useConfirmFocus(asking);
  const run = () => {
    setAsking(false);
    onConfirm();
  };
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {asking ? (
        <motion.span
          key="ask"
          role="alert"
          className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]"
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={{ default: tween.fade, scale: spring.pop }}
        >
          {question}
          <Button size="sm" variant="danger" onClick={run} disabled={disabled} data-testid={testId ? `${testId}-yes` : undefined}>
            Ja
          </Button>
          <Button ref={no} size="sm" onClick={() => setAsking(false)}>
            Nein
          </Button>
        </motion.span>
      ) : (
        <motion.span key="btn" exit={{ opacity: 0, transition: tween.exit }}>
          <HoldConfirm ref={trigger} variant="danger" size="sm" disabled={disabled} onAsk={() => setAsking(true)} onConfirm={run} data-testid={testId}>
            {label}
          </HoldConfirm>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
