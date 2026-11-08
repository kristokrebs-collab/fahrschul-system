import { legalShown } from "@/legal/config";
import { ConsentCheck } from "@/legal/ConsentCheck";
import { LegalLink } from "@/legal/LegalLinks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { armWizard } from "@/onboarding/wizard/wizardStore";
import { celebrateFrom } from "@/motion/Celebrate";
import { DotMatrix } from "@/motion/DotMatrix";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { StatusPill } from "@/motion/StatusPill";
import { TextRoll } from "@/motion/TextRoll";
import { TextScramble } from "@/motion/TextScramble";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { pendingOrderParam } from "@/store/returnTo";
import { pushToast } from "@/store/uiStore";
import { emailProblem, isSendLimit, passwordProblem, passwordStrength, type AuthField } from "../authErrors";
import { oauthProviders, type OAuthProvider } from "../env";
import { ensureCloud } from "../runtime";
import { closeAuthSheet, setAuthEmail, setAuthView, useCloudSession } from "../session";
import { useSyncStatus } from "../sync/status";
import type { AuthView } from "../types";
import { AuthBrand, BladeStage, useBlade } from "./AuthBlade";
import { AuthMorph, MorphItem, slideDir } from "./AuthMorph";
import { CODE_LENGTH, CodeSlots } from "./CodeSlots";
import { OrderContext } from "./OrderContext";
import { AUTH_LAYOUT_ID, syncPill } from "./pill";
import { AUTH } from "./strings";

export interface AuthSheetProps {
  /** Opens the Konto page (the integrator passes `() => navigate("konto")`); hidden when absent. */
  onOpenAccount?: () => void;
}

/**
 * Login sheet (P09, all German): password, magic link, registration (strength meter, e-mail confirmation), reset,
 * new password after the reset link, the 2FA step-up after a password login, the signed-in account panel and the
 * welcome with the first sync. One `Sheet` (540 px; bottom sheet on phones); opened from the header pill it morphs out
 * of it (`layoutId="auth-sheet"`), from anywhere else it slides in.
 *
 * Motion (`AuthMorph.tsx`): the card is ONE card – Anmelden · Link · Registrieren keep one mounted form whose fields glide and
 * whose mode-only blocks slide in / out (the card's height springs, no jump); the other steps (2FA, sent, reset …) cross over
 * inside the same height-following box (x ±16 → 0 on `spring.enter`, exits on `tween.exit`), sections cascade
 * (`StaggerItem`), a wrong field shakes with its loss ring and takes the focus (`Field invalidKey`), the
 * submit label morphs (`TextRoll`), the 2FA code rolls in per slot (`CodeSlots`). Success: the `AsciiCascade`
 * wordmark decodes, a `DotMatrix` wave runs while the first sync uploads (progress on `RollingDigits`), a drawn ✓ and a
 * confetti burst (`celebrateFrom`) when it is live. Reduced motion: static end states.
 */
/** The views in which a pending order is shown above the card (the way to the order is still open). */
const ORDER_VIEWS: readonly AuthView[] = ["signin", "magic", "signup", "reset", "sent"];

export function AuthSheet({ onOpenAccount }: AuthSheetProps) {
  const sheet = useCloudSession((s) => s.sheet);
  const dir = slideDir(sheet.view, sheet.prev);
  // warm the Supabase chunk while the user types (idempotent)
  useEffect(() => {
    void ensureCloud().catch(() => undefined);
  }, []);
  return (
    <Sheet
      open={sheet.open}
      onClose={closeAuthSheet}
      title={AUTH.titles[sheet.view]}
      size="md"
      layoutId={sheet.source === "pill" ? AUTH_LAYOUT_ID : undefined}
      dismissGuard={false}
    >
      <div className="grid gap-4" data-auth-view={sheet.view}>
        {sheet.notice && (
          <StaggerItem>
            <p className="rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px] text-mute" data-testid="auth-notice" role="status">
              {sheet.notice}
            </p>
          </StaggerItem>
        )}
        {ORDER_VIEWS.includes(sheet.view) && (
          <StaggerItem>
            <OrderContext />
          </StaggerItem>
        )}
        {/* R11: one card that morphs – the modes of the entry step keep their form (AuthMorph), the other steps cross over in one height-following box.
            Paket B: our brand strip on top and the blade that sweeps once across the card when Anmelden ↔ Registrieren switches (AuthBlade) */}
        <BladeStage>
          {/* the strip is the `lead` of the morph: its claim may take one line or two, and that height change belongs to the card's own spring */}
          <AuthMorph view={sheet.view} dir={dir} lead={<AuthBrand view={sheet.view} />}>
            <ViewBody view={sheet.view} onOpenAccount={onOpenAccount} />
          </AuthMorph>
        </BladeStage>
      </div>
    </Sheet>
  );
}

