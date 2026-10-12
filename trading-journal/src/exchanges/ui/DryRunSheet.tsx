import { useState } from "react";
import { cn } from "@/lib/cn";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { closeDryRun, primaryConnection, syncNow, useExchange } from "../store";
import { DRY } from "../strings";
import type { PositionCheck, SyncResult } from "../types";
import { Money, shortWhen } from "./parts";

const TOP = 8;

function conventionLine(r: SyncResult): { text: string; tone: "win" | "warn" } {
  const c = r.convention;
  if (!c.used) return { text: DRY.conventionOpen, tone: "warn" };
  return c.feesIncluded ? { text: DRY.conventionIncl(c.samples), tone: "win" } : { text: DRY.conventionOk(c.samples), tone: "win" };
}

function Row({ c }: { c: PositionCheck }) {
  return (
    <StaggerItem
      as="li"
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))_auto] sm:items-center"
      data-testid="dry-row"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", c.side === "long" ? "bg-win" : "bg-loss")} aria-hidden="true" />
        <span className="truncate text-[13px] font-medium">{c.pair}</span>
        <span className="truncate text-[11px] text-faint">{shortWhen(c.exitDate)}</span>
      </span>
      <Money value={c.net} className="text-right text-[13.5px] sm:order-none" />
      <span className="col-span-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-faint sm:contents">
        <span className="sm:text-right">
          <span className="sm:hidden">{DRY.columns.gross} </span>
          <Money value={c.gross} className="text-[12px]" />
        </span>
        <span className="sm:text-right">
          <span className="sm:hidden">{DRY.columns.fee} </span>
          <Money value={-Math.abs(c.fee)} className="text-[12px]" />
        </span>
        <span className="sm:text-right">
          <span className="sm:hidden">{DRY.columns.funding} </span>
          <Money value={c.funding} className="text-[12px]" />
        </span>
        <span className="sm:text-right">
          <Badge tone={c.state === "new" ? "win" : c.state === "deleted" ? "warn" : "mute"}>{DRY.stateLabel[c.state]}</Badge>
        </span>
      </span>
    </StaggerItem>
  );
}

/**
 * Dry run result (P11): what the sync WOULD write – read from Bitunix, nothing saved. Counters cascade in
 * (NumberCascade), the P&L convention is checked on real positions and stated in one sentence, and the strongest
 * positions (biggest |net|) are listed with the venue's numbers next to the journal's net P&L, so the trader can
 * compare with the Bitunix history before importing. "Jetzt importieren" runs the real sync.
 */
export function DryRunSheet() {
  const open = useExchange((s) => s.dryOpen);
  const res = useExchange((s) => s.dryRun);
  const busy = useExchange((s) => s.busy);
  const connectionId = useExchange((s) => primaryConnection(s.status)?.id ?? null);
  const [all, setAll] = useState(false);
  if (!res) return null;
  const checks = [...res.checks].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const shown = all ? checks : checks.slice(0, TOP);
  const fresh = res.checks.filter((c) => c.state === "new").length;
  const conv = conventionLine(res);
  return (
    <Sheet
      open={open}
      onClose={closeDryRun}
      size="lg"
      title={DRY.title}
      dismissGuard={false}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={closeDryRun}>{DRY.close}</Button>
          {connectionId && fresh > 0 && (
            <Button
              variant="primary"
              disabled={!!busy}
              onClick={() => {
                closeDryRun();
                void syncNow(connectionId, { from: new Date(res.window.from).toISOString() });
              }}
              data-testid="dry-import"
            >
              {DRY.importNow}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4" data-testid="dry-sheet">
        <StaggerItem>
          <p className="text-[13px] text-mute">{DRY.lead}</p>
        </StaggerItem>
        <StaggerItem className="grid grid-cols-3 gap-2">
          {(
            [
              [DRY.found, res.counts.fetched],
              [DRY.fresh, fresh],
              [DRY.exists, res.checks.filter((c) => c.state === "exists").length],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
              <NumberCascade value={n} className="dot-num text-[28px] leading-none" />
              <span className="mt-1 block truncate text-[11px] text-faint">{label}</span>
            </div>
          ))}
        </StaggerItem>
        <StaggerItem>
          <p
            className={cn(
              "rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed",
              conv.tone === "win" ? "border-win/30 bg-win/[0.05] text-mute" : "border-warn/30 bg-warn/[0.05] text-mute",
            )}
            data-testid="dry-convention"
          >
            {conv.text}
          </p>
        </StaggerItem>
        {checks.length ? (
          <>
            <div className="hidden grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))_auto] gap-x-3 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint sm:grid">
              <span>{DRY.columns.pair}</span>
              <span className="text-right">{DRY.columns.net}</span>
              <span className="text-right">{DRY.columns.gross}</span>
              <span className="text-right">{DRY.columns.fee}</span>
              <span className="text-right">{DRY.columns.funding}</span>
              <span className="text-right">{DRY.columns.state}</span>
            </div>
            <ul className="grid gap-1.5">
              {shown.map((c) => (
                <Row key={c.id} c={c} />
              ))}
            </ul>
            {checks.length > TOP && !all && (
              <Button size="sm" className="justify-self-start" onClick={() => setAll(true)}>
                {DRY.more(checks.length - TOP)}
              </Button>
            )}
          </>
        ) : (
          <p className="text-[13px] text-mute">{DRY.empty}</p>
        )}
      </div>
    </Sheet>
  );
}
