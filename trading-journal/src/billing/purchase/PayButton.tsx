/**
 * The order button as a Button → Pay morph (B4, Paket B): "Zahlungspflichtig bestellen" → small breathing orbs and "Wird
 * vorbereitet …" while the order goes to the server → orbs and "Weiter zu Stripe …" while the browser leaves. The width never
 * changes: the three labels sit in the same grid cell (the longest decides), the orbs are part of the busy labels' own line.
 * The label of the order step is ALWAYS `BUTTON_LABELS.order` while nothing was sent (§ 312j Abs. 3 BGB) – never "N Tage gratis
 * testen", never "Jetzt abonnieren"; the other two texts appear only AFTER the click. A second click while it works is
 * ignored here (`phase`) AND on the server (the order id is the idempotency key). Failed → the button is free again with its old
 * label (the hint in the sheet says so).
 *
 * The button does not use `Button`'s own `loading` (it would make the label transparent): the busy label stays readable, the
 * button reports `aria-busy` + `aria-disabled` and ignores clicks itself.
 */
import type { CSSProperties, ReactNode } from "react";
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

/** Six dots on a ring that breathe in turn – inside the label's own line, 18 px (`.pay-orbs`). */
function MiniOrbs() {
  return (
    <span aria-hidden="true" className="relative inline-block size-[18px] shrink-0" data-testid="button-orbs">
      <span className="pay-orbs">
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <i key={k} style={{ "--k": k } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}

export function PayButton({ phase, disabled, onPay, idleLabel, className }: PayButtonProps) {
  const busy = phase !== "idle";
  const cells: [OrderPhase, ReactNode][] = [
    ["idle", idleLabel ?? BUTTON_LABELS.order],
    ["confirming", ORDER.preparing],
    ["redirecting", ORDER.redirecting],
  ];
  return (
    <Button
      variant="primary"
      fx={false}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onPay();
      }}
      className={cn("min-w-[15.5rem] justify-center", busy && "cursor-progress", className)}
      data-testid="order-pay"
      data-phase={phase}
    >
      <span className="pay-swap">
        {cells.map(([p, label]) => (
          <span key={p} data-on={phase === p} aria-hidden={phase !== p || undefined} className="inline-flex items-center justify-center gap-2">
            {p !== "idle" && phase === p && <MiniOrbs />}
            {label}
          </span>
        ))}
      </span>
    </Button>
  );
}
