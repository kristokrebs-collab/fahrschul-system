/**
 * The Showroom's simulated hosted payment page (Paket S) – what Stripe Checkout would be, built as the choreography of the reference "Payment
 * Method Animation" in OUR look: a step band, a live card graphic that fills while you type, the card turning over when the CVC field has the
 * focus, and on "pay" the card gliding to the middle ("Die Bank wird gefragt …" with a loader), then a green glow and "Bezahlt (Demo)".
 *
 * DEMO ONLY, and said so on the page: the card fields are plain React state – nothing is stored, nothing is sent anywhere (there is no network in
 * the Showroom), and the result comes from the in-memory mock billing server. `4242 4242 4242 4242` is accepted, `4000 0000 0000 0002` is declined.
 *
 * In the REAL product the card is never typed into our page: the order sheet hands over to Stripe's own hosted Checkout (docs/SHOWROOM.md).
 */
import { LayoutGroup, motion } from "motion/react";
import { useRef, useState, type FormEvent } from "react";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import type { CheckoutRequest } from "@/billing/contract";
import { getBackend } from "../runtime";
import "./showroom.css";

export const TEST_OK = "4242 4242 4242 4242";
export const TEST_DECLINE = "4000 0000 0000 0002";
export const OUTCOMES = {
  active: "Zahlung gelingt (Tarif wird aktiv)",
  incomplete: "Bank verlangt noch eine Bestätigung (3-D-Secure-Demo)",
  unpaid: "Zahlung scheitert nach der Prüfung (Fehlerfall)",
  never: "Bestätigung kommt nicht an (Webhook bleibt aus)",
} as const;
export type OutcomeKey = keyof typeof OUTCOMES;

const CENTS: Record<string, { month: number; year: number }> = { pro: { month: 1200, year: 12000 }, premium: { month: 2400, year: 24000 }, team: { month: 1900, year: 19000 } };
const PLAN_NAME: Record<string, string> = { pro: "Pro", premium: "Premium", team: "Team" };
const eur = (cents: number): string => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function amountOf(o: Pick<CheckoutRequest, "plan" | "interval" | "seats"> | null): { cents: number; line: string } {
  if (!o) return { cents: 0, line: "Bestellung" };
  const base = CENTS[o.plan]?.[o.interval] ?? 0;
  const cents = o.plan === "team" ? base * (o.seats ?? 2) : base;
  return { cents, line: `${PLAN_NAME[o.plan] ?? o.plan} · ${o.interval === "year" ? "jährlich" : "monatlich"}${o.plan === "team" ? ` · ${o.seats ?? 2} Sitze` : ""}` };
}

/** `4242424242424242` → `4242 4242 4242 4242` (digits only, at most 16). */
export const groupNumber = (v: string): string => (v.replace(/\D/g, "").slice(0, 16).match(/.{1,4}/g) ?? []).join(" ");
export const groupExpiry = (v: string): string => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
export const brandOf = (digits: string): string => (digits.startsWith("4") ? "VISA" : /^(5[1-5]|2[2-7])/.test(digits) ? "MASTERCARD" : "KARTE");

type Phase = "form" | "authorising" | "done";