function ViewBody({ view, onOpenAccount }: { view: AuthView; onOpenAccount?: () => void }) {
  switch (view) {
    case "signin":
    case "magic":
    case "signup":
      return <EntryView mode={view} />;
    case "reset":
      return <ResetView />;
    case "sent":
      return <SentView />;
    case "mfa":
      return <MfaView />;
    case "newPassword":
      return <NewPasswordView />;
    case "account":
      return <AccountView onOpenAccount={onOpenAccount} />;
    case "welcome":
      return <WelcomeView />;
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

/** Password input with a show / hide toggle. */
function PasswordInput({ id, name = "password", value, onChange, autoComplete, invalid, describedBy }: { id: string; name?: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative grid">
      <Input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? AUTH.hide : AUTH.show}
        aria-pressed={show}
        className="touch-hit absolute inset-y-0 right-1.5 my-auto grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}

/** Four bars that grow (scaleX) and tint with the password strength. */
function StrengthMeter({ password }: { password: string }) {
  const reduced = useReducedFx();
  const s = passwordStrength(password);
  const tone = s <= 1 ? "bg-loss" : s === 2 ? "bg-warn" : "bg-win";
  return (
    <div className="flex items-center gap-2" aria-live="off">
      <div aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.span
              className={cn("block h-full origin-left rounded-full", tone)}
              initial={false}
              animate={{ scaleX: s >= i ? 1 : 0 }}
              transition={reduced ? { duration: 0 } : { ...spring.bar, delay: (i - 1) * stagger.cards }}
            />
          </span>
        ))}
      </div>
      <span className="w-20 text-right text-[11px] text-faint">{password ? AUTH.strength[s] : ""}</span>
    </div>
  );
}

function SubmitButton({ busy, idle, busyLabel, disabled }: { busy: boolean; idle: string; busyLabel: string; disabled?: boolean }) {
  return (
    <Button type="submit" variant="primary" className="w-full sm:w-auto sm:min-w-[11rem]" disabled={busy || disabled} aria-busy={busy || undefined}>
      <TextRoll mode="roll" text={busy ? busyLabel : idle} />
    </Button>
  );
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="touch-hit rounded-md text-[12.5px] text-mute underline-offset-4 transition-colors hover:text-fg hover:underline">
      {children}
    </button>
  );
}

