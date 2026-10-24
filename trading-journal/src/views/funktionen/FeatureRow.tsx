/**
 * One function of the register as a row: a dot for its honest state, its name, what you DO with it in one plain line, where it
 * lives ("Markt › Tagesplan") – the whole row opens it. A second, quiet button unfolds the details: what it does, what is
 * missing, what it needs, how to get there when there is nothing to scroll to, "Siehe auch". Static: a hundred rows are on
 * the page, the only motion is the fold (`Collapse`) and the staggered fade-in the page gives them.
 */
import { useId, useState } from "react";
import { groupOf, isNewFeature, placeText, seeAlso, type PickReason } from "@/app/featureQuery";
import { PLAN_TIER_LABEL, tierOf, type FeatureEntry } from "@/app/features";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Collapse } from "@/primitives/Expander";
import { FUNKTIONEN } from "./strings";

export interface FeatureRowProps {
  entry: FeatureEntry;
  /** the plan does not include this function (only while payments are open) */
  locked: boolean;
  /** `Date.now()` of the page – "Neu" is judged against it */
  now: number;
  onOpen: (id: string) => void;
  /** hover / focus of the row – preloads the target page's chunk */
  onIntent?: (id: string) => void;
  /** names the group in the place line (search results, quick lists) */
  showGroup?: boolean;
  /** a quick-list row: no fold */
  compact?: boolean;
  /** why it is offered ("Für dich", "Neu", "Empfohlen"), as a tag */
  reason?: PickReason;
  /** a guess, not an answer (a weak search hit) */
  weak?: boolean;
  testId?: string;
  className?: string;
}

function Line({ label, tone, children }: { label: string; tone?: "warn"; children: string }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-mute [overflow-wrap:anywhere]">
      <span className={cn("font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]", tone === "warn" ? "text-warn" : "text-mute")}>{label}</span>
      <span className="ml-1.5">{children}</span>
    </p>
  );
}

export function FeatureRow({ entry: f, locked, now, onOpen, onIntent, showGroup, compact, reason, weak, testId = "feature-row", className }: FeatureRowProps) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const tier = tierOf(f.gate);
  const partial = f.status === "teilweise";
  const fresh = isNewFeature(f, now);
  const see = open ? seeAlso(f) : [];
  // a quick-list row names only the group (the rest is one tap away), every other row says where it lives
  // (the plan it needs is part of the line, not a pill on every row – a pill says only when it is NOT in your plan)
  const place = compact ? groupOf(f).name : `${showGroup ? `${groupOf(f).name} · ` : ""}${placeText(f)}${tier !== "frei" ? ` · ${PLAN_TIER_LABEL[tier]}` : ""}`;
  return (
    <article
      className={cn("rounded-2xl border border-line bg-ink-850 transition-colors duration-200 hover:border-line-2", weak && "opacity-90", className)}
      data-testid={testId}
      data-feature={f.id}
      data-status={f.status}
      data-tier={tier}
      data-page={f.page}
      data-anchor={f.anchor?.testid ?? ""}
      data-anchor-heading={f.anchor?.heading ?? ""}
      data-action={f.action ?? ""}
      data-needs={f.needs ? "1" : ""}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onOpen(f.id)}
          onPointerEnter={() => onIntent?.(f.id)}
          onFocus={() => onIntent?.(f.id)}
          aria-label={FUNKTIONEN.open(f.name)}
          data-testid="feature-open"
          className={cn("group/row flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-2xl px-4 text-left outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:outline-2 focus-visible:outline-offset-[-2px]", compact ? "py-3" : "py-3.5")}
        >
          <span
            aria-hidden="true"
            title={partial ? FUNKTIONEN.statusTitle.teilweise : FUNKTIONEN.statusTitle.fertig}
            className={cn("mt-[7px] size-2 shrink-0 rounded-full", partial ? "bg-warn" : "bg-win")}
          />
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-medium leading-snug text-fg [overflow-wrap:anywhere]">{f.name}</span>
              {reason && <Badge tone={reason === "fuer-dich" ? "steel" : reason === "neu" ? "teal" : "mute"}>{FUNKTIONEN.tag[reason]}</Badge>}
              {!reason && fresh && <Badge tone="teal">{FUNKTIONEN.isNew}</Badge>}
              {partial && <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-warn">{FUNKTIONEN.status.teilweise}</span>}
              {locked && (
                <Badge tone="warn" title={FUNKTIONEN.locked}>
                  {FUNKTIONEN.tier[tier]} · {FUNKTIONEN.locked}
                </Badge>
              )}
            </span>
            {!compact && <span className="text-[13px] leading-snug text-mute [overflow-wrap:anywhere]">{f.task ?? f.benefit}</span>}
            <span className="font-mono text-[11.5px] text-mute [overflow-wrap:anywhere]">
              <span className="sr-only">{FUNKTIONEN.where}: </span>
              {place}
            </span>
          </span>
          {compact && (
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-mute transition-transform duration-200 group-hover/row:translate-x-0.5">
              →
            </span>
          )}
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={open ? panel : undefined}
            aria-label={FUNKTIONEN.details(f.name)}
            data-testid="feature-details"
            className="grid w-12 shrink-0 place-items-center rounded-r-2xl border-l border-line text-mute outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] pointer-coarse:w-14"
          >
            <svg viewBox="0 0 16 16" className={cn("size-4 transition-transform duration-200", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 6 8 10.5 12.5 6" />
            </svg>
          </button>
        )}
      </div>
      {!compact && (
        <Collapse open={open} id={panel}>
          <div className="grid gap-2 border-t border-line px-4 pb-4 pt-3" data-testid="feature-detail-panel">
            <Line label={FUNKTIONEN.benefit}>{f.benefit}</Line>
            {f.path && <Line label={FUNKTIONEN.way}>{f.path}</Line>}
            {f.note && (
              <Line label={partial ? FUNKTIONEN.missing : FUNKTIONEN.limit} tone={partial ? "warn" : undefined}>
                {f.note}
              </Line>
            )}
            {f.needs && <Line label={FUNKTIONEN.needs}>{f.needs}</Line>}
            {f.device && <Line label={FUNKTIONEN.device}>{f.device}</Line>}
            {tier !== "frei" && <Line label="Tarif">{`${PLAN_TIER_LABEL[tier]}${locked ? ` – ${FUNKTIONEN.locked}` : ""}`}</Line>}
            {see.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[12.5px] text-mute">
                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{FUNKTIONEN.see}</span>
                {see.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpen(s.id)}
                    onPointerEnter={() => onIntent?.(s.id)}
                    className="inline-flex items-center gap-1 underline decoration-line-2 underline-offset-4 outline-none transition-colors hover:text-fg hover:decoration-fg pointer-coarse:min-h-11"
                    data-see={s.id}
                  >
                    {s.name}
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
            {f.fids.length > 0 && (
              <p className="font-mono text-[10.5px] text-mute">
                <span className="sr-only">{FUNKTIONEN.fids} </span>
                {f.fids.join(" · ")}
              </p>
            )}
          </div>
        </Collapse>
      )}
    </article>
  );
}
