import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { openUpgrade } from "@/billing/store";
import { cn } from "@/lib/cn";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { useTick } from "@/cloud/ui/SyncStatusCard";
import { agoLabel } from "@/cloud/device";
import { celebrateFrom } from "@/motion/Celebrate";
import { DotMatrix } from "@/motion/DotMatrix";
import { RadarSweep } from "@/motion/fx/RadarSweep";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { RollingDigits } from "@/motion/RollingDigits";
import { StatusPill, type RingCycle } from "@/motion/StatusPill";
import { Switch } from "@/motion/Switch";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { ActionButton } from "@/views/settings/fx";
import {
  disconnectAccount,
  exchangeEnabled,
  loadExchangeStatus,
  openConnect,
  openCsvImport,
  primaryConnection,
  runDryRun,
  startFirstImport,
  syncNow,
  updateConnection,
  useExchange,
} from "../store";
import { CONNECT, EX } from "../strings";
import type { ExchangeConnection, ExchangeStatus, JournalAccount, SyncRun } from "../types";
import { FactList, MaskedKey, Notice, VENUE_NAME, VenueTile } from "./parts";
import { SyncStatus } from "./SyncStatus";

export interface ExchangeConnectionsCardProps {
  className?: string;
}

const ACCOUNTS: readonly { v: JournalAccount; label: string }[] = [
  { v: "scalp", label: "Scalp" },
  { v: "makro", label: "Makro" },
];

/** Minutes until the next cron slot (UTC-aligned every `everyMin`). */
export function minutesToNext(now: number, everyMin: number): number {
  const step = everyMin * 60_000;
  const next = Math.floor(now / step) * step + step;
  return Math.max(0, Math.round((next - now) / 60_000));
}

export function nextSlot(now: number, everyMin: number): number {
  const step = everyMin * 60_000;
  return Math.floor(now / step) * step + step;
}

/** Card header pill: live with a countdown ring to the next automatic sync, or the reason it does not run. */
function ConnPill({ conn, status }: { conn: ExchangeConnection; status: ExchangeStatus }) {
  const now = useTick(60_000);
  const outcome = useExchange((s) => s.outcome);
  if (conn.status === "invalid") return <StatusPill tone="error" expanded label={EX.pillInvalid} />;
  if (!conn.syncEnabled) return <StatusPill tone="muted" expanded label={EX.pillPaused} />;
  if (!status.cron.enabled) return <StatusPill tone="warn" expanded label={EX.pillManual} />;
  const every = status.cron.everyMin;
  const ring: RingCycle = { endsAt: nextSlot(now, every), ms: every * 60_000 };
  return <StatusPill tone="live" expanded ring={ring} label={EX.pillLive(minutesToNext(now, every))} pingKey={outcome?.key} />;
}

/**
 * Konto → "Börse" (P11): the Bitunix connection.
 * - not connected: the bridge (venue tile → dot-matrix chevrons → journal), three facts, "Börse verbinden" (opens the
 *   step-by-step sheet) and the CSV import for every other venue;
 * - connected: key as `••••last4` (TextScramble), live pill with a countdown ring to the next auto sync, counters on
 *   rolling Doto digits, a radar band sweeping the row while a sync runs, a BorderBeam lap + confetti when new trades
 *   arrived, dry run, first import (background, followed live), journal account + auto sync, disconnect by hold.
 * Hidden without cloud (P14 hides it too); honest states for signed out, server not set up and missing plan.
 */
