import { cn } from "@/lib/cn";

/**
 * Hero backdrop (Bundle `d2`): three gradients + 18 px dot grid `rgb(255 255 255/.07)`, `aria-hidden`.
 * Inline styles are verbatim from the bundle; `.hero-backdrop` in shiny-cta.css is the CSS twin.
 */
export function HeroBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 90% at 0% 0%, #2c2c2c 0%, transparent 55%), radial-gradient(80% 70% at 100% 100%, #222 0%, transparent 60%), linear-gradient(160deg, #151515, #0d0d0d)",
        }}
      />
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.07) 1px, transparent 0) 0 0 / 18px 18px" }} />
    </div>
  );
}
