import { legalShown } from "@/legal/config";
import { LegalLink } from "@/legal/LegalLinks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { armWizard } from "@/onboarding/wizard/wizardStore";
import { celebrateFrom } from "@/motion/Celebrate";
import { DotMatrix } from "@/motion/DotMatrix";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { RollingDigits } from "@/motion/RollingDigits";
import { StatusPill } from "@/motion/StatusPill";
import { TextScramble } from "@/motion/TextScramble";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { pendingOrderParam } from "@/store/returnTo";
import { pushToast } from "@/store/uiStore";
import { emailProblem, isSendLimit, passwordProblem, type AuthField } from "../authErrors";
import { oauthProviders, type OAuthProvider } from "../env";
import { setIdleMinutes, useIdlePref } from "../idle";
import { gateViewOf, knownVisitor } from "../gate";
import { ensureCloud } from "../runtime";
import { closeAuthSheet, setAuthEmail, setAuthView, useCloudSession } from "../session";
import { useSyncStatus } from "../sync/status";
import type { AuthView } from "../types";
import { at, CheckBox, ConsentLine, IconMail, IconPerson, LineField, PasswordLine, PillButton, StrengthHint } from "./AuthFields";
import { AuthWindow, bandRunning } from "./AuthWindow";
import { CODE_LENGTH, CodeSlots } from "./CodeSlots";
import { syncPill } from "./pill";
import { AUTH } from "./strings";

export { NewPasswordForm } from "./NewPasswordForm";

export interface AuthSheetProps {
  /** Opens the Konto page (the integrator passes `() => navigate("konto")`); hidden when absent. */
  onOpenAccount?: () => void;
  /**
   * Konto-Pflicht (`src/cloud/gate.ts`, mounted by `src/app/gate/EntryGate.tsx`): the window is the page in front of the app – always
   * open, no close, on the view `gateViewOf` resolves (the entry view, the step the person is on, or the 2FA code); `header` / `footer`
   * frame the card.
   */
  gate?: { header?: ReactNode; footer?: ReactNode };
}

const noop = (): void => undefined;

/**
 * Login window (P09, Paket V – all German): password, magic link, registration (strength hint, e-mail confirmation), reset, new
 * password after the reset link, the 2FA step-up after a password login, the signed-in account panel and the welcome with the first
 * sync. ONE landscape card (`AuthWindow`): Anmelden on the left with the dark band on the right, Registrieren mirrored; the switch
 * runs the band once across the card (1:1 after the reference recording, `docs/audit/V-VORBILD.md`). The other steps show in the
 * form half of the side the card is on; their rows come in with the same stagger. Reduced motion: one short cross-fade.
 *
 * Kept from before: no account enumeration (AUTH-03: the same "check your mail" step for every address), the pre-selected order in
 * every mail link (AUTH-06), the password rules, the AGB / privacy consent at registration, errors at their field (the field shakes and
 * takes the focus), offline said before anything is sent, Escape / close, the focus trap.
 */
export function AuthSheet({ onOpenAccount, gate }: AuthSheetProps) {
  const sheet = useCloudSession((s) => s.sheet);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  // warm the Supabase chunk while the user types (idempotent)
  useEffect(() => {
    void ensureCloud().catch(() => undefined);
  }, []);
  if (gate)
    return (
      <AuthWindow
        gate
        open
        view={gateViewOf(sheet, needsMfa, knownVisitor())}
        onClose={noop}
        header={gate.header}
        footer={gate.footer}
        renderView={(view, titleId) => <ViewBody view={view} titleId={titleId} onOpenAccount={onOpenAccount} />}
      />
    );
  return <AuthWindow open={sheet.open} view={sheet.view} onClose={closeAuthSheet} renderView={(view, titleId) => <ViewBody view={view} titleId={titleId} onOpenAccount={onOpenAccount} />} />;
}

function ViewBody({ view, titleId, onOpenAccount }: { view: AuthView; titleId: string; onOpenAccount?: () => void }) {
  switch (view) {
    case "signin":
    case "magic":
      return <SignInForm mode={view} titleId={titleId} />;
    case "signup":
      return <SignUpForm titleId={titleId} />;
    case "reset":
      return <ResetView titleId={titleId} />;
    case "sent":
      return <SentView titleId={titleId} />;
    case "mfa":
      return <MfaView titleId={titleId} />;
    case "newPassword":
      return <NewPasswordView titleId={titleId} />;
    case "account":
      return <AccountView titleId={titleId} onOpenAccount={onOpenAccount} />;
    case "welcome":
      return <WelcomeView titleId={titleId} />;
  }
}

