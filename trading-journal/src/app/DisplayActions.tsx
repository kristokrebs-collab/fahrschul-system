import { cn } from "@/lib/cn";
import { DISPLAY_STRINGS, toggleFullscreen, useFullscreen, useFullscreenSupported } from "@/app/pwa";

/** Four corners pointing out (enter) / in (leave), 16 px grid, stroke = currentColor. */
export function GlyphFullscreen({ exit = false, className }: { exit?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {exit ? <path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /> : <path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" />}
    </svg>
  );
}

/**
 * Header button `Vollbild` / `Vollbild beenden` (grey-bar fix): the Fullscreen API hides the browser UI and the system
 * bars. Renders nothing where the API is unavailable (iPhone Safari, sandboxed frames). `aria-pressed` mirrors the state.
 */
export function FullscreenButton({ className }: { className?: string }) {
  const supported = useFullscreenSupported();
  const on = useFullscreen();
  if (!supported) return null;
  const label = on ? DISPLAY_STRINGS.fullscreenExit : DISPLAY_STRINGS.fullscreen;
  return (
    <button
      type="button"
      onClick={() => void toggleFullscreen()}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        "touch-hit grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-850 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg aria-pressed:text-fg",
        className,
      )}
    >
      <GlyphFullscreen exit={on} className="size-4" />
    </button>
  );
}
