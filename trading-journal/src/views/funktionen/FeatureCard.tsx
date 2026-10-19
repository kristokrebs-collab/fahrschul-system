/**
 * One function of the register as a card: name, status, plan, the one sentence of benefit, what is missing (honestly), the
 * way there when there is nothing to scroll to, and the button that opens it. Static (no spotlight, no tilt): seventy of
 * them are on one page, and the only motion is the staggered fade-in the page gives each card (`Reveal`).
 */
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { tierOf, type FeatureEntry } from "@/app/features";
import { FUNKTIONEN } from "./strings";

export interface FeatureCardProps {
  entry: FeatureEntry;
  /** the plan does not include this function (only while payments are open) */
  locked: boolean;
  onOpen: (id: string) => void;
  /** hover / focus of the button – preloads the target page's chunk */
  onIntent?: (id: string) => void;
  className?: string;
}

function Line({ label, tone, children }: { label: string; tone?: "warn"; children: string }) {
  return (
    <p className="text-[12px] leading-relaxed text-mute [overflow-wrap:anywhere]">
      <span className={cn("font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]", tone === "warn" ? "text-warn" : "text-faint")}>{label}</span>
      <span className="ml-1.5">{children}</span>
    </p>
  );
}

export function FeatureCard({ entry: f, locked, onOpen, onIntent, className }: FeatureCardProps) {
  const tier = tierOf(f.gate);
  return (
    <article
      className={cn("grid h-full content-start gap-2.5 rounded-2xl border border-line bg-ink-850 p-4 transition-colors duration-200 hover:border-line-2", className)}
      data-testid="feature-card"
      data-feature={f.id}
      data-status={f.status}
      data-tier={tier}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{f.name}</h3>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {tier !== "frei" && (
            <Badge tone={locked ? "warn" : "steel"} title={locked ? FUNKTIONEN.locked : undefined}>
              {FUNKTIONEN.tier[tier]}
              {locked ? ` · ${FUNKTIONEN.locked}` : ""}
            </Badge>
          )}
          <Badge tone={f.status === "fertig" ? "win" : "warn"} dot title={FUNKTIONEN.statusTitle[f.status]}>
            {FUNKTIONEN.status[f.status]}
          </Badge>
        </div>
      </header>
      <p className="text-[13px] leading-relaxed text-fg/90 [overflow-wrap:anywhere]">{f.benefit}</p>
      {f.path && <Line label={FUNKTIONEN.way}>{f.path}</Line>}
      {f.note && (
        <Line label={f.status === "teilweise" ? FUNKTIONEN.missing : FUNKTIONEN.limit} tone={f.status === "teilweise" ? "warn" : undefined}>
          {f.note}
        </Line>
      )}
      {f.needs && <Line label={FUNKTIONEN.needs}>{f.needs}</Line>}
      {f.device && <Line label={FUNKTIONEN.device}>{f.device}</Line>}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="font-mono text-[10.5px] text-faint">
          {f.fids.length > 0 && <span className="sr-only">{FUNKTIONEN.fids} </span>}
          {f.fids.join(" · ")}
        </span>
        <Button
          size="sm"
          onClick={() => onOpen(f.id)}
          onPointerEnter={() => onIntent?.(f.id)}
          onFocus={() => onIntent?.(f.id)}
          aria-label={FUNKTIONEN.openLabel(f.name)}
          data-testid="feature-open"
        >
          {FUNKTIONEN.open}
          <span aria-hidden="true">→</span>
        </Button>
      </footer>
    </article>
  );
}