/* ------------------------------------------------------------------ shared bits */

interface FieldError {
  field: AuthField;
  message: string;
  key: number;
}

let errorSeq = 0;
const errorOf = (field: AuthField, message: string): FieldError => ({ field, message, key: ++errorSeq });

async function cloudOrError(): Promise<Awaited<ReturnType<typeof ensureCloud>> | null> {
  try {
    return await ensureCloud();
  } catch {
    return null;
  }
}

/** Title + accent stroke of a form (one row of the entrance). */
function Head({ titleId, title, top }: { titleId: string; title: string; top?: number }) {
  return (
    <div className={top === undefined ? "grid gap-[1.05cqh]" : "aw-abs"} style={at(top)} data-aw-row="">
      <h2 id={titleId} className="aw-title">
        {title}
      </h2>
      <span className="aw-accent" style={top === undefined ? undefined : { marginTop: "1.05cqh" }} aria-hidden="true" />
    </div>
  );
}

/** The flowing layout of the steps after the entry (title, accent, the notice of the sheet, the body). */
function Step({ titleId, title, children }: { titleId: string; title: string; children: ReactNode }) {
  const notice = useCloudSession((s) => s.sheet.notice);
  return (
    <div className="aw-step">
      <Head titleId={titleId} title={title} />
      {notice && (
        <p className="aw-notice" data-aw-row="" data-testid="auth-notice" role="status">
          {notice}
        </p>
      )}
      {children}
    </div>
  );
}

