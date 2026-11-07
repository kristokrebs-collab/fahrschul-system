import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { CopyButton } from "@/primitives/CopyButton";
import { download } from "@/store/download";
import { pushToast } from "@/store/uiStore";
import type { RecoveryStatus } from "../client";
import { ensureCloud } from "../runtime";
import { SECURITY } from "./strings";

/**
 * Recovery codes of the second factor (B1): how many are left, "Codes erzeugen", and the one moment the codes are on screen
 * – shown with copy and file download, closed only after the user says they are stored. The codes live in this component's
 * state for that moment and nowhere else (not in a store, not in storage, not in a log). Only for a session that did the
 * code step (the server demands aal2 too).
 */
export function RecoverySection() {
  const [status, setStatus] = useState<RecoveryStatus | "loading" | "failed">("loading");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askNew, setAskNew] = useState(false);

  const load = useCallback(async () => {
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.recoveryStatus() : null;
    setStatus(r && r.ok ? r.value : "failed");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setAskNew(false);
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.generateRecoveryCodes() : null;
    setBusy(false);
    if (!r || !r.ok) return pushToast({ kind: "error", title: r && !r.ok ? r.message : "Cloud nicht erreichbar." });
    setCodes(r.value.codes);
    setSaved(false);
    void load();
  }

  const hasSet = typeof status === "object" && status.total > 0;
  return (
    <div className="grid gap-2.5 rounded-2xl border border-line px-3.5 py-3" data-testid="recovery-section">
      <h4 className="text-[13px] font-semibold text-fg">{SECURITY.recoveryTitle}</h4>
      <p className="text-[12.5px] leading-relaxed text-mute">{SECURITY.recoveryText}</p>
      <p className="text-[12px] text-faint" role="status">
        {status === "loading" ? "…" : status === "failed" ? SECURITY.recoveryLoadFailed : hasSet ? SECURITY.recoveryLeft(status.remaining, status.total) : SECURITY.recoveryNone}
      </p>
      {codes ? (
        <motion.div className="grid gap-3 rounded-xl border border-line-2 bg-ink-950/50 p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tween.fade} data-testid="recovery-codes">
          <p className="text-[12.5px] leading-relaxed text-warn">{SECURITY.recoveryShownOnce}</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[13px] tracking-wider text-fg">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={codes.join("\n")} label={SECURITY.recoveryCopy} doneLabel={SECURITY.recoveryCopied} />
            <Button size="sm" onClick={() => void download(SECURITY.recoveryFile, `Wiederherstellungscodes für den Zwei-Faktor-Schutz (je ein Mal gültig)\n\n${codes.join("\n")}\n`, "text/plain")}>
              {SECURITY.recoverySave}
            </Button>
          </div>
          <label className="flex min-h-[44px] items-start gap-2.5 text-[12.5px] text-fg">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-4 shrink-0" data-testid="recovery-saved" />
            {SECURITY.recoveryConfirm}
          </label>
          <Button variant="primary" className="justify-self-start" disabled={!saved} onClick={() => setCodes(null)}>
            {SECURITY.recoveryDone}
          </Button>
        </motion.div>
      ) : hasSet ? (
        askNew ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-(--color-danger-text)" role="alert">
            {SECURITY.recoveryNewAsk}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void generate()}>
              {SECURITY.yes}
            </Button>
            <Button size="sm" onClick={() => setAskNew(false)}>
              {SECURITY.no}
            </Button>
          </span>
        ) : (
          <HoldConfirm className="justify-self-start" variant="secondary" onAsk={() => setAskNew(true)} onConfirm={() => void generate()} disabled={busy}>
            {SECURITY.recoveryNew}
          </HoldConfirm>
        )
      ) : (
        // the row keeps its height while the status loads (no jump when the button arrives)
        status === "loading" ? (
          <div className="h-[37px]" aria-hidden="true" />
        ) : (
          <Button variant="primary" className="justify-self-start" disabled={busy} onClick={() => void generate()} data-testid="recovery-create">
            {SECURITY.recoveryCreate}
          </Button>
        )
      )}
    </div>
  );
}
