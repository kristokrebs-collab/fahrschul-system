/**
 * The order button as a Button → Pay morph (B4): "Zahlungspflichtig bestellen" → small breathing orbs while the order goes
 * to the server → "Weiter zu Stripe …" while the browser leaves. The width never changes: both labels sit in the same grid
 * cell (the longer one decides), the orbs lie over them. The label of the order step is ALWAYS `BUTTON_LABELS.order` (§ 312j
 * Abs. 3 BGB) – never "N Tage gratis testen", never "Jetzt abonnieren". A second click while it works is ignored here
 * (`phase`) AND on the server (the order id is the idempotency key).
 */
import type { ReactNode } from "react";
import { Button } from "@/primitives/Button";
import { cn } from "@/lib/cn";
import type { OrderPhase } from "./orderState";
import { BUTTON_LABELS, ORDER } from "./strings";
import "./purchase.css";

export interface PayButtonProps {
  phase: OrderPhase;
  disabled?: boolean;
  onPay: () => void;
  /** Overrides the idle label (only for the signed-out state – "Anmelden und weiter" – which is not the order step). */
  idleLabel?: ReactNode;
  className?: string;
}

export function PayButton({ phase, disabled, onPay, idleLabel, className }: PayButtonProps) {
  const busy = phase !== "idle";
  return (
    <Button
      variant="primary"
      fx={false}
      loading={busy}
      loader="orbs"
      disabled={disabled}
      onClick={onPay}
      className={cn("min-w-[15.5rem] justify-center", className)}
      data-testid="order-pay"
      data-phase={phase}
    >
      <span className="pay-swap">
        <span data-on={phase !== "redirecting"} aria-hidden={phase === "redirecting" || undefined}>
          {idleLabel ?? BUTTON_LABELS.order}
        </span>
        <span data-on={phase === "redirecting"} aria-hidden={phase !== "redirecting" || undefined}>
          {ORDER.redirecting}
        </span>
      </span>
    </Button>
  );
}
