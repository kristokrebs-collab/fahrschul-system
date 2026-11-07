/**
 * "Verträge hier kündigen" (§ 312k BGB) and "Vertrag widerrufen" (§ 356a BGB) – reachable WITHOUT a login (B4). ENTWURF –
 * Prüfung durch Anwalt nötig; the path and its reasons: `docs/RECHT/kuendigung-widerruf.md`.
 *
 *   form    e-mail address of the account (+ for a withdrawal the name and, optionally, a note on the contract)
 *   confirm the confirmation page: what happens, and the button "Jetzt kündigen" / "Widerruf bestätigen" (`BUTTON_LABELS`) –
 *           nothing stands between the form and this page, no reason, no offer
 *   done    time of receipt; the link in the mail (or at once when the person is signed in as that address)
 *   link    `?kuendigen=<token>`: the page behind the link of the mail – one more click executes it (nobody can end a stranger's contract)
 *
 * Without a mail service on the server the page SAYS so ("nicht eingerichtet") instead of promising a mail.
 */
import { useEffect, useId, useState } from "react";
import { ApiError } from "@/cloud/api";
import { useCloudSession } from "@/cloud/session";
import { BUTTON_LABELS } from "@/legal/consentTexts";
import { legalConfig } from "@/legal/config";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { postContract, postContractConfirm } from "../api";
import { closeContract, useContract } from "../contractStore";
import type { ContractConfirmResponse, ContractKind, ContractReceipt } from "../contract";
import { formatDay } from "../format";
import { CONTRACT } from "../purchase/strings";
import "../purchase/purchase.css";

