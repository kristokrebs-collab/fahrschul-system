/**
 * The result page after the return from Stripe (B4) – five states (`@/billing/purchase/result`): bestätigt · in Bearbeitung ·
 * Bestätigung nötig · abgebrochen · fehlgeschlagen. THE RETURN URL CONFIRMS NOTHING: "Dein Abo ist aktiv" appears only when
 * `billing-status` – the server state the Stripe webhook wrote – says the subscription runs. While the server has not heard
 * yet the page asks again with a growing pause (800 ms … 6 s, ≈ 60 s in all); after that it says honestly "Wir warten noch
 * auf die Bestätigung von Stripe", claims nothing and offers "Status prüfen". Reuses the full-screen wipe of the app; reduced
 * motion = the wipe's instant fade, the orbs stand still.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { celebrateRecord } from "@/motion/fx/celebrate";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { FullscreenWipe, WipeItem } from "@/motion/pulse/FullscreenWipe";
import { Button } from "@/primitives/Button";
import { formatDay } from "@/billing/format";
import { PLAN_CATALOG } from "@/billing/plans";
import { pollDelay, pollTimedOut, resultStateOf, RESULT_TEXT, type ResultState } from "@/billing/purchase/result";
import { clearLastOrder, readLastOrder } from "@/billing/purchase/orderState";
import { RESULT } from "@/billing/purchase/strings";
import { loadBilling, openPortal, requestOrder, setReturned, useBilling } from "@/billing/store";
import "@/billing/purchase/purchase.css";

export function ResultView() {
  const returned = useBilling((s) => s.returned);
  const sub = useBilling((s) => s.account?.subscription ?? null);
  const open = returned?.kind === "success" || returned?.kind === "cancel";
  const kind = returned?.kind === "cancel" ? "cancel" : "success";
  const last = useMemo(() => (returned ? readLastOrder() : null), [returned]);
  const staleId = last?.staleSubId ?? null;
  const state: ResultState = open ? resultStateOf(kind, sub, staleId) : "pending";
  const [attempts, setAttempts] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [checking, setChecking] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const celebrated = useRef(false);
  const timedOut = state === "pending" && pollTimedOut(attempts);

  // ask the server again until it knows (never on the URL alone); one run per `epoch` (a click on "Status prüfen" starts a new one)
  useEffect(() => {
    if (!open || kind !== "success") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let n = 0;
    const tick = async () => {
      if (stop) return;
      setChecking(true);
      await loadBilling();
      if (stop) return;
      setChecking(false);
      const s = useBilling.getState().account?.subscription ?? null;
      if (resultStateOf("success", s, staleId) !== "pending") return;
      n += 1;
      setAttempts(n);
      if (pollTimedOut(n)) return;
      timer = setTimeout(() => void tick(), pollDelay(n));
    };
    timer = setTimeout(() => void tick(), 300);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, kind, epoch, staleId]);

  useEffect(() => {
    if (!open || state !== "confirmed" || celebrated.current) return;
    celebrated.current = true;
    const t = setTimeout(() => {
      if (btn.current?.isConnected) celebrateRecord(btn.current);
    }, 1300);
    return () => clearTimeout(t);
  }, [open, state]);

  const close = useCallback(() => {
    celebrated.current = false;
    setAttempts(0);
    if (state === "confirmed") clearLastOrder();
    setReturned(null);
  }, [state]);

  const checkNow = () => {
    setAttempts(0);
    setEpoch((e) => e + 1);
  };

  const reopen = () => {
    setReturned(null);
    if (last) requestOrder(last.draft);
  };

  const text =
    state === "confirmed" && sub?.status === "trialing" && sub.trialEnd
      ? RESULT_TEXT.confirmedTrial(formatDay(sub.trialEnd))
      : state === "confirmed"
        ? RESULT_TEXT.confirmed
        : state === "pending"
          ? timedOut
            ? RESULT_TEXT.pendingSlow
            : RESULT_TEXT.pending
          : RESULT_TEXT[state];
  const name = sub && state === "confirmed" ? PLAN_CATALOG[sub.plan].name : "";

  return (
    <FullscreenWipe open={open} onClose={close} label={RESULT.label}>
      <div className="mx-auto grid min-h-full max-w-[880px] content-center gap-8 px-6 py-20" data-testid="order-result" data-state={state}>
        <WipeItem index={0}>
          <span className="label">{RESULT.label}</span>
        </WipeItem>
        <WipeItem index={1}>
          <div className="grid gap-5">
            {state === "pending" && (
              <span aria-hidden="true" className="relative block size-10 text-fg">
                <span className="pay-orbs">
                  {[0, 1, 2, 3, 4, 5].map((k) => (
                    <i key={k} style={{ "--k": k } as CSSProperties} />
                  ))}
                </span>
              </span>
            )}
            <h2 className="text-[clamp(30px,6vw,56px)] font-medium leading-[1] tracking-[-0.03em] text-fg" data-testid="result-title" aria-live="polite">
              {state === "confirmed" && name ? (
                <>
                  <span className="sr-only">{`${text.title}: ${name}`}</span>
                  <span aria-hidden="true" className="block">
                    {text.title}
                  </span>
                  <AsciiCascade text={name} as="span" color="inherit" className="block text-signal" />
                </>
              ) : (
                text.title
              )}
            </h2>
          </div>
        </WipeItem>
        <WipeItem index={2}>
          <p className="max-w-[56ch] text-[15px] leading-relaxed text-mute" data-testid="result-text">
            {text.text}
          </p>
        </WipeItem>
        <WipeItem index={3}>
          <div className="flex flex-wrap gap-2.5">
            {state === "confirmed" && (
              <Button ref={btn} variant="primary" fx={false} onClick={close} data-testid="result-close">
                {RESULT.toKonto}
              </Button>
            )}
            {state === "pending" && timedOut && (
              <Button variant="primary" fx={false} onClick={checkNow} loading={checking} data-testid="result-check">
                {RESULT.check}
              </Button>
            )}
            {state === "action" && (
              <Button variant="primary" fx={false} onClick={() => void openPortal("payment")} data-testid="result-pay">
                {RESULT.pay}
              </Button>
            )}
            {(state === "canceled" || state === "failed") && last && (
              <Button variant="primary" fx={false} onClick={reopen} data-testid="result-retry">
                {RESULT.retry}
              </Button>
            )}
            {state !== "confirmed" && (
              <Button variant="secondary" onClick={close} data-testid="result-close">
                {RESULT.close}
              </Button>
            )}
          </div>
        </WipeItem>
      </div>
    </FullscreenWipe>
  );
}
