import { cn } from "@/lib/cn";
import { GlyphSpark } from "./icons";
import { openAssistant } from "./open";

export const ASSISTANT_LABEL = "Assistent";

/** Header button: opens the assistant from every page (also reachable with the shortcut `A`). */
export function AssistantButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openAssistant()}
      aria-label="Assistent öffnen"
      aria-haspopup="dialog"
      title="Assistent (A)"
      data-testid="assistant-button"
      className={cn("touch-hit group/ai relative grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-850 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg", className)}
    >
      <GlyphSpark className="size-[18px] transition-transform duration-200 ease-out group-hover/ai:rotate-12 group-hover/ai:scale-110" />
      <span aria-hidden="true" className="absolute right-1 top-1 size-1 rounded-full bg-signal" />
    </button>
  );
}
