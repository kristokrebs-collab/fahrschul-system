import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { PulseDot } from "@/motion/PulseDot";
import { RollingDigits } from "@/motion/RollingDigits";
import { StatusPill } from "@/motion/StatusPill";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { ActionButton } from "@/views/settings/fx";
import { agoLabel } from "../device";
import { setPrivacy } from "../privacy";
import { ensureCloud } from "../runtime";
import { openAuthSheet, useCloudSession } from "../session";
import { useSyncStatus } from "../sync/status";
import { syncPill } from "./pill";
import { SYNC_CARD } from "./strings";

/** Re-renders every `ms` (relative-time labels; 1 render per 30 s, never per frame). */
export function useTick(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const Glyph = () => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 4.6M2.5 9.5a5.5 5.5 0 0 0 10.3 1.9" />
    <path d="M3 2v3h3M13 14v-3h-3" />
  </svg>
);

/**
 * `Sync` card (P09): live state of the cloud sync on this device.
 * - running: big Doto counters – waiting changes and records in sync – on `RollingDigits`; a `DotMatrix` wave while it
 *   connects / uploads (stops at rest – finite), the upload progress as a scaleX bar (`spring.bar`), the realtime
 *   state with a `PulseDot`, "Zuletzt vor …" (`TextRoll`, refreshed every 30 s) and `Jetzt synchronisieren`
 *   (spinner → ✓). The header `StatusPill` pings on every realtime patch / upload.
 * - signed out / 2FA pending / paused / not in the plan: one honest sentence and the one button that helps.
 */
export function SyncStatusCard({ className }: { className?: string }) {
  const auth = useCloudSession((s) => s.phase);
  const st = useSyncStatus();
  const entitled = useEntitlement("cloudSync");
  const reduced = useReducedFx();
  const now = useTick();
  const pill = syncPill(st.phase, auth);
  const running = ["connecting", "syncing", "live", "offline", "error"].includes(st.phase);
  const busy = st.phase === "connecting" || st.phase === "syncing";
  const pct = st.progress && st.progress.total > 0 ? st.progress.done / st.progress.total : busy ? 0.15 : 1;

  return (
    <Card title={SYNC_CARD.title} action={<StatusPill tone={pill.tone} expanded label={SYNC_CARD.phases[st.phase]} pingKey={st.pings} />} className={className}>
      {auth !== "signedIn" ? (
        <div className="grid gap-3">
          <p className="text-[13px] leading-relaxed text-mute">{SYNC_CARD.signedOut}</p>
          <Button variant="primary" className="justify-self-start" onClick={() => openAuthSheet("signin", "card")}>
            Anmelden
          </Button>
        </div>
      ) : !entitled ? (
        <p className="text-[13px] text-mute">{SYNC_CARD.notEntitled}</p>
      ) : st.phase === "locked" ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-mute">{SYNC_CARD.lockedText}</p>
          <Button variant="primary" className="justify-self-start" onClick={() => openAuthSheet("mfa", "card")}>
            {SYNC_CARD.enterCode}
          </Button>
        </div>
      ) : st.phase === "paused" ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-mute">{SYNC_CARD.pausedText}</p>
          <Button className="justify-self-start" onClick={() => setPrivacy({ sync: true })}>
            Sync einschalten
          </Button>
        </div>
      ) : (
        <div className="grid gap-4" data-testid="sync-status">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4">
            <div className="grid size-[60px] place-items-center rounded-2xl border border-line bg-ink-950/60">
              <AnimatePresence mode="popLayout" initial={false}>
                {busy ? (
                  <motion.span key="wave" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }}>
                    <DotMatrix preset="wave" size={4} gap={2} tone="fg" playing />
                  </motion.span>
                ) : (
                  <motion.span key="dot" initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ scale: spring.pop, opacity: tween.fade }}>
                    <PulseDot tone={st.phase === "live" ? "win" : st.phase === "offline" ? "warn" : "loss"} size={10} rings={st.phase === "live" ? 2 : 1} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <div className="min-w-0">
              <RollingDigits value={st.pending} className={cn("dot-num text-[30px] leading-none", st.pending > 0 ? "text-warn" : "text-fg")} />
              <p className="mt-1 truncate text-[11.5px] text-faint">{st.pending > 0 ? SYNC_CARD.pending(st.pending) : SYNC_CARD.pendingNone}</p>
            </div>
            <div className="min-w-0">
              <RollingDigits value={st.records} className="dot-num text-[30px] leading-none text-fg" />
              <p className="mt-1 truncate text-[11.5px] text-faint">{SYNC_CARD.records}</p>
            </div>
          </div>

          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
            <motion.div
              className={cn("h-full origin-left rounded-full", st.phase === "error" ? "bg-loss" : st.phase === "offline" ? "bg-warn" : "bg-fg")}
              initial={false}
              animate={{ scaleX: running ? pct : 0 }}
              transition={reduced ? { duration: 0 } : spring.bar}
            />
          </div>

          <dl className="grid gap-1.5 text-[12.5px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-faint">{SYNC_CARD.last}</dt>
              <dd className="text-mute">
                <TextRoll text={st.lastSyncAt ? agoLabel(st.lastSyncAt, now) : SYNC_CARD.never} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-faint">Echtzeit</dt>
              <dd className="flex min-w-0 items-center gap-2 text-right text-mute">
                <PulseDot tone={st.realtime ? "win" : "muted"} size={6} rings={st.realtime ? 1 : 0} />
                <span className="truncate">{st.realtime ? SYNC_CARD.realtimeOn : SYNC_CARD.realtimeOff}</span>
              </dd>
            </div>
          </dl>

          {st.error && (
            <motion.p key={st.error} className={cn("rounded-xl border px-3 py-2 text-[12.5px]", st.phase === "error" ? "border-loss/40 bg-loss/10 text-loss" : "border-warn/30 bg-warn/[0.07] text-warn")} initial={reduced ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade}>
              {st.error}
            </motion.p>
          )}
          {st.conflicts > 0 && <p className="text-[12px] text-faint">{SYNC_CARD.conflicts(st.conflicts)}</p>}

          <ActionButton
            className="justify-self-start"
            icon={<Glyph />}
            spinIcon
            disabled={busy}
            onRun={async () => {
              const m = await ensureCloud();
              return m.syncNow();
            }}
          >
            {SYNC_CARD.now}
          </ActionButton>
        </div>
      )}
    </Card>
  );
}
