/**
 * Section „E-Mail-Alarm bei geschlossener App“ (F21) of the Alarme card: the switch, the honest state of the server
 * ("zuletzt geprüft", what is watched, mails today, what waits), the daily limit, the test mail and what goes to the
 * server. Only with an account and the plan (`boxScanner`, the gate of the Box-Scanner's alarms); every state that stands
 * in the way is named (`emailAlertView`). The rules themselves reach the server through the cloud sync; this section only
 * writes `settings.serverAlerts.{email, armedAt, maxPerDay}` and asks `/api/v1/alerts/test` for the status.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { ApiError } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { usePrivacy } from "@/cloud/privacy";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { useSyncStatus } from "@/cloud/sync/status";
import { serverAlertsOf, serverWatchSet, MAIL_DAY_OPTIONS } from "@/domain/keylevels";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { hasClaudeRuntime } from "@/store/capability";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { emailAlertView, mailsToday, reachedServer, runLine, stampText, agoText, type StatusState } from "./emailAlertModel";
import { fetchAlertStatus, sendAlertTestMail } from "./emailAlertApi";
import { EMAIL as T } from "./emailStrings";
import { SwitchRow } from "./SwitchRow";
import { setEmailAlarm, setMailsPerDay } from "./writes";

const POLL_MS = 60_000;

/** The server's status, asked once the preconditions hold and then every minute while the page is visible. */
function useAlertStatus(active: boolean): { state: StatusState; refresh: () => void } {
  const [state, setState] = useState<StatusState>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const load = (): void => {
      fetchAlertStatus(ctrl.signal).then(
        (data) => {
          if (!ctrl.signal.aborted) setState({ kind: "ok", data });
        },
        (e: unknown) => {
          if (!ctrl.signal.aborted) setState({ kind: "error", message: e instanceof ApiError ? e.message : "Der Server hat nicht geantwortet." });
        },
      );
    };
    load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) load();
    }, POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [active, nonce]);
  return { state, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12px] text-mute">{label}</dt>
      <dd className={cn("min-w-0 text-[12.5px] text-fg", tone === "warn" && "text-warn")}>{children}</dd>
    </div>
  );
}

