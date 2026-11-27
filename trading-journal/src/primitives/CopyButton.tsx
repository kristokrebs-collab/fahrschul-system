import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { TextRoll } from "@/motion/TextRoll";
import { Button, type ButtonProps } from "@/primitives/Button";
import { useActionStatus } from "@/primitives/useActionStatus";

/** Clipboard with a textarea fallback for contexts without `navigator.clipboard` (http, old WebViews). Nothing is sent anywhere. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection copy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "status" | "success" | "error" | "loading" | "statusIcon" | "onClick"> {
  /** The text to copy (read at the click). */
  text?: string;
  /** Your own copy (e.g. with a selected-field fallback); resolves `true` when it worked. Wins over `text`. */
  onCopy?: () => boolean | Promise<boolean>;
  /** Idle label (default „Kopieren“). */
  label?: string;
  /** Label while it shows the ✓ (default „Kopiert“). */
  doneLabel?: string;
  /** Reported after each try; toasts and other notes stay with the caller. */
  onResult?: (ok: boolean) => void;
  /** How long the ✓ stays (ms, default `dwell.done`). */
  hold?: number;
  /** Symbol only (the ✓ replaces it): give the button an `aria-label`; `label` / `doneLabel` are then only the accessible text of the states. */
  iconOnly?: boolean;
}

const COPY_PATH = "M5.5 5.5V3.8c0-.7.6-1.3 1.3-1.3h5.4c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3h-1.7M3.8 5.5h5.4c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3V6.8c0-.7.6-1.3 1.3-1.3z";

/**
 * Copy feedback in one place: the symbol turns into a ✓ that draws itself, the label rolls from „Kopieren“ to „Kopiert“
 * (`TextRoll`), a soft green wash fades in, and after `hold` it all goes back. A failed copy shakes the button once and
 * keeps the label. The button keeps its width (the longer of the two labels is reserved, no text in the DOM for it), the
 * accessible name always is the current label. Reduced motion: instant swaps.
 */
export function CopyButton({ text, onCopy, label = "Kopieren", doneLabel = "Kopiert", onResult, hold, iconOnly = false, variant = "secondary", size = "sm", className, ...rest }: CopyButtonProps) {
  const { status, set } = useActionStatus(hold);
  const latest = useRef({ text, onCopy, onResult });
  useEffect(() => {
    latest.current = { text, onCopy, onResult };
  }, [text, onCopy, onResult]);
  const ok = status === "success";
  const widest = label.length >= doneLabel.length ? label : doneLabel;

  const copy = async () => {
    const { text: t, onCopy: custom, onResult: report } = latest.current;
    let done: boolean;
    try {
      done = custom ? await custom() : await copyToClipboard(t ?? "");
    } catch {
      done = false;
    }
    set(done ? "success" : "error");
    report?.(done);
  };

  return (
    <Button variant={variant} size={size} status={status} statusIcon={false} onClick={() => void copy()} className={cn("min-w-0", className)} {...rest}>
      <span className="relative grid size-3.5 shrink-0 place-items-center" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          className={cn("col-start-1 row-start-1 size-3.5 transition-[opacity,scale] duration-200", ok && "scale-50 opacity-0")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={COPY_PATH} />
        </svg>
        {ok && (
          <svg viewBox="0 0 16 16" className="fx-check col-start-1 row-start-1 size-3.5 text-win" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path pathLength={1} d="M3.5 8.5l3 3 6-7" />
          </svg>
        )}
      </span>
      {!iconOnly && (
        <span className="fx-reserve" data-reserve={widest}>
          <TextRoll text={ok ? doneLabel : label} className="[grid-area:1/1] justify-self-center" />
        </span>
      )}
    </Button>
  );
}