async function cloudOrError(): Promise<Awaited<ReturnType<typeof ensureCloud>> | null> {
  try {
    return await ensureCloud();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ entry: password / magic link / signup */

const MODE_OPTIONS = [
  { v: "signin" as const, label: AUTH.modes.signin },
  { v: "magic" as const, label: AUTH.modes.magic },
  { v: "signup" as const, label: AUTH.modes.signup },
];

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

function EntryView({ mode }: { mode: "signin" | "magic" | "signup" }) {
  const consentNeeded = legalShown();
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const stored = useCloudSession((s) => s.sheet.email);
  const [email, setEmail] = useState(stored);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const ids = useId();
  const providers = oauthProviders();
  const emailId = `${ids}-email`;
  const pwId = `${ids}-pw`;
  const form = useRef<HTMLFormElement>(null);
  const blade = useBlade();

  /** Shows the error at its field AND moves the focus there (the field that needs the next keystroke), then the screen reader hears it by the field's `aria-describedby`. */
  const fail = (e: FieldError) => {
    setErr(e);
    const target = e.field === "email" ? emailId : e.field === "password" ? pwId : null;
    if (target) requestAnimationFrame(() => document.getElementById(target)?.focus());
  };

  // the mode changes while the form stays mounted: a stale error of the other mode goes, and a focus that sat in a field the
  // new mode no longer has (the password in "Link per E-Mail") moves to the e-mail field instead of falling out of the card
  const modeSeen = useRef(mode);
  useEffect(() => {
    if (modeSeen.current === mode) return;
    modeSeen.current = mode;
    setErr(null);
    setConsentMissing(false);
    if (mode === "magic" && document.activeElement === document.getElementById(pwId)) document.getElementById(emailId)?.focus({ preventScroll: true });
  }, [mode, pwId, emailId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setAuthEmail(email.trim());
    const ep = emailProblem(email);
    if (ep) return fail(errorOf("email", ep));
    if (mode !== "magic") {
      const pp = mode === "signup" ? passwordProblem(password) : password ? null : "Bitte gib dein Passwort ein.";
      if (pp) return fail(errorOf("password", pp));
    }
    // registration: the operator's AGB and privacy policy first (Review F07)
    if (mode === "signup" && consentNeeded && !consent) {
      setConsentMissing(true);
      return setErr(errorOf(null, AUTH_LEGAL.missing));
    }
    // offline: say so before anything is sent (the typed values stay)
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
      setAuthView(r.value.mfa ? "mfa" : "welcome");
    } else if (mode === "magic") {
      const order = pendingOrderParam();
      const r = order ? await m.sendMagicLink(email, order) : await m.sendMagicLink(email);
      setBusy(false);
      if (!r.ok) return fail(errorOf(r.field, r.message));
      setAuthView("sent", { notice: null, sent: "magic" });
    } else {
      const order = pendingOrderParam();
      const r = order ? await m.signUp(email, password, order) : await m.signUp(email, password);
      setBusy(false);
      if (!r.ok) return fail(errorOf(r.field, r.message));
      // a registration arms the setup wizard (once; it opens after the sign-in, when nothing else owns the screen)
      armWizard();
      setAuthView(r.value.confirm ? "sent" : "welcome", { sent: "confirm" });
    }
  }

  async function oauth(p: OAuthProvider) {
    if (mode === "signup" && consentNeeded && !consent) {
      setConsentMissing(true);
      return setErr(errorOf(null, AUTH_LEGAL.missing));
    }
    setBusy(true);
    const m = await cloudOrError();
    const r = m ? await m.signInOAuth(p) : null;
    if (!r || !r.ok) {
      setBusy(false);
      setErr(errorOf(null, r && !r.ok ? r.message : AUTH.unavailable));
    }
  }

  return (
    // `relative`: a block that leaves (`MorphItem`, popLayout) is taken out of the flow at once, the others glide up (`layout="position"`)
    <form ref={form} className="relative grid gap-4" noValidate method="post" onSubmit={(e) => void submit(e)} data-auth-mode={mode}>
      <StaggerItem layout="position">
        {/* the blade carries the switch (AuthBlade): the mode shows at once, the content follows behind the band */}
        <Segmented options={MODE_OPTIONS} value={blade.pending ?? mode} onChange={(v) => blade.switchTo(v)} aria-label="Anmeldeart" className="w-full" />
      </StaggerItem>
      <MorphItem itemKey={`lead-${mode}`}>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH.lead[mode]}</p>
      </MorphItem>
      {providers.length > 0 && (
        <MorphItem show={mode !== "magic"} itemKey="oauth" className="grid gap-2">
          {providers.map((p) => (
            <Button key={p} onClick={() => void oauth(p)} disabled={busy} className="w-full">
              {AUTH.oauth(AUTH.oauthNames[p] ?? p)}
            </Button>
          ))}
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {AUTH.or}
            <span className="h-px flex-1 bg-line" />
          </div>
        </MorphItem>
      )}
      <StaggerItem layout="position">
        <Field label={AUTH.email} htmlFor={emailId} error={err?.field === "email" ? err.message : undefined} invalidKey={err?.field === "email" ? err.key : null}>
          <Input
            id={emailId}
            name="email"
            type="email"
            // the password manager reads the pair: the identifier of a login is the "username", of a registration the "email"
            autoComplete={mode === "signin" ? "username" : "email"}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            invalid={err?.field === "email"}
            aria-describedby={err?.field === "email" ? `${emailId}-error` : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              // a shown e-mail error goes the moment the address is valid (no waiting for the next submit)
              if (err?.field === "email" && !emailProblem(e.target.value)) setErr(null);
            }}
          />
        </Field>
      </StaggerItem>
      <MorphItem show={mode !== "magic"} itemKey="password" className="relative grid gap-2">
        <Field
          label={AUTH.password}
          htmlFor={pwId}
          help={mode === "signup" && err?.field !== "password" ? AUTH.passwordHelp : undefined}
          error={err?.field === "password" ? err.message : undefined}
          invalidKey={err?.field === "password" ? err.key : null}
        >
          <PasswordInput
            id={pwId}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (err?.field === "password" && mode === "signup" && !passwordProblem(v)) setErr(null);
            }}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            invalid={err?.field === "password"}
            describedBy={err?.field === "password" ? `${pwId}-error` : mode === "signup" ? `${pwId}-help` : undefined}
          />
        </Field>
        <MorphItem show={mode === "signup"} itemKey="strength">
          <StrengthMeter password={password} />
        </MorphItem>
      </MorphItem>
      {consentNeeded && (
        <MorphItem show={mode === "signup"} itemKey="consent">
          <ConsentCheck
            checked={consent}
            onChange={(v) => {
              setConsent(v);
              if (v) {
                setConsentMissing(false);
                if (err?.message === AUTH_LEGAL.missing) setErr(null);
              }
            }}
            invalid={consentMissing}
            testId="signup-consent"
          >
            {AUTH_LEGAL.consentPre}
            <LegalLink doc="agb" />
            {AUTH_LEGAL.consentMid}
            <LegalLink doc="datenschutz">{AUTH_LEGAL.datenschutz}</LegalLink>
            {AUTH_LEGAL.consentPost}
          </ConsentCheck>
        </MorphItem>
      )}
      {err && err.field === null && (
        <motion.p role="alert" layout="position" className="text-[12.5px] text-loss" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade} key={err.key}>
          {err.message}
        </motion.p>
      )}
      <StaggerItem layout="position" className="flex flex-wrap items-center justify-between gap-3">
        {/* the "forgot" link keeps its place and fades with the mode, so the submit button never moves sideways */}
        <span className={cn("transition-opacity duration-200", mode !== "signin" && "pointer-events-none opacity-0")} aria-hidden={mode !== "signin" || undefined} inert={mode !== "signin" || undefined}>
          <LinkButton onClick={() => setAuthView("reset")}>{AUTH.forgot}</LinkButton>
        </span>
        <SubmitButton busy={busy} idle={AUTH.submit[mode]} busyLabel={AUTH.busy[mode]} />
      </StaggerItem>
      {/* the way over to the other face, as in the reference ("New to …? Create account" ↔ "Already have an account? Sign in"):
          the same blade, and the focus lands in the first field of the new face */}
      <MorphItem show={mode !== "magic"} itemKey="switch">
        <p className="text-center">
          <LinkButton onClick={() => blade.switchTo(mode === "signup" ? "signin" : "signup", { focus: true })}>{mode === "signup" ? AUTH.switchLink.toSignin : AUTH.switchLink.toSignup}</LinkButton>
        </p>
      </MorphItem>
      <MorphItem show={mode === "signup"} itemKey="eu">
        <p className="text-[11.5px] leading-relaxed text-faint">{AUTH.euNote}</p>
      </MorphItem>
      {consentNeeded && (
        <MorphItem show={mode !== "signup"} itemKey="legal">
          <p className="text-[11.5px] leading-relaxed text-faint" data-testid="auth-legal-note">
            {AUTH_LEGAL.notePre}
            <LegalLink doc="agb" className="text-mute underline" />
            {AUTH_LEGAL.noteMid}
            <LegalLink doc="datenschutz" className="text-mute underline">
              {AUTH_LEGAL.datenschutz}
            </LegalLink>
            {AUTH_LEGAL.notePost}
          </p>
        </MorphItem>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ reset / sent */

function ResetView() {
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
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH.lead.reset}</p>
      </StaggerItem>
      <StaggerItem>
        <Field label={AUTH.email} htmlFor={id} error={err?.field === "email" ? err.message : undefined} invalidKey={err?.field === "email" ? err.key : null}>
          <Input id={id} type="email" autoComplete="email" inputMode="email" value={email} invalid={err?.field === "email"} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </StaggerItem>
      {err && err.field === null && (
        <p role="alert" className="text-[12.5px] text-loss">
          {err.message}
        </p>
      )}
      <StaggerItem className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton onClick={() => setAuthView("signin")}>{AUTH.back}</LinkButton>
        <SubmitButton busy={busy} idle={AUTH.submit.reset} busyLabel={AUTH.busy.reset} />
      </StaggerItem>
    </form>
  );
}

