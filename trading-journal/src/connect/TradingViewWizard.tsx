import { useEffect, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { StaggerItem } from "@/motion/Stagger";
import { Button } from "@/primitives/Button";
import { CopyButton } from "@/primitives/CopyButton";
import { useConnectUi } from "./open";
import { nextAttempt, nextDelay, POLL_TOTAL_MS } from "./pollBackoff";
import { PartnerBox } from "./PartnerBox";
import { wizardReducer, wizardStart } from "./slotState";
import { TV } from "./strings";
import { TV_CLOSE_MESSAGE, TV_OPEN_MESSAGE, TV_PINE, TV_PINE_SIGNAL, TV_SIGNAL_FLAT_MESSAGE, TV_SIGNAL_MESSAGE, TV_TEST_MESSAGE, maskedUrl, signalsUrl } from "./tvTemplates";
import { createTv, loadTv, revokeTv, sendAppTest, tvList, useTv, type TvReceipt } from "./tvStore";
import { TvMcpPanel } from "./TvMcpPanel";
import { TvSignals } from "./TvSignals";

function Code({ label, text, testId }: { label: string; text: string; testId?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-mute">{label}</span>
        <CopyButton text={text} label={TV.copy} doneLabel={TV.copied} />
      </div>
      <code className="cx-panel cx-code" data-testid={testId}>
        {text}
      </code>
    </div>
  );
}

function Receipt({ r }: { r: TvReceipt }) {
  return (
    <li className="cx-panel grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px]" data-testid="tv-receipt" data-kind={r.kind} data-via={r.via}>
      <span className={cn("font-medium", r.kind === "rejected" ? "text-loss" : "text-fg")}>
        {TV.kind[r.kind]}
        {r.symbol ? ` · ${r.symbol}` : ""}
      </span>
      <span className="num text-mute">{new Date(r.receivedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <span className="col-span-2 text-[11.5px] text-mute">
        {r.kind === "rejected" ? (r.detail ?? "abgelehnt") : TV.via[r.via]}
      </span>
    </li>
  );
}

/**
 * TradingView assistant (Paket Verbindungen), no OAuth: Zieladresse kopieren → in den TradingView-Alarm einfügen →
 * Testsignal senden → Empfang hier anzeigen. The address is the user's own webhook (`hooks-tradingview.mts`); it can
 * be replaced at any time (the old one stops at once). The receipt list polls while the dialog is on the last step.
 */
export function TradingViewWizard({ onClose }: { onClose: () => void }) {
  const status = useTv((s) => s.status);
  const url = useTv((s) => s.url);
  const busy = useTv((s) => s.busy);
  const error = useTv((s) => s.error);
  const [w, dispatch] = useReducer(wizardReducer, 3, (n: number) => wizardStart(n, false));
  const [asking, setAsking] = useState<null | "rotate" | "revoke">(null);
  const [startedAt] = useState(() => Date.now());
  const lastStep = w.step === 2;

  useEffect(() => {
    void loadTv();
  }, []);

  // poll while the test step is open: fast at first, slower and slower (`pollBackoff`), fast again when something new arrives; only a visible tab,
  // ten minutes at most per opening
  // the body stays mounted while the sheet closes: a closed dialog does not poll
  const dialogOpen = useConnectUi((c) => c.service === "tradingview");
  const headId = tvList(status)[0]?.id ?? null;
  const seenHead = useRef<string | null>(headId);
  useEffect(() => {
    seenHead.current = headId;
  }, [headId]);
  useEffect(() => {
    if (!lastStep || !dialogOpen) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = (): void => {
      if (stopped || Date.now() - startedAt > POLL_TOTAL_MS) return;
      const before = seenHead.current;
      const go = document.hidden ? Promise.resolve(null) : loadTv();
      void go.then((st) => {
        if (stopped) return;
        const now = st ? (tvList(st)[0]?.id ?? null) : before;
        attempt = nextAttempt(attempt, now !== before);
        timer = setTimeout(tick, nextDelay(attempt));
      });
    };
    timer = setTimeout(tick, nextDelay(0));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastStep, dialogOpen, startedAt]);

  const receipts = status?.receipts ?? [];
  const list = tvList(status);
  const signalsOn = !!status?.signalsAvailable;
  const hasToken = !!status?.hasToken;
  const newest = list.find((r) => r.kind === "test" && r.status === "processed") ?? null;

  return (
    <div className="grid gap-5" data-testid="tv-wizard">
      <StaggerItem className="grid gap-1.5">
        <p className="text-[13px] leading-relaxed text-mute">{TV.lead}</p>
        <p className="text-[11.5px] leading-relaxed text-faint" data-testid="tv-honest">
          {TV.honest}
        </p>
      </StaggerItem>

      <StaggerItem>
        <ol className="grid grid-cols-3 gap-2" aria-label="Schritte">
          {TV.steps.map((label, i) => (
            <li key={label} aria-current={i === w.step ? "step" : undefined}>
              <span aria-hidden="true" className={cn("mb-1.5 block h-1 rounded-full", i < w.step ? "bg-win" : i === w.step ? "bg-fg" : "bg-white/[0.07]")} />
              <span className={cn("text-[11.5px]", i > w.step ? "text-faint" : "text-fg")}>
                <span className="num mr-1 font-mono text-faint">{i + 1}</span>
                {label}
              </span>
            </li>
          ))}
        </ol>
      </StaggerItem>

      {w.step === 0 && (
        <div className="grid gap-3" data-testid="tv-step-address">
          <h3 className="text-[14px] font-semibold">{TV.addrTitle}</h3>
          <p className="text-[12.5px] leading-relaxed text-mute">{TV.addrLead}</p>
          {url ? (
            <div className="grid gap-2">
              <div className="cx-panel flex min-w-0 items-center gap-2 py-1 pl-3 pr-1">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px]" data-testid="tv-url" title={maskedUrl(url)}>
                  {url}
                </code>
                <CopyButton text={url} label={TV.copy} doneLabel={TV.copied} />
              </div>
              <p className="text-[11.5px] leading-relaxed text-warn">{TV.onceOnly}</p>
            </div>
          ) : hasToken && status?.token ? (
            <p className="text-[12.5px] text-mute" data-testid="tv-hidden">
              {TV.hidden(status.token.prefix)}
            </p>
          ) : null}
          {error && (
            <p role="alert" className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] text-loss" data-testid="tv-error">
              {error}
            </p>
          )}
          {!hasToken ? (
            <Button variant="primary" fx={false} className="justify-self-start" loading={busy === "create"} onClick={() => void createTv(false)} data-testid="tv-create">
              {TV.create}
            </Button>
          ) : asking === "rotate" ? (
            <div className="grid gap-2" role="group" aria-label={TV.rotate}>
              <p className="text-[12.5px] text-mute">{TV.rotateAsk}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === "rotate"}
                  onClick={() => void createTv(true).then((r) => r.ok && setAsking(null))}
                  data-testid="tv-rotate-yes"
                >
                  {TV.rotate}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                  {TV.disconnectNo}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" className="justify-self-start" onClick={() => setAsking("rotate")} data-testid="tv-rotate">
              {TV.rotate}
            </Button>
          )}
          {hasToken && list.length > 0 && <TvSignals list={list} limit={3} />}
          <TvMcpPanel />
          <PartnerBox partner="tradingview" />
        </div>
      )}

      {w.step === 1 && (
        <div className="grid gap-3" data-testid="tv-step-alarm">
          <h3 className="text-[14px] font-semibold">{TV.alarmTitle}</h3>
          <ol className="grid gap-2">
            {TV.alarm.map((s, i) => (
              <li key={s.t} className="cx-panel grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3">
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg border border-line-2 font-mono text-[12px]">
                  {i + 1}
                </span>
                <span className="grid gap-0.5">
                  <span className="text-[13px] font-medium">{s.t}</span>
                  <span className="text-[12.5px] leading-snug text-mute">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <h3 className="text-[14px] font-semibold">{TV.templates}</h3>
          <Code label={TV.tplTest} text={TV_TEST_MESSAGE} testId="tv-tpl-test" />
          <Code label={TV.tplOpen} text={TV_OPEN_MESSAGE} testId="tv-tpl-open" />
          <Code label={TV.tplClose} text={TV_CLOSE_MESSAGE} />
          <Code label={TV.tplPine} text={TV_PINE} testId="tv-tpl-pine" />
          <Code label={TV.tplSignal} text={TV_SIGNAL_MESSAGE} testId="tv-tpl-signal" />
          <Code label={TV.tplSignalFlat} text={TV_SIGNAL_FLAT_MESSAGE} testId="tv-tpl-signal-flat" />
          <Code label={TV.tplPineSignal} text={TV_PINE_SIGNAL} testId="tv-tpl-pine-signal" />
          <Code label={TV.signalUrlLabel} text={signalsUrl(url, status?.origin ?? null, typeof location !== "undefined" ? location.origin : "")} testId="tv-signal-url" />
          <p className="text-[11.5px] leading-relaxed text-faint" data-testid="tv-signal-url-hint">
            {TV.signalUrlHint}
          </p>
          <p className="text-[11.5px] leading-relaxed text-faint" data-testid="tv-plan-note">
            {TV.planNote}
          </p>
          <p className="text-[11.5px] leading-relaxed text-faint" data-testid="tv-trade-note">
            {status && !status.tradeAlerts.allowed ? `${TV.tradeNote} In deinem Tarif (${status.tradeAlerts.plan}) ist es nicht enthalten.` : TV.tradeNote}
          </p>
        </div>
      )}

      {w.step === 2 && (
        <div className="grid gap-3" data-testid="tv-step-test">
          <h3 className="text-[14px] font-semibold">{TV.testTitle}</h3>
          <p className="text-[12.5px] leading-relaxed text-mute">{TV.testLead}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" fx={false} loading={busy === "test"} disabled={!url} onClick={() => void sendAppTest()} data-testid="tv-send-test">
              {TV.sendTest}
            </Button>
            {!url && <span className="text-[11.5px] text-mute">{hasToken ? "Die Adresse ist nicht mehr sichtbar – in Schritt 1 neu erstellen, oder den Test-Alarm in TradingView auslösen." : "Erstelle zuerst die Zieladresse (Schritt 1)."}</span>}
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] text-loss" data-testid="tv-error">
              {error}
            </p>
          )}
          <div aria-live="polite" className="grid gap-2" data-testid="tv-receipts">
            <span className="label">{TV.receiptsTitle}</span>
            {newest ? (
              <p className="rounded-xl border border-win/35 bg-win/[0.06] px-3 py-2 text-[12.5px] text-fg" data-testid="tv-arrived" data-via={newest.via}>
                <strong className="font-semibold">{TV.confirmed}</strong> {newest.via === "extern" ? TV.gotExtern : TV.gotApp}
              </p>
            ) : (
              <p className="text-[12.5px] text-mute" data-testid="tv-waiting">
                {hasToken ? TV.waiting : TV.noReceipts}
              </p>
            )}
            {status && !status.receiptsAvailable && <p className="text-[11.5px] text-warn">{TV.migration}</p>}
            {signalsOn ? (
              <TvSignals list={list} limit={10} />
            ) : (
              receipts.length > 0 && (
                <ul className="grid gap-1.5">
                  {receipts.slice(0, 5).map((r) => (
                    <Receipt key={r.id} r={r} />
                  ))}
                </ul>
              )
            )}
            {signalsOn && <p className="text-[11px] text-faint">{TV.signalsPolling}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {hasToken && (
          <div className="mr-auto">
            {asking === "revoke" ? (
              <span className="flex flex-wrap items-center gap-2" role="group" aria-label={TV.disconnect}>
                <span className="text-[12px] text-mute">{TV.disconnectAsk}</span>
                <Button size="sm" variant="danger" loading={busy === "revoke"} onClick={() => void revokeTv().then((ok) => ok && setAsking(null))} data-testid="tv-disconnect-yes">
                  {TV.disconnectYes}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                  {TV.disconnectNo}
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setAsking("revoke")} data-testid="tv-disconnect">
                {TV.disconnect}
              </Button>
            )}
          </div>
        )}
        {w.step > 0 && <Button onClick={() => dispatch({ type: "back" })}>Zurück</Button>}
        {w.step < 2 ? (
          <Button variant="primary" fx={false} onClick={() => dispatch({ type: "next" })} disabled={w.step === 0 && !hasToken} data-testid="tv-next">
            Weiter
          </Button>
        ) : (
          <Button variant="primary" fx={false} onClick={onClose} data-testid="tv-done">
            Fertig
          </Button>
        )}
      </div>
    </div>
  );
}
