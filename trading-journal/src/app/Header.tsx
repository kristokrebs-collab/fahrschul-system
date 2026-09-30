import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import type { StoreMode } from "@/domain/types";
import { Magnetic } from "@/primitives/Magnetic";
import { SplitText } from "@/primitives/SplitText";
import { Icon } from "@/primitives/icons";
import { MODE_LABELS, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

export const WORDMARK = "Trade Journal";
export const SUBTITLE = "Makro & Scalp · Entscheidungen, Win-Rate, Backtest";
export const HEADER_CTA = "Trade eintragen";

const MODE_TONE: Record<StoreMode, StatusTone> = { cloud: "live", local: "warn", error: "error", connecting: "muted" };

/**
 * Sticky app header (Plan 2.5 "Header", 6.6): logo tile `₿` → overview, `SplitText` wordmark
 * (once per session), subtitle, sync pill (`hidden md:inline-flex`), Magnetic → `.shiny-cta`
 * `Trade eintragen` (label `max-sm:sr-only`) opening the editor without a morph source.
 */
export function Header() {
  const mode = useJournal((s) => s.mode);
  const openEditor = useUi((s) => s.openEditor);
  const label = MODE_LABELS[mode];
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-line/80 bg-ink-900/[0.97]">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
        <button type="button" onClick={() => navigate("overview")} className="flex min-w-0 items-center gap-3 text-left" aria-label="Übersicht">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold text-fg" aria-hidden="true">
            ₿
          </span>
          <span className="min-w-0">
            <SplitText text={WORDMARK} className="hidden text-[15px] font-semibold tracking-tight sm:inline-flex" />
            <span className="hidden truncate text-[11px] text-faint sm:block">{SUBTITLE}</span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline-flex" title={label.text}>
            <StatusPill tone={MODE_TONE[mode]} expanded label={label.text} feed="sync" />
          </span>
          <Magnetic intensity={0.25} range={120}>
            <button type="button" onClick={() => openEditor()} className="shiny-cta inline-flex items-center gap-2 max-sm:!px-3">
              <span className="size-3.5 [&>svg]:size-full" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <span className="max-sm:sr-only">{HEADER_CTA}</span>
            </button>
          </Magnetic>
        </div>
      </div>
    </header>
  );
}
