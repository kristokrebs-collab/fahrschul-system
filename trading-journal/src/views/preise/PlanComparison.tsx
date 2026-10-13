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
const COLS = "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]";

const byGroup = (g: FeatureGroup): Feature[] => FEATURES.filter((f) => FEATURE_INFO[f].group === g);

function limitText(key: LimitKey, plan: PlanId): string {
  const v = PLAN_LIMITS[plan][key];
  if (!Number.isFinite(v)) return PREISE.unlimited;
  if (key === "screenshotStorageMb") return v === 0 ? "–" : v >= 1024 ? `${(v / 1024).toLocaleString("de-DE")} GB` : `${v} MB`;
  return v === 0 ? "–" : String(v);
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
      label: LIMIT_INFO[k].label,
      cells: PLANS.map((p) => {
        const t = limitText(k, p);
        return {
          node: <span className={cn("num font-mono text-[12.5px]", t === "–" ? "text-faint" : "text-fg")}>{t}</span>,
          text: t === "–" ? PREISE.notIncluded : t === PREISE.unlimited ? "unbegrenzt" : t,
        };
      }),
    })),
  });
  return out;
}

/** One group: labels on the left, the plan cells cascade in from the recommended column (HeatGridReveal). */
function VisualGroup({ group, first, mine }: { group: Group; first: boolean; mine: number }) {
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
                className={cn("grid h-11 place-items-center border-b border-line/60", i === ORIGIN_COL && "bg-signal/[0.05]", i === mine && "bg-white/[0.04]")}
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
            <div className="grid grid-cols-4">
              {PLANS.map((p, i) => (
                <span key={p} className={cn("truncate px-0.5 text-center text-[12px] font-semibold", i === ORIGIN_COL ? "text-fg" : "text-mute")}>
                  {PLAN_CATALOG[p].name}
                </span>
              ))}
            </div>
          </div>
          {data.map((g, gi) => (
            <VisualGroup key={g.title} group={g} first={gi === 0} mine={mine} />
          ))}
        </div>
      </div>
    </Card>
  );
}
