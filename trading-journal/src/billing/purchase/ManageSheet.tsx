/**
 * Management of the own subscription (B4, Konto → "Abo verwalten") – a glass sheet: plan, interval, seats, price, status and
 * the next payment / the end; the Stripe customer portal for payment method and invoices; the switch month ↔ year and the
 * seats (the portal's plan-update flow does them and Stripe prorates – the sheet says it is only done once Stripe confirms);
 * the cancel button "Verträge hier kündigen" (§ 312k BGB) and – during the first 14 days – "Vertrag widerrufen" (§ 356a BGB).
 * Nothing here changes a plan by itself: the plan comes from the server (`billing-status`, written by the webhook).
 */
import { useEffect } from "react";
import { BUTTON_LABELS } from "@/legal/consentTexts";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { openContract } from "../contractStore";
import { daysUntil, formatDay, formatMoney, nextLine, STATUS_LABEL } from "../format";
import { PLAN_CATALOG } from "../plans";
import { changeSubscription, closeManage, loadBilling, openCancel, openPortal, useBilling } from "../store";
import { WITHDRAWAL_DAYS, withdrawalOpen } from "./manage";
import { MANAGE } from "./strings";
import "./purchase.css";

const DL = "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px] sm:grid-cols-[9rem_minmax(0,1fr)]";

export function ManageSheet() {
  const open = useBilling((s) => s.manageOpen);
  const account = useBilling((s) => s.account);
  const busy = useBilling((s) => s.busy);
  const sub = account?.subscription ?? null;

  useEffect(() => {
    if (open) void loadBilling({ invoices: false });
  }, [open]);

  const live = !!sub && sub.status !== "canceled" && sub.status !== "incomplete_expired";
  const cancelled = !!sub?.cancelAtPeriodEnd;
  const canWithdraw = live && !cancelled && withdrawalOpen(sub?.startedAt ?? null, Date.now());
  const left = sub?.startedAt ? daysUntil(new Date(Date.parse(sub.startedAt) + WITHDRAWAL_DAYS * 86_400_000).toISOString()) : null;
  const other = sub?.interval === "month" ? "year" : "month";

  return (
    <Sheet open={open} onClose={closeManage} title={MANAGE.title} size="md" dismissGuard={false} className="pay-sheet">
      <div className="grid gap-5" data-testid="manage-sheet">
        <StaggerItem>
          <p className="text-[13.5px] leading-relaxed text-mute">{MANAGE.lead}</p>
        </StaggerItem>

        {!sub || !live ? (
          <StaggerItem>
            <p className="text-[13.5px] text-mute" data-testid="manage-none">
              {MANAGE.none}
            </p>
          </StaggerItem>
        ) : (
          <>
            <StaggerItem className="pay-glass p-4 sm:p-5">
              <dl className={DL} data-testid="manage-facts">
                <dt className="text-mute">{MANAGE.plan}</dt>
                <dd className="font-semibold">Trade Journal {PLAN_CATALOG[sub.plan].name}</dd>
                <dt className="text-mute">{MANAGE.interval}</dt>
                <dd>{sub.interval === "year" ? "jährlich" : sub.interval === "month" ? "monatlich" : "–"}</dd>
                {sub.plan === "team" && (
                  <>
                    <dt className="text-mute">{MANAGE.seats}</dt>
                    <dd>{sub.seats}</dd>
                  </>
                )}
                {sub.amount !== null && (
                  <>
                    <dt className="text-mute">{MANAGE.price}</dt>
                    <dd className="num font-mono">
                      {formatMoney(sub.amount, sub.currency ?? "eur")} {sub.interval === "year" ? "pro Jahr" : "pro Monat"}
                    </dd>
                  </>
                )}
                <dt className="text-mute">{MANAGE.status}</dt>
                <dd>{STATUS_LABEL[sub.status]}</dd>
                <dt className="text-mute">{cancelled ? MANAGE.ends : MANAGE.next}</dt>
                <dd data-testid="manage-next">{cancelled ? formatDay(sub.cancelAt ?? sub.currentPeriodEnd) || "–" : nextLine(sub)}</dd>
              </dl>
            </StaggerItem>

            <StaggerItem className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => void openPortal("manage")} data-testid="manage-portal">
                  {MANAGE.portal}
                </Button>
                {!cancelled && sub.interval && (
                  <Button size="sm" disabled={!!busy} onClick={() => void openPortal("update")} data-testid="manage-switch">
                    {MANAGE.switchInterval(other)}
                  </Button>
                )}
                {sub.plan === "team" && !cancelled && (
                  <Button size="sm" disabled={!!busy} onClick={() => void openPortal("update")} data-testid="manage-seats">
                    {MANAGE.seatsBtn}
                  </Button>
                )}
                {cancelled && (
                  <Button size="sm" variant="primary" fx={false} disabled={!!busy} onClick={() => void changeSubscription("resume")}>
                    Kündigung zurücknehmen
                  </Button>
                )}
              </div>
              {!cancelled && <p className="text-[12px] text-faint">{MANAGE.switchNote}</p>}
            </StaggerItem>

            {!cancelled && (
              <StaggerItem className="grid gap-3 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => {
                      closeManage();
                      openCancel();
                    }}
                    data-testid="manage-cancel"
                  >
                    {BUTTON_LABELS.cancel}
                  </Button>
                  {canWithdraw && (
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => {
                        closeManage();
                        openContract("withdraw");
                      }}
                      data-testid="manage-withdraw"
                    >
                      {BUTTON_LABELS.withdraw}
                    </Button>
                  )}
                </div>
                {canWithdraw && (
                  <p className="text-[12px] text-faint">
                    {MANAGE.withdrawNote}
                    {left !== null ? ` Noch ${left} ${left === 1 ? "Tag" : "Tage"}.` : ""}
                  </p>
                )}
              </StaggerItem>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
