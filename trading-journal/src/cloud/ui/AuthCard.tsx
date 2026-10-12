import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { date as fmtDate } from "@/lib/format";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { TextScramble } from "@/motion/TextScramble";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Magnetic } from "@/primitives/Magnetic";
import { Skeleton } from "@/primitives/Skeleton";
import { pushToast } from "@/store/uiStore";
import { ensureCloud } from "../runtime";
import { openAuthSheet, useCloudSession } from "../session";
import { NewPasswordForm } from "./AuthSheet";
import { AUTH, AUTH_CARD } from "./strings";

const BENEFIT_ICONS: Record<string, string> = {
  sync: "M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M17 3v4h-4M7 21v-4h4",
  offline: "M3 12h4l3-7 4 14 3-7h4",
  eu: "M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.3l5-.7z",
};

/**
 * `Login` card (P09). Signed out: the pitch – headline words rise in (`stagger.words`), three benefits whose icons
 * draw themselves (`tween.draw`, staggered), the magnetic `Anmelden` (opens the login sheet) and `Konto erstellen`.
 * Signed in: avatar, the e-mail decoding in (`TextScramble`), method / confirmed / member-since, `Passwort ändern`
 * (inline form springs open), `Abmelden`, `Überall abmelden` (hold, or tap → ask).
 */
export function AuthCard({ className }: { className?: string }) {
  const phase = useCloudSession((s) => s.phase);
  return (
    <Card title={AUTH_CARD.title} className={className}>
      {phase === "signedIn" ? <SignedIn /> : phase === "loading" || phase === "idle" ? <Loading /> : <SignedOut />}
    </Card>
  );
}

function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-9 w-40" />
    </div>
  );
}

function SignedOut() {
  const reduced = useReducedFx();
  const words = AUTH_CARD.signedOutTitle.split(" ");
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h3 className="text-[clamp(20px,5.5vw,26px)] font-semibold leading-tight tracking-tight">
          {words.map((w, i) => (
            <motion.span
              key={`${w}-${i}`}
              className="inline-block"
              initial={reduced ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
              transition={{ y: { ...spring.enter, delay: i * stagger.words * 2 }, opacity: { ...tween.reveal, delay: i * stagger.words * 2 }, filter: { ...tween.reveal, delay: i * stagger.words * 2 } }}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </motion.span>
          ))}
        </h3>
        <p className="text-[13px] leading-relaxed text-mute">{AUTH_CARD.signedOutText}</p>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-3">
        {AUTH_CARD.benefits.map((b, i) => (
          <motion.li
            key={b.k}
            className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 rounded-xl border border-line bg-ink-950/40 p-3 sm:grid-cols-1 sm:gap-1.5"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            transition={{ y: { ...spring.enter, delay: 0.15 + i * stagger.lead }, opacity: { ...tween.fade, delay: 0.15 + i * stagger.lead } }}
          >
            <svg viewBox="0 0 24 24" className="row-span-2 mt-0.5 size-5 text-fg sm:row-span-1 sm:mt-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <motion.path d={BENEFIT_ICONS[b.k]} initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduced ? { duration: 0 } : { ...tween.draw, delay: 0.25 + i * stagger.lead }} />
            </svg>
            <span className="text-[13px] font-medium text-fg">{b.t}</span>
            <span className="text-[11.5px] leading-snug text-faint">{b.d}</span>
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2.5">
        <Magnetic intensity={0.2} range={90}>
          <Button variant="primary" onClick={() => openAuthSheet("signin", "card")}>
            {AUTH_CARD.cta}
          </Button>
        </Magnetic>
        <Button onClick={() => openAuthSheet("signup", "card")}>{AUTH_CARD.create}</Button>
      </div>
    </div>
  );
}

function SignedIn() {
  const s = useCloudSession();
  const reduced = useReducedFx();
  const [pwOpen, setPwOpen] = useState(false);
  const [askAll, setAskAll] = useState(false);
  const email = s.user?.email ?? "–";
  async function out(scope: "local" | "global") {
    const m = await ensureCloud().catch(() => null);
    await m?.signOutScope(scope);
    pushToast({ kind: "info", title: AUTH.signedOut, detail: AUTH.signedOutDetail });
  }
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3.5">
        <motion.span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-full border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-dot text-[22px] text-fg"
          initial={reduced ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ scale: spring.pop, opacity: tween.fade }}
        >
          {email.slice(0, 1).toUpperCase()}
        </motion.span>
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-faint">{AUTH_CARD.email}</span>
          <TextScramble text={email} className="block truncate font-mono text-[14px] text-fg" />
        </span>
      </div>
      <dl className="grid gap-1.5 text-[12.5px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-faint">{AUTH_CARD.method}</dt>
          <dd className="text-mute">{AUTH_CARD.methods[s.provider ?? "email"] ?? s.provider}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-faint">E-Mail</dt>
          <dd>
            <Badge tone={s.emailConfirmed ? "win" : "warn"} dot>
              {s.emailConfirmed ? AUTH_CARD.verified : AUTH_CARD.unverified}
            </Badge>
          </dd>
        </div>
        {s.createdAt && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-faint">{AUTH_CARD.since}</dt>
            <dd className="text-mute">{fmtDate(new Date(s.createdAt))}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        {s.provider === "email" || !s.provider ? (
          <Button onClick={() => setPwOpen((v) => !v)} aria-expanded={pwOpen}>
            {AUTH_CARD.changePassword}
          </Button>
        ) : null}
        <Button onClick={() => void out("local")}>{AUTH_CARD.signOut}</Button>
        {askAll ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]" role="alert">
            {AUTH_CARD.signOutAll}?
            <Button size="sm" variant="danger" onClick={() => void out("global")}>
              Ja
            </Button>
            <Button size="sm" onClick={() => setAskAll(false)}>
              Nein
            </Button>
          </span>
        ) : (
          <HoldConfirm variant="danger" onAsk={() => setAskAll(true)} onConfirm={() => void out("global")} title={AUTH_CARD.signOutAllHint}>
            {AUTH_CARD.signOutAll}
          </HoldConfirm>
        )}
      </div>
      <AnimatePresence initial={false}>
        {pwOpen && (
          <motion.div
            key="pw"
            className="overflow-hidden rounded-xl border border-line bg-ink-950/40 p-4"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, clipPath: "inset(0% 0% 100% 0% round 12px)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0% round 12px)", transitionEnd: { clipPath: "none", transform: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ y: spring.layout, clipPath: spring.layout, opacity: tween.fade }}
          >
            <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.14em] text-faint">{AUTH_CARD.passwordTitle}</p>
            <NewPasswordForm reason="change" onDone={() => setPwOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