/** One mail per address and minute is the server's default; the button waits as long (a shorter wait would only run into the limit). */
export const RESEND_S = 60;
/** After the server refused for the send limit: wait longer, the hint says why. */
export const RESEND_LIMIT_S = 120;

/** What a resend said: the line under the buttons (`role="status"` / `role="alert"`), never only a toast that is gone before it is read. */
interface ResendNote {
  kind: "ok" | "limit" | "error";
  text: string;
  key: number;
}

/** Envelope drawn line by line, then a resend with a rolling countdown, an honest limit hint and the way back / to another address. */
function SentView() {
  const email = useCloudSession((s) => s.sheet.email);
  const sentKind = useCloudSession((s) => s.sheet.sent);
  const resendNow = useCloudSession((s) => s.sheet.resendNow);
  const reduced = useReducedFx();
  const [left, setLeft] = useState(resendNow ? 0 : RESEND_S);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ResendNote | null>(null);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const text = sentKind === "reset" ? AUTH.sent.reset(email) : sentKind === "confirm" ? AUTH.sent.confirm(email) : AUTH.sent.magic(email);
  async function resend() {
    if (busy || left > 0) return; // the button is disabled; a keyboard repeat or a second tap cannot send twice
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setNote({ kind: "error", text: AUTH.offline, key: ++errorSeq });
    setBusy(true);
    const m = await cloudOrError();
    const order = pendingOrderParam();
    const r = !m ? null : sentKind === "reset" ? await m.sendPasswordReset(email, order) : sentKind === "confirm" ? await m.resendConfirmation(email, order) : await m.sendMagicLink(email, order);
    setBusy(false);
    if (r?.ok) {
      setNote({ kind: "ok", text: AUTH.sent.resent, key: ++errorSeq });
      setLeft(RESEND_S);
    } else if (r && isSendLimit(r.code)) {
      setNote({ kind: "limit", text: AUTH.sent.limit, key: ++errorSeq });
      setLeft(RESEND_LIMIT_S);
    } else setNote({ kind: "error", text: r && !r.ok ? r.message : AUTH.unavailable, key: ++errorSeq });
  }
  const draw = (i: number) => (reduced ? { duration: 0 } : { ...tween.draw, delay: i * stagger.lead });
  return (
    <div className="grid justify-items-center gap-4 py-2 text-center">
      <StaggerItem>
        <svg viewBox="0 0 64 48" className="h-16 w-20 text-fg" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <motion.rect x="4" y="6" width="56" height="36" rx="5" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(0)} />
          <motion.path d="M6 9l26 19L58 9" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw(1)} />
          <motion.circle cx="54" cy="10" r="4" className="fill-signal stroke-none" initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.pop, delay: reduced ? 0 : 0.6 }} />
        </svg>
      </StaggerItem>
      <StaggerItem>
        <p className="max-w-[26rem] text-[13.5px] leading-relaxed text-fg" data-testid="auth-sent-text">
          {text}
        </p>
        <p className="mt-1.5 text-[12px] text-faint">{AUTH.sent.sameBrowser}</p>
      </StaggerItem>
      <StaggerItem className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => void resend()} disabled={left > 0 || busy} aria-busy={busy || undefined} data-testid="auth-resend">
          {left > 0 ? (
            <span className="inline-flex items-center gap-1">
              {AUTH.sent.resend} · <RollingDigits value={left} className="tabular-nums" aria-label={`${left} Sekunden`} /> s
            </span>
          ) : (
            AUTH.sent.resend
          )}
        </Button>
        <LinkButton onClick={() => setAuthView("signin")}>{sentKind === "confirm" ? AUTH.sent.toSignin : AUTH.back}</LinkButton>
        {sentKind !== "magic" && <LinkButton onClick={() => setAuthView(sentKind === "reset" ? "reset" : "signup")}>{AUTH.sent.otherMail}</LinkButton>}
        {/* the registration text names both cases ("frei" / "schon ein Konto"): the way to the reset is as close as the way to the login */}
        {sentKind === "confirm" && <LinkButton onClick={() => setAuthView("reset")}>{AUTH.forgot}</LinkButton>}
      </StaggerItem>
      <StaggerItem className="grid max-w-[26rem] gap-1">
        {/* below the buttons: a result never moves them */}
        {note ? (
          <p key={note.key} role={note.kind === "ok" ? "status" : "alert"} data-testid="auth-resend-note" data-kind={note.kind} className={cn("text-[12.5px]", note.kind === "ok" ? "text-win" : "text-loss")}>
            {note.text}
          </p>
        ) : null}
        <p className="text-[11.5px] leading-snug text-faint" data-testid="auth-limit-hint">
          {AUTH.sent.limitHint} {AUTH.sent.spam}
        </p>
      </StaggerItem>
    </div>
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
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)} data-testid="recovery-form">
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH.recoveryLead}</p>
      </StaggerItem>
      <StaggerItem>
        <Field label={AUTH.recoveryLabel} htmlFor={`${id}-rc`} error={err?.message} invalidKey={err?.key ?? null}>
          <Input id={`${id}-rc`} value={code} autoComplete="off" spellCheck={false} autoFocus onChange={(e) => setCode(e.target.value)} placeholder="ABCDE-FGHJK" className="font-mono uppercase tracking-[0.12em]" />
        </Field>
      </StaggerItem>
      <StaggerItem>
        <p className="text-[11.5px] leading-relaxed text-faint">{AUTH.recoveryNoCodes}</p>
      </StaggerItem>
      <StaggerItem className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton onClick={onBack}>{AUTH.recoveryBack}</LinkButton>
        <SubmitButton busy={busy} idle={AUTH.recoverySubmit} busyLabel={AUTH.recoveryBusy} disabled={!code.trim()} />
      </StaggerItem>
    </form>
  );
}

