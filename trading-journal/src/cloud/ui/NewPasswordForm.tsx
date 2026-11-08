/**
 * „Passwort ändern“ on the Konto page (P09): new password + repeat, strength bars, the server's German error at the field. Its own file
 * since Paket V: the login window (`AuthSheet` / `AuthWindow`) has its own underline fields, and the Konto chunk must not pull the
 * window's stylesheet in with this form.
 */
import { motion } from "motion/react";
import { useId, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { StaggerItem } from "@/motion/Stagger";
import { spring, stagger } from "@/motion/tokens";
import { TextRoll } from "@/motion/TextRoll";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { pushToast } from "@/store/uiStore";
import { passwordProblem, passwordStrength, type AuthField } from "../authErrors";
import { ensureCloud } from "../runtime";
import { AUTH } from "./strings";

interface FieldError {
  field: AuthField;
  message: string;
  key: number;
}
let errorSeq = 0;
const errorOf = (field: AuthField, message: string): FieldError => ({ field, message, key: ++errorSeq });

/** Password input with a show / hide toggle. */
function PasswordInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative grid">
      <Input id={id} name="password" type={show ? "text" : "password"} autoComplete="new-password" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)} className="pr-11" />
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
    const m = await ensureCloud().catch(() => null);
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
          <PasswordInput id={`${ids}-pw`} value={pw} onChange={setPw} invalid={err?.field === "password"} />
        </Field>
        <StrengthMeter password={pw} />
      </StaggerItem>
      <StaggerItem>
        <Field label={AUTH.repeat} htmlFor={`${ids}-rep`} error={err?.field === "code" ? err.message : undefined} invalidKey={err?.field === "code" ? err.key : null}>
          <PasswordInput id={`${ids}-rep`} value={repeat} onChange={setRepeat} invalid={err?.field === "code"} />
        </Field>
      </StaggerItem>
      {err && err.field === null && (
        <p role="alert" className="text-[12.5px] text-loss">
          {err.message}
        </p>
      )}
      <StaggerItem className="flex justify-end">
        <Button type="submit" variant="primary" className="w-full sm:w-auto sm:min-w-[11rem]" disabled={busy} aria-busy={busy || undefined}>
          <TextRoll mode="roll" text={busy ? AUTH.busy.newPassword : AUTH.submit.newPassword} />
        </Button>
      </StaggerItem>
    </form>
  );
}
