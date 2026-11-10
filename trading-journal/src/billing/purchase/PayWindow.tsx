/**
 * The payment window (Paket V) – a 1:1 rebuild of the reference recording's checkout (`docs/audit/V-VORBILD.md` § 2) that replaces the
 * order sheet: header with the step band (Auswahl ✓ — Konto ✓ — ③ Zahlung), on the left the card graphic and the order summary, on the
 * right the form. With a publishable key the card fields are Stripe Elements (the number never passes through our code); the card
 * fills its groups, shows the brand, turns when the security code has the focus. „Zahlungspflichtig bestellen“ (the statutory label,
 * § 312j Abs. 3 BGB) lifts the card into the middle; while the bank / Stripe / the webhook answer it shines and the spinner turns; only
 * the SERVER's confirmation (subscription active or the trial created) turns it green. Any error flies the card back and says why at the
 * field – nothing is ever shown as paid that the server has not confirmed.
 *
 * Kept from the order sheet (B4, § 312j Abs. 2 BGB, ENTWURF – Prüfung durch Anwalt nötig): plan, interval, seats, the price, today's amount,
 * the trial and the first payment with its date, the automatic renewal with its date, the cancellation, the tax – compact in the summary
 * card instead of a table; two separate, never pre-ticked boxes (AGB / Widerruf / Datenschutz, the immediate start); the button is the
 * only way to order. Without a publishable key (or with Stripe Tax on) the same window hands over to Stripe Checkout as before.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { legalConfig } from "@/legal/config";
import { LegalLink } from "@/legal/LegalLinks";
import { TERMS_CONSENT, TERMS_PARTS } from "@/legal/consentRecord";
import { IMMEDIATE_START_CONSENT } from "@/legal/consentTexts";
import { useDialogBehaviour } from "@/motion/a11y";
import { payStage } from "@/motion/vorbild";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { cancelAll, settled } from "@/motion/waapi";
import { Segmented } from "@/primitives/Segmented";
import { Stepper } from "@/primitives/Stepper";
import { formatMoney } from "../format";
import { PLAN_CATALOG } from "../plans";
import { closeDetail, closeOrder, loadBilling, noteOrderReturn, openDetail, useBilling, useBillingMode, usePurchaseGate, useTrialDays } from "../store";
import { ClosedNotice } from "../ui/parts";
import { formatOrderDay, orderReadiness, savingLabel, seatsFor, summarize, type OrderDraft } from "./order";
import { markTried, resetOrderForm, setImmediate, setTerms, submitOrder, useOrderForm } from "./orderState";
import { fieldSource, loadFields, type CardFieldKind, type CardFields, type CardFieldState } from "./pay/fields";
import { authorising, back, lift, success, type StageParts } from "./pay/payMotion";
import { onStage, payInApp, resetPayFlow, usePayFlow } from "./pay/payFlow";
import { brandMark, PayCard } from "./pay/PayCard";
import { BUTTON_LABELS, ORDER, PAY, PRICE_TAX_NOTE } from "./strings";
import "@/styles/islands.css";
import "./purchase.css";
import "./pay/payWindow.css";

const EMPTY: CardFieldState = { empty: true, complete: false, error: null };
const PORTRAIT_QUERY = "(max-width: 639px)";

function usePortrait(): boolean {
  const [p, setP] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PORTRAIT_QUERY).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(PORTRAIT_QUERY);
    const on = () => setP(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return p;
}

const Icon = {
  person: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c.9-3.6 3.6-5.6 7-5.6s6.1 2 7 5.6" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path d="M3 10h18" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  tick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
};

/** Row positions of the right column (share of the window height, measured § 2.1). */
const ROWS = { title: 13.3, sub: 18.5, holderLabel: 23.9, holder: 26.9, numberLabel: 39.2, number: 42.4, pairLabel: 54.7, pair: 57.8 } as const;
const at = (top: number) => ({ "--pw-top": top }) as React.CSSProperties;

