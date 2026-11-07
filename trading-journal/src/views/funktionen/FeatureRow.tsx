/**
 * One function of the register as a row: a small symbol (with a dot for the honest state of the function: green = does what
 * the sentence says, amber = partly), its name, what you DO with it in one plain line, what you can do with it RIGHT NOW
 * (verfügbar / Einrichtung nötig / ab Pro …, with the next step), where it lives ("Markt › Tagesplan") – the whole row opens it.
 * A star keeps it among your favourites; a second, quiet button unfolds the details: what it does, what is missing, what it
 * needs, how to get there when there is nothing to scroll to, "Siehe auch". Static: a hundred rows are on the page, the only
 * motion is the fold (`Collapse`), the star's pop and the staggered fade-in the page gives them.
 */
import { motion } from "motion/react";
import { useId, useState } from "react";
import { groupOf, isNewFeature, placeText, seeAlso, type PickReason } from "@/app/featureQuery";
import { PLAN_TIER_LABEL, tierOf, type FeatureEntry } from "@/app/features";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Collapse } from "@/primitives/Expander";
import { FunctionGlyph } from "./glyphs";
import type { AvailabilityInfo } from "./status";
import { FUNKTIONEN } from "./strings";

export interface FeatureRowProps {
  entry: FeatureEntry;
  /** what can be done with it right now (`availabilityOf`) */
  availability: AvailabilityInfo;
  /** `Date.now()` of the page – "Neu" is judged against it */
  now: number;
  onOpen: (id: string) => void;
  /** hover / focus of the row – preloads the target page's chunk */
  onIntent?: (id: string) => void;
  /** "Tarife ansehen" of a function in a higher plan – opens the upgrade sheet for it */
  onUpgrade?: (entry: FeatureEntry) => void;
  /** favourites: the star shows this state and calls back; absent = no star */
  favorite?: boolean;
  onToggleFavorite?: (id: string) => void;
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

/** The star: outlined = not a favourite, filled = a favourite. A 44-px target; the fill pops once on a spring (reduced motion: instant). */
function Star({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  const reduced = useReducedFx();
  // the pop belongs to the tap, not to a row that mounts already starred
  const [tapped, setTapped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setTapped(true);
        onClick();
      }}
      aria-pressed={on}
      aria-label={on ? FUNKTIONEN.favorite.remove(name) : FUNKTIONEN.favorite.add(name)}
      title={on ? FUNKTIONEN.favorite.removeTitle : FUNKTIONEN.favorite.addTitle}
      data-testid="feature-star"
      data-on={on ? "1" : "0"}
      className="grid w-11 shrink-0 place-items-center text-mute outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] pointer-coarse:w-12"
    >
      <motion.svg
        key={on ? "on" : "off"}
        viewBox="0 0 24 24"
        className={cn("size-[18px]", on && "text-warn")}
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        aria-hidden="true"
        initial={reduced || !on || !tapped ? false : { scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={spring.pop}
      >
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" />
      </motion.svg>
    </button>
  );
}

export function FeatureRow({ entry: f, availability, now, onOpen, onIntent, onUpgrade, favorite, onToggleFavorite, showGroup, compact, reason, weak, testId = "feature-row", className }: FeatureRowProps) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const tier = tierOf(f.gate);
  const partial = f.status === "teilweise";
  const fresh = isNewFeature(f, now);
  const see = open ? seeAlso(f) : [];
  const group = groupOf(f);
  const locked = availability.kind === "tarif";
  // a quick-list row names only the group (the rest is one tap away), every other row says where it lives
  // (the plan it needs is part of the line, not a pill on every row – a pill says only when it is NOT in your plan)
  const place = compact ? group.name : `${showGroup ? `${group.name} · ` : ""}${placeText(f)}${tier !== "frei" ? ` · ${PLAN_TIER_LABEL[tier]}` : ""}`;
  return (
    <article
      className={cn("rounded-2xl border border-line bg-ink-850 transition-colors duration-200 hover:border-line-2", weak && "opacity-90", className)}
      data-testid={testId}
      data-feature={f.id}
      data-status={f.status}
      data-availability={availability.kind}
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
            data-testid="feature-glyph"
            className="relative mt-px grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-mute transition-colors duration-200 group-hover/row:text-fg [&>svg]:size-[18px]"
          >
            <FunctionGlyph id={f.id} group={f.group} />
            <span className={cn("absolute -right-[3px] -top-[3px] size-2 rounded-full ring-2 ring-ink-850", partial ? "bg-warn" : "bg-win")} />
          </span>
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-medium leading-snug text-fg [overflow-wrap:anywhere]">{f.name}</span>
              {reason && <Badge tone={reason === "fuer-dich" ? "steel" : reason === "neu" ? "teal" : "mute"}>{FUNKTIONEN.tag[reason]}</Badge>}
              {!reason && fresh && <Badge tone="teal">{FUNKTIONEN.isNew}</Badge>}
              {partial && <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-warn">{FUNKTIONEN.status.teilweise}</span>}
            </span>
            {!compact && <span className="text-[13px] leading-snug text-mute [overflow-wrap:anywhere]">{f.task ?? f.benefit}</span>}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-mute [overflow-wrap:anywhere]" data-testid="feature-meta">
              {!compact && (
                <span
                  data-testid="feature-availability"
                  data-kind={availability.kind}
                  className={cn("font-semibold", availability.kind === "einrichtung" && "text-warn", availability.kind === "tarif" && "text-fg")}
                  title={availability.next}
                >
                  {FUNKTIONEN.availability[availability.kind]}
                  {locked && availability.plan ? ` · ab ${PLAN_TIER_LABEL[availability.plan]}` : ""}
                </span>
              )}
              <span>
                <span className="sr-only">{FUNKTIONEN.where}: </span>
                {place}
              </span>
            </span>
          </span>
          {compact && (
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-mute transition-transform duration-200 group-hover/row:translate-x-0.5">
              →
            </span>
          )}
        </button>
        {onToggleFavorite && <Star on={!!favorite} name={f.name} onClick={() => onToggleFavorite(f.id)} />}
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
      {/* a function of a higher plan says the next step and offers it – the only status that has a button of its own */}
      {locked && !compact && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[12.5px] text-mute" data-testid="feature-next">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]">{FUNKTIONEN.next}</span>
            <span className="ml-1.5">{availability.next}</span>
          </span>
          {onUpgrade && availability.plan && (
            <button
              type="button"
              onClick={() => onUpgrade(f)}
              data-testid="feature-upgrade"
              className="inline-flex min-h-11 items-center gap-1 text-fg underline decoration-line-2 underline-offset-4 outline-none transition-colors hover:decoration-fg focus-visible:outline-2 pointer-fine:min-h-9"
            >
              {FUNKTIONEN.seePlan(PLAN_TIER_LABEL[availability.plan])}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
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
            <Line label={FUNKTIONEN.statusLabel}>{FUNKTIONEN.availabilityText[availability.kind]}</Line>
            {f.needs && (
              <Line label={availability.kind === "einrichtung" ? FUNKTIONEN.next : FUNKTIONEN.needs} tone={availability.kind === "einrichtung" ? "warn" : undefined}>
                {f.needs}
              </Line>
            )}
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
