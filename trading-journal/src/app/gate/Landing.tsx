/**
 * Landing page (Launch-Audit B3, `gate: "landing"` in `src/cloud/gate.ts`): what a first visit of the start page sees INSTEAD of the
 * registration form – what the journal does, how you work with it, and the plans to choose from. Its own lazy chunk inside the gate
 * chunk (a returning browser never loads it); the styles live in `landing.css`, not in the first-load stylesheet.
 *
 * - Bar: the wordmark, „Anmelden“ (the account pill) and „Konto erstellen“ – the bar of the public pricing page.
 * - Hero: the claim builds up piece by piece (eyebrow → two title lines → lead → buttons → promise), next to it a SAMPLE journal
 *   (labelled as one): five trades land row by row, the result line draws itself, then the two lines the journal reads out of them.
 * - Three steps, the plans (Monat / Jahr, the four cards of the pricing page with their real prices and buttons), the full comparison,
 *   the FAQ, a closing call and the public links.
 *
 * Every button does what the pricing page's buttons do: „Kostenlos starten“ → `requestFree()` (registration, no order), a plan's button
 * → `requestOrder` (notes the choice, opens the registration; the order comes back after the login). The window opens OVER the page as a
 * dialog (close, Escape) – the same as on `#preise`. Nothing here claims numbers nobody measured: no user counts, no promised results.
 * Motion: opacity / transform / clip-path only, each piece once; reduced motion shows the rest pose at once (global rule in `base.css`,
 * `useReducedFx` for the curve).
 */
import { animate, useMotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { requestFree, useBilling, useBillingMode } from "@/billing/store";
import { ClosedNotice, OutageNotice } from "@/billing/ui/parts";
import { closeAuthSheet, openAuthSheet, useCloudSession } from "@/cloud/session";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { AuthSheet } from "@/cloud/ui/AuthSheet";
import { EquityDraw } from "@/motion/fx/EquityDraw";
import { Reveal } from "@/motion/Reveal";
import { ease } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { PlanComparison } from "@/views/preise/PlanComparison";
import { PlanGrid } from "@/views/preise/PlanGrid";
import { IntervalToggle, LegalLine } from "@/views/preise/PreiseView";
import { PricingFaq } from "@/views/preise/PricingFaq";
import { StatsMarquee } from "@/views/preise/StatsMarquee";
import "./landing.css";
import { formatR, GATE, LANDING } from "./strings";

/** Seconds after the page's entrance at which the sample's result line starts to draw (the five rows have landed by then). */
export const SAMPLE_DRAW = { delay: 1.25, duration: 1.1 } as const;

/** The running result of the sample's trades in R (starts at 0): the line the panel draws. */
export function sampleCurve(rows: readonly { r: number }[] = LANDING.sample.rows): number[] {
  const out = [0];
  for (const row of rows) out.push(Math.round((out[out.length - 1]! + row.r) * 10) / 10);
  return out;
}

/** The order of a piece in its group's build-up (`--i`, read by `landing.css`). */
const step = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

/** The sample journal next to the claim: rows, the line, the reading – one after another. */
function Sample() {
  const reduced = useReducedFx();
  const progress = useMotionValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      progress.set(1);
      return;
    }
    const run = animate(progress, 1, { duration: SAMPLE_DRAW.duration, delay: SAMPLE_DRAW.delay, ease: ease.out });
    return () => run.stop();
  }, [reduced, progress]);
  const s = LANDING.sample;
  return (
    <figure className="lp-sample" data-testid="landing-sample">
      <figcaption className="lp-sample-head">
        <span>{s.title}</span>
        <span className="lp-tag">{s.label}</span>
      </figcaption>
      <ul className="lp-rows">
        {s.rows.map((row, i) => (
          <li key={i} className="lp-row" style={step(i)}>
            <span className="lp-pair">{row.pair}</span>
            <span className="lp-side">{row.side}</span>
            <span className="lp-setup">{row.setup}</span>
            <span className="lp-r" data-tone={row.r < 0 ? "loss" : "win"}>
              {formatR(row.r)}
            </span>
          </li>
        ))}
      </ul>
      <EquityDraw values={sampleCurve()} height={96} tone="win" label={s.curve} progress={progress} className="lp-curve" />
      <div className="lp-verdict">
        <span className="lp-verdict-label">{s.verdictLabel}</span>
        {s.verdict.map((v, i) => (
          <p key={v.name} className="lp-verdict-row" style={step(i)}>
            <span>{v.name}</span>
            <span className="lp-r" data-tone={v.r < 0 ? "loss" : "win"}>
              {formatR(v.r)}
            </span>
          </p>
        ))}
      </div>
    </figure>
  );
}

