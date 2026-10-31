import { cn } from "@/lib/cn";
import { GlyphSpark } from "./icons";
import { openAssistant } from "./open";

export const ASSISTANT_LABEL = "Assistent";

/** Header button: opens the assistant from every page (also reachable with the shortcut `A`). */
/** `label`: the visible word next to the icon (the header shows it where there is room; the name stays in `aria-label`). */
export function AssistantButton({ className, label }: { className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => openAssistant()}
      aria-label="Assistent öffnen"
      aria-haspopup="dialog"
      title="Assistent (A)"
      data-testid="assistant-button"
      className={cn("tap group/ai relative inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-line-2 bg-ink-850 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg", className)}
    >
      <GlyphSpark className="size-[18px] transition-transform duration-200 ease-out group-hover/ai:rotate-12 group-hover/ai:scale-110" />
      <span aria-hidden="true" className="absolute right-1 top-1 size-1 rounded-full bg-signal" />
      {label && (
        <span aria-hidden="true" className="max-xl:hidden text-[12.5px] font-medium text-fg">
          {label}
        </span>
      )}
    </button>
  );
}