export function ExchangeConnectionsCard({ className }: ExchangeConnectionsCardProps) {
  const enabled = exchangeEnabled();
  const phase = useCloudSession((s) => s.phase);
  const status = useExchange((s) => s.status);
  const load = useExchange((s) => s.load);
  const error = useExchange((s) => s.error);
  const signedIn = phase === "signedIn";

  useEffect(() => {
    if (enabled && signedIn) void loadExchangeStatus();
  }, [enabled, signedIn]);

  if (!enabled) return null;
  const conn = primaryConnection(status);
  return (
    <div className="h-full" data-testid="exchange-card">
      <Card title={EX.cardTitle} className={cn("h-full", className)} action={signedIn && conn && status ? <ConnPill conn={conn} status={status} /> : null}>
        {!signedIn ? (
          <SignedOut />
        ) : !status && load !== "error" ? (
          <Loading />
        ) : !status ? (
          <div className="grid gap-3">
            <Notice tone="warn">{error?.message ?? EX.notConfigured}</Notice>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void loadExchangeStatus()}>
                Erneut versuchen
              </Button>
              <Button size="sm" onClick={openCsvImport}>
                {EX.csv}
              </Button>
            </div>
          </div>
        ) : !status.configured && !conn ? (
          <div className="grid gap-3">
            <Notice tone="warn">{EX.notConfigured}</Notice>
            <Button size="sm" className="justify-self-start" onClick={openCsvImport}>
              {EX.csv}
            </Button>
          </div>
        ) : conn ? (
          <Connected conn={conn} status={status} />
        ) : (
          <Hero status={status} />
        )}
      </Card>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="grid gap-4">
      <Bridge />
      <p className="text-[13.5px] leading-relaxed text-mute">{EX.signedOut}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => openAuthSheet("signin", "card")}>
          {EX.signIn}
        </Button>
        <Button size="sm" onClick={openCsvImport}>
          {EX.csv}
        </Button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-3 py-2 text-[13px] text-mute" aria-busy="true">
      <DotMatrix preset="loader" size={3} gap={1.5} tone="fg" />
      {EX.loading}
    </div>
  );
}

/** Venue tile → chevrons → journal tile; the chevrons run three cycles on first view, then rest. */
function Bridge({ flowing = false }: { flowing?: boolean }) {
  const reduced = useReducedFx();
  const [play, setPlay] = useState(!reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setPlay(false), 3_600);
    return () => clearTimeout(t);
  }, [reduced]);
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <VenueTile exchange="bitunix" />
      <span className="grid min-w-0 flex-1 place-items-center overflow-hidden rounded-xl border border-dashed border-line-2 px-2 py-2.5">
        <DotMatrix preset="chevrons" size={3} gap={2} tone={flowing ? "win" : "fg"} playing={play || flowing} />
      </span>
      <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-2xl border border-line-2 bg-ink-950 px-2.5 font-mono text-[13px] font-semibold tracking-tight text-fg">
        TJ
      </span>
    </div>
  );
}

function Hero({ status }: { status: ExchangeStatus }) {
  const entitled = status.plan.entitled;
  return (
    <div className="grid gap-5" data-testid="exchange-hero">
      <Bridge />
      <div className="grid gap-1.5">
        <h3 className="text-[clamp(20px,5vw,24px)] font-semibold leading-tight tracking-tight">{EX.heroTitle}</h3>
        <p className="text-[13.5px] leading-relaxed text-mute">{EX.heroLead}</p>
      </div>
      <FactList facts={EX.facts} />
      {entitled ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => openConnect()} data-testid="exchange-connect">
            {EX.connect}
          </Button>
          <Button onClick={openCsvImport}>{EX.csv}</Button>
        </div>
      ) : (
        <div className="grid gap-2.5 rounded-xl border border-line bg-ink-950/40 p-3">
          <span className="flex items-center gap-2 text-[13px] text-mute">
            <Badge tone="steel">Pro</Badge>
            {EX.upgradeLine}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => openUpgrade("exchangeSync", "pro")}>
              {EX.upgrade}
            </Button>
            <Button size="sm" onClick={openCsvImport}>
              {EX.csv}
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11.5px] text-faint">{EX.otherVenues}</p>
    </div>
  );
}

/** Latest finished run of a connection (the counters before any action of this session). */
function lastRunOf(runs: readonly SyncRun[], connectionId: string): SyncRun | null {
  return runs.find((r) => r.connectionId === connectionId && !r.dryRun && r.status !== "running") ?? null;
}

