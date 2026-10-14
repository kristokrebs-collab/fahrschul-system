import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { COMPARISON_GROUPS, featureOffered, FEATURE_INFO, LIMIT_INFO, limitOffered, PLAN_CATALOG, PLAN_LIMITS, planIncludes, type FeatureGroup, type Offer } from "@/billing/plans";
import { useBillingMode, useEffectivePlan, useOffer } from "@/billing/store";
import { FEATURES, LIMIT_KEYS, type Feature, type LimitKey, type PlanId } from "@/billing/types";
import { Mark } from "@/billing/ui/parts";
import { HeatGridReveal } from "@/motion/fx/HeatGridReveal";
import { Card } from "@/primitives/Card";
import { PREISE } from "./strings";

const PLANS: readonly PlanId[] = ["free", "pro", "premium", "team"];
/** The recommended column: the cascade starts there ("trade the best"). */
const ORIGIN_COL = Math.max(
  0,
  PLANS.findIndex((p) => PLAN_CATALOG[p].recommended),
);
/** label column | plan columns; on a phone the plans get a little more (the header „Premium“ must fit 4 × ~45 px) */
const COLS = "grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]";

const byGroup = (g: FeatureGroup): Feature[] => FEATURES.filter((f) => FEATURE_INFO[f].group === g);

/** The storage limit is shown in GB: the unit stands in the row label, the cells carry numbers only (P2-10). */
const STORAGE_UNIT = "GB";

/** A limit cell: `null` = not included, `Infinity` = unlimited, else the number (storage in GB). */
function limitValue(key: LimitKey, plan: PlanId): number | null {
  const v = PLAN_LIMITS[plan][key];
  if (!Number.isFinite(v)) return Infinity;
  if (v === 0) return null;
  return key === "screenshotStorageMb" ? v / 1024 : v;
}

function limitLabel(key: LimitKey): string {
  return key === "screenshotStorageMb" ? `${LIMIT_INFO[key].label} (${STORAGE_UNIT})` : LIMIT_INFO[key].label;
}

interface Row {
  key: string;
  label: string;
  cells: { node: ReactNode; text: string }[];
}

interface Group {
  title: string;
  rows: Row[];
}

/** The comparison as this deployment can deliver it (no "KI-Coach" rows without a server key – Review F06). */
function groups(offer: Offer): Group[] {
  const out: Group[] = COMPARISON_GROUPS.map((g) => ({
    title: g.label,
    rows: byGroup(g.group).filter((f) => featureOffered(f, offer)).map((f) => ({
      key: f,
      label: FEATURE_INFO[f].label,
      cells: PLANS.map((p) => {
        const on = planIncludes(p, f);
        return {
          node: <Mark on={on} />,
          text: on ? PREISE.included : PREISE.notIncluded,
        };
      }),
    })),
  }));
  out.push({
    title: PREISE.limitsGroup,
    rows: LIMIT_KEYS.filter((k) => limitOffered(k, offer)).map((k) => ({
      key: k,
      label: limitLabel(k),
      cells: PLANS.map((p) => {
        const v = limitValue(k, p);
        const n = v == null || !Number.isFinite(v) ? "" : v.toLocaleString("de-DE");
        return {
          // one "not included" mark for features and limits; ∞ in Plex Sans at digit size (the mono ∞ is half as tall)
          node:
            v == null ? (
              <Mark on={false} />
            ) : !Number.isFinite(v) ? (
              <span className="font-sans text-[15px] leading-none text-fg">{PREISE.unlimited}</span>
            ) : (
              <span className="num font-mono text-[12.5px] text-fg">{n}</span>
            ),
          text: v == null ? PREISE.notIncluded : !Number.isFinite(v) ? "unbegrenzt" : k === "screenshotStorageMb" ? `${n} ${STORAGE_UNIT}` : n,
        };
      }),
    })),
  });
  return out;
}

/** The recommended column: a signal breath on ink; on paper the same share of signal reads pink, like a warning – there an ink tint (P1-19). */
const ORIGIN_TINT = "bg-signal/[0.05] [:root[data-theme=light]_&]:bg-fg/[0.04]";