/** A required box (never pre-ticked): the whole row is its label, the square has a 44-px touch area. */
function Check({ checked, onChange, invalid, testId, children }: { checked: boolean; onChange: (v: boolean) => void; invalid: boolean; testId: string; children: ReactNode }) {
  return (
    <label className="pw-check" data-invalid={invalid && !checked ? "" : undefined} data-testid={testId} data-checked={checked ? "true" : "false"}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={invalid && !checked ? true : undefined} />
      <span className="pw-tick touch-hit" aria-hidden="true">
        {Icon.tick}
      </span>
      <span>{children}</span>
    </label>
  );
}

export function PayWindow() {
  const order = useBilling((s) => s.order);
  const config = useBilling((s) => s.config);
  const promo = useBilling((s) => s.promo);
  const mode = useBillingMode();
  const gate = usePurchaseGate();
  const trial = useTrialDays();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const userName = useCloudSession((s) => s.user?.name ?? "");
  const form = useOrderForm();
  const flow = usePayFlow();
  const reduced = useReducedFx();
  const portrait = usePortrait();
  const open = order.open && !!order.draft;
  const draft = useMemo<OrderDraft>(() => order.draft ?? { plan: "pro", interval: "year", seats: 1 }, [order.draft]);
  const now = useMemo(() => new Date(order.openedAt || 0), [order.openedAt]);
  const titleId = useId();

  // every opening is a NEW order: new idempotency key, both boxes open, the stage at rest
  useEffect(() => {
    if (!open) return;
    resetOrderForm();
    resetPayFlow();
  }, [open, order.openedAt]);

  const live = useMemo(
    () => summarize(draft, { prices: config?.prices, trialDays: trial, now, automaticTax: config?.automaticTax === true, coupon: promo?.valid ? promo : null }),
    [draft, config?.prices, config?.automaticTax, trial, now, promo],
  );
  // on the stage the order on screen is the one that was placed: a subscription that arrives meanwhile must not re-word it
  const [placed, setPlaced] = useState<typeof live | null>(null);
  const s = placed && flow.phase !== "idle" && flow.phase !== "failed" ? placed : live;
  const cat = PLAN_CATALOG[draft.plan];
  const per = ORDER.intervalWord(draft.interval, true);
  const source = fieldSource({ automaticTax: config?.automaticTax === true });
  const embedded = source !== "redirect" && signedIn && gate.open;
  const ready = orderReadiness({ open: gate.open, signedIn, terms: form.terms, immediate: form.immediate, busy: form.phase !== "idle" });
  const label = savingLabel(s.saving);
  const todayCents = s.trialDays > 0 ? 0 : s.payCents;

  /* ---------------------------------------------------------------- card fields */
  const [holder, setHolder] = useState("");
  const [fields, setFields] = useState<CardFields | null>(null);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [st, setSt] = useState<{ number: CardFieldState; expiry: CardFieldState; cvc: CardFieldState; brand: string | null }>({ number: EMPTY, expiry: EMPTY, cvc: EMPTY, brand: null });
  const [focus, setFocus] = useState<CardFieldKind | "holder" | null>(null);
  const [tried, setTried] = useState(false);
  const numberMount = useRef<HTMLDivElement>(null);
  const expiryMount = useRef<HTMLDivElement>(null);
  const cvcMount = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // a new opening: the holder from the account's name, the fields empty (state from props, no effect)
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (open && openedFor !== order.openedAt) {
    setOpenedFor(order.openedAt);
    setHolder(userName);
    setSt({ number: EMPTY, expiry: EMPTY, cvc: EMPTY, brand: null });
    setFieldsFailed(false);
    setTried(false);
    setPlaced(null);
  }

  const styleNow = useCallback(() => {
    const cs = winRef.current ? getComputedStyle(winRef.current) : null;
    const v = (n: string, f: string) => cs?.getPropertyValue(n).trim() || f;
    return { color: v("--color-fg", "#121212"), placeholder: v("--color-faint", "#6b6b6b"), danger: v("--color-loss", "#cc1e29"), fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace', fontSize: portrait ? "16px" : `${Math.max(16, Math.round((winRef.current?.clientWidth ?? 1006) * 0.017))}px` };
  }, [portrait]);

  useEffect(() => {
    if (!open || !embedded) return;
    let alive = true;
    let made: CardFields | null = null;
    loadFields(source)
      .then((f) => {
        const targets = { number: numberMount.current, expiry: expiryMount.current, cvc: cvcMount.current };
        if (!alive || !targets.number || !targets.expiry || !targets.cvc) {
          f.destroy();
          return;
        }
        made = f;
        f.mount(targets as Record<CardFieldKind, HTMLElement>, {
          change: (kind, state, brand) => setSt((p) => ({ ...p, [kind]: state, ...(kind === "number" ? { brand: brand && brand !== "unknown" ? brand : null } : {}) })),
          focus: (kind) => setFocus(kind),
          blur: (kind) => setFocus((cur) => (cur === kind ? null : cur)),
        }, styleNow());
        setFields(f);
      })
      .catch(() => alive && setFieldsFailed(true));
    return () => {
      alive = false;
      made?.destroy();
      setFields(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per opening and source; the refs are stable
  }, [open, embedded, source]);

  /* ---------------------------------------------------------------- stage choreography */
  const cardRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const glowOkRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const spinnerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const tickRef = useRef<SVGPathElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  /** Read in effects only (the elements of the stage at that moment). */
  function stageParts(): StageParts {
    return {
      win: winRef.current,
      card: cardRef.current,
      plate: plateRef.current,
      glow: glowRef.current,
      glowOk: glowOkRef.current,
      sheen: sheenRef.current,
      form: formRef.current,
      summary: summaryRef.current,
      right: rightRef.current,
      status: statusRef.current,
      spinner: spinnerRef.current,
    };
  }
  const liftAnims = useRef<Animation[]>([]);
  const loopAnims = useRef<Animation[]>([]);
  const delta = useRef({ x: 0, y: 0 });
  /**
   * The stage: rest → lifting (the flow left idle) → landed (the card is in the middle) → … → returning (an error) → rest. The steps that
   * follow the flow are taken while rendering (state from props); the ones that follow an animation are taken when it has finished.
   */
  const [stage, setStage] = useState<"rest" | "lifting" | "landed" | "returning">("rest");
  const phase = flow.phase;
  if (!open && stage !== "rest") setStage("rest");
  else if (open && onStage(phase) && stage === "rest") setStage("lifting");
  else if (phase === "failed" && (stage === "lifting" || stage === "landed")) setStage("returning");
  const succeeded = useRef(false);

  useLayoutEffect(() => {
    if (stage === "lifting") {
      succeeded.current = false;
      const l = lift(stageParts(), reduced);
      liftAnims.current = l.anims;
      delta.current = l.delta;
      loopAnims.current = authorising(stageParts(), reduced);
      // the answer may come before the card has landed (a fast server): the success waits for the landing
      void settled(l.anims.filter((a) => a.id === "pay:card-lift" || a.id === "pay:card-fade")).then(() => setStage((cur) => (cur === "lifting" ? "landed" : cur)));
    } else if (stage === "returning") {
      cancelAll(loopAnims.current);
      loopAnims.current = [];
      const b = back(stageParts(), delta.current, reduced);
      void settled(b).then(() => {
        cancelAll(liftAnims.current);
        cancelAll(b);
        liftAnims.current = [];
        setStage((cur) => (cur === "returning" ? "rest" : cur));
      });
    } else if (stage === "rest") {
      // closed, or back at rest: nothing of the stage stays on the elements
      cancelAll(loopAnims.current);
      cancelAll(liftAnims.current);
      loopAnims.current = [];
      liftAnims.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one choreography per stage step
  }, [stage]);

  useLayoutEffect(() => {
    if (stage !== "landed" || succeeded.current || (phase !== "confirmed" && phase !== "slow")) return;
    succeeded.current = true;
    cancelAll(loopAnims.current);
    loopAnims.current = phase === "confirmed" ? success({ ...stageParts(), ring: ringRef.current, tick: tickRef.current, doneBtn: doneRef.current }, reduced) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the success runs once, when the card has landed and the server has answered
  }, [stage, phase]);

  const inFlight = phase === "starting" || phase === "confirming" || phase === "waiting";
  /** What the stage shows: an answer that came while the card was still flying waits for the landing. */
  const shown = stage !== "landed" && (phase === "confirmed" || phase === "slow") ? "waiting" : phase;
  /**
   * The window leaves instead of vanishing (motion review, Runde 13): it fades and eases back a little on `tween.exitSurface`, THEN the
   * order closes. The order stays open for those 180 ms, so nothing of the stage is reset while it is still visible. Reduced motion, or
   * a browser without the Web Animations API: closed at once, as before.
   */
  const overlayRef = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const close = () => {
    if (inFlight || form.phase === "confirming" || leaving.current) return;
    if (phase === "confirmed") void loadBilling();
    const el = overlayRef.current;
    if (reduced || !el || typeof el.animate !== "function") {
      closeOrder();
      return;
    }
    leaving.current = true;
    el.style.pointerEvents = "none";
    const done = () => {
      leaving.current = false;
      closeOrder();
    };
    const timing = { duration: tween.exitSurface.duration * 1000, easing: `cubic-bezier(${tween.exitSurface.ease.join(", ")})`, fill: "forwards" as const };
    dialogRef.current?.animate?.([{ transform: "scale(1)" }, { transform: "scale(0.985)" }], timing);
    el.animate([{ opacity: 1 }, { opacity: 0 }], timing).finished.then(done, done);
  };
  useDialogBehaviour(dialogRef, open, close);

  const change = (next: Partial<OrderDraft>) => {
    const d = { ...draft, ...next };
    useBilling.setState((st2) => ({ order: { ...st2.order, draft: { plan: d.plan, interval: d.interval, seats: seatsFor(d.plan, d.seats) } } }));
    resetOrderForm(); // another order: the consents given for the one on screen no longer apply
  };

  const missing: CardFieldKind | "holder" | null = !holder.trim() ? "holder" : !st.number.complete ? "number" : !st.expiry.complete ? "expiry" : !st.cvc.complete ? "cvc" : null;
  const pay = () => {
    if (!signedIn) {
      noteOrderReturn(draft);
      closeOrder();
      openAuthSheet("signin", "card");
      return;
    }
    if (!form.terms || !form.immediate) {
      markTried();
      return;
    }
    if (!embedded) {
      void submitOrder(draft);
      return;
    }
    if (!fields || missing) {
      setTried(true);
      if (missing === "holder") document.getElementById(`${titleId}-holder`)?.focus();
      else if (missing && fields) fields.focus(missing);
      return;
    }
    setPlaced(live);
    void payInApp(draft, fields, holder);
  };

  const flipped = focus === "cvc" && stage === "rest";
  const groups: 0 | 1 | 4 = st.number.complete ? 4 : st.number.empty ? 0 : 1;
  const fieldErr = (k: CardFieldKind): string | null => (flow.phase === "failed" && flow.error?.field === k ? flow.error.message : st[k].error ?? (tried && !st[k].complete ? PAY.missing[k] : null));
  const brand = brandMark(st.brand);
  const amountToday = formatMoney(todayCents, s.currency);
  // the server decides whether this order has a trial (its answer is in the flow), the summary only proposed it
  const trialNow = phase === "idle" || phase === "starting" ? s.trialDays > 0 : flow.trialDays > 0;
  const statusTitle = shown === "confirmed" ? (trialNow ? PAY.trialActive : PAY.paid(formatMoney(s.payCents, s.currency))) : shown === "slow" ? PAY.slowTitle : PAY.authorising;
  const cardWord = [brand ? (brand === "mastercard" ? "Mastercard" : brand[0] + brand.slice(1).toLowerCase()) : PAY.cardWord, flow.card?.last4 ? `•••• ${flow.card.last4}` : null].filter(Boolean).join(" ");
  const statusSub =
    shown === "confirmed"
      ? trialNow
        ? PAY.trialSub(cardWord, formatOrderDay(s.firstPayment), formatMoney(s.totalCents, s.currency), per)
        : PAY.paidSub(cardWord)
      : shown === "slow"
        ? PAY.slowSub
        : `${cardWord} · ${PAY.today} ${trialNow ? formatMoney(0, s.currency) : formatMoney(s.payCents, s.currency)}`;

  if (!open) return null;
  return (
    <div ref={overlayRef} className="pw-overlay" data-orient={portrait ? "portrait" : "landscape"} data-layer="Bezahlen">
      <div className="pw-dim" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pw-frame"
        data-orient={portrait ? "portrait" : "landscape"}
        data-testid="order-sheet"
        data-plan={draft.plan}
        data-interval={draft.interval}
        data-seats={s.draft.seats}
        data-source={embedded ? source : "redirect"}
        data-pay-phase={phase}
      >
        <div
          ref={winRef}
          className="pw-win tj-paper"
          data-orient={portrait ? "portrait" : "landscape"}
          data-stage={stage !== "rest" ? "" : undefined}
          style={{ "--pw-flip-ms": reduced ? "0ms" : stage !== "rest" ? `${payStage.liftTurn.duration}ms` : `${payStage.flip.duration}ms`, "--pw-flip-ease": stage !== "rest" ? payStage.liftTurn.easing : payStage.flip.easing } as React.CSSProperties}
        >
          <header className="pw-head">
            <span className="pw-logo">
              <span className="pw-logo-mark" aria-hidden="true">
                <span />
              </span>
              <b>TRADE JOURNAL</b>
              <em>· {PAY.kasse}</em>
            </span>
            <ol className="pw-steps" aria-label={PAY.stepsLabel} data-testid="order-steps">
              <li>
                <span className="pw-dot" data-done="">
                  {Icon.tick}
                </span>
                {PAY.steps[0]}
              </li>
              <li>
                <span className="pw-dot" data-done="">
                  {Icon.tick}
                </span>
                {PAY.steps[1]}
              </li>
              <li data-active="" aria-current="step">
                <span className="pw-dot" data-active="">
                  3
                </span>
                {PAY.steps[2]}
              </li>
            </ol>
          </header>
          <div className="pw-left" aria-hidden="true" />
          <div ref={rightRef} className="pw-right" aria-hidden="true" />
          <div className="pw-body">
            <div ref={cardRef} className="pw-cardbox" data-testid="pay-card" data-tone={phase === "confirmed" ? "confirmed" : phase === "failed" ? "error" : onStage(phase) ? "working" : "idle"}>
              <div ref={plateRef} className="pw-plate" />
              <div ref={glowRef} className="pw-glow" />
              <div ref={glowOkRef} className="pw-glow-ok" />
              <PayCard view={{ holder, groups: embedded ? groups : 0, expiry: embedded && st.expiry.complete, cvc: embedded && st.cvc.complete, brand: embedded ? st.brand : null, flipped, plan: cat.name }} reduced={reduced} />
              <span className="pw-sheen" aria-hidden="true">
                <i ref={sheenRef} />
              </span>
            </div>

            <section ref={summaryRef} className="pw-summary" data-testid="order-summary" aria-label={PAY.summaryLabel}>
              <div className="pw-sum-head">
                <span className="pw-eyebrow">{PAY.yourOrder}</span>
                <Segmented<OrderDraft["interval"]>
                  aria-label={ORDER.rows.interval}
                  size="sm"
                  options={[
                    { v: "month", label: "Monatlich" },
                    { v: "year", label: label ? `Jährlich ${label}` : "Jährlich" },
                  ]}
                  value={draft.interval}
                  onChange={(v) => change({ interval: v })}
                />
              </div>
              <div className="pw-row" data-testid="order-total">
                <b data-testid="order-plan">Trade Journal {cat.name}</b>
                <span>
                  {formatMoney(s.payCents, s.currency)} {per}
                </span>
                <small data-testid="order-renewal">{ORDER.renewal(formatOrderDay(s.renewal), draft.interval, formatMoney(s.totalCents, s.currency))}</small>
                {s.payCents !== s.totalCents && promo?.valid && <small className="!text-win">{ORDER.couponNote(promo.code)}</small>}
              </div>
              {draft.plan === "team" && (
                <div className="pw-row" data-testid="order-seats">
                  <b>{ORDER.rows.seats}</b>
                  <span>
                    <Stepper value={s.draft.seats} min={PLAN_CATALOG.team.minSeats ?? 2} max={PLAN_CATALOG.team.maxSeats ?? 50} onChange={(n) => change({ seats: n })} decreaseLabel={ORDER.seatsLess} increaseLabel={ORDER.seatsMore} testId="order-seat-stepper" />
                  </span>
                  <small>{ORDER.seatsLine(s.draft.seats, `${formatMoney(s.unitCents, s.currency)} ${per}`)}</small>
                </div>
              )}
              <div className="pw-row" data-testid="order-first">
                <b>{s.trialDays > 0 ? PAY.trialRow(s.trialDays) : PAY.firstRow}</b>
                <span data-tone={s.trialDays > 0 ? "win" : undefined}>{s.trialDays > 0 ? PAY.included : formatMoney(s.payCents, s.currency)}</span>
                <small>{s.trialDays > 0 ? ORDER.trial(s.trialDays, formatOrderDay(s.firstPayment), formatMoney(s.totalCents, s.currency), per) : embedded ? PAY.noTrialHere(formatMoney(s.totalCents, s.currency), per) : ORDER.noTrial(formatMoney(s.totalCents, s.currency), per)}</small>
              </div>
              <div className="pw-row" data-testid="order-cancel">
                <b>{ORDER.rows.cancel}</b>
                <span>{PAY.anytime}</span>
                <small>{PAY.cancelShort}</small>
              </div>
              <div className="pw-row" data-testid="order-tax">
                <b>{ORDER.rows.tax}</b>
                <span>{s.automaticTax ? PAY.taxStripe : PAY.taxIncl}</span>
                <small>
                  {embedded ? (
                    <span data-testid="order-tax-note">{PAY.taxHere}</span>
                  ) : (
                    <>
                      {s.automaticTax ? ORDER.taxOn : ORDER.taxOff} <span data-testid="order-tax-note">{PRICE_TAX_NOTE}</span>
                    </>
                  )}
                </small>
              </div>
              <div className="pw-total">
                <span>{PAY.dueToday}</span>
                <strong data-testid="order-today">{amountToday}</strong>
              </div>
            </section>

            <form
              ref={formRef}
              className="pw-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                pay();
              }}
              // usable again as soon as the card turns back (an error): a tap during the 300 ms return must not get lost
              inert={stage === "lifting" || stage === "landed" || undefined}
            >
              <h2 id={titleId} className="pw-title pw-abs" style={at(ROWS.title)}>
                {embedded ? PAY.title : ORDER.title}
                {embedded && source === "demo" && (
                  <span className="pw-demo" data-testid="pay-demo-badge">
                    DEMO
                  </span>
                )}
              </h2>
              <p className="pw-sub pw-abs" style={at(ROWS.sub)}>
                {embedded ? (source === "demo" ? PAY.subDemo : PAY.sub) : ORDER.lead}
              </p>
              {!gate.open ? (
                <div className="pw-abs" style={at(ROWS.holderLabel)}>
                  <ClosedNotice mode={mode} config={config} />
                  <p className="pw-sub mt-2" data-testid="order-closed">
                    {gate.blockedBy.includes("legal") ? ORDER.closedLegal : ORDER.closedStripe}
                  </p>
                </div>
              ) : embedded ? (
                <>
                  <label className="pw-label pw-abs" style={at(ROWS.holderLabel)} htmlFor={`${titleId}-holder`}>
                    {PAY.holder}
                  </label>
                  <div className="pw-abs" style={at(ROWS.holder)}>
                    <div className="pw-box" data-focus={focus === "holder" ? "" : undefined} data-invalid={tried && !holder.trim() ? "" : undefined}>
                      {Icon.person}
                      <input
                        id={`${titleId}-holder`}
                        name="cc-name"
                        autoComplete="cc-name"
                        value={holder}
                        placeholder={PAY.holderPh}
                        onChange={(e) => setHolder(e.target.value.slice(0, 26))}
                        onFocus={() => setFocus("holder")}
                        onBlur={() => setFocus((c) => (c === "holder" ? null : c))}
                        data-testid="pay-holder"
                      />
                    </div>
                    {tried && !holder.trim() && <p className="pw-ferr">{PAY.missing.holder}</p>}
                  </div>
                  <span className="pw-label pw-abs" style={at(ROWS.numberLabel)} id={`${titleId}-nl`}>
                    {PAY.number}
                  </span>
                  <div className="pw-abs" style={at(ROWS.number)}>
                    <div className="pw-box" data-focus={focus === "number" ? "" : undefined} data-invalid={fieldErr("number") ? "" : undefined} aria-labelledby={`${titleId}-nl`} role="group">
                      {Icon.card}
                      <div ref={numberMount} className="pw-mount" data-testid="pay-number" />
                      {brand && <span className="pc-brand">{brand}</span>}
                    </div>
                    {fieldErr("number") && (
                      <p className="pw-ferr" role="alert" data-testid="pay-number-error">
                        {fieldErr("number")}
                      </p>
                    )}
                  </div>
                  <div className="pw-pair pw-abs" style={at(ROWS.pairLabel)}>
                    <span className="pw-label" id={`${titleId}-el`}>
                      {PAY.expiry}
                    </span>
                    <span className="pw-label" id={`${titleId}-cl`}>
                      {PAY.cvc} <i>· {PAY.cvcBack}</i>
                    </span>
                  </div>
                  <div className="pw-pair pw-abs" style={at(ROWS.pair)}>
                    <div>
                      <div className="pw-box" data-focus={focus === "expiry" ? "" : undefined} data-invalid={fieldErr("expiry") ? "" : undefined} aria-labelledby={`${titleId}-el`} role="group">
                        {Icon.calendar}
                        <div ref={expiryMount} className="pw-mount" data-testid="pay-expiry" />
                      </div>
                      {fieldErr("expiry") && <p className="pw-ferr">{fieldErr("expiry")}</p>}
                    </div>
                    <div>
                      <div className="pw-box" data-focus={focus === "cvc" ? "" : undefined} data-invalid={fieldErr("cvc") ? "" : undefined} aria-labelledby={`${titleId}-cl`} role="group">
                        {Icon.lock}
                        <div ref={cvcMount} className="pw-mount" data-testid="pay-cvc" />
                      </div>
                      {fieldErr("cvc") && <p className="pw-ferr">{fieldErr("cvc")}</p>}
                    </div>
                  </div>
                  {fieldsFailed && (
                    <p className="pw-ferr pw-abs" style={at(ROWS.pair + 8)} role="alert">
                      {PAY.fieldsFailed}
                    </p>
                  )}
                </>
              ) : (
                <div className="pw-handover pw-abs" style={at(ROWS.holderLabel)} data-testid="order-handover">
                  <span>{signedIn ? PAY.handover : ORDER.signInNote}</span>
                  <span>{ORDER.payment}</span>
                </div>
              )}
              <div className="pw-flow" style={!gate.open || !embedded ? { top: "calc(45cqh - 9.4cqh)" } : undefined}>
                {gate.open && (
                  <div className="pw-consents" data-testid="order-consents">
                    <Check checked={form.terms} onChange={setTerms} invalid={form.tried} testId="order-terms">
                      {TERMS_CONSENT}
                    </Check>
                    {/* the documents as their own links (inside the running sentence they could not be tapped on a phone) */}
                    <nav aria-label={PAY.legalLinks} className="pw-links" data-testid="order-legal-links">
                      <LegalLink doc="agb" />
                      <LegalLink doc="widerruf">{TERMS_PARTS.widerruf}</LegalLink>
                      <LegalLink doc="datenschutz">{TERMS_PARTS.datenschutz}</LegalLink>
                    </nav>
                    {form.tried && !form.terms && (
                      <p role="alert" className="pw-ferr">
                        {ORDER.termsMissing}
                      </p>
                    )}
                    <Check checked={form.immediate} onChange={setImmediate} invalid={form.tried} testId="order-immediate">
                      {IMMEDIATE_START_CONSENT}
                    </Check>
                    {form.tried && !form.immediate && (
                      <p role="alert" className="pw-ferr">
                        {ORDER.immediateMissing}
                      </p>
                    )}
                  </div>
                )}
                {form.error && (
                  <p role="alert" className="pw-ferr" data-testid="order-error">
                    {form.error}
                  </p>
                )}
                <button
                  type="submit"
                  className="pw-pay"
                  disabled={!gate.open || (signedIn && ready.blocked === "busy")}
                  aria-busy={form.phase !== "idle" || undefined}
                  data-testid="order-pay"
                  data-phase={form.phase}
                >
                  {Icon.lock}
                  <span style={form.phase === "confirming" && !embedded ? { opacity: 0 } : undefined}>{!signedIn ? ORDER.signInButton : form.phase === "redirecting" ? ORDER.redirecting : BUTTON_LABELS.order}</span>
                  {Icon.arrow}
                  {form.phase === "confirming" && !embedded && (
                    <span className="pay-orbs" data-testid="button-orbs" aria-hidden="true">
                      {[0, 1, 2, 3, 4, 5].map((k) => (
                        <i key={k} style={{ "--k": k } as React.CSSProperties} />
                      ))}
                    </span>
                  )}
                </button>
                <div className="pw-trust">
                  <span>
                    {Icon.shield}
                    {PAY.trustStripe}
                  </span>
                  <span>
                    {Icon.lock}
                    {PAY.trustTls}
                  </span>
                </div>
                <p className="pw-note">
                  {ORDER.notAdvice} {!legalConfig().draftsReviewed && ORDER.draft}{" "}
                  <button
                    type="button"
                    className="touch-hit"
                    onClick={() => {
                      closeOrder();
                      closeDetail();
                      openDetail(draft.plan);
                    }}
                    data-testid="order-details"
                  >
                    {ORDER.details}
                  </button>
                </p>
              </div>
            </form>

            <div ref={statusRef} className="pw-status" data-on={stage !== "rest" ? "" : undefined} data-state={shown} role="status" aria-live="polite" aria-hidden={stage === "rest" || undefined} data-testid="pay-status">
              <div className="pw-spin" aria-hidden="true">
                {shown !== "confirmed" && <div ref={spinnerRef} className="pw-spinner" />}
                {shown === "confirmed" && (
                  <svg viewBox="0 0 40 40" className="pw-ok" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle ref={ringRef} cx="20" cy="20" r="17" pathLength={1} strokeDasharray="1" />
                    <path ref={tickRef} d="M12.5 20.5l5 5 10-11" pathLength={1} strokeDasharray="1" />
                  </svg>
                )}
              </div>
              <p className="pw-status-title" data-testid="pay-status-title">
                {statusTitle}
              </p>
              <p className="pw-status-sub">{statusSub}</p>
              {(shown === "confirmed" || shown === "slow") && (
                <button ref={doneRef} type="button" className="pw-again" onClick={close} data-testid="pay-done">
                  {shown === "confirmed" ? PAY.done : ORDER.close}
                </button>
              )}
            </div>
          </div>
        </div>
        <button type="button" className="pw-close" onClick={close} disabled={inFlight} aria-label={ORDER.close} data-testid="order-cancel-btn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
