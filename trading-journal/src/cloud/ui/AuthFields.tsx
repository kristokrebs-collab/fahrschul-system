/**
 * The parts of the login card's form half (Paket V): underline fields with a floating label and a symbol on the right, the tick row,
 * the full-width pill, the strength hint and the consent line. Plain elements with the card's classes (`authWindow.css`); positions
 * come from `top` (share of the card height, `--aw-top`), so the rows sit where the recording has them.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { canAnimate } from "@/motion/waapi";
import { passwordStrength } from "../authErrors";
import { AUTH } from "./strings";

/** `top` (in % of the card height) as the CSS variable the absolute rows read. */
export const at = (top: number | undefined): CSSProperties | undefined => (top === undefined ? undefined : ({ "--aw-top": top } as CSSProperties));

export const IconPerson = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M5 20c.9-3.6 3.6-5.6 7-5.6s6.1 2 7 5.6" />
  </svg>
);
export const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="M4.5 7l7.5 6 7.5-6" />
  </svg>
);
export const IconEye = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);
export const IconKey = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="14" r="3.5" />
    <path d="M10.5 11.5L19 3m-3 3l2.5 2.5M14 8l2 2" />
  </svg>
);
const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** Shakes the element once whenever `key` changes to a non-null value (a refused field). */
function useShake(key: number | null | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (key == null || !canAnimate(ref.current)) return;
    ref.current.animate([{ translate: "0 0" }, { translate: "-6px 0" }, { translate: "5px 0" }, { translate: "-3px 0" }, { translate: "0 0" }], { duration: 350, easing: "ease-in-out" });
  }, [key]);
  return ref;
}

export interface LineFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  name?: string;
  autoComplete?: string;
  inputMode?: "email" | "text";
  icon?: ReactNode;
  /** A control in place of the symbol (the password's show / hide toggle). */
  trailing?: ReactNode;
  error?: string;
  /** Changes with every new refusal of this field (shake). */
  errorKey?: number | null;
  /** Row position (share of the card height) of the field's top edge in the landscape card. */
  top?: number;
  /** The first field of a form: its focus line grows during the switch choreography. */
  first?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  className?: string;
  spellCheck?: boolean;
  testId?: string;
}

/** Underline field: placeholder in the field, label floats on focus, accent line grows from the left, symbol on the right. */
export function LineField({ id, label, value, onChange, type = "text", name, autoComplete, inputMode, icon, trailing, error, errorKey, top, first, describedBy, autoFocus, className, spellCheck, testId }: LineFieldProps) {
  const ref = useShake(error ? errorKey : null);
  const errId = `${id}-error`;
  const desc = [error ? errId : null, describedBy ?? null].filter(Boolean).join(" ") || undefined;
  return (
    <div ref={ref} className={`aw-field ${top === undefined ? "" : "aw-abs"} ${className ?? ""}`} style={at(top)} data-aw-row="" data-invalid={error ? "" : undefined} data-testid={testId}>
      <input
        id={id}
        name={name}
        type={type}
        className="aw-input"
        placeholder=" "
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={type === "email" || inputMode === "email" ? "none" : undefined}
        autoCorrect={type === "email" || inputMode === "email" ? "off" : undefined}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={desc}
        autoFocus={autoFocus}
        data-aw-first={first ? "" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <label htmlFor={id} className="aw-label">
        {label}
      </label>
      <span className="aw-fline" aria-hidden="true" />
      <span className="aw-ffocus" aria-hidden="true" data-aw-focusline={first ? "" : undefined} />
      {trailing ?? (icon ? <span className="aw-ficon" aria-hidden="true">{icon}</span> : null)}
      {error && (
        <p id={errId} className="aw-ferror">
          {error}
        </p>
      )}
    </div>
  );
}

/** Password field with the eye as its show / hide toggle (`aria-pressed`). */
export function PasswordLine(props: Omit<LineFieldProps, "type" | "trailing" | "icon">) {
  const [show, setShow] = useState(false);
  return (
    <LineField
      {...props}
      name={props.name ?? "password"}
      type={show ? "text" : "password"}
      trailing={
        <button type="button" className="aw-ficon" onClick={() => setShow((v) => !v)} aria-label={show ? AUTH.hide : AUTH.show} aria-pressed={show}>
          <IconEye off={show} />
        </button>
      }
    />
  );
}

/** Native checkbox with the card's filled square. */
export function CheckBox({ checked, onChange, label, describedBy, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; describedBy?: string; testId?: string }) {
  return (
    <label className="aw-check" data-testid={testId}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} />
      <span className="aw-box" aria-hidden="true">
        <Tick />
      </span>
      <span>{label}</span>
    </label>
  );
}

/** The consent line at registration (a real checkbox; the documents are links that never toggle it). */
export function ConsentLine({
  checked,
  onChange,
  invalid,
  children,
  top,
  inputId,
  describedBy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  invalid?: boolean;
  children: ReactNode;
  top?: number;
  /** id of the checkbox (so the form can move the focus to it when the consent is missing) */
  inputId?: string;
  /** id of the message that says what is missing – read with the checkbox while it is invalid */
  describedBy?: string;
}) {
  const own = `${useId()}-consent`;
  const id = inputId ?? own;
  return (
    <div className={`aw-consent ${top === undefined ? "" : "aw-abs"}`} style={at(top)} data-aw-row="" data-invalid={invalid && !checked ? "" : undefined} data-testid="signup-consent" data-checked={checked ? "true" : "false"}>
      <span className="aw-check" style={{ minHeight: 0 }}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={invalid && !checked ? true : undefined} aria-describedby={invalid && !checked ? describedBy : undefined} />
        <span className="aw-box" aria-hidden="true">
          <Tick />
        </span>
      </span>
      <label htmlFor={id}>{children}</label>
    </div>
  );
}

/** Four short strength segments on the left, the rule on the right. */
export function StrengthHint({ password, top }: { password: string; top?: number }) {
  const s = password ? passwordStrength(password) : 0;
  const tone = s <= 1 ? "loss" : s === 2 ? "warn" : "win";
  return (
    <div className={`aw-hint ${top === undefined ? "" : "aw-abs"}`} style={at(top)} data-aw-row="" aria-live="off">
      <span className="aw-seg" data-tone={tone} aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} data-on={password && s >= i ? "" : undefined} />
        ))}
      </span>
      <span>{password ? `${AUTH.strength[s]} · ${AUTH.card.pwRule}` : AUTH.card.pwRule}</span>
    </div>
  );
}

/** The full-width pill (submit). */
export function PillButton({ label, busyLabel, busy, top, disabled, onClick, type = "submit", testId }: { label: string; busyLabel?: string; busy?: boolean; top?: number; disabled?: boolean; onClick?: () => void; type?: "submit" | "button"; testId?: string }) {
  return (
    <button type={type} className={`aw-btn ${top === undefined ? "" : "aw-abs"}`} style={at(top)} data-aw-btn="" disabled={busy || disabled} aria-busy={busy || undefined} onClick={onClick} data-testid={testId}>
      {busy && busyLabel ? busyLabel : label}
    </button>
  );
}