type Step = "form" | "confirm" | "done" | "link" | "linkDone";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** `07.11.2026, 14:32:05 Uhr` – date AND time of the receipt (Berlin time, as the mail says). */
export function receiptStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${day}, ${time} Uhr`;
}

export function ContractSheet() {
  const kind = useContract((s) => s.open);
  const token = useContract((s) => s.token);
  const signedEmail = useCloudSession((s) => (s.phase === "signedIn" ? (s.user?.email ?? "") : ""));
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const shown: ContractKind = kind ?? "cancel";
  const T = CONTRACT[shown];
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [contract, setContract] = useState("");
  const [err, setErr] = useState<{ field: "email" | "name"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ContractReceipt | null>(null);
  const [result, setResult] = useState<ContractConfirmResponse | null>(null);
  const emailId = useId();
  const nameId = useId();
  const noteId = useId();

  // every opening starts clean (the token of a mail link goes straight to its last page)
  useEffect(() => {
    if (!kind) return;
    setStep(token ? "link" : "form");
    setEmail((e) => e || signedEmail);
    setErr(null);
    setFail(null);
    setReceipt(null);
    setResult(null);
  }, [kind, token, signedEmail]);

  const toConfirm = () => {
    const e = email.trim();
    if (!EMAIL.test(e)) return setErr({ field: "email", message: CONTRACT.invalidEmail });
    if (shown === "withdraw" && !name.trim()) return setErr({ field: "name", message: CONTRACT.nameMissing });
    setErr(null);
    setStep("confirm");
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setFail(null);
    try {
      const r = await postContract({ kind: shown, email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}), ...(contract.trim() ? { contract: contract.trim() } : {}) }, signedIn);
      setReceipt(r);
      setStep("done");
    } catch (e) {
      setFail(e instanceof ApiError && e.status !== 0 ? e.message : CONTRACT.failed);
    } finally {
      setBusy(false);
    }
  };

  const confirmLink = async () => {
    if (busy || !token) return;
    setBusy(true);
    setFail(null);
    try {
      setResult(await postContractConfirm(token));
      setStep("linkDone");
    } catch (e) {
      setFail(e instanceof ApiError && e.code === "unknown_link" ? CONTRACT.unknown : CONTRACT.failed);
    } finally {
      setBusy(false);
    }
  };

  const title = step === "confirm" || step === "link" ? T.confirmTitle : step === "done" || step === "linkDone" ? T.doneTitle : T.title;
  const confirmLabel = shown === "cancel" ? BUTTON_LABELS.cancelConfirm : BUTTON_LABELS.withdrawConfirm;

  const footer =
    step === "form" ? (
      <>
        <Button variant="ghost" onClick={closeContract}>
          {CONTRACT.close}
        </Button>
        <span className="flex-1" />
        <Button variant="primary" fx={false} onClick={toConfirm} data-testid="contract-next">
          {T.next}
        </Button>
      </>
    ) : step === "confirm" ? (
      <>
        <Button variant="ghost" onClick={() => setStep("form")} disabled={busy}>
          {CONTRACT.back}
        </Button>
        <span className="flex-1" />
        <Button variant="danger" loading={busy} onClick={() => void send()} data-testid="contract-confirm">
          {confirmLabel}
        </Button>
      </>
    ) : step === "link" ? (
      <>
        <Button variant="ghost" onClick={closeContract} disabled={busy}>
          {CONTRACT.close}
        </Button>
        <span className="flex-1" />
        <Button variant="danger" loading={busy} onClick={() => void confirmLink()} data-testid="contract-link-confirm">
          {confirmLabel}
        </Button>
      </>
    ) : (
      <>
        <span className="flex-1" />
        <Button variant="primary" fx={false} onClick={closeContract} data-testid="contract-done">
          {CONTRACT.close}
        </Button>
      </>
    );

  return (
    <Sheet open={!!kind} onClose={closeContract} title={title} size="md" dismissGuard={false} className="pay-sheet" footer={footer}>
      <div className="grid gap-4" data-testid="contract-sheet" data-kind={shown} data-step={step}>
        {step === "form" && (
          <>
            <StaggerItem>
              <p className="text-[13.5px] leading-relaxed text-mute">{T.lead}</p>
            </StaggerItem>
            <StaggerItem>
              <Field label={CONTRACT.email} htmlFor={emailId} error={err?.field === "email" ? err.message : undefined} invalidKey={err?.field === "email" ? err.message : null}>
                <Input id={emailId} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={err?.field === "email"} data-testid="contract-email" />
              </Field>
            </StaggerItem>
            {shown === "withdraw" && (
              <>
                <StaggerItem>
                  <Field label={CONTRACT.name} htmlFor={nameId} error={err?.field === "name" ? err.message : undefined} invalidKey={err?.field === "name" ? err.message : null}>
                    <Input id={nameId} autoComplete="name" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} invalid={err?.field === "name"} data-testid="contract-name" />
                  </Field>
                </StaggerItem>
                <StaggerItem>
                  <Field label={CONTRACT.contractHint} htmlFor={noteId}>
                    <Input id={noteId} value={contract} onChange={(e) => setContract(e.target.value.slice(0, 300))} data-testid="contract-note" />
                  </Field>
                </StaggerItem>
              </>
            )}
          </>
        )}

        {step === "confirm" && (
          <StaggerItem className="grid gap-3">
            <p className="text-[14px] leading-relaxed" data-testid="contract-confirm-text">
              {T.confirmLead(email.trim())}
            </p>
            {shown === "withdraw" && (
              <dl className="grid gap-1 text-[13px] text-mute">
                <div>
                  <dt className="inline">Name: </dt>
                  <dd className="inline text-fg">{name.trim()}</dd>
                </div>
                {contract.trim() && (
                  <div>
                    <dt className="inline">Vertrag: </dt>
                    <dd className="inline text-fg">{contract.trim()}</dd>
                  </div>
                )}
              </dl>
            )}
            {fail && (
              <p role="alert" className="text-[12.5px] text-loss" data-testid="contract-error">
                {fail}
              </p>
            )}
          </StaggerItem>
        )}

        {step === "done" && receipt && (
          <StaggerItem className="grid gap-3" data-testid="contract-receipt">
            <p className="text-[14px] font-semibold" data-testid="contract-received">
              {CONTRACT.receivedAt(receiptStamp(receipt.receivedAt))}
            </p>
            <p className="text-[13.5px] leading-relaxed text-mute" data-testid="contract-after">
              {receipt.next === "done" ? (receipt.mail === "sent" ? `${T.afterDirect} ${CONTRACT.mailSentDirect}` : `${T.afterDirect} ${CONTRACT.mailOff}`) : receipt.mail === "sent" ? `${CONTRACT.mailSent} ${T.afterLink}` : CONTRACT.mailOff}
            </p>
          </StaggerItem>
        )}

        {step === "link" && (
          <StaggerItem className="grid gap-3">
            <p className="text-[14px] leading-relaxed">{T.linkLead}</p>
            {fail && (
              <p role="alert" className="text-[12.5px] text-loss" data-testid="contract-error">
                {fail}
              </p>
            )}
          </StaggerItem>
        )}

        {step === "linkDone" && result && (
          <StaggerItem className="grid gap-2" data-testid="contract-result" data-status={result.status}>
            <p className="text-[15px] font-semibold">
              {result.status === "done" ? T.linkDone : result.status === "late" ? CONTRACT.withdraw.late : result.status === "expired" ? CONTRACT.expired : T.linkNone}
            </p>
            {result.status === "done" && (
              <p className="text-[13.5px] text-mute">{shown === "cancel" ? CONTRACT.cancel.linkEnds(formatDay(result.endsAt)) : CONTRACT.withdraw.linkEnds()}</p>
            )}
            <p className="text-[12.5px] text-mute">{CONTRACT.receivedAt(receiptStamp(result.confirmedAt))}</p>
          </StaggerItem>
        )}

        <StaggerItem>
          {!legalConfig().draftsReviewed && <p className="text-[12px] text-faint">{CONTRACT.draft}</p>}
        </StaggerItem>
      </div>
    </Sheet>
  );
}
