/**
 * Apache-2.0 attribution for lightweight-charts (Plan 5.8). Render once in the footer
 * (`attributionLogo:false` makes this mandatory).
 */
import { cn } from "@/lib/cn";
import { CHART_ATTRIBUTION } from "./theme";

export function ChartAttribution({ className }: { className?: string }) {
  return (
    <div className={cn("text-[11px] text-faint", className)}>
      <p>
        {CHART_ATTRIBUTION.notice}
        <a href={CHART_ATTRIBUTION.href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          {CHART_ATTRIBUTION.linkText}
        </a>
      </p>
      <p>{CHART_ATTRIBUTION.dataLine}</p>
    </div>
  );
}
