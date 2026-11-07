/**
 * The archive row of the Top-Trader card (C3): one honest line about the history this device has stored (how long, how many
 * gaps, whether it is growing), the switch that stops the storing, "Als CSV" and a two-step "Löschen". Its height is reserved
 * (text two lines on a phone, one from sm up; the controls are one row of 44 px targets), so nothing moves when the status
 * changes. Nothing here asks the exchange for anything: the card stores only what it already shows.
 */
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { setNetArchiveOn, type NetArchiveStatus } from "@/market/netArchive";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { NETCARD as S } from "./traderNetStrings";

export interface TraderNetArchiveProps {
  line: string;
  status: NetArchiveStatus;
  recording: boolean;
  /** rows stored (also those the live series covers) */
  stored: number;
  canExport: boolean;
  onCsv: () => void;
  onClear: () => Promise<void>;
}

export function TraderNetArchive({ line, status, recording, stored, canExport, onCsv, onClear }: TraderNetArchiveProps) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const unavailable = status === "unavailable";
  return (
    <div className="grid gap-2 border-t border-line pt-3" data-testid="trader-net-archive" data-status={status} data-recording={recording ? "on" : "off"} data-stored={stored}>
      <p className="min-h-[2.6em] text-[11.5px] leading-[1.3] text-mute sm:min-h-[1.3em]" data-testid="trader-net-archive-line">
        {line}
      </p>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <Switch id={id} size="sm" checked={recording && !unavailable} onCheckedChange={setNetArchiveOn} disabled={unavailable} aria-label={S.archiveSwitch} className="touch-hit shrink-0" />
          <label htmlFor={id} className={cn("text-[12px] text-mute", unavailable && "opacity-60")}>
            {S.archiveSwitch}
          </label>
        </div>
        {asking ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={S.archiveSure} data-testid="trader-net-archive-sure">
            <span className="text-[12px] text-fg">{S.archiveSure}</span>
            <Button
              size="sm"
              variant="danger"
              className="pointer-coarse:min-h-11"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void onClear().finally(() => {
                  setBusy(false);
                  setAsking(false);
                });
              }}
              data-testid="trader-net-archive-yes"
            >
              {S.archiveSureYes}
            </Button>
            <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setAsking(false)} disabled={busy} data-testid="trader-net-archive-no">
              {S.archiveSureNo}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" className="pointer-coarse:min-h-11" onClick={onCsv} disabled={!canExport} fx={false} data-testid="trader-net-archive-csv">
              {S.archiveCsv}
            </Button>
            <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setAsking(true)} disabled={stored === 0} fx={false} data-testid="trader-net-archive-delete">
              {S.archiveDelete}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