export const EmailAlertSection = memo(function EmailAlertSection() {
  const cloud = cloudEnabled() && !hasClaudeRuntime();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const address = useCloudSession((s) => s.user?.email ?? null);
  const entitled = useEntitlement("boxScanner");
  const syncOn = usePrivacy((s) => s.sync);
  const syncPhase = useSyncStatus((s) => s.phase);
  const pending = useSyncStatus((s) => s.pending);
  const rawAlerts = useJournal((s) => s.settings.serverAlerts);
  const rawLevels = useJournal((s) => s.settings.keyLevels);
  const cfg = useMemo(() => serverAlertsOf(rawAlerts), [rawAlerts]);
  const watch = useMemo(() => serverWatchSet(rawLevels), [rawLevels]);
  const pushToast = useUi((s) => s.pushToast);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const asking = cloud && signedIn && !needsMfa && entitled;
  const { state: status, refresh } = useAlertStatus(asking);
  const view = emailAlertView({ cloud, signedIn, needsMfa, entitled, status, syncOn, syncPhase, cfg });

  // the ages ("vor 3 Min") follow the clock; the status poll refreshes the server's side
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const toggle = async (on: boolean): Promise<void> => {
    if ((await setEmailAlarm(on)) !== "ok") pushToast({ kind: "error", title: T.saveFailed });
    else if (on) refresh();
  };
  const perDay = async (n: number): Promise<void> => {
    if ((await setMailsPerDay(n)) !== "ok") pushToast({ kind: "error", title: T.saveFailed });
  };
  const test = async (): Promise<void> => {
    setSending(true);
    try {
      await sendAlertTestMail();
      pushToast({ kind: "success", title: T.testSent(address), detail: T.testSentDetail });
    } catch (e) {
      pushToast({ kind: "error", title: T.testFailed, detail: e instanceof ApiError ? e.message : "Der Server hat nicht geantwortet." });
    } finally {
      setSending(false);
    }
  };

  const server = status.kind === "ok" ? status.data : null;
  const shownRun = view.kind === "on" || view.kind === "sync" ? runLine(server?.lastRun ?? null, now) : null;
  const today = mailsToday(cfg, now);
  const levelName = (id: string): string => watch.levels.find((l) => l.id === id)?.name ?? watch.over.find((l) => l.id === id)?.name ?? T.problemUnknownLevel;

  return (
    <section className="grid gap-3 border-t border-line pt-4" data-testid="email-alert" data-state={view.kind} aria-labelledby="email-alert-title">
      <div className="grid gap-0.5">
        <h3 id="email-alert-title" className="label">
          {T.title}
        </h3>
        <p className="text-[12px] leading-snug text-mute">{T.lead}</p>
      </div>

      <SwitchRow id="email-alert-switch" label={T.switchLabel} help={T.switchHelp} checked={cfg.email} onChange={(on) => void toggle(on)} disabled={!cfg.email && !view.canEnable} />

      <div className="grid gap-2 rounded-xl border border-line-2 bg-white/[0.03] px-3 py-2.5" data-testid="email-alert-state">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={view.tone} dot>
            {view.head}
          </Badge>
          {view.kind === "signedout" && (
            <Button size="sm" onClick={() => openAuthSheet("signin", "card")}>
              {T.signIn}
            </Button>
          )}
          {(view.kind === "mfa" || view.kind === "sync" || view.kind === "unconfirmed" || view.kind === "address") && (
            <Button size="sm" onClick={() => navigate("konto")}>
              {T.openAccount}
            </Button>
          )}
        </div>
        <p className="text-[12.5px] leading-snug text-mute" data-testid="email-alert-note">
          {view.kind === "unavailable" && status.kind === "error" ? `${view.note} ${status.message}` : view.note}
        </p>
        {cfg.email && view.kind !== "nocloud" && view.kind !== "signedout" && (
          <dl className="grid gap-1.5 border-t border-line pt-2" data-testid="email-alert-rows">
            {shownRun && (
              <Row label={T.rows.lastRun} tone={shownRun.tone === "warn" ? "warn" : undefined}>
                <span data-testid="email-alert-lastrun">{shownRun.text}</span>
              </Row>
            )}
            <Row label={T.rows.transfer}>{reachedServer(syncPhase, pending) ? T.transferLive : T.transferPending}</Row>
            <Row label={T.rows.watched}>
              {watch.levels.length ? T.watchedCount(watch.levels.length) : T.watchedNone}
              {watch.over.length > 0 && <span className="block text-warn">{T.watchedOver(watch.over.length)}</span>}
            </Row>
            <Row label={T.rows.today}>{T.todayOf(today, cfg.maxPerDay)}</Row>
            <Row label={T.rows.lastMail}>{cfg.lastMailAt ? `${stampText(cfg.lastMailAt)} (${agoText(cfg.lastMailAt, now)})` : T.never}</Row>
            {cfg.outbox.length > 0 && <Row label={T.rows.waiting}>{T.waitingCount(cfg.outbox.length)}</Row>}
            {cfg.fail && (
              <Row label={T.rows.send} tone="warn">
                {T.failedSendRetry(cfg.fail.n)} {T.failedSend[cfg.fail.code] ?? T.failedSendUnknown}
              </Row>
            )}
            {cfg.problems.length > 0 && (
              <Row label={T.rows.problems} tone="warn">
                <ul className="grid gap-0.5">
                  {cfg.problems.map((p) => (
                    <li key={p.id}>
                      {levelName(p.id)}: {T.problem[p.code]}
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </dl>
        )}
      </div>

      {cfg.email && view.canEnable && (
        <div className="grid gap-1.5">
          <span id="email-alert-perday" className="label">
            {T.perDay}
          </span>
          <Segmented<string> aria-labelledby="email-alert-perday" size="md" className="justify-self-start" value={String(cfg.maxPerDay)} onChange={(v) => void perDay(Number(v))} options={MAIL_DAY_OPTIONS.map((n) => ({ v: String(n), label: String(n) }))} />
          <p className="text-[11.5px] leading-snug text-mute">{T.perDayHelp}</p>
        </div>
      )}

      {view.testable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button size="sm" onClick={() => void test()} disabled={sending} data-testid="email-alert-test">
            {sending ? T.testing : T.test}
          </Button>
          <span className="min-w-0 break-words text-[12px] text-mute">{T.recipient(address)}</span>
        </div>
      )}

      <div className="grid gap-1.5 text-[11.5px] leading-snug text-mute">
        <p>
          <span className="font-semibold text-fg">{T.limitsTitle}: </span>
          {T.limits.join(" ")}
        </p>
        <p>
          <span className="font-semibold text-fg">{T.quietTitle}: </span>
          {T.quiet}
        </p>
        <p data-testid="email-alert-privacy">
          <span className="font-semibold text-fg">{T.privacyTitle}: </span>
          {T.privacy}
        </p>
      </div>
    </section>
  );
});