export default function Landing({ foot }: { foot: ReactNode }) {
  const mounted = useCloudSession((s) => s.sheet.mounted);
  const mode = useBillingMode();
  const config = useBilling((s) => s.config);
  const reduced = useReducedFx();
  const hasLocal = useJournal((s) => s.trades.length > 0);
  const plansHead = useRef<HTMLHeadingElement>(null);
  // from the gate (a deep link's window, then the wordmark): the gate's window is not a dialog to close here – the page comes first
  useLayoutEffect(() => {
    const s = useCloudSession.getState().sheet;
    if (s.open && s.source === "gate") closeAuthSheet();
  }, []);
  const toPlans = () => {
    const el = plansHead.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };
  return (
    <div className="lp" data-testid="entry-landing">
      <header className="aw-pricing-bar" data-layer="Kopfzeile">
        <div className="aw-pricing-row">
          <span className="aw-gate-word">{GATE.word}</span>
          <div className="aw-pricing-actions">
            <AccountPill />
            <Button size="sm" variant="primary" fx={false} onClick={() => openAuthSheet("signup", "card")} data-testid="landing-signup">
              {GATE.signup}
            </Button>
          </div>
        </div>
      </header>
      <main className="lp-main">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-claim">
            <p className="lp-eyebrow lp-in" style={step(0)}>
              <span aria-hidden="true" className="lp-dot" />
              {LANDING.eyebrow}
            </p>
            <h1 id="lp-title" className="lp-title">
              <span className="lp-in" style={step(1)}>
                {LANDING.title[0]}
              </span>{" "}
              <em className="lp-in" style={step(2)}>
                {LANDING.title[1]}
              </em>
            </h1>
            <p className="lp-lead lp-in" style={step(3)}>
              {LANDING.lead}
            </p>
            <div className="lp-actions lp-in" style={step(4)}>
              <Button variant="primary" fx={false} onClick={requestFree} data-testid="landing-start">
                {LANDING.start}
              </Button>
              <Button variant="secondary" fx={false} onClick={toPlans} data-testid="landing-compare">
                {LANDING.compare}
              </Button>
            </div>
            <p className="lp-promise lp-in" style={step(5)}>
              {LANDING.promise}
            </p>
            {/* a browser that already holds a journal (the app before the account): nothing is lost – said where the decision is made */}
            {hasLocal && (
              <p className="lp-promise lp-in" style={step(6)} data-testid="landing-local-note">
                {GATE.localNote}
              </p>
            )}
          </div>
          <Sample />
        </section>

        <section className="lp-section" aria-labelledby="lp-steps">
          <h2 id="lp-steps" className="lp-kicker">
            <span aria-hidden="true" className="lp-dot" />
            {LANDING.stepsTitle}
          </h2>
          <ol className="lp-steps">
            {LANDING.steps.map((s, i) => (
              <Reveal as="li" key={s.no} index={i} className="lp-step">
                <span aria-hidden="true" className="lp-step-no">
                  {s.no}
                </span>
                <h3 className="lp-step-title">{s.title}</h3>
                <p className="lp-step-text">{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        <section className="lp-section" aria-labelledby="lp-plans" data-testid="landing-plans">
          <div className="lp-plans-head">
            <div className="lp-plans-copy">
              <p className="lp-kicker">
                <span aria-hidden="true" className="lp-dot" />
                {LANDING.plansEyebrow}
              </p>
              <h2 id="lp-plans" ref={plansHead} tabIndex={-1} className="lp-h2">
                {LANDING.plansTitle}
              </h2>
              <p className="lp-lead">{LANDING.plansLead}</p>
            </div>
            <IntervalToggle />
          </div>
          {mode !== "open" && <ClosedNotice mode={mode} config={config} />}
          <OutageNotice />
          <PlanGrid />
          <Reveal>
            <StatsMarquee />
          </Reveal>
          <Reveal>
            <PlanComparison />
          </Reveal>
          <Reveal>
            <PricingFaq />
          </Reveal>
        </section>

        <Reveal as="section" className="lp-end" aria-labelledby="lp-end">
          <h2 id="lp-end" className="lp-h2">
            {LANDING.endTitle}
          </h2>
          <p className="lp-lead">{LANDING.endText}</p>
          <div className="lp-actions">
            <Button variant="primary" fx={false} onClick={requestFree} data-testid="landing-start-end">
              {LANDING.start}
            </Button>
            <Button variant="ghost" fx={false} onClick={() => openAuthSheet("signin", "card")} data-testid="landing-signin">
              {LANDING.signin}
            </Button>
          </div>
        </Reveal>
        <LegalLine />
      </main>
      <div className="aw-pricing-foot">{foot}</div>
      {mounted && <AuthSheet />}
    </div>
  );
}