/** A small text link of the card (switches, back). Ignored while the band runs (it runs exactly once). */
function CardLink({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      className="aw-link"
      data-testid={testId}
      onClick={() => {
        if (!bandRunning()) onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Consent at registration (the operator's own documents are linked – Review F07). */
export const AUTH_LEGAL = {
  consentPre: "Ich akzeptiere die ",
  consentMid: " und habe die ",
  datenschutz: "Datenschutzerklärung",
  consentPost: " gelesen.",
  missing: "Bitte bestätige die AGB und die Datenschutzerklärung.",
  notePre: "Es gelten die ",
  noteMid: " und die ",
  notePost: " des Betreibers.",
} as const;

/* ------------------------------------------------------------------ Anmelden (+ Link per E-Mail): form half A */

/** Row tops of the landscape card, share of the card height (measured, `V-VORBILD.md` § 1.2). */
const A_ROWS = { head: 17.3, field1: 28.2, field2: 44.9, line: 61.8, lead: 47.2, button: 68.4, foot: 81.9, error: 86.3, alt: 90.2, legal: 94.4 } as const;
/** … of the registration (§ 1.3). */
const B_ROWS = { head: 9.5, field1: 20.1, field2: 37.2, field3: 53.9, hint: 66.3, consent: 70.1, button: 76.2, error: 86.75, foot: 89.8 } as const;

function SignInForm({ mode, titleId }: { mode: "signin" | "magic"; titleId: string }) {
  const stored = useCloudSession((s) => s.sheet.email);
  const notice = useCloudSession((s) => s.sheet.notice);
  const idleNever = useIdlePref((s) => s.minutes === 0);
  const [remember, setRemember] = useState(idleNever);
  const [email, setEmail] = useState(stored);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const ids = useId();
  const providers = oauthProviders();
  const emailId = `${ids}-email`;
  const pwId = `${ids}-pw`;
  const rememberHint = `${ids}-remember`;

  /** Shows the error at its field AND moves the focus there; the screen reader hears it by the field's `aria-describedby`. */
  const fail = (e: FieldError) => {
    setErr(e);
    const target = e.field === "email" ? emailId : e.field === "password" ? pwId : null;
    if (target) requestAnimationFrame(() => document.getElementById(target)?.focus());
  };

  // Anmelden ↔ Link per E-Mail keep this form: a stale error goes, a focus in the password field (gone in "Link") moves to the e-mail
  const modeSeen = useRef(mode);
  useEffect(() => {
    if (modeSeen.current === mode) return;
    modeSeen.current = mode;
    setErr(null);
    if (mode === "magic" && (document.activeElement === document.getElementById(pwId) || !document.activeElement || document.activeElement === document.body)) document.getElementById(emailId)?.focus({ preventScroll: true });
  }, [mode, pwId, emailId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setAuthEmail(email.trim());
    const ep = emailProblem(email);
    if (ep) return fail(errorOf("email", ep));
    if (mode === "signin" && !password) return fail(errorOf("password", "Bitte gib dein Passwort ein."));
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setErr(errorOf(null, AUTH.offline));
    setErr(null);
    setBusy(true);
    const m = await cloudOrError();
    if (!m) {
      setBusy(false);
      return setErr(errorOf(null, AUTH.unavailable));
    }
    if (mode === "signin") {
      const r = await m.signInPassword(email, password);
      setBusy(false);
      if (!r.ok) {
        // right password, address not confirmed yet (the server says so only to someone who knows the password): the way on is a new link
        if (r.code === "email_not_confirmed") return setAuthView("sent", { sent: "confirm", resendNow: true, notice: AUTH.sent.notConfirmed });
        return fail(errorOf(r.field, r.message));
      }
      // "Angemeldet bleiben": off = signed out after 30 minutes without activity on this device (the Konto setting, changed only when ticked differently)
      if (remember !== idleNever) setIdleMinutes(remember ? 0 : 30);
      setAuthView(r.value.mfa ? "mfa" : "welcome");
    } else {
      const order = pendingOrderParam();
      const r = order ? await m.sendMagicLink(email, order) : await m.sendMagicLink(email);
      setBusy(false);
      if (!r.ok) return fail(errorOf(r.field, r.message));
      setAuthView("sent", { notice: null, sent: "magic" });
    }
  }

  async function oauth(p: OAuthProvider) {
    setBusy(true);
    const m = await cloudOrError();
    const r = m ? await m.signInOAuth(p) : null;
    if (!r || !r.ok) {
      setBusy(false);
      setErr(errorOf(null, r && !r.ok ? r.message : AUTH.unavailable));
    }
  }

  const toSignup = () => {
    setAuthEmail(email.trim());
    setAuthView("signup");
  };

  return (
    <form className="contents" noValidate method="post" onSubmit={(e) => void submit(e)} data-auth-mode={mode}>
      <Head titleId={titleId} title={mode === "magic" ? AUTH.titles.magic : AUTH.titles.signin} top={A_ROWS.head} />
      <LineField
        id={emailId}
        name="email"
        type="email"
        label={AUTH.email}
        // the password manager reads the pair: the identifier of a login is the "username"
        autoComplete="username"
        inputMode="email"
        spellCheck={false}
        icon={<IconPerson />}
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (err?.field === "email" && !emailProblem(v)) setErr(null);
        }}
        error={err?.field === "email" ? err.message : undefined}
        errorKey={err?.field === "email" ? err.key : null}
        top={A_ROWS.field1}
        first
      />
      {mode === "signin" ? (
        <PasswordLine
          id={pwId}
          label={AUTH.password}
          autoComplete="current-password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (err?.field === "password" && v) setErr(null);
          }}
          error={err?.field === "password" ? err.message : undefined}
          errorKey={err?.field === "password" ? err.key : null}
          top={A_ROWS.field2}
        />
      ) : (
        // a failed e-mail link lands here (`client.ts`, AUTH-05 / B9): its reason takes the lead's place – this form is the way on (a new link)
        <p className="aw-lead aw-abs" style={at(A_ROWS.lead)} data-aw-row="" {...(notice ? { role: "status", "data-notice": "", "data-testid": "auth-notice" } : {})}>
          {notice ?? AUTH.card.magicLead}
        </p>
      )}
      {mode === "signin" ? (
        <div className="aw-line aw-abs" style={at(A_ROWS.line)} data-aw-row="">
          <CheckBox checked={remember} onChange={setRemember} label={AUTH.card.remember} describedBy={rememberHint} testId="auth-remember" />
          <span id={rememberHint} className="sr-only">
            {AUTH.card.rememberHint}
          </span>
          {/* the address typed here goes along (it was dropped: the reset form opened empty, QA Runde 13) */}
          <CardLink onClick={() => setAuthView("reset", { email: email.trim() })} testId="auth-forgot">
            {AUTH.forgot}
          </CardLink>
        </div>
      ) : (
        <span className="aw-abs" style={at(A_ROWS.line)} data-aw-row="" aria-hidden="true" />
      )}
      <PillButton label={AUTH.submit[mode]} busyLabel={AUTH.busy[mode]} busy={busy} top={A_ROWS.button} />
      <p className="aw-foot aw-abs" style={at(A_ROWS.foot)} data-aw-foot="">
        <span>{AUTH.card.newHere}</span>
        <CardLink onClick={toSignup} testId="auth-to-signup">
          {AUTH.card.create}
        </CardLink>
      </p>
      {err && err.field === null && (
        <p role="alert" className="aw-msg aw-abs" style={at(A_ROWS.error)}>
          {err.message}
        </p>
      )}
      <p className="aw-foot aw-foot-small aw-abs" style={at(A_ROWS.alt)} data-aw-foot="">
        <span>{mode === "magic" ? AUTH.card.passwordAsk : AUTH.card.magicAsk}</span>
        <CardLink onClick={() => setAuthView(mode === "magic" ? "signin" : "magic")} testId="auth-magic-toggle">
          {mode === "magic" ? AUTH.card.passwordLink : AUTH.card.magicLink}
        </CardLink>
        {providers.map((p) => (
          <CardLink key={p} onClick={() => void oauth(p)}>
            {AUTH.oauthNames[p] ?? p}
          </CardLink>
        ))}
      </p>
      {legalShown() && (
        // signing in: the operator's documents as a note, no box (Review F07; the box is the registration's)
        <p className="aw-legal aw-abs" style={at(A_ROWS.legal)} data-aw-foot="" data-testid="auth-legal-note">
          {AUTH_LEGAL.notePre}
          <LegalLink doc="agb" />
          {AUTH_LEGAL.noteMid}
          <LegalLink doc="datenschutz">{AUTH_LEGAL.datenschutz}</LegalLink>
          {AUTH_LEGAL.notePost}
        </p>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ Registrieren: form half B */

function SignUpForm({ titleId }: { titleId: string }) {
  const consentNeeded = legalShown();
  const stored = useCloudSession((s) => s.sheet.email);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(stored);
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const ids = useId();
  const emailId = `${ids}-email`;
  const pwId = `${ids}-pw`;

  const fail = (e: FieldError) => {
    setErr(e);
    const target = e.field === "email" ? emailId : e.field === "password" ? pwId : null;
    if (target) requestAnimationFrame(() => document.getElementById(target)?.focus());
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setAuthEmail(email.trim());
    const ep = emailProblem(email);
    if (ep) return fail(errorOf("email", ep));
    const pp = passwordProblem(password);
    if (pp) return fail(errorOf("password", pp));
    // registration: the operator's AGB and privacy policy first (Review F07)
    if (consentNeeded && !consent) {
      setConsentMissing(true);
      return setErr(errorOf(null, AUTH_LEGAL.missing));
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setErr(errorOf(null, AUTH.offline));
    setErr(null);
    setBusy(true);
    const m = await cloudOrError();
    if (!m) {
      setBusy(false);
      return setErr(errorOf(null, AUTH.unavailable));
    }
    const order = pendingOrderParam();
    const given = name.trim();
    const r = given ? await m.signUp(email, password, order ?? null, given) : order ? await m.signUp(email, password, order) : await m.signUp(email, password);
    setBusy(false);
    if (!r.ok) return fail(errorOf(r.field, r.message));
    // a registration arms the setup wizard (once; it opens after the sign-in, when nothing else owns the screen)
    armWizard();
    setAuthView(r.value.confirm ? "sent" : "welcome", { sent: "confirm" });
  }

  return (
    <form className="contents" noValidate method="post" onSubmit={(e) => void submit(e)} data-auth-mode="signup">
      <Head titleId={titleId} title={AUTH.titles.signup} top={B_ROWS.head} />
      <LineField id={`${ids}-name`} name="name" label={AUTH.card.name} autoComplete="name" icon={<IconPerson />} value={name} onChange={setName} top={B_ROWS.field1} first describedBy={`${ids}-name-hint`} />
      <span id={`${ids}-name-hint`} className="sr-only">
        {AUTH.card.nameHint}
      </span>
      <LineField
        id={emailId}
        name="email"
        type="email"
        label={AUTH.email}
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        icon={<IconMail />}
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (err?.field === "email" && !emailProblem(v)) setErr(null);
        }}
        error={err?.field === "email" ? err.message : undefined}
        errorKey={err?.field === "email" ? err.key : null}
        top={B_ROWS.field2}
      />
      <PasswordLine
        id={pwId}
        label={AUTH.password}
        autoComplete="new-password"
        value={password}
        onChange={(v) => {
          setPassword(v);
          if (err?.field === "password" && !passwordProblem(v)) setErr(null);
        }}
        error={err?.field === "password" ? err.message : undefined}
        errorKey={err?.field === "password" ? err.key : null}
        top={B_ROWS.field3}
      />
      <StrengthHint password={password} top={B_ROWS.hint} />
      {consentNeeded && (
        <ConsentLine
          checked={consent}
          onChange={(v) => {
            setConsent(v);
            if (v) {
              setConsentMissing(false);
              if (err?.message === AUTH_LEGAL.missing) setErr(null);
            }
          }}
          invalid={consentMissing}
          top={B_ROWS.consent}
        >
          {AUTH_LEGAL.consentPre}
          <LegalLink doc="agb" />
          {AUTH_LEGAL.consentMid}
          <LegalLink doc="datenschutz">{AUTH_LEGAL.datenschutz}</LegalLink>
          {AUTH_LEGAL.consentPost}
        </ConsentLine>
      )}
      <PillButton label={AUTH.submit.signup} busyLabel={AUTH.busy.signup} busy={busy} top={B_ROWS.button} />
      {err && err.field === null && (
        <p role="alert" className="aw-msg aw-abs" style={at(B_ROWS.error)}>
          {err.message}
        </p>
      )}
      <p className="aw-foot aw-abs" style={at(B_ROWS.foot)} data-aw-foot="">
        <span>{AUTH.card.haveAccount}</span>
        <CardLink
          onClick={() => {
            setAuthEmail(email.trim());
            setAuthView("signin");
          }}
          testId="auth-to-signin"
        >
          {AUTH.card.signin}
        </CardLink>
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ reset / sent */

function ResetView({ titleId }: { titleId: string }) {
  const stored = useCloudSession((s) => s.sheet.email);
  const [email, setEmail] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const id = `${useId()}-email`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ep = emailProblem(email);
    if (ep) return setErr(errorOf("email", ep));
    setAuthEmail(email.trim());
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setErr(errorOf(null, AUTH.offline));
    setBusy(true);
    const m = await cloudOrError();
    const order = pendingOrderParam();
    const r = m ? await m.sendPasswordReset(email, order) : null;
    setBusy(false);
    if (!r) return setErr(errorOf(null, AUTH.unavailable));
    if (!r.ok) return setErr(errorOf(r.field === "email" ? "email" : null, r.message));
    setAuthView("sent", { sent: "reset" });
  }
  return (
    <Step titleId={titleId} title={AUTH.titles.reset}>
      <form className="contents" noValidate onSubmit={(e) => void submit(e)}>
        <p className="aw-lead" data-aw-row="">
          {AUTH.lead.reset}
        </p>
        <LineField id={id} type="email" label={AUTH.email} autoComplete="email" inputMode="email" icon={<IconMail />} value={email} onChange={setEmail} error={err?.field === "email" ? err.message : undefined} errorKey={err?.field === "email" ? err.key : null} first />
        {err && err.field === null && (
          <p role="alert" className="aw-msg">
            {err.message}
          </p>
        )}
        <PillButton label={AUTH.submit.reset} busyLabel={AUTH.busy.reset} busy={busy} />
        <p className="aw-foot" data-aw-foot="">
          <CardLink onClick={() => setAuthView("signin")}>{AUTH.back}</CardLink>
        </p>
      </form>
    </Step>
  );
}

/** One mail per address and minute is the server's default; the button waits as long (a shorter wait would only run into the limit). */
export const RESEND_S = 60;
/** After the server refused for the send limit: wait longer, the toast says why. */
export const RESEND_LIMIT_S = 120;

/** Envelope drawn line by line, then a resend with a rolling countdown. */
function SentView({ titleId }: { titleId: string }) {
  const email = useCloudSession((s) => s.sheet.email);
  const sentKind = useCloudSession((s) => s.sheet.sent);
  const resendNow = useCloudSession((s) => s.sheet.resendNow);
  const reduced = useReducedFx();
  const [left, setLeft] = useState(resendNow ? 0 : RESEND_S);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const text = sentKind === "reset" ? AUTH.sent.reset(email) : sentKind === "confirm" ? AUTH.sent.confirm(email) : AUTH.sent.magic(email);
  async function resend() {
    if (busy || left > 0) return; // the button is disabled; a keyboard repeat or a second tap cannot send twice
    if (typeof navigator !== "undefined" && navigator.onLine === false) return pushToast({ kind: "error", title: AUTH.offline });
    setBusy(true);
    const m = await cloudOrError();
    const order = pendingOrderParam();
    const r = !m ? null : sentKind === "reset" ? await m.sendPasswordReset(email, order) : sentKind === "confirm" ? await m.resendConfirmation(email, order) : await m.sendMagicLink(email, order);
    setBusy(false);
    if (r?.ok) {
      pushToast({ kind: "success", title: AUTH.sent.resent });
      setLeft(RESEND_S);
    } else if (r && isSendLimit(r.code)) {
      // the server refused for the send limit: say so and wait longer (never retried in a loop)
      pushToast({ kind: "error", title: AUTH.sent.limit });
      setLeft(RESEND_LIMIT_S);
    } else pushToast({ kind: "error", title: r && !r.ok ? r.message : AUTH.unavailable });
  }
  const draw = (i: number) => (reduced ? { duration: 0 } : { ...tween.draw, delay: i * stagger.lead });
  return (
    <Step titleId={titleId} title={AUTH.titles.sent}>
      <div data-aw-row="">
        <svg viewBox="0 0 64 48" className="h-[8cqh] min-h-11 w-auto text-fg" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <motion.rect x="4" y="6" width="56" height="36" rx="5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(0)} />
          <motion.path d="M6 9l26 19L58 9" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(1)} />
          <motion.circle cx="54" cy="10" r="4" className="fill-signal stroke-none" initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.pop, delay: reduced ? 0 : 0.6 }} />
        </svg>
      </div>
      <div data-aw-row="">
        <p className="aw-lead !text-fg" data-testid="auth-sent-text">
          {text}
        </p>
        <p className="aw-lead mt-1">{AUTH.sent.sameBrowser}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4" data-aw-btn="">
        <Button onClick={() => void resend()} disabled={left > 0 || busy} aria-busy={busy || undefined} data-testid="auth-resend">
          {left > 0 ? (
            <span className="inline-flex items-center gap-1">
              {AUTH.sent.resend} · <RollingDigits value={left} className="tabular-nums" aria-label={`${left} Sekunden`} /> s
            </span>
          ) : (
            AUTH.sent.resend
          )}
        </Button>
        <span className="aw-foot">
          <CardLink onClick={() => setAuthView("signin")}>{AUTH.back}</CardLink>
        </span>
      </div>
    </Step>
  );
}

/* ------------------------------------------------------------------ 2FA step-up */

/** Lost device (B1): a recovery code instead of the app code – ends the second factor, the account then works with the password. */
function RecoveryForm({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    const m = await cloudOrError();
    const r = m ? await m.redeemRecoveryCode(code) : null;
    setBusy(false);
    if (!r || !r.ok) {
      setErr(errorOf("code", r && !r.ok ? r.message : AUTH.unavailable));
      return;
    }
    pushToast({ kind: "success", title: AUTH.recoveryDone, detail: AUTH.recoveryDoneDetail, duration: 9000 });
    setAuthView("welcome");
  }
  return (
    <form className="contents" noValidate onSubmit={(e) => void submit(e)} data-testid="recovery-form">
      <p className="aw-lead" data-aw-row="">
        {AUTH.recoveryLead}
      </p>
      <LineField id={`${id}-rc`} label={AUTH.recoveryLabel} value={code} autoComplete="off" spellCheck={false} autoFocus onChange={setCode} error={err?.message} errorKey={err?.key ?? null} className="[&_input]:font-mono [&_input]:uppercase [&_input]:tracking-[0.12em]" first />
      <p className="aw-lead" data-aw-row="">
        {AUTH.recoveryNoCodes}
      </p>
      <PillButton label={AUTH.recoverySubmit} busyLabel={AUTH.recoveryBusy} busy={busy} disabled={!code.trim()} />
      <p className="aw-foot" data-aw-foot="">
        <CardLink onClick={onBack}>{AUTH.recoveryBack}</CardLink>
      </p>
    </form>
  );
}

function MfaView({ titleId }: { titleId: string }) {
  const [recovery, setRecovery] = useState(false);
  return <Step titleId={titleId} title={AUTH.titles.mfa}>{recovery ? <RecoveryForm onBack={() => setRecovery(false)} /> : <MfaCodeForm onLost={() => setRecovery(true)} />}</Step>;
}

function MfaCodeForm({ onLost }: { onLost: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const [accepted, setAccepted] = useState(false);
  async function verify(c: string) {
    if (busy || c.length !== CODE_LENGTH) return;
    setBusy(true);
    const m = await cloudOrError();
    const r = m ? await m.verifyLoginCode(c) : null;
    setBusy(false);
    if (!r || !r.ok) {
      setErr(errorOf("code", r && !r.ok ? r.message : AUTH.unavailable));
      setCode("");
      return;
    }
    setAccepted(true);
    setTimeout(() => setAuthView("welcome"), 450);
  }
  return (
    <form
      className="contents"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <p className="aw-lead" data-aw-row="">
        {AUTH.lead.mfa}
      </p>
      <div data-aw-row="">
        <CodeSlots
          value={code}
          onChange={(c) => {
            setCode(c);
            if (c) setErr(null);
          }}
          onComplete={(c) => void verify(c)}
          label="2FA-Code"
          disabled={busy || accepted}
          invalidKey={err?.key ?? null}
          accepted={accepted}
          autoFocus
        />
      </div>
      {err && (
        <p key={err.key} role="alert" className="aw-msg">
          {err.message}
        </p>
      )}
      <PillButton label="Bestätigen" busyLabel={AUTH.busy.mfa} busy={busy} disabled={code.length !== CODE_LENGTH} />
      <p className="aw-foot flex-wrap" data-aw-foot="">
        <CardLink
          onClick={() =>
            void (async () => {
              const m = await cloudOrError();
              await m?.signOutScope("local");
              closeAuthSheet();
            })()
          }
        >
          {AUTH.mfaSignOut}
        </CardLink>
        <CardLink onClick={onLost}>{AUTH.lostDevice}</CardLink>
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ new password (reset link) */

function NewPasswordView({ titleId }: { titleId: string }) {
  const [pw, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const ids = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const pp = passwordProblem(pw);
    if (pp) return setErr(errorOf("password", pp));
    if (pw !== repeat) return setErr(errorOf("code", AUTH.mismatch));
    setBusy(true);
    const m = await cloudOrError();
    const r = m ? await m.updatePassword(pw, "reset") : null;
    setBusy(false);
    if (!r || !r.ok) return setErr(errorOf(r && !r.ok && r.field === "password" ? "password" : null, r && !r.ok ? r.message : AUTH.unavailable));
    pushToast({ kind: "success", title: AUTH.passwordSaved, detail: r.value.othersSignedOut ? AUTH.passwordOthersOut : AUTH.passwordOthersKept });
    setAuthView("account");
  }
  return (
    <Step titleId={titleId} title={AUTH.titles.newPassword}>
      <form className="contents" noValidate onSubmit={(e) => void submit(e)}>
        <p className="aw-lead" data-aw-row="">
          {AUTH.lead.newPassword}
        </p>
        <PasswordLine id={`${ids}-pw`} label={AUTH.newPassword} autoComplete="new-password" value={pw} onChange={setPw} error={err?.field === "password" ? err.message : undefined} errorKey={err?.field === "password" ? err.key : null} first />
        <StrengthHint password={pw} />
        <PasswordLine id={`${ids}-rep`} label={AUTH.repeat} autoComplete="new-password" value={repeat} onChange={setRepeat} error={err?.field === "code" ? err.message : undefined} errorKey={err?.field === "code" ? err.key : null} />
        {err && err.field === null && (
          <p role="alert" className="aw-msg">
            {err.message}
          </p>
        )}
        <PillButton label={AUTH.submit.newPassword} busyLabel={AUTH.busy.newPassword} busy={busy} />
      </form>
    </Step>
  );
}

/* ------------------------------------------------------------------ account panel */

function AccountView({ titleId, onOpenAccount }: { titleId: string; onOpenAccount?: () => void }) {
  const user = useCloudSession((s) => s.user);
  const sync = useSyncStatus((s) => s.phase);
  const pings = useSyncStatus((s) => s.pings);
  const [confirmAll, setConfirmAll] = useState(false);
  const pill = syncPill(sync, "signedIn");
  async function out(scope: "local" | "global") {
    const m = await cloudOrError();
    await m?.signOutScope(scope);
    closeAuthSheet();
    pushToast({ kind: "info", title: AUTH.signedOut, detail: AUTH.signedOutDetail });
  }
  return (
    <Step titleId={titleId} title={AUTH.titles.account}>
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-ink-950/50 p-3.5" data-aw-row="">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-dot text-[20px] text-fg">
          {(user?.email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-faint">{AUTH.account.signedInAs}</span>
          <TextScramble className="block truncate text-[14px] font-medium text-fg" text={user?.email ?? "–"} />
        </span>
        <StatusPill tone={pill.tone} expanded label={pill.label} pingKey={pings} />
      </div>
      <div className="flex flex-wrap gap-2" data-aw-btn="">
        {onOpenAccount && (
          <Button
            variant="primary"
            onClick={() => {
              closeAuthSheet();
              onOpenAccount();
            }}
          >
            {AUTH.account.open}
          </Button>
        )}
        <Button onClick={() => void out("local")}>{AUTH.account.signOut}</Button>
        {confirmAll ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-(--color-danger-text)" role="alert">
            {AUTH.account.signOutAll}?
            <Button size="sm" variant="danger" onClick={() => void out("global")}>
              Ja
            </Button>
            <Button size="sm" onClick={() => setConfirmAll(false)}>
              Nein
            </Button>
          </span>
        ) : (
          <HoldConfirm variant="danger" onAsk={() => setConfirmAll(true)} onConfirm={() => void out("global")}>
            {AUTH.account.signOutAll}
          </HoldConfirm>
        )}
      </div>
      <p className="aw-lead" data-aw-foot="">
        {AUTH.account.signOutHint}
      </p>
    </Step>
  );
}

/* ------------------------------------------------------------------ welcome + first sync */

function WelcomeView({ titleId }: { titleId: string }) {
  const reduced = useReducedFx();
  const phase = useSyncStatus((s) => s.phase);
  const progress = useSyncStatus((s) => s.progress);
  const records = useSyncStatus((s) => s.records);
  const check = useRef<HTMLSpanElement>(null);
  const done = phase === "live";
  const waiting = phase === "connecting" || phase === "syncing";
  const fired = useRef(false);
  useEffect(() => {
    if (!done || fired.current || reduced) return;
    fired.current = true;
    if (check.current) celebrateFrom(check.current, { kind: "streak", tone: "win" });
  }, [done, reduced]);
  const text = done ? AUTH.welcome.done : phase === "paused" ? AUTH.welcome.paused : AUTH.welcome.syncing;
  return (
    <Step titleId={titleId} title={AUTH.titles.welcome}>
      {/* the scramble glyphs are wider than the word: a clipping box keeps the card at 390 px */}
      <div className="max-w-full overflow-hidden" data-aw-row="">
        <AsciiCascade text={AUTH.welcome.word} as="p" className="font-dot text-[clamp(20px,5cqh,34px)] leading-none tracking-[0.04em] text-fg" seed={9} scrambled />
      </div>
      <div className="grid justify-items-start gap-3" data-aw-row="">
        <div className="relative grid h-[52px] place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            {done ? (
              <motion.span
                key="ok"
                ref={check}
                className="grid size-12 place-items-center rounded-full border border-win/50 bg-win/10 text-win"
                initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ scale: spring.pop, opacity: tween.fade }}
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduced ? { duration: 0 } : tween.check} />
                </svg>
              </motion.span>
            ) : (
              <motion.span key="wave" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }}>
                <DotMatrix preset="wave" size={5} gap={2.5} tone="fg" playing={waiting} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {progress && progress.total > 0 && !done && (
          <p className="font-mono text-[12px] text-mute" aria-live="off">
            <RollingDigits value={progress.done} /> / {progress.total}
          </p>
        )}
        {done && records > 0 && <p className="font-mono text-[12px] text-mute">{records} Einträge synchron</p>}
      </div>
      <p className="aw-lead" data-aw-row="">
        {text}
      </p>
      <PillButton type="button" label={AUTH.welcome.close} onClick={closeAuthSheet} />
    </Step>
  );
}
