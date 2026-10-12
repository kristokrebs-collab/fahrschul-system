import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { celebrateFrom } from "@/motion/Celebrate";
import { HoldButton } from "@/motion/HoldButton";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { TextRoll } from "@/motion/TextRoll";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { pushToast } from "@/store/uiStore";
import type { DeviceSession, TotpEnrollment } from "../client";
import { agoLabel, deviceKind, deviceLabel } from "../device";
import { setIdleMinutes, useIdlePref, type IdleMinutes } from "../idle";
import { ensureCloud } from "../runtime";
import { useCloudSession } from "../session";
import { CODE_LENGTH, CodeSlots } from "./CodeSlots";
import { QrReveal } from "./QrReveal";
import { SECURITY } from "./strings";
import { useTick } from "./SyncStatusCard";

/**
 * `Sicherheit` card (P09): 2FA (TOTP), the signed-in devices and the idle sign-out.
 * - 2FA on: QR with a dither wipe (`QrReveal`), the key in groups of four (copy), the code on rolling slots
 *   (`CodeSlots`), confirmed by HOLDING (`HoldButton`) → the badge pops to `Aktiv` with a confetti burst. 2FA off:
 *   `HoldConfirm` (tap asks).
 * - Devices: this device first, every row `Chrome · macOS · 192.168.1.x · aktiv vor 5 Min` – the age label morphs
 *   (`TextRoll`, refreshed every 30 s); `Andere Geräte abmelden` (hold or tap → ask; Supabase `signOut({ scope:
 *   "others" })`).
 * - Idle sign-out: `Segmented` Nie / 30 Min / 2 Std / 8 Std.
 */
