/**
 * The order the login is for (Paket B): a person who picked "Premium · jährlich" on the price page and now meets the
 * registration sees that the choice is still there – plan, interval, seats, the amount due – and that the way back leads to
 * exactly this order. "Ohne Kauf weiter" drops the note again (cancelled purchase → on in the free area).
 *
 * The note itself is `returnTo` (`src/store/returnTo.ts`, target `order:<plan>.<interval>.<seats>`); this component only reads
 * it. It decides nothing about the price: the real amount is the server's (Stripe), this is the list / reported price.
 */
import { formatMoney } from "@/billing/format";
import { PLAN_CATALOG } from "@/billing/plans";
import { summarize, parseOrderParam } from "@/billing/purchase/order";
import { useBilling } from "@/billing/store";
import { clearReturnTo, useReturnTo } from "@/store/returnTo";
import { pushToast } from "@/store/uiStore";
import { closeAuthSheet } from "../session";
import { AUTH } from "./strings";

export function OrderContext() {
  const pending = useReturnTo((s) => s.pending);
  const prices = useBilling((s) => s.config?.prices);
  if (!pending || pending.target.kind !== "order") return null;
  const draft = parseOrderParam(pending.target.order);
  if (!draft) return null;
  const sum = summarize(draft, { prices });
  const year = draft.interval === "year";
  const total = `${formatMoney(sum.totalCents, sum.currency)} ${year ? "pro Jahr" : "pro Monat"}`;
  return (
    <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="auth-order" data-plan={draft.plan} data-interval={draft.interval} data-seats={sum.draft.seats}>
      <span className="label">{AUTH.order.title}</span>
      <p className="text-[13.5px] font-medium text-fg" data-testid="auth-order-line">
        {AUTH.order.line(PLAN_CATALOG[draft.plan].name, year ? "jährlich" : "monatlich", draft.plan === "team" ? sum.draft.seats : null, total)}
      </p>
      <p className="text-[12px] leading-snug text-mute">{AUTH.order.after}</p>
      <button
        type="button"
        data-testid="auth-order-skip"
        onClick={() => {
          clearReturnTo();
          closeAuthSheet();
          pushToast({ kind: "info", title: AUTH.order.skipped });
        }}
        className="touch-hit justify-self-start rounded-md text-[12.5px] text-mute underline-offset-4 transition-colors hover:text-fg hover:underline"
      >
        {AUTH.order.skip}
      </button>
    </div>
  );
}
