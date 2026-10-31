import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Skeleton } from "@/primitives/Skeleton";
import { isStripeUrl } from "../api";
import { formatDay, formatMoney } from "../format";
import { loadBilling, openPortal, useBilling, useBillingMode } from "../store";
import { BILLING_CARD } from "../strings";

/**
 * Konto → "Rechnungen" (P10): the newest invoices straight from Stripe (number, date, amount, status, hosted page / PDF),
 * "Zahlungsmittel ändern" and the full history in the Customer Portal. Rows cascade in (`RevealGroup`). Only links to
 * Stripe-hosted pages are rendered. Hidden without cloud / payments and while signed out.
 */
export function BillingCard({ className }: { className?: string }) {
  const mode = useBillingMode();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const account = useBilling((s) => s.account);
  const busy = useBilling((s) => s.busy);
  const hasCustomer = !!account?.hasCustomer;
  const invoices = account?.invoices ?? null;
  // Premium / Pro without an own subscription = a seat of a team plan (the plan card says "Über den Team-Tarif …")
  const seatMember = !!account && !account.subscription && !!account.plan && account.plan.plan !== "free";

  // once per user: an answer without invoices (Stripe down) must not trigger the next request
  const asked = useRef<string | null>(null);
  const userId = account?.userId ?? null;
  const wants = !account || (account.hasCustomer && account.invoices === null);
  useEffect(() => {
    if (mode !== "open" || !signedIn || !wants) return;
    const key = userId ?? "pending";
    if (asked.current === key) return;
    asked.current = key;
    void loadBilling({ invoices: true });
  }, [mode, signedIn, wants, userId]);

  if (mode !== "open" || !signedIn) return null;
  return (
    <div className="h-full" data-testid="billing-card">
      <Card title={BILLING_CARD.title} className={cn("h-full", className)} note={BILLING_CARD.note}>
        {!account ? (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !hasCustomer ? (
          // the whole card is empty → the one empty state (fills the row beside the plan card); a team seat has a plan
          // but no invoices of its own – it says so instead of "sobald du ein Abo hast"
          seatMember ? (
            <EmptyState title={BILLING_CARD.seatTitle} text={BILLING_CARD.seat} line={false} className="flex-1" />
          ) : (
            <EmptyState title={BILLING_CARD.noCustomerTitle} text={BILLING_CARD.noCustomer} line={false} className="flex-1" />
          )
        ) : (
          <div className="grid gap-4">
            {invoices === null ? (
              <div className="grid gap-2" aria-busy="true">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : invoices.length === 0 ? (
              <p className="text-[13px] text-mute">{BILLING_CARD.empty}</p>
            ) : (
              <RevealGroup as="ul" className="grid gap-2" aria-label={BILLING_CARD.title}>
                {invoices.map((inv) => (
                  <RevealItem
                    as="li"
                    key={inv.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-fg">{inv.number ?? inv.id}</span>
                      <span className="text-[12px] text-faint">{formatDay(inv.created)}</span>
                    </span>
                    <span className="num font-mono">{formatMoney(inv.total, inv.currency)}</span>
                    <Badge tone={inv.status === "paid" ? "win" : inv.status === "open" ? "warn" : "mute"}>
                      {BILLING_CARD.status[inv.status ?? ""] ?? inv.status ?? "–"}
                    </Badge>
                    <span className="flex gap-3 text-[12.5px]">
                      {inv.hostedUrl && isStripeUrl(inv.hostedUrl) && (
                        <a
                          className="touch-hit font-semibold text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg"
                          href={inv.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {BILLING_CARD.open}
                        </a>
                      )}
                      {inv.pdfUrl && isStripeUrl(inv.pdfUrl) && (
                        <a
                          className="touch-hit font-semibold text-mute underline decoration-line-2 underline-offset-4 hover:text-fg"
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {BILLING_CARD.pdf}
                        </a>
                      )}
                    </span>
                  </RevealItem>
                ))}
              </RevealGroup>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => void openPortal("payment")}>
                {BILLING_CARD.paymentMethod}
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => void openPortal("manage")}>
                {BILLING_CARD.all}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
