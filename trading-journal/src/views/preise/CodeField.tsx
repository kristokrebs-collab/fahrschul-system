import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { textLink } from "@/lib/textLink";
import { checkCode, clearCode, useBilling, useBillingMode } from "@/billing/store";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { PREISE } from "./strings";

/**
 * Promotion code (P10): checked on the server (`/api/v1/billing/code`, a preview – Checkout applies it). Valid: the
 * terms decode in (`TextScramble`) and the plan cards decode their new price; invalid: the field shakes with the
 * German reason (`Field invalidKey`). Disabled while payments are not set up.
 */
export function CodeField({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const mode = useBillingMode();
  const promo = useBilling((s) => s.promo);
  const busy = useBilling((s) => s.busy);
  const [value, setValue] = useState("");
  const [fails, setFails] = useState(0);
  const disabled = mode !== "open";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const res = await checkCode(value);
    if (res && !res.valid) setFails((n) => n + 1);
  };
  const invalid = promo && !promo.valid ? promo.message : undefined;
  return (
    <div className={cn("min-w-0", className)} data-testid="code-field">
      <AnimatePresence mode="wait" initial={false}>
        {promo?.valid ? (
          <motion.div
            key="applied"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-win/30 bg-win/[0.06] px-4 py-2.5"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ scale: spring.pop, opacity: tween.fade }}
          >
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-win">{PREISE.codeApplied}</span>
            <TextScramble text={`${promo.code} · ${promo.message ?? ""}`} as="span" className="font-mono text-[13px] text-fg" />
            {(promo.firstTimeOnly || promo.restricted) && (
              <span className="text-[12px] text-mute">
                {[promo.firstTimeOnly ? PREISE.codeFirstTime : "", promo.restricted ? PREISE.codeRestricted : ""].filter(Boolean).join(" · ")}
              </span>
            )}
            <button
              type="button"
              className={cn(textLink, "ml-auto text-[12.5px]")}
              onClick={() => {
                clearCode();
                setValue("");
              }}
            >
              {PREISE.codeRemove}
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={(e) => void submit(e)}
            className="flex items-end gap-2"
            initial={false}
            exit={{ opacity: 0, transition: tween.exit }}
          >
            <Field label={PREISE.codeLabel} htmlFor="promo-code" error={invalid} invalidKey={fails} className="min-w-0 flex-1">
              <Input
                id="promo-code"
                value={value}
                onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 40))}
                placeholder={disabled ? "–" : PREISE.codePlaceholder}
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                invalid={!!invalid}
                className="font-mono uppercase tracking-[0.08em]"
              />
            </Field>
            <Button type="submit" disabled={disabled || !value.trim() || !!busy} className="mb-px">
              {busy === "code" ? "…" : PREISE.codeCheck}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