function MfaView() {
  const [recovery, setRecovery] = useState(false);
  if (recovery) return <RecoveryForm onBack={() => setRecovery(false)} />;
  return <MfaCodeForm onLost={() => setRecovery(true)} />;
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
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH.lead.mfa}</p>
      </StaggerItem>
      <StaggerItem>
        <CodeSlots
          value={code}
          onChange={(c) => {
            setCode(c);
            if (c) setErr(null);
          }}
          onComplete={(c) => void verify(c)}
          label="2FA-Code" disabled={busy || accepted} invalidKey={err?.key ?? null} accepted={accepted} autoFocus />
      </StaggerItem>
      {err && (
        <motion.p key={err.key} role="alert" className="text-center text-[12.5px] text-loss" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade}>
          {err.message}
        </motion.p>
      )}
      <StaggerItem className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton
          onClick={() =>
            void (async () => {
              const m = await cloudOrError();
              await m?.signOutScope("local");
              closeAuthSheet();
            })()
          }
        >
          {AUTH.mfaSignOut}
        </LinkButton>
        <SubmitButton busy={busy} idle="Bestätigen" busyLabel={AUTH.busy.mfa} disabled={code.length !== CODE_LENGTH} />
      </StaggerItem>
      <StaggerItem>
        <LinkButton onClick={onLost}>{AUTH.lostDevice}</LinkButton>
      </StaggerItem>
    </form>
  );
}

