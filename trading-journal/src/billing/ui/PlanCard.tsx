import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import type { SubscriptionSummary } from "../contract";
import { daysUntil, formatMoney, nextLine, STATUS_LABEL, statusTone } from "../format";
import { PLAN_CATALOG } from "../plans";
import { changeSubscription, loadBilling, openCancel, openPortal, openUpgrade, useBilling, useBillingMode, useEffectivePlan } from "../store";
import { BILLING, PLAN_CARD } from "../strings";
import type { LimitKey, PlanInfo } from "../types";
import { LimitMeter } from "./LimitMeter";
import { ClosedNotice } from "./parts";

export interface PlanCardProps {
  className?: string;
  /** Opens another page (`navigate("preise")`); without it the "Tarife ansehen" button is not shown. */
  onNavigate?: (page: "preise" | "konto") => void;
  /** Current usage per limit (the feature packages count): shown as meters against the plan's limits. */
  usage?: Partial<Record<LimitKey, number>>;
}

const OPEN = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

/**
 * Konto → "Abo" (P10). The plan name decodes in as an AsciiCascade wordmark next to its dot-matrix glyph tile; a
 * trial counts down in rolling Doto digits with a draining bar; status as a badge; a BorderBeam lap when the plan
 * changes. The actions follow the state – and "Vertrag hier kündigen" is always visible while an abo runs
 * (§ 312k BGB). Hidden without cloud; honest notice while payments are not set up.
 */
