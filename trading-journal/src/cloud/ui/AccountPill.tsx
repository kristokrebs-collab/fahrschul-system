import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { radius, spring } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { cloudEnabled } from "../env";
import { openAuthSheet, useCloudSession } from "../session";
import { useSyncStatus } from "../sync/status";
import { AUTH_LAYOUT_ID, syncPill } from "./pill";
import { PILL } from "./pillStrings";

const DOT_TONE: Record<StatusTone, string> = { live: "bg-win", warn: "bg-warn", error: "bg-loss", muted: "bg-faint-line" };

export interface AccountPillProps {
  className?: string;
}

/**
 * Header pill of the cloud (P09) – mount it in the header next to the mode pill. Renders nothing without cloud.
 * - Signed out: `Anmelden` pill; the login sheet MORPHS out of it (`layoutId="auth-sheet"`, `spring.sheet`); the pill
 *   is `visibility: hidden` while its sheet is open (the morph contract).
 * - Signed in: a `StatusPill` (`Sync · live`, `Offline`, `2FA-Code fehlt` …) that pings on every realtime patch /
 *   upload (`pingKey`, ≤ 4 pings/s); a tap opens the account panel (same morph).
 * Press: `usePressable` squash. Reduced motion: no morph (the sheet slides), no pings.
 * While the pill morphs (scaled up to the sheet's box) its `touch-hit` ::after is off – scaled ×10 the 44-px tap ring
 * would reach past the screen edge and widen a phone's layout viewport for the length of the morph.
 */
export function AccountPill({ className }: AccountPillProps) {
  const phase = useCloudSession((s) => s.phase);
  const email = useCloudSession((s) => s.user?.email ?? null);
  const sheetFromPill = useCloudSession((s) => s.sheet.open && s.sheet.source === "pill");
  const sync = useSyncStatus((s) => s.phase);
  const pings = useSyncStatus((s) => s.pings);
  const press = usePressable({ scale: 0.95 });
  const ref = useRef<HTMLButtonElement>(null);
  if (!cloudEnabled() || phase === "off") return null;
  const signedIn = phase === "signedIn";
  const pill = syncPill(sync, phase);
  return (
    <motion.button
      ref={ref}
      type="button"
      layoutId={AUTH_LAYOUT_ID}
      layoutDependency={sheetFromPill}
      onLayoutAnimationStart={() => ref.current?.setAttribute("data-morph", "")}
      onLayoutAnimationComplete={() => ref.current?.removeAttribute("data-morph")}
      onClick={() => openAuthSheet(undefined, "pill")}
      aria-label={signedIn ? PILL.accountLabel(email) : PILL.signIn}
      aria-haspopup="dialog"
      data-cloud-pill={signedIn ? "account" : "signin"}
      {...press}
      transition={{ layout: spring.sheet, ...press.transition }}
      style={{ borderRadius: radius.pill, visibility: sheetFromPill ? "hidden" : "visible" }}
      className={cn(
        "touch-hit inline-flex h-9 shrink-0 items-center gap-2 border px-1.5 text-[12.5px] font-medium transition-colors data-[morph]:after:hidden",
        signedIn ? "border-line bg-ink-900 text-mute hover:border-line-2 hover:text-fg" : "border-line-2 bg-white/[0.04] pl-3 pr-3.5 text-fg hover:bg-white/[0.08]",
        className,
      )}
    >
      {signedIn ? (
        <>
          <span aria-hidden="true" className="relative grid size-6 place-items-center rounded-full border border-line-2 bg-ink-700 font-dot text-[12px] text-fg">
            {(email ?? "?").slice(0, 1).toUpperCase()}
            {/* phones hide the status pill: a status dot on the avatar keeps the sync state visible */}
            <span className={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full border border-ink-900 sm:hidden", DOT_TONE[pill.tone])} />
          </span>
          <StatusPill tone={pill.tone} expanded label={pill.label} pingKey={pings} className="max-sm:hidden" />
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
          </svg>
          <span className="max-sm:sr-only">{PILL.signIn}</span>
        </>
      )}
    </motion.button>
  );
}
