/**
 * Konto-Pflicht (`src/cloud/gate.ts`): what a signed-out visitor of a build with the cloud sees INSTEAD of the app – its own lazy chunk,
 * mounted by `App` while `useEntryGate()` says `gate` or `pricing`. The app shell (pages, header, dock, the feature hosts) is not mounted
 * at all until the session is there.
 *
 * - `gate`: the login / registration window of Paket V (`AuthSheet` → `AuthWindow`, the band animation unchanged) as a full page – always
 *   open, no close; first visit on „Konto erstellen“, a browser that had a session on „Anmelden“. Under the card the public pages:
 *   Impressum, Datenschutz, AGB, Widerruf, Hinweise, „Verträge hier kündigen“ (§ 312k BGB), „Vertrag widerrufen“ (§ 356a BGB), Preise.
 * - `pricing`: `#preise` read only (the pricing page itself, a small bar with „Anmelden“ / „Konto erstellen“, the same links below). Every
 *   buy button routes through `requestOrder`, which notes the choice and opens the registration – the order comes back after the login.
 *
 * Both mount the hosts the public pages need: the legal sheets (`?rechtliches=<doc>`), the billing host (contract pages `?kuendigen` /
 * `?widerruf` incl. the token links of the mails, `?ref=` and `?order=` of a link, the plans' prices) and the toast island (a sign-out
 * by idle time or an expired session says why). Local journal data on the device is never touched here: after the sign-in the app's
 * first sync asks what to do with it (Datenübernahme, `TakeoverDialog`).
 */
import { Suspense, useLayoutEffect, useMemo, type ReactNode } from "react";
import { HostSlot } from "@/app/HostSlot";
import { lazyView } from "@/app/pages";
import { PageSkeleton } from "@/app/PageSkeleton";
import { toIslandToast } from "@/app/toasts";
import { BillingHost } from "@/billing/ui/BillingHost";
import { gateViewOf, knownVisitor, type GateState } from "@/cloud/gate";
import { closeAuthSheet, openAuthSheet, useCloudSession } from "@/cloud/session";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { AuthSheet } from "@/cloud/ui/AuthSheet";
import { LegalHost } from "@/legal/LegalHost";
import { LegalLinks } from "@/legal/LegalLinks";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { Button } from "@/primitives/Button";
import { ToastIsland } from "@/primitives/Toast";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { GATE } from "./strings";

const Preise = lazyView("preise");

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

/** The hosts of the public pages (legal sheets, contract pages, billing links) and the toasts. */
function PublicHosts() {
  return (
    <>
      <HostSlot name="Rechtliches">
        <LegalHost />
      </HostSlot>
      <HostSlot name="Abo">
        <BillingHost onNavigate={(p) => navigate(p)} />
      </HostSlot>
      <Toasts />
    </>
  );
}

/** A link of the gate's foot that moves inside the app (a real `#…` link: open in a new tab works). */
function PageLink({ page, children }: { page: "preise"; children: ReactNode }) {
  return (
    <a
      href={`#${page}`}
      className="inline-flex min-h-tap items-center px-2.5 underline-offset-2 hover:text-fg hover:underline"
      data-testid={`gate-link-${page}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(page);
      }}
    >
      {children}
    </a>
  );
}

function GateFoot({ pricing = false }: { pricing?: boolean }) {
  const hasLocal = useJournal((s) => s.trades.length > 0);
  return (
    <footer className="aw-gate-foot" data-testid="gate-foot">
      {!pricing && hasLocal && (
        <p className="aw-gate-note" data-testid="gate-local-note">
          {GATE.localNote}
        </p>
      )}
      <LegalLinks roomy className="justify-center" />
      {!pricing && (
        <nav aria-label={GATE.moreLabel}>
          <PageLink page="preise">{GATE.pricingLink}</PageLink>
        </nav>
      )}
    </footer>
  );
}

/** The gate page: the window, the heading above it, the public links below it. */
function GatePage() {
  const sheet = useCloudSession((s) => s.sheet);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  // the sheet store follows the gate: closed (a sign-out closes it) or on a step of a session → the gate's view; a step the person is on
  // (Passwort vergessen, Postfach, a failed link's notice) stays
  useLayoutEffect(() => {
    const view = gateViewOf(sheet, needsMfa, knownVisitor());
    if (!sheet.open || sheet.view !== view) openAuthSheet(view, "gate");
  }, [sheet, needsMfa]);
  return (
    <div className="contents" data-testid="entry-gate" data-gate-view={gateViewOf(sheet, needsMfa, knownVisitor())}>
      <AuthSheet
        gate={{
          header: (
            <header className="aw-gate-head">
              <h1 className="aw-gate-word">{GATE.word}</h1>
              <p className="aw-gate-lead">{GATE.lead}</p>
            </header>
          ),
          footer: <GateFoot />,
        }}
      />
    </div>
  );
}

/** `#preise` without a login: the pricing page, read only; the bar and every buy button lead to the registration. */
function PublicPricing() {
  const mounted = useCloudSession((s) => s.sheet.mounted);
  // from the gate („Preise ansehen“): the gate's window is not a dialog to close here – the page comes first, the bar opens it again
  useLayoutEffect(() => {
    const s = useCloudSession.getState().sheet;
    if (s.open && s.source === "gate") closeAuthSheet();
  }, []);
  return (
    <div className="relative min-h-dvh" data-testid="public-pricing">
      <header className="aw-pricing-bar" data-layer="Kopfzeile">
        <div className="aw-pricing-row">
          <span className="aw-gate-word">{GATE.word}</span>
          <div className="aw-pricing-actions">
            <AccountPill />
            <Button size="sm" variant="primary" fx={false} onClick={() => openAuthSheet("signup", "card")} data-testid="gate-pricing-signup">
              {GATE.signup}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-10 pt-6 sm:px-6">
        <Suspense fallback={<PageSkeleton page="preise" />}>
          <Preise />
        </Suspense>
      </main>
      <div className="aw-pricing-foot">
        <GateFoot pricing />
      </div>
      {mounted && <AuthSheet />}
    </div>
  );
}

export default function EntryGate({ mode }: { mode: Extract<GateState, "gate" | "pricing"> }) {
  return (
    <MorphDialogProvider>
      {mode === "pricing" ? <PublicPricing /> : <GatePage />}
      <PublicHosts />
    </MorphDialogProvider>
  );
}