/* ------------------------------------------------------------------ new password (reset link) */

export function NewPasswordForm({ reason, onDone }: { reason: "reset" | "change"; onDone: () => void }) {
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
    const r = m ? await m.updatePassword(pw, reason) : null;
    setBusy(false);
    if (!r || !r.ok) return setErr(errorOf(r && !r.ok && r.field === "password" ? "password" : null, r && !r.ok ? r.message : AUTH.unavailable));
    pushToast({ kind: "success", title: AUTH.passwordSaved, detail: r.value.othersSignedOut ? AUTH.passwordOthersOut : AUTH.passwordOthersKept });
    onDone();
  }
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <StaggerItem className="grid gap-2">
        <Field label={AUTH.newPassword} htmlFor={`${ids}-pw`} error={err?.field === "password" ? err.message : undefined} invalidKey={err?.field === "password" ? err.key : null}>
          <PasswordInput id={`${ids}-pw`} value={pw} onChange={setPw} autoComplete="new-password" invalid={err?.field === "password"} />
        </Field>
        <StrengthMeter password={pw} />
      </StaggerItem>
      <StaggerItem>
        <Field label={AUTH.repeat} htmlFor={`${ids}-rep`} error={err?.field === "code" ? err.message : undefined} invalidKey={err?.field === "code" ? err.key : null}>
          <PasswordInput id={`${ids}-rep`} value={repeat} onChange={setRepeat} autoComplete="new-password" invalid={err?.field === "code"} />
        </Field>
      </StaggerItem>
      {err && err.field === null && (
        <p role="alert" className="text-[12.5px] text-loss">
          {err.message}
        </p>
      )}
      <StaggerItem className="flex justify-end">
        <SubmitButton busy={busy} idle={AUTH.submit.newPassword} busyLabel={AUTH.busy.newPassword} />
      </StaggerItem>
    </form>
  );
}

