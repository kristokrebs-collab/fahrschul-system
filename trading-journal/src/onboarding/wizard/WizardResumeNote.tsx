/**
 * A quiet line on the Konto page for a setup that was left half-way (Paket P, docs/PSYCHOLOGIE.md): the real progress ("2 von 4
 * Schritten durchgegangen") and one button that opens the wizard at the stored step. It exists ONLY while the wizard is `active`
 * (begun and paused) – never for a finished, declined or not yet started setup, never on the Übersicht or the Cockpit, and it carries no
 * deadline, no warning and no "nur noch".
 */
import { useState } from "react";
import { Button } from "@/primitives/Button";
import { openWizard, readWizard, useWizard, WIZARD_STEP_LABELS, wizardProgress } from "./wizardStore";

export const RESUME_NOTE = {
  label: "Einrichtung",
  progress: (done: number, total: number, next: string) => `${done} von ${total} Schritten durchgegangen – als Nächstes: ${next}.`,
  resume: "Weiter, wo du aufgehört hast",
} as const;

export function WizardResumeNote({ className }: { className?: string }) {
  const open = useWizard((s) => s.open);
  const [stored, setStored] = useState(readWizard);
  const [was, setWas] = useState(open);
  // re-read the stored place whenever the wizard opens or closes (adjusting state while rendering, no effect round trip)
  if (was !== open) {
    setWas(open);
    setStored(readWizard());
  }
  if (open || stored?.status !== "active") return null;
  const { done, total } = wizardProgress(stored);
  return (
    <div className={className} data-testid="wizard-resume">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-2xl border border-line bg-white/[0.02] px-4 py-3 text-[13.5px]">
        <p className="min-w-0 text-mute">
          <span className="font-medium text-fg">{RESUME_NOTE.label}</span> · {RESUME_NOTE.progress(done, total, WIZARD_STEP_LABELS[stored.step] ?? "")}
        </p>
        <Button size="sm" onClick={() => openWizard(true)} data-testid="wizard-resume-open">
          {RESUME_NOTE.resume}
        </Button>
      </div>
    </div>
  );
}

export default WizardResumeNote;
