/**
 * The order summary (Bestellübersicht, B4) – a glass sheet with focus trap, scroll lock and Esc (the `Sheet`), opened by
 * `requestOrder` once the person is signed in. It shows, BEFORE the order is placed (§ 312j Abs. 2 BGB): the plan and its main
 * contents, interval and seats, the total price, the price AFTER a trial and the date of the first payment, the automatic
 * renewal with its date, the cancellation (no notice period), and how tax is shown – never an invented "0,00". Two separate,
 * never pre-ticked boxes (AGB / Widerruf / Datenschutz, and the express request for an immediate start with its knowledge of
 * Wertersatz and Erlöschen – wording from `src/legal/consentRecord.ts`); the button says exactly "Zahlungspflichtig bestellen".
 * ENTWURF – Prüfung durch Anwalt nötig. The order is placed only by the button (`submitOrder`).
 *
 * Paket B (after the payment reference): two columns from `md` (a phone: card on top, the summary below). The LEFT column is the
 * plan card (`PlanCardArt`) – an illustration of the choice that follows every change (interval, seats) and turns over to show
 * what is included; it is NOT a card form (Stripe's own page takes the payment, we never see card data). A quiet path band says
 * where the order is (step 3 is the result page). The total stands next to the button. After the click the summary gives way
 * to the `PayStage` (calm hand-over, same size, nothing jumps) until Stripe opens – or, when the order fails, comes back
 * unchanged with the reason and the way to try again.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { legalConfig } from "@/legal/config";
import { ConsentCheck } from "@/legal/ConsentCheck";
import { LegalLink } from "@/legal/LegalLinks";
import { TERMS_CONSENT } from "@/legal/consentRecord";
import { IMMEDIATE_START_CONSENT } from "@/legal/consentTexts";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { Stepper } from "@/primitives/Stepper";
import { formatMoney } from "../format";
import { highlightsFor, PLAN_CATALOG } from "../plans";
import { closeDetail, closeOrder, noteOrderReturn, openDetail, useBilling, useBillingMode, useOffer, usePurchaseGate, useTrialDays } from "../store";
import { ClosedNotice, Mark, PriceDigits } from "../ui/parts";
import { formatOrderDay, savingLabel, seatsFor, summarize, type OrderDraft } from "./order";
import { markTried, resetOrderForm, setImmediate, setTerms, submitOrder, useOrderForm } from "./orderState";
import { PayButton } from "./PayButton";
import { PayStage } from "./PayStage";
import { PlanCardArt } from "./PlanCardArt";
import { ORDER, PRICE_TAX_NOTE } from "./strings";
import "./purchase.css";

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2.5 text-[13.5px] sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid={testId}>
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

/** The quiet path of the order: 1 prüfen · 2 Zahlung bei Stripe · 3 Bestätigung (reached only on the result page, from the server's word). */
function Steps({ current }: { current: 0 | 1 }) {
  return (
    <ol aria-label={ORDER.steps.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint" data-testid="order-steps">
      {ORDER.steps.items.map((t, i) => (
        <li key={t} aria-current={i === current ? "step" : undefined} data-state={i < current ? "done" : i === current ? "now" : "next"} className={cn("flex items-center gap-2", i === current && "font-medium text-fg")}>
          <span className="font-mono">{i + 1}</span>
          {t}
          {i < ORDER.steps.items.length - 1 && <span aria-hidden="true" className="h-px w-5 bg-line-2" />}
        </li>
      ))}
    </ol>
  );
}

/** The plan card with its turn button. A component of its own, keyed by the opening of the order: a new order starts on the front. */
function OrderCard({ draft, totalCents, currency, highlights }: { draft: OrderDraft; totalCents: number; currency: string; highlights: readonly string[] }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="grid content-start justify-items-start gap-3">
      <PlanCardArt plan={draft.plan} interval={draft.interval} seats={draft.seats} totalCents={totalCents} currency={currency} flipped={flipped} highlights={highlights} />
      <Button size="sm" variant="ghost" onClick={() => setFlipped((v) => !v)} aria-pressed={flipped} data-testid="order-flip">
        {ORDER.flip}
      </Button>
      <p className="max-w-[20rem] text-[11.5px] leading-snug text-faint" data-testid="order-card-note">
        {ORDER.cardNote}
      </p>
    </div>
  );
}