function NewPasswordView() {
  return (
    <>
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH.lead.newPassword}</p>
      </StaggerItem>
      <NewPasswordForm reason="reset" onDone={() => setAuthView("account")} />
    </>
  );
}

/* ------------------------------------------------------------------ account panel */

function AccountView({ onOpenAccount }: { onOpenAccount?: () => void }) {
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
    <div className="grid gap-4">
      <StaggerItem className="flex items-center gap-3 rounded-2xl border border-line bg-ink-950/50 p-3.5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-dot text-[20px] text-fg">
          {(user?.email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-faint">{AUTH.account.signedInAs}</span>
          <TextScramble className="block truncate text-[14px] font-medium text-fg" text={user?.email ?? "–"} />
        </span>
        <StatusPill tone={pill.tone} expanded label={pill.label} pingKey={pings} />
      </StaggerItem>
      <StaggerItem className="flex flex-wrap gap-2">
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
      </StaggerItem>
      <StaggerItem>
        <p className="text-[11.5px] text-faint">{AUTH.account.signOutHint}</p>
      </StaggerItem>
    </div>
  );
}

/* ------------------------------------------------------------------ welcome + first sync */

function WelcomeView() {
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
    <div className="grid justify-items-center gap-5 py-2 text-center">
      {/* the scramble glyphs are wider than the word: a phone-sized font + a clipping box keep the sheet at 390 px */}
      <StaggerItem className="max-w-full overflow-hidden">
        <AsciiCascade text={AUTH.welcome.word} as="p" className="font-dot text-[clamp(20px,6vw,40px)] leading-none tracking-[0.04em] text-fg" seed={9} scrambled />
      </StaggerItem>
      <StaggerItem className="grid justify-items-center gap-3">
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
      </StaggerItem>
      <StaggerItem>
        <p className="max-w-[26rem] text-[13.5px] leading-relaxed text-mute">{text}</p>
      </StaggerItem>
      <StaggerItem>
        <Button variant="primary" onClick={closeAuthSheet}>
          {AUTH.welcome.close}
        </Button>
      </StaggerItem>
    </div>
  );
}
