import { openEditorWarm, preloadOverlay } from "@/app/overlayLoad";
import { cn } from "@/lib/cn";
import { Icon } from "@/primitives/icons";
import { Magnetic } from "@/primitives/Magnetic";

export const NEW_TRADE_LABEL = "Trade eintragen";

export interface NewTradeButtonProps {
  /** classes of the button (the header and the sidebar differ in padding and width) */
  className?: string;
  /** classes of the visible word (`max-sm:sr-only` in the header, `sr-only` in the narrow rail) */
  labelClassName?: string;
  /** classes of the magnetic wrapper (the sidebar stretches it) */
  wrapClassName?: string;
}

/**
 * The primary action „Trade eintragen“ – one component for the header (below 768 px) and the sidebar (from 768 px), so form and
 * effect stay identical wherever it stands: `.shiny-cta` (conic border, shimmer on hover), magnetic pull, opens the editor without
 * a morph source. The words are the accessible name even when only the plus is visible.
 */
export function NewTradeButton({ className, labelClassName, wrapClassName }: NewTradeButtonProps) {
  // the editor is a chunk of its own (Budget-Schnitt): fetched on intent here and at idle, so the tap opens it at once
  const warm = () => void preloadOverlay("editor");
  return (
    <Magnetic intensity={0.25} range={120} className={wrapClassName}>
      <button type="button" onClick={() => openEditorWarm()} onPointerEnter={warm} onFocus={warm} onPointerDown={warm} className={cn("shiny-cta inline-flex items-center gap-2 pointer-coarse:min-h-tap pointer-coarse:min-w-tap pointer-coarse:justify-center", className)}>
        <span className="size-3.5 [&>svg]:size-full" aria-hidden="true">
          <Icon name="plus" />
        </span>
        <span className={labelClassName}>{NEW_TRADE_LABEL}</span>
      </button>
    </Magnetic>
  );
}