/** One group: labels on the left, the plan cells cascade in from the recommended column (HeatGridReveal). The own plan's
 * column carries no fill – only its header is marked (P2-10). */
function VisualGroup({ group, first }: { group: Group; first: boolean }) {
  return (
    <div className="grid gap-1.5">
      <span className="label pt-3 text-faint">{group.title}</span>
      <div className={cn("grid gap-x-2", COLS)}>
        <ul className="grid">
          {group.rows.map((r) => (
            <li key={r.key} className="flex h-11 items-center border-b border-line/60 pr-2 text-[13px] leading-tight text-fg/90 [overflow-wrap:anywhere]">
              <span className="line-clamp-2">{r.label}</span>
            </li>
          ))}
        </ul>
        <HeatGridReveal cols={PLANS.length} origin={[0, ORIGIN_COL]} ring={first} className="content-start">
          {group.rows.flatMap((r) =>
            r.cells.map((c, i) => (
              <div
                key={`${r.key}-${i}`}
                className={cn("grid h-11 place-items-center border-b border-line/60", i === ORIGIN_COL && ORIGIN_TINT)}
              >
                {c.node}
              </div>
            )),
          )}
        </HeatGridReveal>
      </div>
    </div>
  );
}

/**
 * "Alle Funktionen im Vergleich" (P10): the full matrix from `plans.ts` (the same table the gates use) – feature
 * groups, then the limits. Each group's cells cascade in from the recommended column (HeatGridReveal, `spring.deal`
 * pops) while the ticks draw themselves. Screen readers get a real (visually hidden) table; the animated grid is
 * `aria-hidden`. Phones keep all four plan columns, labels wrap.
 */
export function PlanComparison({ className }: { className?: string }) {
  const current = useEffectivePlan();
  const mode = useBillingMode();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const mine = mode === "open" && signedIn ? PLANS.indexOf(current.plan) : -1;
  const data = groups(useOffer());
  return (
    <Card title={PREISE.compareTitle} note={PREISE.compareLead} className={className}>
      <div data-testid="plan-comparison">
        {/* a table ignores the sr-only 1-px box (it sizes to its content) – the wrapping div clips it */}
        <div className="sr-only">
          <table>
            <caption>{PREISE.compareTitle}</caption>
            <thead>
              <tr>
                <th scope="col">Funktion</th>
                {PLANS.map((p) => (
                  <th key={p} scope="col">
                    {PLAN_CATALOG[p].name}
                  </th>
                ))}
              </tr>
            </thead>
            {data.map((g) => (
              <tbody key={g.title}>
                <tr>
                  <th scope="rowgroup" colSpan={PLANS.length + 1}>
                    {g.title}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={i}>{c.text}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div aria-hidden="true" className="grid gap-2">
          <div className={cn("grid gap-x-2 pb-1", COLS)}>
            <span />
            <div className="grid grid-cols-4 items-end">
              {PLANS.map((p, i) => (
                // the own plan: no column fill (the recommended column has the tint), a 2-px ink rule over its name and
                // the „Dein Tarif“ pill – two marks that never look alike (P2-10)
                <span key={p} className={cn("grid min-w-0 justify-items-center gap-1 border-t-2 pt-1.5 text-center sm:px-0.5", i === mine ? "border-fg" : "border-transparent")} data-mine={i === mine || undefined}>
                  {i === mine && (
                    <span className="rounded-full border border-line-2 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.06em] text-fg">
                      <span className="max-sm:hidden">{PREISE.current}</span>
                      <span className="sm:hidden">{PREISE.currentShort}</span>
                    </span>
                  )}
                  <span className={cn("max-w-full truncate text-[10.5px] font-semibold tracking-tight sm:text-[12px] sm:tracking-normal", i === ORIGIN_COL || i === mine ? "text-fg" : "text-mute")}>{PLAN_CATALOG[p].name}</span>
                </span>
              ))}
            </div>
          </div>
          {data.map((g, gi) => (
            <VisualGroup key={g.title} group={g} first={gi === 0} />
          ))}
        </div>
      </div>
    </Card>
  );
}