function CardArt({ number, holder, expiry, cvc, flipped }: { number: string; holder: string; expiry: string; cvc: string; flipped: boolean }) {
  const digits = number.replace(/\D/g, "");
  const shown = (digits.padEnd(16, "•").match(/.{4}/g) ?? []).join(" ");
  return (
    <div className="sr-stage">
      <div className={`sr-card${flipped ? " flip" : ""}`} data-testid="demo-card" data-flipped={flipped ? "1" : "0"}>
        <div className="sr-face">
          <div className="sr-chip-g" aria-hidden="true" />
          <span className="sr-brand">{brandOf(digits)}</span>
          <p className="sr-num" data-testid="demo-card-number">
            {shown}
          </p>
          <div className="sr-meta">
            <span data-testid="demo-card-holder">{holder.trim() || "Name auf der Karte"}</span>
            <span data-testid="demo-card-expiry">{expiry || "MM/JJ"}</span>
          </div>
        </div>
        <div className="sr-face sr-back" aria-hidden="true">
          <div className="sr-stripe" />
          <div className="sr-sign">
            <span data-testid="demo-card-cvc">{cvc.padEnd(3, "•")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoCheckout({ onLeave }: { onLeave: (url: string) => void }) {
  const reduced = useReducedFx();
  // read ONCE: the order is gone from the mock as soon as the "webhook" has landed, the amount must stay on the page
  const [{ cents, line }] = useState(() => amountOf(getBackend().billing.pendingOrder()));
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [remember, setRemember] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeKey>("active");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<OutcomeKey | null>(null);
  const back = useRef<string | null>(null);
  const layout = reduced ? { duration: 0 } : spring.layout;

  const leave = () => onLeave(back.current ?? `${location.origin}/#preise`);
  const cancel = () => {
    const done = getBackend().billing.cancelCheckout();
    onLeave(done?.location ?? `${location.origin}/#preise`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const digits = number.replace(/\D/g, "");
    const month = Number(expiry.slice(0, 2));
    if (digits.length !== 16 || !holder.trim() || !/^\d\d\/\d\d$/.test(expiry) || month < 1 || month > 12 || cvc.length !== 3) {
      setError("Bitte fülle alle Felder der Demo-Karte aus (16 Ziffern, Datum MM/JJ, CVC mit 3 Ziffern).");
      return;
    }
    setError(null);
    setFlipped(false);
    setPhase("authorising");
    window.setTimeout(
      () => {
        if (digits === TEST_DECLINE.replace(/\D/g, "")) {
          setPhase("form");
          setError("Die Demo-Karte wurde abgelehnt (Testnummer 4000 0000 0000 0002). Es wurde nichts berechnet – versuche die andere Testnummer.");
          return;
        }
        // the "webhook" lands now: the mock server learns the result of the order
        const done = getBackend().billing.completeCheckout(outcome);
        if (done) back.current = done.location;
        try {
          sessionStorage.setItem("tj2-showroom-outcome", outcome);
        } catch {
          /* blocked storage: the return note falls back to its generic text */
        }
        setResult(outcome);
        setPhase("done");
      },
      reduced ? 900 : 2600,
    );
  };

  const again = () => {
    setPhase("form");
    setResult(null);
    setError(null);
  };

  const cardArt = (
    <motion.div layoutId="sr-card" layout transition={layout} className="sr-wrap">
      <CardArt number={number} holder={holder} expiry={expiry} cvc={cvc} flipped={flipped} />
    </motion.div>
  );
  const ok = result === "active";

  return (
    <div className="sr-pay" role="dialog" aria-modal="true" aria-label="Zahlungsseite (Demo)" data-testid="demo-checkout" data-phase={phase}>
      <div className="sr-pay-bar">
        <b>Demo-Zahlungsseite</b>
        <span>kein Stripe · Demo-Karte – nichts wird gespeichert oder gesendet · Im echten Kauf gibst du die Karte bei Stripe ein</span>
      </div>
      <ol className="sr-steps" aria-label="Schritte" style={{ listStyle: "none", padding: 0 }}>
        <li>Tarif</li>
        <i aria-hidden="true" />
        <li>Angaben</li>
        <i aria-hidden="true" />
        <li className="on" aria-current="step">
          Zahlung
        </li>
      </ol>
      <LayoutGroup>
        {phase === "form" ? (
          <div className="sr-grid">
            <div className="sr-card-col">
              {cardArt}
              <p className="sr-note">Die Karte füllt sich beim Tippen; beim CVC-Feld dreht sie sich um. Nur Demo – nichts davon verlässt diese Seite.</p>
            </div>
            <form className="sr-form" onSubmit={submit} noValidate autoComplete="off" aria-label="Demo-Kartenformular">
              <h1>Zahlungsdaten (Demo-Karte)</h1>
              <div className="sr-tests" role="group" aria-label="Testnummern">
                <button type="button" className="sr-chip" data-testid="demo-fill-ok" onClick={() => { setNumber(TEST_OK); setHolder(holder || "Demo Person"); setExpiry("12/34"); setCvc("123"); }}>
                  {TEST_OK} · gelingt
                </button>
                <button type="button" className="sr-chip" data-testid="demo-fill-decline" onClick={() => { setNumber(TEST_DECLINE); setHolder(holder || "Demo Person"); setExpiry("12/34"); setCvc("123"); }}>
                  {TEST_DECLINE} · abgelehnt
                </button>
              </div>
              <label className="sr-field">
                Karteninhaber
                <input value={holder} onChange={(e) => setHolder(e.target.value.slice(0, 26))} name="sr-demo-holder" autoComplete="off" data-testid="demo-holder" />
              </label>
              <label className="sr-field">
                Kartennummer
                <span className="sr-numwrap">
                  <input value={number} onChange={(e) => setNumber(groupNumber(e.target.value))} inputMode="numeric" name="sr-demo-number" autoComplete="off" placeholder="0000 0000 0000 0000" data-testid="demo-number" />
                  <em aria-hidden="true">{brandOf(number.replace(/\D/g, ""))}</em>
                </span>
              </label>
              <div className="sr-row2">
                <label className="sr-field">
                  Gültig bis (MM/JJ)
                  <input value={expiry} onChange={(e) => setExpiry(groupExpiry(e.target.value))} inputMode="numeric" name="sr-demo-exp" autoComplete="off" placeholder="MM/JJ" data-testid="demo-expiry" />
                </label>
                <label className="sr-field">
                  CVC
                  <input
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onFocus={() => setFlipped(true)}
                    onBlur={() => setFlipped(false)}
                    inputMode="numeric"
                    name="sr-demo-cvc"
                    autoComplete="off"
                    placeholder="123"
                    data-testid="demo-cvc"
                  />
                </label>
              </div>
              <label className="sr-field">
                Ausgang (nur Demo)
                <select value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeKey)} data-testid="demo-outcome">
                  {(Object.keys(OUTCOMES) as OutcomeKey[]).map((k) => (
                    <option key={k} value={k}>
                      {OUTCOMES[k]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sr-order" aria-label="Deine Bestellung">
                <div>
                  <span>{line}</span>
                  <span>{eur(cents)}</span>
                </div>
                <div>
                  <span>Steuer</span>
                  <span>laut Stripe Tax (Demo: nicht berechnet)</span>
                </div>
                <div className="tot">
                  <span>Summe heute</span>
                  <span>{eur(cents)}</span>
                </div>
              </div>
              <label className="sr-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Karte merken – in der Demo wird nichts gespeichert.</span>
              </label>
              {error && (
                <p className="sr-err" role="alert" data-testid="demo-error">
                  {error}
                </p>
              )}
              <button type="submit" className="sr-primary" data-testid="demo-pay">
                Demo-Zahlung · {eur(cents)} →
              </button>
              <button type="button" className="sr-link" onClick={cancel} data-testid="demo-cancel">
                Abbrechen – zurück zum Journal
              </button>
            </form>
          </div>
        ) : (
          <div className={`sr-auth${phase === "done" && ok ? " paid" : ""}`} role="status" aria-live="polite" data-testid="demo-auth" data-phase={phase}>
            {cardArt}
            {phase === "authorising" ? (
              <>
                <h2>Die Bank wird gefragt …</h2>
                <span className="sr-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <p>Demo: Es gibt keine Bank – der Mock-Server antwortet in wenigen Sekunden.</p>
              </>
            ) : (
              <>
                {ok && (
                  <span className="sr-paid-mark" aria-hidden="true">
                    ✓
                  </span>
                )}
                <h2 data-testid="demo-result">{ok ? `Bezahlt (Demo) · ${eur(cents)}` : result === "unpaid" ? "Die Demo-Zahlung ist gescheitert" : "Noch nicht bestätigt (Demo)"}</h2>
                <p>
                  {ok
                    ? "Das war eine Demo: Es wurde nichts abgebucht und es gibt keinen echten Beleg. Der Mock-Server hat den Tarif freigeschaltet – im Journal siehst du ihn gleich."
                    : "Der Mock-Server hat die Bestellung noch nicht (oder nicht erfolgreich) bestätigt. Das Journal zeigt gleich, was er gemeldet hat – so sähe es auch bei Stripe aus."}
                </p>
                <div className="sr-btns">
                  <button type="button" className="sr-primary" style={{ padding: "0 26px" }} onClick={leave} data-testid="demo-continue">
                    Weiter zum Journal
                  </button>
                  <button type="button" className="sr-ghost" onClick={again} data-testid="demo-again">
                    Noch einmal ansehen
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}
