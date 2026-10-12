import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { RollingDigits } from "@/motion/RollingDigits";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Skeleton } from "@/primitives/Skeleton";
import { pushToast } from "@/store/uiStore";
import { formatDay, formatMoney } from "../format";
import { loadReferral, useBilling, useBillingMode } from "../store";
import { REFERRAL } from "../strings";

/**
 * Konto → "Freunde einladen" (P10): the own referral code decodes in (`TextScramble`), the share link with a copy
 * button (✓ pops in), counters in rolling Doto digits (invited / paying / credit) and the newest credits. The reward
 * terms come from the server (`/api/v1/billing/referral`) – nothing here is invented. Signed in + payments open only.
 */
export function ReferralCard({ className }: { className?: string }) {
  const mode = useBillingMode();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const info = useBilling((s) => s.referralInfo);
  const reduced = useReducedFx();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (mode === "open" && signedIn && !info) void loadReferral();
  }, [mode, signedIn, info]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (mode !== "open" || !signedIn) return null;
  const link = info ? `${window.location.origin}${info.path}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      (document.getElementById("ref-link") as HTMLInputElement | null)?.select();
      pushToast({ kind: "info", title: REFERRAL.copyFailed });
    }
  };
  return (
    <div className="h-full" data-testid="referral-card">
      <Card title={REFERRAL.title} className={cn("h-full", className)}>
        {!info ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <TextScramble text={info.code} as="span" className="dot-num text-[30px] leading-none tracking-[0.08em] text-fg" />
              <p className="text-[13px] leading-relaxed text-mute">
                {REFERRAL.lead(info.trialDays)}{" "}
                {info.commissionPct
                  ? REFERRAL.commission(info.commissionPct)
                  : info.rewardCents
                    ? REFERRAL.reward(formatMoney(info.rewardCents, info.currency))
                    : ""}
              </p>
            </div>
            <div className="flex min-w-0 items-stretch gap-2">
              <label htmlFor="ref-link" className="sr-only">
                Einladungslink
              </label>
              <input
                id="ref-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-line-2 bg-ink-950 px-3 py-2 font-mono text-[12.5px] text-mute outline-none focus:border-steel/50"
              />
              <Button size="sm" onClick={() => void copy()} className="relative min-w-[118px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? "y" : "n"}
                    className="inline-flex items-center gap-1.5"
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, transition: tween.exit }}
                    transition={{ y: spring.pop, opacity: tween.fade }}
                  >
                    {copied ? (
                      <>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className="size-4 text-win"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12.5l4.2 4.2L19 7" />
                        </svg>
                        {REFERRAL.copied}
                      </>
                    ) : (
                      REFERRAL.copy
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {[
                { k: REFERRAL.signups, v: <RollingDigits value={info.stats.signups} className="dot-num text-[24px] leading-none" /> },
                { k: REFERRAL.paying, v: <RollingDigits value={info.stats.paying} className="dot-num text-[24px] leading-none" /> },
                { k: REFERRAL.earned, v: <span className="dot-num text-[20px] leading-none">{formatMoney(info.earned.applied, info.currency)}</span> },
              ].map((s) => (
                <div key={s.k} className="grid gap-1 rounded-xl border border-line bg-ink-950/40 p-3">
                  <dt className="text-[11.5px] text-mute">{s.k}</dt>
                  <dd>{s.v}</dd>
                </div>
              ))}
            </dl>
            {info.ledger.length > 0 && (
              <ul className="grid gap-1 text-[12.5px]">
                {info.ledger.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 text-mute">
                    <span>
                      {REFERRAL.ledgerKind[l.kind] ?? l.kind} · {formatDay(l.createdAt)}
                    </span>
                    <span className={cn("num font-mono", l.status === "pending" ? "text-faint" : "text-win")}>
                      {formatMoney(l.amount, l.currency)}
                      {l.status === "pending" ? ` (${REFERRAL.pending})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
