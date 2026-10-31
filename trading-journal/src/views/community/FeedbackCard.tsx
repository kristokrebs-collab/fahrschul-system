import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { EDITION } from "@/edition";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { sendFeedback, useSocial } from "@/social/store";
import { FEEDBACK } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";

type Kind = (typeof FEEDBACK.kinds)[number]["v"];

/**
 * Feedback (P12) → `/api/v1/feedback`: kind, two sentences, send. Works signed out too. After sending the field
 * collapses into a drawn ✓ ("Angekommen") for a moment. Only the text is stored – no IP, no device.
 */
export function FeedbackCard({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const [kind, setKind] = useState<Kind>("idea");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const busy = useSocial((s) => s.busy);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3) return;
    if (await sendFeedback({ kind, message: text.trim(), page: "community", meta: { edition: EDITION } })) {
      setText("");
      setSent((n) => n + 1);
    }
  };
  return (
    <Card title={FEEDBACK.title} note={FEEDBACK.lead} className={cn("h-full", className)} data-testid="feedback-card">
      <form onSubmit={submit} className="grid gap-3">
        <Segmented<Kind> aria-label="Art" options={FEEDBACK.kinds.map((k) => ({ v: k.v, label: k.label }))} value={kind} onChange={setKind} />
        <label htmlFor={id} className="sr-only">
          {FEEDBACK.title}
        </label>
        <Textarea id={id} value={text} rows={4} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={FEEDBACK.placeholder} data-testid="feedback-text" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11.5px] text-faint">{FEEDBACK.privacy}</span>
          <div className="flex items-center gap-3">
            <AnimatePresence>
              {sent > 0 && (
                <motion.span
                  key={sent}
                  className="flex items-center gap-1.5 text-[12.5px] text-win"
                  initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
                  exit={{ opacity: 0, transition: tween.exit }}
                  transition={{ default: spring.pop, opacity: tween.fade }}
                  data-testid="feedback-sent"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.draw} />
                  </svg>
                  {FEEDBACK.sent}
                </motion.span>
              )}
            </AnimatePresence>
            <Button type="submit" variant="primary" disabled={text.trim().length < 3 || busy === "feedback"} data-testid="feedback-send">
              <Glyph name="send" className="size-4" />
              {FEEDBACK.send}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