export function SecurityCard({ className }: { className?: string }) {
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  if (!signedIn) return null;
  return (
    <Card title={SECURITY.title} className={className}>
      <div className="grid gap-6">
        <MfaSection />
        <div className="h-px bg-line" />
        <SessionsSection />
        <div className="h-px bg-line" />
        <IdleSection />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ 2FA */

function groups(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function MfaSection() {
  const factors = useCloudSession((s) => s.factors);
  const aal = useCloudSession((s) => s.user?.aal ?? "aal1");
  const reduced = useReducedFx();
  const verified = factors.find((f) => f.status === "verified") ?? null;
  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; key: number } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [askOff, setAskOff] = useState(false);
  const badge = useRef<HTMLSpanElement>(null);

  async function start() {
    setBusy(true);
    setErr(null);
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.enrollTotp() : null;
    setBusy(false);
    if (!r || !r.ok) return setErr({ message: r && !r.ok ? r.message : "Cloud nicht erreichbar.", key: Date.now() });
    setEnroll(r.value);
    setCode("");
    setAccepted(false);
  }

  async function confirm() {
    if (!enroll || code.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.verifyTotp(enroll.factorId, code, "enroll") : null;
    setBusy(false);
    if (!r || !r.ok) {
      setErr({ message: r && !r.ok ? r.message : "Cloud nicht erreichbar.", key: Date.now() });
      setCode("");
      return;
    }
    setAccepted(true);
    pushToast({ kind: "success", title: SECURITY.enabled });
    setTimeout(() => {
      setEnroll(null);
      if (badge.current && !reduced) celebrateFrom(badge.current, { kind: "streak", tone: "win" });
    }, 600);
  }

  async function disable() {
    if (!verified) return;
    setBusy(true);
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.unenrollTotp(verified.id) : null;
    setBusy(false);
    setAskOff(false);
    if (!r || !r.ok) return pushToast({ kind: "error", title: r && !r.ok ? r.message : "Cloud nicht erreichbar." });
    pushToast({ kind: "info", title: SECURITY.disabled });
  }

  return (
    <section className="grid gap-3" aria-labelledby="sec-mfa">
      <div className="flex items-center justify-between gap-3">
        <h3 id="sec-mfa" className="text-[14px] font-semibold text-fg">
          {SECURITY.mfaTitle}
        </h3>
        <motion.span ref={badge} key={verified ? "on" : "off"} initial={reduced ? false : { scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ scale: spring.pop, opacity: tween.fade }}>
          <Badge tone={verified ? "win" : "mute"} dot ping={!!verified}>
            {verified ? SECURITY.mfaOn : SECURITY.mfaOff}
          </Badge>
        </motion.span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-mute">{verified ? SECURITY.mfaOnText : SECURITY.mfaOffText}</p>

      <AnimatePresence mode="popLayout" initial={false}>
        {enroll ? (
          <motion.div
            key="enroll"
            className="grid gap-4 rounded-2xl border border-line bg-ink-950/50 p-4"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ y: spring.enter, opacity: tween.fade }}
            data-testid="mfa-enroll"
          >
            <p className="text-center text-[12.5px] text-mute">{SECURITY.scan}</p>
            <QrReveal src={enroll.qr} alt="QR-Code für deine Authenticator-App" />
            <div className="grid justify-items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-faint">{SECURITY.manual}</span>
              <span className="flex max-w-full flex-wrap items-center justify-center gap-2">
                <code className="break-all rounded-lg border border-line bg-ink-900 px-2.5 py-1 text-center font-mono text-[12.5px] tracking-wider text-fg">{groups(enroll.secret)}</code>
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(enroll.secret).then(
                      () => setCopied(true),
                      () => undefined,
                    );
                  }}
                >
                  <TextRoll text={copied ? SECURITY.copied : SECURITY.copy} />
                </Button>
              </span>
            </div>
            <div className="grid gap-2">
              <span className="text-center text-[12px] text-faint">{SECURITY.codeLabel}</span>
              <CodeSlots
                value={code}
                onChange={(c) => {
                  setCode(c);
                  if (c) setErr(null);
                }}
                label={SECURITY.codeLabel} disabled={busy || accepted} invalidKey={err?.key ?? null} accepted={accepted} />
              {err && (
                <motion.p key={err.key} role="alert" className="text-center text-[12.5px] text-loss" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade}>
                  {err.message}
                </motion.p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button onClick={() => setEnroll(null)} disabled={busy}>
                {SECURITY.cancel}
              </Button>
              <HoldButton variant="primary" onConfirm={() => void confirm()} disabled={code.length !== CODE_LENGTH || busy || accepted} holdLabel="Halten …" armedLabel={SECURITY.confirmArmed}>
                {SECURITY.confirm}
              </HoldButton>
            </div>
          </motion.div>
        ) : verified ? (
          <motion.div key="on" className="flex flex-wrap items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
            {aal !== "aal2" ? (
              <p className="text-[12.5px] text-warn">{SECURITY.needCode}</p>
            ) : askOff ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-(--color-danger-text)" role="alert">
                {SECURITY.disableAsk}
                <Button size="sm" variant="danger" onClick={() => void disable()} disabled={busy}>
                  {SECURITY.yes}
                </Button>
                <Button size="sm" onClick={() => setAskOff(false)}>
                  {SECURITY.no}
                </Button>
              </span>
            ) : (
              <HoldConfirm variant="danger" onAsk={() => setAskOff(true)} onConfirm={() => void disable()} disabled={busy}>
                {SECURITY.disable}
              </HoldConfirm>
            )}
          </motion.div>
        ) : (
          <motion.div key="off" className="grid gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
            <Button variant="primary" className="justify-self-start" onClick={() => void start()} disabled={busy} aria-busy={busy || undefined}>
              <TextRoll mode="roll" text={busy ? "Bereite vor …" : SECURITY.enable} />
            </Button>
            {err && (
              <p role="alert" className="text-[12.5px] text-loss">
                {err.message}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ------------------------------------------------------------------ devices */

function DeviceGlyph({ ua }: { ua: string | null }) {
  const k = deviceKind(ua);
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {k === "phone" ? <rect x="7" y="2.5" width="10" height="19" rx="2.5" /> : k === "tablet" ? <rect x="4" y="3" width="16" height="18" rx="2.5" /> : <path d="M3 5.5h18v11H3zM8 20.5h8M12 16.5v4" />}
    </svg>
  );
}

function SessionsSection() {
  const sessionId = useCloudSession((s) => s.sessionId);
  const reduced = useReducedFx();
  const now = useTick();
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.listSessions() : null;
    if (r && r.ok) {
      setList(r.value);
      setFailed(false);
    } else {
      setList([]);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const m = await ensureCloud().catch(() => null);
      const r = m ? await m.listSessions() : null;
      if (!alive) return;
      if (r && r.ok) setList(r.value);
      else {
        setList([]);
        setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  async function others() {
    setBusy(true);
    const m = await ensureCloud().catch(() => null);
    const r = m ? await m.signOutScope("others") : null;
    setBusy(false);
    setAsk(false);
    if (!r || !r.ok) return pushToast({ kind: "error", title: r && !r.ok ? r.message : "Cloud nicht erreichbar." });
    pushToast({ kind: "success", title: SECURITY.signedOutOthers, detail: SECURITY.signedOutOthersDetail });
    void load();
  }

  const otherCount = (list ?? []).filter((s) => !s.current).length;
  return (
    <section className="grid gap-3" aria-labelledby="sec-sessions">
      <h3 id="sec-sessions" className="text-[14px] font-semibold text-fg">
        {SECURITY.sessionsTitle}
      </h3>
      {list === null ? (
        <div className="grid gap-2">
          <Skeleton height={52} />
          <Skeleton height={52} />
        </div>
      ) : (
        <ul className="grid gap-1.5" data-testid="session-list">
          {list.map((s, i) => (
            <motion.li
              key={s.id}
              className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", s.current ? "border-line-2 bg-white/[0.03]" : "border-line")}
              initial={reduced ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
              transition={{ x: { ...spring.enter, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
            >
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", s.current ? "border-white/30 text-fg" : "border-line text-mute")}>
                <DeviceGlyph ua={s.userAgent} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
                  <span className="truncate">{deviceLabel(s.userAgent)}</span>
                  {s.current && <Badge tone="win">{SECURITY.thisDevice}</Badge>}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-faint">
                  {s.ip && <span className="truncate">{s.ip} ·</span>}
                  <TextRoll text={SECURITY.active(agoLabel(s.lastActiveAt, now))} />
                </span>
              </span>
            </motion.li>
          ))}
          {list.length === 0 && <li className="text-[12.5px] text-faint">{failed ? SECURITY.sessionsError : SECURITY.sessionsEmpty}</li>}
        </ul>
      )}
      {(otherCount > 0 || failed) &&
        (ask ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-(--color-danger-text)" role="alert">
            {SECURITY.signOutOthersAsk}
            <Button size="sm" variant="danger" onClick={() => void others()} disabled={busy}>
              {SECURITY.yes}
            </Button>
            <Button size="sm" onClick={() => setAsk(false)}>
              {SECURITY.no}
            </Button>
          </span>
        ) : (
          <HoldConfirm variant="danger" className="justify-self-start" onAsk={() => setAsk(true)} onConfirm={() => void others()} disabled={busy}>
            {SECURITY.signOutOthers}
          </HoldConfirm>
        ))}
    </section>
  );
}

/* ------------------------------------------------------------------ idle */

function IdleSection() {
  const minutes = useIdlePref((s) => s.minutes);
  return (
    <section className="grid gap-2.5" aria-labelledby="sec-idle">
      <h3 id="sec-idle" className="text-[14px] font-semibold text-fg">
        {SECURITY.idleTitle}
      </h3>
      <Segmented
        options={SECURITY.idleOptions}
        value={String(minutes)}
        onChange={(v) => setIdleMinutes(Number(v) as IdleMinutes)}
        aria-label={SECURITY.idleTitle}
        className="w-full sm:w-auto"
      />
      <p className="text-[11.5px] leading-relaxed text-faint">{SECURITY.idleHelp}</p>
    </section>
  );
}
