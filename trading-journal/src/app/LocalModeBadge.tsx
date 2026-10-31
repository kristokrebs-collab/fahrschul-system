import { Popover as PopoverPrimitive } from "radix-ui";
import { useState } from "react";
import { useLocalBadgeOpen, useLocalModeCopy } from "@/app/LocalModeBanner";
import { openAuthSheet } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Icon } from "@/primitives/icons";

export const LOCAL_BADGE = {
  /** visible word (wide header) and the short word (narrow) */
  label: "Lokaler Modus",
  short: "Lokal",
  /** accessible name: says what a tap does */
  aria: "Lokaler Modus – Erklärung öffnen",
  title: "Lokaler Modus",
  backup: "Backup öffnen",
  close: "Schließen",
} as const;

/**
 * `Lokaler Modus` as a small badge in the header (Etappe 1a) instead of a banner above the page: a warn dot and the word, a tap
 * (or Enter) opens a short explanation with the same sentences the banner had – where the data lives, what to do about it – and,
 * where it applies, the one button that fixes it (`Anmelden` / `Code eingeben`, or `Backup öffnen`). Shown only in local mode with a
 * working storage; without storage the red `Speichern nicht möglich.` banner stays (`LocalModeBanner`). Below 640 px only the dot
 * shows (the name stays in `aria-label`); the tap area is 44 × 44 px in every case. A Radix popover: focus moves in, Escape and a tap
 * outside close it, the focus returns to the badge.
 */
export function LocalModeBadge({ className }: { className?: string }) {
  const show = useLocalBadgeOpen();
  const copy = useLocalModeCopy();
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={LOCAL_BADGE.aria}
          data-testid="local-badge"
          className={cn(
            "group/badge tap inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-warn/30 bg-warn/[0.08] px-3 text-[12.5px] font-medium text-warn outline-none transition-colors duration-200 hover:border-warn/50 hover:bg-warn/[0.14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-sm:px-0 max-sm:size-tap",
            className,
          )}
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warn" />
          <span aria-hidden="true" className="max-sm:hidden xl:hidden">
            {LOCAL_BADGE.short}
          </span>
          <span aria-hidden="true" className="max-xl:hidden">
            {LOCAL_BADGE.label}
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          data-testid="local-badge-panel"
          className="z-[60] grid w-[min(calc(100vw-24px),340px)] gap-3 rounded-2xl border border-line-2 bg-ink-850 p-4 text-[13px] leading-relaxed text-fg shadow-tooltip outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-[13.5px] font-semibold">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
              {LOCAL_BADGE.title}
            </p>
            <PopoverPrimitive.Close
              aria-label={LOCAL_BADGE.close}
              className="touch-hit -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-mute outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-white [&>svg]:size-3.5"
            >
              <Icon name="x" />
            </PopoverPrimitive.Close>
          </div>
          <p className="text-mute">{copy.text.trim()}</p>
          <div className="flex flex-wrap gap-2">
            {copy.action && (
              <Button
                size="sm"
                className="touch-hit"
                onClick={() => {
                  setOpen(false);
                  if (copy.action) openAuthSheet(copy.action.view, "banner");
                }}
              >
                {copy.action.label}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="touch-hit"
              onClick={() => {
                setOpen(false);
                void import("@/app/featureOpen").then((m) => m.openFeature("backup"));
              }}
            >
              {LOCAL_BADGE.backup}
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
