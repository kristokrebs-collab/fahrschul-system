/**
 * The card graphic of the payment window (Paket V, `docs/audit/V-VORBILD.md` § 2.1–2.3): ISO format 1.59 : 1, front (chip, contactless,
 * brand block, number in four groups, holder, expiry, card brand) and back (magnetic stripe, signature panel with the security-code box,
 * small print). It turns about the vertical axis when the security code has the focus (CSS transition 290 ms `cubic-bezier(0.3,0,0.3,1)`).
 *
 * What it can show is what Stripe tells us: the number field is `empty` / `complete` and has a `brand` – never digits. So the number row
 * fills in GROUPS of "••••" (the first group with the first keystroke, the other three when the number is complete; each group falls in
 * ≈ 100 ms), the expiry and the security code turn solid when complete. The holder's name is OUR field: it shows live, every character
 * falling in.
 */
import { useLayoutEffect, useRef } from "react";
import { payStage } from "@/motion/vorbild";
import { canAnimate } from "@/motion/waapi";

export interface CardView {
  holder: string;
  /** 0 = empty, 1 = typing, 4 = complete (groups shown solid). */
  groups: 0 | 1 | 4;
  expiry: boolean;
  cvc: boolean;
  brand: string | null;
  flipped: boolean;
  plan: string;
}

/** `visa` → `VISA` (Stripe's brand keys; unknown shows nothing). */
export function brandMark(brand: string | null | undefined): string | null {
  switch (brand) {
    case "visa":
      return "VISA";
    case "mastercard":
      return "mastercard";
    case "amex":
      return "AMEX";
    case "discover":
      return "DISCOVER";
    case "diners":
      return "DINERS";
    case "jcb":
      return "JCB";
    case "unionpay":
      return "UnionPay";
    default:
      return null;
  }
}

const fall = (el: Element | null, delay: number, reduced: boolean) => {
  if (!canAnimate(el) || reduced) return;
  el.animate([{ opacity: 0, translate: "0 -0.5em", scale: "0.6" }, { opacity: 1, translate: "0 0", scale: "1" }], { duration: payStage.fallIn.duration, delay, easing: payStage.fallIn.easing, fill: "backwards" }).id = "pay:fall";
};

/** Text whose NEW characters fall in (the holder's name). */
function FallText({ text, reduced }: { text: string; reduced: boolean }) {
  const prev = useRef(text.length);
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = text.length;
    if (text.length <= from || !box.current) return;
    const spans = box.current.children;
    for (let i = from; i < text.length; i++) fall(spans[i] ?? null, 0, reduced);
  }, [text, reduced]);
  return (
    <span ref={box} className="pc-fall">
      {[...text].map((ch, i) => (
        <span key={i}>{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}

const Chip = () => (
  <svg viewBox="0 0 40 30" className="pc-chip" aria-hidden="true">
    <rect x="0.75" y="0.75" width="38.5" height="28.5" rx="5" fill="url(#pc-chip-g)" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1" />
    <defs>
      <linearGradient id="pc-chip-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e6e6e4" />
        <stop offset="1" stopColor="#9a9a98" />
      </linearGradient>
    </defs>
    <path d="M0 10h13M0 20h13M27 10h13M27 20h13M13 0v30M27 0v30M13 15h14" stroke="rgb(0 0 0 / 0.3)" strokeWidth="1" fill="none" />
  </svg>
);
const Contactless = () => (
  <svg viewBox="0 0 24 24" className="pc-nfc" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M8 8.5a5 5 0 0 1 0 7M11.5 6a8.5 8.5 0 0 1 0 12M15 3.5a12 12 0 0 1 0 17" />
  </svg>
);

export function PayCard({ view, reduced }: { view: CardView; reduced: boolean }) {
  const row = useRef<HTMLSpanElement>(null);
  const exp = useRef<HTMLSpanElement>(null);
  const cvc = useRef<HTMLSpanElement>(null);
  const brandRef = useRef<HTMLSpanElement>(null);
  const seen = useRef({ groups: view.groups, expiry: view.expiry, cvc: view.cvc, brand: view.brand });
  // a group / the expiry / the code that just turned solid falls in (≈ 100 ms, 50 ms apart)
  useLayoutEffect(() => {
    const was = seen.current;
    if (view.groups > was.groups && row.current) {
      for (let g = was.groups; g < view.groups; g++) fall(row.current.children[g] ?? null, (g - was.groups) * payStage.fallIn.stagger, reduced);
    }
    if (view.expiry && !was.expiry) fall(exp.current, 0, reduced);
    if (view.cvc && !was.cvc) fall(cvc.current, 0, reduced);
    if (view.brand && view.brand !== was.brand && canAnimate(brandRef.current) && !reduced) brandRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 66, fill: "backwards" }).id = "pay:brand";
    seen.current = { groups: view.groups, expiry: view.expiry, cvc: view.cvc, brand: view.brand };
  }, [view.groups, view.expiry, view.cvc, view.brand, reduced]);
  const mark = brandMark(view.brand);
  return (
    <div className="pc-flipper" data-flipped={view.flipped ? "1" : "0"} data-testid="pay-card-flipper">
      <div className="pc-face pc-front">
        <div className="pc-top">
          <span className="pc-chips">
            <Chip />
            <Contactless />
          </span>
          <span className="pc-mark">
            <b>TRADE JOURNAL</b>
            <small>{view.plan}</small>
          </span>
        </div>
        <span ref={row} className="pc-number" data-testid="pay-card-number" data-groups={view.groups} aria-hidden="true">
          {[0, 1, 2, 3].map((g) => (
            <span key={g} data-on={g < view.groups ? "" : undefined}>
              ••••
            </span>
          ))}
        </span>
        <div className="pc-bottom">
          <span className="pc-field">
            <small>KARTENINHABER</small>
            <span className="pc-value" data-testid="pay-card-holder">
              {view.holder ? <FallText text={view.holder.toUpperCase()} reduced={reduced} /> : <span className="pc-ph">DEIN NAME</span>}
            </span>
          </span>
          <span className="pc-field">
            <small>GÜLTIG BIS</small>
            <span ref={exp} className="pc-value" data-on={view.expiry ? "" : undefined} data-testid="pay-card-expiry">
              ••/••
            </span>
          </span>
          <span ref={brandRef} className="pc-brand" data-testid="pay-card-brand">
            {mark}
          </span>
        </div>
      </div>
      <div className="pc-face pc-back" aria-hidden="true">
        <span className="pc-stripe" />
        <span className="pc-sign">
          <span className="pc-hatch" />
          <span ref={cvc} className="pc-cvc" data-on={view.cvc ? "" : undefined} data-testid="pay-card-cvc">
            •••
          </span>
        </span>
        <span className="pc-fine">Diese Karte bleibt bei deiner Bank. Trade Journal sieht weder Nummer noch Prüfziffer – Stripe verarbeitet die Zahlung.</span>
        <span className="pc-brand pc-brand-back">{mark}</span>
      </div>
    </div>
  );
}