export function PlanCard({ className, onNavigate, usage }: PlanCardProps) {
  const mode = useBillingMode();
  const phase = useCloudSession((s) => s.phase);
  const config = useBilling((s) => s.config);
  const account = useBilling((s) => s.account);
  const plan = useEffectivePlan();
  const signedIn = phase === "signedIn";

  useEffect(() => {
    if (mode !== "off" && signedIn && !account) void loadBilling();
  }, [mode, signedIn, account]);

  if (mode === "off") return null;
  const sub = signedIn ? (account?.subscription ?? null) : null;
  return (
    <div className="h-full" data-testid="plan-card">
      <Card title={PLAN_CARD.title} className={cn("h-full", className)} action={signedIn && mode === "open" ? <StatusBadge sub={sub} plan={plan} /> : null}>
        {mode === "closed" ? (
          <ClosedNotice mode={mode} config={config} />
        ) : !signedIn ? (
          <SignedOut onNavigate={onNavigate} />
        ) : (
          <Current plan={plan} sub={sub} onNavigate={onNavigate} usage={usage} />
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ sub, plan }: { sub: SubscriptionSummary | null; plan: PlanInfo }) {
  if (!sub) return <Badge tone="mute">{plan.plan === "free" ? "Free" : STATUS_LABEL[plan.status]}</Badge>;
  const tone = statusTone(sub);
  const label = sub.cancelAtPeriodEnd ? "Gekündigt" : STATUS_LABEL[sub.status];
  return (
    <Badge tone={tone === "win" ? "win" : tone === "loss" ? "loss" : tone === "warn" ? "warn" : "mute"} dot ping={sub.status === "past_due"}>
      {label}
    </Badge>
  );
}

function SignedOut({ onNavigate }: { onNavigate?: PlanCardProps["onNavigate"] }) {
  return (
    <div className="grid gap-4">
      <p className="text-[13.5px] leading-relaxed text-mute">{BILLING.signInFirst}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => openAuthSheet("signin", "card")}>
          Anmelden
        </Button>
        {onNavigate && (
          <Button size="sm" onClick={() => onNavigate("preise")}>
            {PLAN_CARD.upgrade}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Dot-matrix plan glyph in a dark tile (decorative). */
function GlyphTile({ glyph }: { glyph: string }) {
  return (
    <span aria-hidden="true" className="grid h-14 shrink-0 place-items-center rounded-2xl border border-line-2 bg-ink-950 px-3">
      <DotMatrixText text={glyph} size={2} gap={1} tone="fg" decorative />
    </span>
  );
}

function Current({
  plan,
  sub,
  onNavigate,
  usage,
}: {
  plan: PlanInfo;
  sub: SubscriptionSummary | null;
  onNavigate?: PlanCardProps["onNavigate"];
  usage?: PlanCardProps["usage"];
}) {
  const reduced = useReducedFx();
  const busy = useBilling((s) => s.busy);
  const account = useBilling((s) => s.account);
  const cat = PLAN_CATALOG[plan.plan];
  // one BorderBeam lap whenever the plan changes (adjusting state while rendering, no effect round trip)
  const [shown, setShown] = useState(plan.plan);
  const [fire, setFire] = useState(0);
  if (shown !== plan.plan) {
    setShown(plan.plan);
    setFire((n) => n + 1);
  }
  const open = !!sub && OPEN.has(sub.status);
  const trialDays = sub?.status === "trialing" ? daysUntil(sub.trialEnd) : null;
  const seatMember = !sub && plan.plan !== "free";
  const meters = Object.entries(usage ?? {}).filter((e): e is [LimitKey, number] => typeof e[1] === "number");
  return (
    <div className="relative grid gap-5">
      {fire > 0 && (
        // clipped: the beam's disc is larger than its box (a mask clips the paint, not the scroll overflow)
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <BorderBeam fire={fire} />
        </span>
      )}
      <div className="flex items-center gap-4">
        <GlyphTile glyph={cat.glyph} />
        <div className="grid min-w-0 gap-1">
          <AsciiCascade key={plan.plan} text={cat.name} as="h3" className="text-[clamp(24px,6vw,30px)] font-semibold leading-none tracking-tight" />
          <p className="text-[13px] text-mute" data-testid="plan-next">
            {seatMember ? "Über den Team-Tarif deiner Gruppe." : sub ? nextLine(sub) : PLAN_CARD.freeLine}
          </p>
        </div>
      </div>

      {trialDays !== null && sub?.trialEnd && (
        <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="plan-trial">
          <div className="flex items-baseline gap-2">
            <RollingDigits value={trialDays} className="dot-num text-[34px] leading-none text-fg" aria-label={`${trialDays} Tage`} />
            <span className="text-[12.5px] text-mute">{PLAN_CARD.trialLeft}</span>
          </div>
          <span aria-hidden="true" className="relative block h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.span
              className="absolute inset-0 origin-left rounded-full bg-warn"
              initial={reduced ? false : { scaleX: 1 }}
              animate={{ scaleX: Math.max(0.02, Math.min(1, trialDays / 14)) }}
              transition={{ ...tween.gauge, delay: 0.2 }}
            />
          </span>
        </div>
      )}

      {sub && sub.amount !== null && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-mute">Preis</dt>
          <dd className="num text-right font-mono">
            {formatMoney(sub.amount, sub.currency ?? "eur")} {sub.interval ? PLAN_CARD.perPeriod[sub.interval] : ""}
          </dd>
          {sub.plan === "team" && account?.team && (
            <>
              <dt className="text-mute">Sitze</dt>
              <dd className="text-right">{PLAN_CARD.seats(account.team.used, account.team.seats)}</dd>
            </>
          )}
        </dl>
      )}

      {meters.length > 0 && (
        <div className="grid gap-3">
          {meters.map(([key, used]) => (
            <LimitMeter key={key} limitKey={key} used={used} />
          ))}
        </div>
      )}

      <motion.div
        className="flex flex-wrap gap-2"
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
        transition={{ y: spring.enter, opacity: tween.fade }}
      >
        {!sub && !seatMember && (
          <>
            <Button variant="primary" size="sm" onClick={() => openUpgrade(null, "pro")}>
              Pro testen
            </Button>
            {onNavigate && (
              <Button size="sm" onClick={() => onNavigate("preise")}>
                {PLAN_CARD.upgrade}
              </Button>
            )}
          </>
        )}
        {sub && (sub.status === "past_due" || sub.status === "unpaid") && (
          <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void openPortal("payment")}>
            {PLAN_CARD.pay}
          </Button>
        )}
        {sub?.status === "paused" && (
          <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void changeSubscription("resume")}>
            {PLAN_CARD.unpause}
          </Button>
        )}
        {sub?.cancelAtPeriodEnd && sub.status !== "paused" && (
          <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void changeSubscription("resume")}>
            {PLAN_CARD.resume}
          </Button>
        )}
        {open && !sub?.cancelAtPeriodEnd && (
          <Button size="sm" disabled={!!busy} onClick={() => void openPortal("update")}>
            {PLAN_CARD.change}
          </Button>
        )}
        {account?.hasCustomer && (
          <Button size="sm" disabled={!!busy} onClick={() => void openPortal("manage")}>
            {PLAN_CARD.manage}
          </Button>
        )}
        {open && !sub?.cancelAtPeriodEnd && (
          <Button variant="danger" size="sm" disabled={!!busy} onClick={openCancel} data-testid="cancel-contract">
            {PLAN_CARD.cancel}
          </Button>
        )}
      </motion.div>
    </div>
  );
}
