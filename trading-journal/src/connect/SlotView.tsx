import { useRef } from "react";
import { openAuthSheet } from "@/cloud/session";
import { openUpgrade } from "@/billing/store";
import { cn } from "@/lib/cn";
import { useIdleGate } from "@/motion/rich/idle";
import "./connect.css";
import { useServiceView } from "./facts";
import { openConnectDialog } from "./open";
import { SERVICES, type ServiceId } from "./services";
import { SLOT_ACTION, SLOT_LABEL, SLOT_TONE } from "./slotState";

export interface SlotViewProps {
  service: ServiceId;
  className?: string;
  /** Replaces the status line (a place that has a more specific thing to say). */
  hint?: string;
  /** Runs right before the dialog / sign-in / upgrade opens (a sheet that hosts the placeholder closes itself here). */
  onBeforeOpen?: () => void;
}

/**
 * The clickable placeholder (Paket Verbindungen): one row with the service tile, its name, the honest state and what a
 * click does. Six states (`slotState`): nicht verbunden · verbindet · verbunden · Fehler · im höheren Tarif · nicht
 * eingerichtet (plus „Anmeldung nötig“). A click opens the guided dialog – except where the click is only a hand-off
 * (sign in, upgrade).
 */
export default function SlotView({ service, className, hint, onBeforeOpen }: SlotViewProps) {
  const def = SERVICES[service];
  const view = useServiceView(service);
  const ref = useRef<HTMLButtonElement>(null);
  useIdleGate(ref);
  const state = view.state;

  const onClick = (): void => {
    onBeforeOpen?.();
    if (state === "signin") return openAuthSheet("signin", "card");
    if (state === "upgrade" && (service === "binance-spot" || service === "binance-futures" || service === "bitunix")) return openUpgrade("exchangeSync", "pro");
    openConnectDialog(service);
  };

  return (
    <button
      ref={ref}
      type="button"
      className={cn("cx-slot cx-glass", className)}
      data-state={state}
      data-service={service}
      data-testid={`connect-slot-${service}`}
      onClick={onClick}
      aria-label={`${def.name}: ${SLOT_LABEL[state]}. ${SLOT_ACTION[state]}`}
    >
      <span className="cx-tile" aria-hidden="true">
        {def.glyph}
      </span>
      <span className="min-w-0">
        <span className="cx-name">
          {def.name}
          <span className="cx-pill" data-testid={`connect-slot-${service}-state`}>
            <span key={state} className="cx-dot" data-tone={SLOT_TONE[state]} data-pop="" data-busy={state === "connecting" ? "" : undefined} aria-hidden="true" />
            {SLOT_LABEL[state]}
          </span>
        </span>
        <span className="cx-line">{hint ?? view.line}</span>
      </span>
      <span className="cx-act" aria-hidden="true">
        <span className="cx-act-text">{SLOT_ACTION[state]}</span>
        <svg viewBox="0 0 16 16" className="cx-act-arrow size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </span>
    </button>
  );
}
