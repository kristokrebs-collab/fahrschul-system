import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { agoLabel } from "@/cloud/device";
import { useTick } from "@/cloud/ui/SyncStatusCard";
import { Collapse } from "@/primitives/Expander";
import { PulseDot } from "@/motion/PulseDot";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useExchange } from "../store";
import { EX } from "../strings";
import type { SyncRun } from "../types";

const TONE: Record<SyncRun["status"], "win" | "warn" | "loss" | "muted"> = { ok: "win", partial: "warn", error: "loss", running: "muted" };

function runLine(r: SyncRun): string {
  if (r.status === "error") return r.error ?? EX.runStatus.error;
  if (r.status === "running") return EX.runStatus.running;
  if (r.dryRun) return `${r.fetched} gelesen · nichts gespeichert`;
  const parts = [`${r.inserted} neu`];
  if (r.updated) parts.push(`${r.updated} aktualisiert`);
  if (r.unchanged) parts.push(`${r.unchanged} unverändert`);
  if (r.skipped) parts.push(`${r.skipped} gelöscht gelassen`);
  return parts.join(" · ");
}

/**
 * Sync history of one connection (P11): the last runs – manual, automatic, first import, dry run – with a status dot,
 * what happened and when. Collapsed to the newest run; "Verlauf" opens the rest (rows cascade in). No polling of its
 * own: it shows what the exchange store holds (refreshed after every action and while a first import runs).
 */
export function SyncStatus({ connectionId, className }: { connectionId?: string; className?: string }) {
  const runs = useExchange((s) => s.status?.runs ?? []);
  const reduced = useReducedFx();
  const now = useTick(30_000);
  const [open, setOpen] = useState(false);
  const list = runs.filter((r) => !connectionId || r.connectionId === connectionId || r.connectionId === null).slice(0, 8);
  if (!list.length) return null;
  const [head, ...rest] = list;
  const row = (r: SyncRun, i: number) => (
    <motion.li
      key={r.id}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 text-[12.5px]"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ y: { ...spring.enter, delay: i * stagger.reveal }, opacity: { ...tween.fade, delay: i * stagger.reveal } }}
      data-testid="sync-run"
    >
      <PulseDot tone={TONE[r.status]} size={6} rings={r.status === "running" ? 1 : 0} />
      <span className="min-w-0">
        <span className="text-fg">{EX.runKind[r.kind]}</span>
        <span className={cn("ml-2 truncate", r.status === "error" ? "text-loss" : "text-mute")}>{runLine(r)}</span>
      </span>
      <span className="shrink-0 text-[11px] text-faint">{agoLabel(r.finishedAt ?? r.startedAt, now)}</span>
    </motion.li>
  );
  return (
    <div className={cn("grid gap-1", className)} data-testid="sync-status">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{EX.history}</span>
        {rest.length > 0 && (
          <button
            type="button"
            className="touch-hit text-[11.5px] text-mute underline-offset-4 hover:text-fg hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Weniger" : `+${rest.length} ältere`}
          </button>
        )}
      </div>
      <ul className="grid divide-y divide-line">{row(head!, 0)}</ul>
      <Collapse open={open}>
        <ul className="grid divide-y divide-line border-t border-line">{rest.map((r, i) => row(r, i + 1))}</ul>
      </Collapse>
    </div>
  );
}
