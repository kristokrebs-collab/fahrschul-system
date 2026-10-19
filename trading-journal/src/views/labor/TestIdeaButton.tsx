/**
 * "Diese Idee testen" (F12): one button for a Box setup, the entry check and a journal combination. A click translates the
 * source into a draft of the lab's "Eigene Idee", fills the lab with it and opens the Labor page – nothing is saved and no
 * run is started. When no rule can be built from the source the lab stays untouched and the reason shows under the button.
 *
 * Only this small component sits in the pages that carry the button; the translation and the lab store load with the click.
 */
import { useState } from "react";
import type { IdeaInput } from "@/domain/lab/idea";
import { Button, type ButtonVariant } from "@/primitives/Button";
import { navigate } from "@/store/router";

export const TEST_IDEA = { label: "Diese Idee testen", busy: "Übersetze …", failed: "Das Labor konnte nicht geladen werden. Versuch es noch einmal." } as const;

export function TestIdeaButton({ input, onOpen, variant = "ghost", size = "md", className, testId = "test-idea", label = TEST_IDEA.label }: { input: IdeaInput; onOpen?: () => void; variant?: ButtonVariant; size?: "sm" | "md"; className?: string; testId?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { openIdea } = await import("./openIdea");
      const draft = openIdea(input);
      if (draft.testable) {
        onOpen?.();
        navigate("labor");
      } else setProblem(draft.blocked ?? TEST_IDEA.failed);
    } catch {
      setProblem(TEST_IDEA.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-w-0 content-start justify-items-start gap-1.5 justify-self-start">
      <Button variant={variant} size={size} className={className} onClick={() => void run()} disabled={busy} data-testid={testId}>
        {busy ? TEST_IDEA.busy : label}
      </Button>
      {problem && (
        <p role="status" className="max-w-[46ch] text-[11.5px] leading-snug text-mute" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
    </div>
  );
}