export function OrderSheet() {
  const order = useBilling((s) => s.order);
  const config = useBilling((s) => s.config);
  const promo = useBilling((s) => s.promo);
  const mode = useBillingMode();
  const gate = usePurchaseGate();
  const trial = useTrialDays();
  const offer = useOffer();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const form = useOrderForm();
  const open = order.open && !!order.draft;
  const draft = useMemo<OrderDraft>(() => order.draft ?? { plan: "pro", interval: "year", seats: 1 }, [order.draft]);
  // the date of the order is the moment it was opened (stamped by `openOrder`, an event – not read while rendering)
  const now = useMemo(() => new Date(order.openedAt || 0), [order.openedAt]);
  const body = useRef<HTMLDivElement>(null);
  const errorLine = useRef<HTMLDivElement>(null);
  const busy = form.phase !== "idle";

  // every opening is a NEW order: new idempotency key, both boxes open
  useEffect(() => {
    if (open) resetOrderForm();
  }, [open, order.openedAt]);

  // the stage covers the summary from its top: bring the top into view (a phone's summary is taller than the screen)
  useEffect(() => {
    if (busy) body.current?.closest<HTMLElement>(".overflow-y-auto")?.scrollTo?.({ top: 0 });
  }, [busy]);
  // a failed order: the reason (and the way on) comes into view
  useEffect(() => {
    if (form.error) errorLine.current?.scrollIntoView?.({ block: "nearest" });
  }, [form.error]);

  const s = useMemo(
    () => summarize(draft, { prices: config?.prices, trialDays: trial, now, automaticTax: config?.automaticTax === true, coupon: promo?.valid ? promo : null }),
    [draft, config?.prices, config?.automaticTax, trial, now, promo],
  );
  const cat = PLAN_CATALOG[draft.plan];
  const per = ORDER.intervalWord(draft.interval, true);
  const unit = `${formatMoney(s.unitCents, s.currency)} ${per}`;
  const label = savingLabel(s.saving);
  const highlights = useMemo(() => highlightsFor(draft.plan, offer), [draft.plan, offer]);
  // with a trial the line says what is due TODAY (0 €) and what follows – never only the plan price next to the button
  const totalLine = ORDER.due(s.trialDays, formatMoney(s.payCents, s.currency), per);

  const change = (next: Partial<OrderDraft>) => {
    const d = { ...draft, ...next };
    useBilling.setState((st) => ({ order: { ...st.order, draft: { plan: d.plan, interval: d.interval, seats: seatsFor(d.plan, d.seats) } } }));
    resetOrderForm(); // another order: the consents given for the one on screen no longer apply
  };

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
    void submitOrder(draft);
  };

  const close = () => {
    if (form.phase === "confirming") return;
    closeOrder();
  };

  return (
    <Sheet open={open} onClose={close} title={ORDER.title} size="lg" dismissGuard={false} className="pay-sheet" footer={footer()}>
      <div ref={body} className="relative">
        <div
          className="grid gap-5 transition-opacity duration-200"
          style={{ opacity: busy ? 0 : 1 }}
          inert={busy || undefined}
          aria-hidden={busy || undefined}
          data-testid="order-sheet"
          data-plan={draft.plan}
          data-interval={draft.interval}
          data-seats={s.draft.seats}
        >
          <StaggerItem>
            <Steps current={busy ? 1 : 0} />
          </StaggerItem>
          <div className="grid gap-5 md:grid-cols-[19rem_minmax(0,1fr)] md:items-start md:gap-7">
            <StaggerItem className="md:sticky md:top-0">
              {/* key: a new opening of the order starts on the front of the card */}
              <OrderCard key={order.openedAt} draft={s.draft} totalCents={s.payCents} currency={s.currency} highlights={highlights} />
            </StaggerItem>
            <div className="grid min-w-0 gap-5">
              <StaggerItem className="grid gap-2">
                <p className="text-[13.5px] leading-relaxed text-mute">{ORDER.lead}</p>
              </StaggerItem>

              {!gate.open && (
                <StaggerItem>
                  <ClosedNotice mode={mode} config={config} />
                  <p className="mt-2 text-[12.5px] text-mute" data-testid="order-closed">
                    {gate.blockedBy.includes("legal") ? ORDER.closedLegal : ORDER.closedStripe}
                  </p>
                </StaggerItem>
              )}

              <StaggerItem className="pay-glass grid gap-1 p-4 sm:p-5" data-testid="order-summary">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
                  <div className="grid gap-0.5">
                    <span className="label">{ORDER.rows.plan}</span>
                    <span className="text-[20px] font-semibold tracking-tight" data-testid="order-plan">
                      Trade Journal {cat.name}
                    </span>
                  </div>
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
                <dl className="divide-y divide-white/[0.06]">
                  {draft.plan === "team" && (
                    <Row label={ORDER.rows.seats} testId="order-seats">
                      <div className="flex flex-wrap items-center gap-3">
                        <Stepper
                          value={s.draft.seats}
                          min={PLAN_CATALOG.team.minSeats ?? 2}
                          max={PLAN_CATALOG.team.maxSeats ?? 50}
                          onChange={(n) => change({ seats: n })}
                          decreaseLabel={ORDER.seatsLess}
                          increaseLabel={ORDER.seatsMore}
                          testId="order-seat-stepper"
                        />
                        <span className="text-[12.5px] text-mute">{ORDER.seatsLine(s.draft.seats, unit)}</span>
                      </div>
                    </Row>
                  )}
                  <Row label={ORDER.rows.interval}>{ORDER.intervalWord(draft.interval)}</Row>
                  <Row label={ORDER.rows.total} testId="order-total">
                    <div className="grid gap-1">
                      <PriceDigits cents={s.payCents} className="text-[34px]" />
                      <span className="text-[12px] leading-snug text-mute">{ORDER.totalNote(per)}</span>
                      {s.payCents !== s.totalCents && promo?.valid && <span className="text-[12px] text-win">{ORDER.couponNote(promo.code)}</span>}
                    </div>
                  </Row>
                  <Row label={ORDER.rows.first} testId="order-first">
                    {s.trialDays > 0
                      ? ORDER.trial(s.trialDays, formatOrderDay(s.firstPayment), formatMoney(s.totalCents, s.currency), per)
                      : ORDER.noTrial(formatMoney(s.totalCents, s.currency), per)}
                  </Row>
                  <Row label={ORDER.rows.renewal} testId="order-renewal">
                    {ORDER.renewal(formatOrderDay(s.renewal), draft.interval, formatMoney(s.totalCents, s.currency))}
                  </Row>
                  <Row label={ORDER.rows.cancel} testId="order-cancel">
                    {ORDER.cancel}
                  </Row>
                  <Row label={ORDER.rows.tax} testId="order-tax">
                    <span className="grid gap-1">
                      <span>{s.automaticTax ? ORDER.taxOn : ORDER.taxOff}</span>
                      <span className="text-[12px] text-mute" data-testid="order-tax-note">
                        {PRICE_TAX_NOTE}
                      </span>
                    </span>
                  </Row>
                </dl>
              </StaggerItem>

              <StaggerItem className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold text-mute">{ORDER.contains}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      closeOrder();
                      closeDetail();
                      openDetail(draft.plan);
                    }}
                    data-testid="order-details"
                  >
                    {ORDER.details}
                  </Button>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {highlights.map((h, i) => (
                    <li key={h} className="flex items-start gap-2.5 text-[13.5px]">
                      <Mark on delay={0.2 + i * 0.05} className="mt-px shrink-0" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </StaggerItem>

              {gate.open && (
                <StaggerItem className="grid gap-3" data-testid="order-consents">
                  <div className="grid gap-1.5">
                    <ConsentCheck checked={form.terms} onChange={setTerms} invalid={form.tried} testId="order-terms">
                      {TERMS_CONSENT}
                    </ConsentCheck>
                    {/* the documents as their own 44-px links: inside the running sentence they could not be tapped on a phone */}
                    <nav aria-label="Rechtstexte lesen" className="-mx-2.5 flex flex-wrap items-center text-[12px] text-mute" data-testid="order-legal-links">
                      <LegalLink doc="agb" className="inline-flex min-h-tap items-center px-2.5 text-fg underline" />
                      <LegalLink doc="widerruf" className="inline-flex min-h-tap items-center px-2.5 text-fg underline">
                        Widerrufsbelehrung
                      </LegalLink>
                      <LegalLink doc="datenschutz" className="inline-flex min-h-tap items-center px-2.5 text-fg underline">
                        Datenschutzerklärung
                      </LegalLink>
                    </nav>
                    {form.tried && !form.terms && (
                      <p role="alert" className="text-[12px] text-loss">
                        {ORDER.termsMissing}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <ConsentCheck checked={form.immediate} onChange={setImmediate} invalid={form.tried} testId="order-immediate">
                      {IMMEDIATE_START_CONSENT}
                    </ConsentCheck>
                    {form.tried && !form.immediate && (
                      <p role="alert" className="text-[12px] text-loss">
                        {ORDER.immediateMissing}
                      </p>
                    )}
                  </div>
                </StaggerItem>
              )}

              <StaggerItem className="grid gap-1">
                <p className="text-[12px] text-faint">{ORDER.payment}</p>
                <p className="text-[12px] text-faint">{ORDER.notAdvice}</p>
                {!legalConfig().draftsReviewed && <p className="text-[12px] text-faint">{ORDER.draft}</p>}
                {form.error && (
                  <div ref={errorLine} role="alert" className="grid gap-1" data-testid="order-error">
                    <p className="text-[12.5px] text-loss">{form.error}</p>
                    <p className="text-[12px] text-mute" data-testid="order-retry-hint">
                      {ORDER.retry}
                    </p>
                  </div>
                )}
              </StaggerItem>
            </div>
          </div>
        </div>
        {busy && <PayStage phase={form.phase as "confirming" | "redirecting"} plan={draft.plan} interval={draft.interval} seats={s.draft.seats} totalCents={s.payCents} currency={s.currency} highlights={highlights} totalLine={totalLine} renewalLine={ORDER.renewal(formatOrderDay(s.renewal), draft.interval, formatMoney(s.totalCents, s.currency))} />}
      </div>
    </Sheet>
  );

  function footer() {
    return (
      <>
        <Button variant="ghost" onClick={close} disabled={form.phase === "confirming"} data-testid="order-cancel-btn">
          {ORDER.close}
        </Button>
        <span className="flex-1" />
        {!signedIn && gate.open && <span className="basis-full text-[12px] text-mute sm:basis-auto">{ORDER.signInNote}</span>}
        {/* the amount due stands next to the button (the order button itself keeps its legally fixed words) */}
        {gate.open && signedIn && (
          <span className="basis-full text-right text-[13px] text-mute sm:basis-auto" data-testid="order-footer-total">
            {s.trialDays > 0 ? null : <>{ORDER.footerTotal} </>}
            <span className="num font-mono font-semibold text-fg">{totalLine}</span>
          </span>
        )}
        {/* busy is guarded inside the button (it stays readable: "Wird vorbereitet …"); `disabled` is only for the closed flow */}
        <PayButton phase={form.phase} disabled={!gate.open} onPay={pay} idleLabel={!signedIn ? ORDER.signInButton : undefined} />
      </>
    );
  }
}