const GLYPH_SYNC = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 4.6M2.5 9.5a5.5 5.5 0 0 0 10.3 1.9" />
    <path d="M3 2v3h3M13 14v-3h-3" />
  </svg>
);

function Connected({ conn, status }: { conn: ExchangeConnection; status: ExchangeStatus }) {
  const reduced = useReducedFx();
  const busy = useExchange((s) => s.busy);
  const outcome = useExchange((s) => s.outcome);
  const backfill = useExchange((s) => s.backfill);
  const actionError = useExchange((s) => s.actionError);
  const now = useTick(30_000);
  const syncRef = useRef<HTMLButtonElement>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState<(typeof CONNECT.importRanges)[number]["v"]>("90");
  const [asking, setAsking] = useState(false);
  const { trigger, no } = useConfirmFocus(asking);

  const mine = outcome && outcome.connectionId === conn.id ? outcome : null;
  const last = lastRunOf(status.runs, conn.id);
  const counts = mine?.counts ?? last ?? { inserted: 0, updated: 0, unchanged: 0 };
  const importing = !!backfill && !backfill.done && backfill.connectionId === conn.id;
  const scanning = busy === "sync" || busy === "dry" || importing;
  const invalid = conn.status === "invalid";

  // one beam lap + confetti per outcome that brought new trades (adjusting state while rendering)
  const [seenKey, setSeenKey] = useState(mine?.key ?? 0);
  const [fire, setFire] = useState(0);
  if (mine && mine.key !== seenKey) {
    setSeenKey(mine.key);
    if (mine.counts.inserted > 0) setFire((n) => n + 1);
  }
  useEffect(() => {
    if (fire > 0 && syncRef.current) celebrateFrom(syncRef.current, { kind: "win", tone: "win" });
  }, [fire]);

  return (
    <div className="relative grid gap-4" data-testid="exchange-connected">
      {fire > 0 && (
        <span aria-hidden="true" className="pointer-events-none absolute -inset-1 overflow-hidden rounded-2xl">
          <BorderBeam fire={fire} />
        </span>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-950/45 p-3.5">
        <RadarSweep active={scanning} variant="band" tone={invalid ? "signal" : "win"} />
        <div className="relative flex flex-wrap items-center gap-3">
          <VenueTile exchange={conn.exchange} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold">{VENUE_NAME[conn.exchange] ?? conn.exchange}</span>
              {conn.label && <span className="truncate text-[12px] text-faint">{conn.label}</span>}
            </span>
            <span className="text-[12.5px] text-mute">
              <MaskedKey last4={conn.keyLast4} /> · <span className="text-faint">nur Lesen</span>
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-faint">
            {scanning && <DotMatrix preset="snake" size={2} gap={1} tone="win" playing />}
            <TextRoll text={scanning ? EX.syncing : `${EX.lastSync} ${conn.lastSyncAt ? agoLabel(conn.lastSyncAt, now) : EX.never}`} />
          </span>
        </div>

        <dl className="relative mt-3.5 grid grid-cols-3 gap-2" data-testid="exchange-counters">
          {(["inserted", "updated", "unchanged"] as const).map((k) => (
            <div key={k} className="min-w-0 rounded-xl border border-line bg-ink-900/60 px-3 py-2">
              <dd>
                <RollingDigits value={counts[k]} className={cn("dot-num text-[26px] leading-none", k === "inserted" && counts[k] > 0 ? "text-win" : "text-fg")} />
              </dd>
              <dt className="mt-1 truncate text-[11px] text-faint">{EX.counters[k]}</dt>
            </div>
          ))}
        </dl>
      </div>

      {invalid && (
        <div className="grid gap-2">
          <Notice tone="loss">{conn.lastError ?? "Der Key wird von Bitunix nicht mehr akzeptiert."}</Notice>
          <Button variant="primary" size="sm" className="justify-self-start" onClick={() => openConnect(conn.id)}>
            {EX.reconnect}
          </Button>
        </div>
      )}
      {!invalid && conn.lastError && <Notice tone="warn">{conn.lastError}</Notice>}
      {actionError && !invalid && actionError.message !== conn.lastError && <Notice tone="warn">{actionError.message}</Notice>}

      <AnimatePresence initial={false}>
        {importing && (
          <motion.div
            key="import"
            className="flex items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-[12.5px] text-mute"
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ y: spring.enter, opacity: tween.fade }}
            data-testid="exchange-backfill"
          >
            <DotMatrix preset="wave" size={3} gap={1.5} tone="fg" playing />
            <span className="min-w-0 flex-1">{CONNECT.importRunning}</span>
            {backfill?.run && <span className="num font-mono text-fg">{backfill.run.inserted}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {!invalid && (
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton ref={syncRef} variant="primary" size="sm" icon={GLYPH_SYNC} spinIcon disabled={!!busy || importing} onRun={() => syncNow(conn.id).then((o) => o !== null)} data-testid="exchange-sync">
            {EX.syncNow}
          </ActionButton>
          <Button size="sm" disabled={!!busy || importing} onClick={() => void runDryRun(conn.id)} title={EX.dryRunHint} data-testid="exchange-dry">
            {busy === "dry" ? "Liest …" : EX.dryRun}
          </Button>
          <Button size="sm" disabled={!!busy || importing} aria-expanded={rangeOpen} onClick={() => setRangeOpen((o) => !o)}>
            {EX.firstImport}
          </Button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {rangeOpen && !invalid && (
          <motion.div
            key="range"
            className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3"
            style={{ transformOrigin: "top" }}
            initial={reduced ? false : { opacity: 0, clipPath: "inset(0 0 100% 0 round 12px)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0 0% 0 round 12px)" }}
            exit={{ opacity: 0, clipPath: "inset(0 0 100% 0 round 12px)", transition: tween.exit }}
            transition={{ clipPath: tween.reveal, opacity: tween.fade }}
          >
            <span className="text-[12.5px] text-mute">{CONNECT.importLead}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented size="sm" aria-label={CONNECT.importTitle} value={range} onChange={setRange} options={CONNECT.importRanges} />
              <Button
                variant="primary"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  setRangeOpen(false);
                  void startFirstImport(conn.id, Number(range));
                }}
              >
                {CONNECT.importStart}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span id={`acc-${conn.id}`} className="label">
            {EX.journalAccount}
          </span>
          <Segmented size="sm" aria-labelledby={`acc-${conn.id}`} value={conn.journalAccount} onChange={(v) => void updateConnection(conn.id, { journalAccount: v })} options={ACCOUNTS} />
        </div>
        <label className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="grid gap-0.5 sm:text-right">
            <span className="text-[13px] text-fg">{EX.autoSync}</span>
            <span className="text-[11px] text-faint">{status.cron.enabled ? `alle ${status.cron.everyMin} Min` : "auf diesem Server aus"}</span>
          </span>
          <Switch checked={conn.syncEnabled} onCheckedChange={(v) => void updateConnection(conn.id, { syncEnabled: v })} aria-label={EX.autoSync} />
        </label>
      </div>

      <SyncStatus connectionId={conn.id} />

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-faint">{EX.ipNote}</span>
        {asking ? (
          <motion.span
            className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]"
            role="alert"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ default: tween.fade, scale: spring.pop }}
          >
            {EX.disconnectAsk}
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setAsking(false);
                void disconnectAccount(conn.id);
              }}
            >
              {EX.disconnect}
            </Button>
            <Button ref={no} size="sm" onClick={() => setAsking(false)}>
              Abbrechen
            </Button>
          </motion.span>
        ) : (
          <HoldConfirm ref={trigger} size="sm" variant="danger" disabled={busy === "disconnect"} onAsk={() => setAsking(true)} onConfirm={() => void disconnectAccount(conn.id)} data-testid="exchange-disconnect">
            {EX.disconnect}
          </HoldConfirm>
        )}
      </div>
    </div>
  );
}
