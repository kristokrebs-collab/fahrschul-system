/**
 * `AlertConnectSlot` – the place in the alarm settings where a MISSING connection (the telephone's confirmed number, the e-mail address) is
 * shown and set up: the state in one line, the one next step as a button, and the setup flow below it when it is open.
 *
 * This is a thin placeholder with a deliberately small interface so the shared connection hub (`ConnectSlot`, `src/connect`, a later package)
 * can take its place without touching the card: the card passes `channel`, `state`, `title`, `detail`, the action and the flow as `children`
 * and nothing else. There is no second hub here – no storage, no fetching, no list of connections.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";

export type ConnectSlotState = "connected" | "missing" | "pending" | "unavailable";

export interface AlertConnectSlotProps {
  channel: "phone" | "email";
  state: ConnectSlotState;
  /** "Telefon" */
  title: string;
  /** the one honest line: the masked number, what is missing, why it is not possible */
  detail: string;
  /** the next step ("Nummer bestätigen"); without it the slot only reports */
  actionLabel?: string;
  onAction?: () => void;
  /** the setup flow, shown below the row while it is needed */
  children?: ReactNode;
  className?: string;
}

const TONE: Record<ConnectSlotState, BadgeTone> = { connected: "win", missing: "warn", pending: "steel", unavailable: "mute" };
const LABEL: Record<ConnectSlotState, string> = { connected: "Verbunden", missing: "Fehlt", pending: "In Arbeit", unavailable: "Nicht möglich" };

export function AlertConnectSlot({ channel, state, title, detail, actionLabel, onAction, children, className }: AlertConnectSlotProps) {
  return (
    <div data-testid={`alert-slot-${channel}`} data-state={state} className={cn("grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="flex items-center gap-2 text-[13px] text-fg">
            {title}
            <Badge tone={TONE[state]} dot>
              {LABEL[state]}
            </Badge>
          </span>
          <span className="text-[12px] text-mute" role="status">
            {detail}
          </span>
        </div>
        {actionLabel && onAction && (
          <Button size="sm" variant="secondary" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
