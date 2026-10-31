import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/cn";
import { celebrateFrom } from "@/motion/Celebrate";
import { DotMatrix } from "@/motion/DotMatrix";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { closeConnect, connectAccount, runDryRun, startFirstImport, useExchange, type UiError } from "../store";
import { BITUNIX_API_URL, CONNECT, EX } from "../strings";
import type { ConnectResult, JournalAccount } from "../types";
import { fmtPlain } from "./parts";

const ACCOUNTS: readonly { v: JournalAccount; label: string }[] = [
  { v: "scalp", label: "Scalp" },
  { v: "makro", label: "Makro" },
];

type Step = 0 | 1 | 2;

/** Three dots joined by a bar that fills on `spring.bar` as the steps advance. */
function Stepper({ step }: { step: Step }) {
  const reduced = useReducedFx();
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Schritte">
      {CONNECT.steps.map((label, i) => {
        const state = i < step ? "done" : i === step ? "now" : "next";
        return (
          <li key={label} className="grid gap-1.5" aria-current={state === "now" ? "step" : undefined}>
            <span aria-hidden="true" className="relative block h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.span
                className={cn("absolute inset-0 origin-left rounded-full", state === "done" ? "bg-win" : "bg-fg")}
                initial={false}
                animate={{ scaleX: state === "next" ? 0 : 1 }}
                transition={reduced ? { duration: 0 } : spring.bar}
              />
            </span>
            <span className={cn("text-[11.5px]", state === "next" ? "text-faint" : "text-fg")}>
              <span className="num mr-1 font-mono text-faint">{i + 1}</span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function HowTo() {
  return (
    <div className="grid gap-3">
      <h3 className="text-[14px] font-semibold">{CONNECT.howTitle}</h3>
      <ol className="grid gap-2">
        {CONNECT.how.map((s, i) => (
          <StaggerItem as="li" key={s.t} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-line bg-ink-950/40 p-3">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 place-items-center rounded-lg border font-mono text-[12px]",
                i === 2 ? "border-signal/50 text-signal" : "border-line-2 text-fg",
              )}
            >
              {i + 1}
            </span>
            <span className="grid gap-0.5">
              <span className="text-[13px] font-medium text-fg">{s.t}</span>
              <span className="text-[12.5px] leading-snug text-mute">{s.d}</span>
            </span>
          </StaggerItem>
        ))}
      </ol>
      <StaggerItem>
        <a
          href={BITUNIX_API_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg"
        >
          {CONNECT.open}
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M6 3h7v7M13 3 4 12" />
          </svg>
        </a>
      </StaggerItem>
      <StaggerItem>
        <p className="rounded-xl border border-warn/25 bg-warn/[0.05] px-3 py-2 text-[12px] leading-relaxed text-mute">{EX.ipNote}</p>
      </StaggerItem>
    </div>
  );
}

/**
 * "Bitunix verbinden" (P11): a 3-step sheet.
 * 1. How to create a READ-ONLY key on Bitunix (numbered steps, link to the API page, the IP-binding trade-off).
 * 2. Key + secret (the secret hidden by default; once typed, the key shows only as `••••last4`, decoded by
 *    TextScramble), journal account, the read-only confirmation. Invalid input shakes the field.
 * 3. The check against Bitunix (DotMatrix snake while it runs) → success: drawn ✓, BorderBeam lap, confetti, available
 *    balance on rolling digits, and the first import (30 / 90 / 180 / 365 days) or a dry run first.
 * The key travels once over HTTPS to the server, is stored encrypted and never comes back.
 */
export function ConnectSheet() {
  const open = useExchange((s) => s.connectOpen);
  const reduced = useReducedFx();
  const [step, setStep] = useState<Step>(0);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [keyFocused, setKeyFocused] = useState(false);
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState<JournalAccount>("scalp");
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [range, setRange] = useState<(typeof CONNECT.importRanges)[number]["v"]>("90");
  const okRef = useRef<HTMLSpanElement>(null);

  // reset on open (render-phase adjustment, as ImportDialog)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(0);
      setApiKey("");
      setSecret("");
      setShowSecret(false);
      setLabel("");
      setAccount("scalp");
      setReadOnly(false);
      setError(null);
      setChecking(false);
      setResult(null);
      setRange("90");
    }
  }

  const close = () => {
    // never keep a typed secret around after the sheet closes
    setApiKey("");
    setSecret("");
    closeConnect();
  };

  async function submit() {
    if (apiKey.trim().length < 8 || secret.trim().length < 8) {
      setError({ code: "required", message: CONNECT.required });
      setShake(Date.now());
      return;
    }
    if (!readOnly) {
      setError({ code: "confirm", message: CONNECT.confirmRequired });
      setShake(Date.now());
      return;
    }
    // the secret leaves the state – and the form's DOM, committed once more WITHOUT it (flushSync) before the step
    // changes, so the exiting form's frozen copy holds no secret either; it only comes back from this closure when
    // the check fails, so the trader can correct it
    const creds = { apiKey: apiKey.trim(), secret: secret.trim() };
    flushSync(() => {
      setError(null);
      setSecret("");
      setShowSecret(false);
      setKeyFocused(false);
    });
    setStep(2);
    setChecking(true);
    const out = await connectAccount({
      exchange: "bitunix",
      apiKey: creds.apiKey,
      secret: creds.secret,
      label: label.trim() || undefined,
      journalAccount: account,
      readOnlyConfirmed: true,
    });
    setChecking(false);
    if (out.ok) {
      setApiKey("");
      setResult(out.result);
      requestAnimationFrame(() => okRef.current && celebrateFrom(okRef.current, { kind: "streak", tone: "win" }));
    } else {
      setSecret(creds.secret);
      setError(out.error);
      setStep(1);
      setShake(Date.now());
    }
  }

  const last4 = apiKey.trim().slice(-4);
  const masked = apiKey.trim().length >= 8 && !keyFocused;
  const connId = result?.connection.id ?? null;

  const footer =
    step === 0 ? (
      <>
        <span className="flex-1" />
        <Button variant="ghost" onClick={close}>Abbrechen</Button>
        <Button variant="primary" onClick={() => setStep(1)} data-testid="connect-next">
          {CONNECT.next}
        </Button>
      </>
    ) : step === 1 ? (
      <>
        <Button onClick={() => setStep(0)}>{CONNECT.back}</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => void submit()} data-testid="connect-submit">
          {CONNECT.submit}
        </Button>
      </>
    ) : result && connId ? (
      <>
        <Button onClick={close}>{CONNECT.importLater}</Button>
        <span className="flex-1" />
        <Button
          onClick={() => {
            close();
            void runDryRun(connId);
          }}
        >
          {CONNECT.importDry}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            close();
            void startFirstImport(connId, Number(range));
          }}
          data-testid="connect-import"
        >
          {CONNECT.importStart}
        </Button>
      </>
    ) : (
      <span className="flex-1" />
    );

  return (
    <Sheet
      open={open}
      onClose={close}
      size="md"
      title={CONNECT.title}
      dismissGuard={() => step === 1 && (apiKey.length > 0 || secret.length > 0)}
      footer={footer}
    >
      <div className="grid gap-5" data-testid="connect-sheet">
        <StaggerItem>
          <Stepper step={step} />
        </StaggerItem>

        <AnimatePresence mode="popLayout" initial={false}>
          {step === 0 && (
            <motion.div
              key="how"
              initial={reduced ? false : { opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, x: -16, transition: tween.exit }}
              transition={{ x: spring.enter, opacity: tween.fade }}
            >
              <HowTo />
            </motion.div>
          )}

          {step === 1 && (
            <motion.form
              key="form"
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              initial={reduced ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, x: -16, transition: tween.exit }}
              transition={{ x: spring.enter, opacity: tween.fade }}
              autoComplete="off"
            >
              <Field
                label={
                  <span className="flex items-baseline justify-between gap-2">
                    {EX.keyLabel}
                    {masked && (
                      <span className="font-mono text-[11px] normal-case tracking-normal text-mute" data-testid="key-mask">
                        <span aria-hidden="true" className="tracking-[0.18em] text-faint">
                          ••••
                        </span>
                        <TextScramble text={last4} />
                      </span>
                    )}
                  </span>
                }
                htmlFor="bx-key"
                invalidKey={error && apiKey.trim().length < 8 ? shake : null}
              >
                <Input
                  id="bx-key"
                  value={masked ? `••••••••••••${last4}` : apiKey}
                  onChange={(e) => setApiKey(e.target.value.replace(/^•+/, ""))}
                  onFocus={() => setKeyFocused(true)}
                  onBlur={() => setKeyFocused(false)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className={cn("font-mono", masked && "tracking-wider text-mute")}
                  placeholder="z. B. 9a25209b66004da4…"
                  invalid={!!error && apiKey.trim().length < 8}
                />
              </Field>
              <Field label={EX.secretLabel} htmlFor="bx-secret" invalidKey={error && secret.trim().length < 8 ? shake : null}>
                <div className="relative">
                  <Input
                    id="bx-secret"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    spellCheck={false}
                    autoComplete="new-password"
                    className="pr-20 font-mono"
                    invalid={!!error && secret.trim().length < 8}
                  />
                  <button
                    type="button"
                    className="touch-hit absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11.5px] text-mute hover:text-fg"
                    onClick={() => setShowSecret((v) => !v)}
                    aria-pressed={showSecret}
                  >
                    {showSecret ? "Verbergen" : "Zeigen"}
                  </button>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={CONNECT.label} htmlFor="bx-label">
                  <Input id="bx-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={CONNECT.labelPh} />
                </Field>
                <div className="grid content-start gap-1.5">
                  <span id="bx-account" className="label">
                    {CONNECT.account}
                  </span>
                  <Segmented className="justify-self-start" aria-labelledby="bx-account" value={account} onChange={setAccount} options={ACCOUNTS} />
                </div>
              </div>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-[13px] transition-colors",
                  readOnly ? "border-win/35 bg-win/[0.05]" : "border-line bg-ink-950/40",
                )}
                data-field=""
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[#3fb27f]"
                  checked={readOnly}
                  onChange={(e) => setReadOnly(e.target.checked)}
                  data-testid="connect-readonly"
                />
                <span className="text-fg">{CONNECT.confirm}</span>
              </label>
              <p className="text-[11.5px] leading-relaxed text-faint">{CONNECT.privacy}</p>
              {error && (
                <motion.p
                  role="alert"
                  className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] text-loss"
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={tween.fade}
                  data-testid="connect-error"
                >
                  {error.message}
                </motion.p>
              )}
              <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
            </motion.form>
          )}

          {step === 2 && (
            <motion.div
              key="check"
              className="relative grid gap-4"
              initial={reduced ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ scale: spring.enter, opacity: tween.fade }}
            >
              <div className="relative grid place-items-center gap-3 overflow-hidden rounded-2xl border border-line bg-ink-950/50 px-4 py-7 text-center">
                {result && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <BorderBeam fire={1} />
                  </span>
                )}
                {checking || !result ? (
                  <>
                    <DotMatrix preset="snake" size={5} gap={2} tone="fg" playing={checking} />
                    <span className="text-[13px] text-mute">
                      <TextRoll text={CONNECT.checking} />
                    </span>
                  </>
                ) : (
                  <>
                    <span ref={okRef} className="grid size-12 place-items-center rounded-full border border-win/40 bg-win/10 text-win">
                      <svg
                        viewBox="0 0 24 24"
                        className="size-6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <motion.path
                          d="M5 12.5 10 17 19 7"
                          initial={reduced ? false : { pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={tween.check}
                        />
                      </svg>
                    </span>
                    <span className="text-[17px] font-semibold" data-testid="connect-ok">
                      {CONNECT.ok}
                    </span>
                    <span className="flex items-baseline gap-2 text-mute">
                      <RollingDigits
                        value={Math.round(result.account.available)}
                        className="dot-num text-[30px] leading-none text-fg"
                        aria-label={`${fmtPlain(result.account.available)} USDT`}
                      />
                      <span className="text-[12.5px]">{CONNECT.available}</span>
                    </span>
                  </>
                )}
              </div>
              {result && (
                <motion.div
                  className="grid gap-2"
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                  transition={{ y: { ...spring.enter, delay: 0.15 }, opacity: { ...tween.fade, delay: 0.15 } }}
                >
                  <span className="label">{CONNECT.importTitle}</span>
                  <p className="text-[12.5px] text-mute">{CONNECT.importLead}</p>
                  <Segmented className="justify-self-start" aria-label={CONNECT.importTitle} value={range} onChange={setRange} options={CONNECT.importRanges} />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
