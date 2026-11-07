/**
 * The telephone setup of the alarm settings: number (with country code) → explicit consent → code by SMS → confirmed; then the test call and the
 * opt-out. Everything that matters is decided by the server (`/api/v1/alerts/phone`): this only asks, shows the server's German answer and keeps
 * the person in the loop. The number is typed once and never shown again (only `+49 ••• ••67`). No call is ever made to an unconfirmed number.
 * The test call has its button next to the other channels' tests (`AlertSettingsCard`).
 */
import { useState } from "react";
import { ApiError } from "@/cloud/api";
import { CONSENT_TEXT, parsePhone, PHONE_PROBLEM_TEXT } from "@/domain/alerts/phone";
import { Button } from "@/primitives/Button";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { pushToast } from "@/store/uiStore";
import { phoneCheck, phoneRevoke, phoneStart } from "./api";
import type { PhoneStatus } from "./model";

export interface PhoneSetupProps {
  status: PhoneStatus;
  masked: string | null;
  /** the account's phone changed on the server: reload the settings */
  onChanged: () => void;
  /** the code was sent: the number is being checked (the slot says "In Arbeit" before the server state reloads) */
  onStarted?: () => void;
}

const msg = (e: unknown): string => (e instanceof ApiError ? e.message : "Der Server hat nicht geantwortet.");

export function PhoneSetup({ status, masked, onChanged, onStarted }: PhoneSetupProps) {
  const [number, setNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"number" | "code">(status === "pending" ? "code" : "number");
  const [shownMask, setShownMask] = useState<string | null>(masked);
  const [busy, setBusy] = useState<null | "start" | "check" | "revoke">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const parsed = parsePhone(number);
  const numberError = number.trim() && !parsed.ok ? PHONE_PROBLEM_TEXT[parsed.problem] : null;

  async function start(): Promise<void> {
    if (!parsed.ok || !consent) return;
    setBusy("start");
    setError(null);
    try {
      const r = await phoneStart(number);
      setShownMask(r.masked);
      setStep("code");
      setCode("");
      onStarted?.();
      pushToast({ kind: "info", title: "Code gesendet", detail: "Du bekommst ihn gleich per SMS." });
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function check(): Promise<void> {
    setBusy("check");
    setError(null);
    try {
      await phoneCheck(code.trim());
      setNumber("");
      setConsent(false);
      pushToast({ kind: "success", title: "Nummer bestätigt" });
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(): Promise<void> {
    setBusy("revoke");
    setError(null);
    try {
      await phoneRevoke();
      setConfirmRevoke(false);
      setStep("number");
      pushToast({ kind: "success", title: "Telefon abgemeldet", detail: "Die Nummer ist gelöscht." });
      onChanged();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  if (status === "verified") {
    return (
      <div className="grid gap-3" data-testid="phone-verified">
        <p className="text-[12px] text-mute">
          Anrufe gehen an {shownMask ?? masked ?? "deine bestätigte Nummer"}. Jeder Anruf zählt gegen dein Monatskontingent, auch der Testanruf (Knopf unter der Tabelle).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {confirmRevoke ? (
            <>
              <span className="text-[12px] text-fg">Nummer löschen und Anrufe beenden?</span>
              <Button size="sm" variant="danger" loading={busy === "revoke"} onClick={() => void revoke()}>
                Ja, abmelden
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                Abbrechen
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(true)}>
              Abmelden und Nummer löschen
            </Button>
          )}
        </div>
        {error && (
          <p className="text-[12px] text-loss" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (step === "code") {
    return (
      <form
        className="grid gap-3"
        data-testid="phone-code"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 4) void check();
        }}
      >
        <Field label="Code aus der SMS" htmlFor="phone-code-input" help={`Gesendet an ${shownMask ?? "deine Nummer"}.`} error={error}>
          <Input id="phone-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} invalid={!!error} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" type="submit" loading={busy === "check"} disabled={code.trim().length < 4}>
            Bestätigen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStep("number");
              setError(null);
            }}
          >
            Andere Nummer
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="grid gap-3"
      data-testid="phone-number"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <Field label="Telefonnummer" htmlFor="phone-number-input" help="Mit Ländervorwahl, zum Beispiel +49 170 1234567." error={numberError ?? error}>
        <Input id="phone-number-input" type="tel" inputMode="tel" autoComplete="tel" value={number} onChange={(e) => setNumber(e.target.value)} invalid={!!(numberError ?? error)} />
      </Field>
      <CheckboxRow checked={consent} onToggle={() => setConsent((c) => !c)}>
        Einwilligung zu Anrufen
      </CheckboxRow>
      <p className="text-[12px] text-mute" data-testid="phone-consent-text">
        {CONSENT_TEXT}
      </p>
      <div>
        <Button size="sm" variant="primary" type="submit" loading={busy === "start"} disabled={!parsed.ok || !consent}>
          Code senden
        </Button>
      </div>
    </form>
  );
}
