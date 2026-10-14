import { useEffect, useRef, useState } from "react";
import { celebrateRecord } from "@/motion/fx/celebrate";
import { DotMatrix } from "@/motion/DotMatrix";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { FullscreenWipe, WipeItem } from "@/motion/pulse/FullscreenWipe";
import { formatDay } from "../format";
import { PLAN_CATALOG } from "../plans";
import { loadBilling, setReturned, useBilling } from "../store";
import { RETURN } from "../strings";
import { grantsPlan } from "../types";

/** Polls of the status after the return (the webhook usually lands within a second or two). */
export const RETURN_POLLS = 10;
export const RETURN_POLL_MS = 1500;

/**
 * Return from Stripe Checkout (P10): the FullscreenWipe (red curtain, black panel) with "Zahlung wird bestätigt …"
 * while a dot-matrix wave runs, then – as soon as the webhook wrote the plan – the plan name decodes in
 * (AsciiCascade), the trial end / "Alles freigeschaltet" line rises and confetti bursts from the button
 * (`celebrateRecord`). The status is polled at most `RETURN_POLLS` times; if Stripe is slow it says so honestly.
 */
export function CheckoutReturn() {
  const returned = useBilling((s) => s.returned);
  const sub = useBilling((s) => s.account?.subscription ?? null);
  const open = returned?.kind === "success";
  const confirmed = !!sub && grantsPlan(sub.status);
  const [slow, setSlow] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const celebrated = useRef(false);

  useEffect(() => {
    if (!open || confirmed) return;
    let n = 0;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await loadBilling();
      if (stop) return;
      const s = useBilling.getState().account?.subscription;
      if (s && grantsPlan(s.status)) return;
      if (++n >= RETURN_POLLS) {
        setSlow(true);
        return;
      }
      timer = setTimeout(() => void tick(), RETURN_POLL_MS);
    };
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => void tick(), 300);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, confirmed]);

  useEffect(() => {
    if (!open || !confirmed || celebrated.current) return;
    celebrated.current = true;
    // after the wipe and the items landed
    const t = setTimeout(() => {
      if (btn.current?.isConnected) celebrateRecord(btn.current);
    }, 1300);
    return () => clearTimeout(t);
  }, [open, confirmed]);

  const close = () => {
    celebrated.current = false;
    setSlow(false);
    setReturned(null);
  };
  const name = sub ? PLAN_CATALOG[sub.plan].name : "";
  return (
    <FullscreenWipe open={open} onClose={close} label={RETURN.label}>
      <div
        className="mx-auto grid min-h-full max-w-[880px] content-center gap-8 px-6 py-20"
        data-testid="checkout-return"
        data-confirmed={confirmed ? "" : undefined}
      >
        <WipeItem index={0}>
          <span className="label">{RETURN.label}</span>
        </WipeItem>
        <WipeItem index={1}>
          {confirmed ? (
            <h2 className="text-[clamp(40px,8vw,84px)] font-medium leading-[0.95] tracking-[-0.04em] text-fg">
              <span className="sr-only">{RETURN.welcome(name)}</span>
              <span aria-hidden="true" className="block">
                Willkommen bei
              </span>
              <AsciiCascade text={name} as="span" color="inherit" className="block text-signal" />
            </h2>
          ) : (
            <div className="grid gap-5">
              <span aria-hidden="true">
                {/* busy indicator: plays only while confirming, unmounts with the confirmation */}
                <DotMatrix preset="wave" size={6} gap={3} tone="fg" />
              </span>
              <h2 className="text-[clamp(30px,6vw,56px)] font-medium leading-[1] tracking-[-0.03em] text-fg">{RETURN.confirming}</h2>
            </div>
          )}
        </WipeItem>
        <WipeItem index={2}>
          <p className="max-w-[52ch] text-[15px] leading-relaxed text-mute">
            {confirmed
              ? sub?.status === "trialing" && sub.trialEnd
                ? RETURN.trialUntil(formatDay(sub.trialEnd))
                : RETURN.active
              : slow
                ? RETURN.slow
                : "\u00a0"}
          </p>
        </WipeItem>
        <WipeItem index={3}>
          <button ref={btn} type="button" onClick={close} className="touch-hit rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink-950">
            {RETURN.go}
          </button>
        </WipeItem>
      </div>
    </FullscreenWipe>
  );
}
