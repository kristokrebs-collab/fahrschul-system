import { AnimatePresence, motion } from "motion/react";
import { useReducer, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ApiError } from "@/cloud/api";
import { connectExchange } from "@/exchanges/api";
import { disconnectAccount, loadExchangeStatus, runDryRun, startFirstImport, syncNow, useExchange } from "@/exchanges/store";
import type { ExchangeConnection, JournalAccount } from "@/exchanges/types";
import { cn } from "@/lib/cn";
import { celebrateFrom } from "@/motion/Celebrate";
import { RollingDigits } from "@/motion/RollingDigits";
import { StaggerItem } from "@/motion/Stagger";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { PartnerBox } from "./PartnerBox";
import { connectionOf } from "./facts";
import type { ServiceId } from "./services";
import { binanceMarketOf } from "./services";
import { canResubmit, wizardReducer, wizardStart } from "./slotState";
import { BINANCE_API_URL, BN } from "./strings";

type Market = "spot" | "futures";

interface Issue {
  code: string;
  level: "block" | "warn" | "info";
  text: string;
}

/** `details.issues` of the connect function's `rights_refused` / `rights_confirm` answers, checked. */
export function issuesOf(details: unknown): Issue[] {
  const raw = typeof details === "object" && details !== null ? (details as { issues?: unknown }).issues : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Issue => typeof i === "object" && i !== null && typeof (i as Issue).text === "string" && ["block", "warn", "info"].includes((i as Issue).level))
    .map((i) => ({ code: String(i.code), level: i.level, text: i.text }));
}

const ACCOUNTS: readonly { v: JournalAccount; label: string }[] = [
  { v: "scalp", label: "Scalp" },
  { v: "makro", label: "Makro" },
];

function Tick({ ok = true }: { ok?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("mt-0.5 size-3.5 shrink-0", ok ? "text-win" : "text-warn")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function Steps({ step, labels }: { step: number; labels: readonly string[] }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Schritte">
      {labels.map((label, i) => (
        <li key={label} aria-current={i === step ? "step" : undefined} className="grid gap-1.5">
          <span aria-hidden="true" className={cn("block h-1 rounded-full", i < step ? "bg-win" : i === step ? "bg-fg" : "bg-white/[0.07]")} />
          <span className={cn("text-[11.5px]", i > step ? "text-faint" : "text-fg")}>
            <span className="num mr-1 font-mono text-faint">{i + 1}</span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ErrorBox({ children, testId = "bn-error" }: { children: ReactNode; testId?: string }) {
  return (
    <p role="alert" className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] text-loss" data-testid={testId}>
      {children}
    </p>
  );
}

/** Progress of the first import, from the exchange store's background job (polled there every 3 s). */
function ImportProgress({ connectionId }: { connectionId: string }) {
  const job = useExchange((s) => s.backfill);
  const outcome = useExchange((s) => s.outcome);
  if (!job || job.connectionId !== connectionId) return null;
  const found = job.run?.fetched ?? 0;
  return (
    <div className="cx-panel grid gap-2 p-3" data-testid="bn-progress" aria-live="polite">
      {!job.done ? (
        <>
          <span className="text-[13px] font-medium">{BN.importRunning}</span>
          <span aria-hidden="true" className="relative block h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <span className="absolute inset-y-0 left-0 w-1/3 animate-[cx-slide_1.4s_ease-in-out_infinite] rounded-full bg-fg motion-reduce:animate-none" />
          </span>
          <span className="text-[12px] text-mute">{found > 0 ? BN.importFound(found) : "Binance wird gelesen …"}</span>
        </>
      ) : job.run?.status === "error" ? (
        <ErrorBox testId="bn-import-error">{job.run.error ?? "Der Import ist fehlgeschlagen."}</ErrorBox>
      ) : (
        <span className="text-[13px] font-medium text-win" data-testid="bn-import-done">
          {BN.importDone(outcome?.counts.inserted ?? job.run?.inserted ?? 0)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ connected */

function Manage({ conn, id, onClose }: { conn: ExchangeConnection; id: ServiceId; onClose: () => void }) {
  const busy = useExchange((s) => s.busy);
  const actionError = useExchange((s) => s.actionError);
  const [asking, setAsking] = useState(false);
  const [range, setRange] = useState<"30" | "90">("90");
  const invalid = conn.status === "invalid";
  const tags = [
    conn.permissions.includes("read") ? BN.rightRead : null,
    conn.permissions.length ? BN.rightNoTrade : null,
    conn.permissions.includes("futures_enabled") ? BN.rightFutures : null,
    conn.permissions.includes("ip_restricted") ? BN.rightIp : null,
  ].filter((t): t is string => !!t);
  return (
    <div className="grid gap-4" data-testid="bn-manage">
      <StaggerItem className="cx-panel grid gap-1 p-3">
        <span className="text-[13px] font-medium">
          {invalid ? "Der Key wird nicht mehr akzeptiert" : "Verbunden"} · …{conn.keyLast4}
        </span>
        <span className="text-[12px] text-mute">{BN.connectedSince(new Date(conn.createdAt).toLocaleDateString("de-DE"))}</span>
        {conn.lastError && <span className="text-[12px] text-loss">{conn.lastError}</span>}
        {tags.length > 0 && (
          <ul className="mt-1 grid gap-0.5 text-[12px] text-mute" aria-label={BN.rightsTitle}>
            {tags.map((t) => (
              <li key={t} className="flex gap-1.5">
                <Tick />
                {t}
              </li>
            ))}
          </ul>
        )}
      </StaggerItem>
      {actionError && <ErrorBox testId="bn-action-error">{actionError.message}</ErrorBox>}
      {!invalid && (
        <StaggerItem className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" fx={false} loading={busy === "sync"} disabled={!!busy} onClick={() => void syncNow(conn.id)} data-testid="bn-sync">
            {BN.syncNow}
          </Button>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => {
              onClose();
              void runDryRun(conn.id);
            }}
          >
            {BN.dryRun}
          </Button>
        </StaggerItem>
      )}
      {!invalid && (
        <StaggerItem className="grid gap-2">
          <span className="label">{BN.reimport}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented aria-label={BN.importTitle} value={range} onChange={setRange} options={BN.importRanges} />
            <Button size="sm" disabled={!!busy} onClick={() => void startFirstImport(conn.id, Number(range))} data-testid="bn-reimport">
              {BN.importStart}
            </Button>
          </div>
        </StaggerItem>
      )}
      <ImportProgress connectionId={conn.id} />
      <p className="text-[12px] leading-relaxed text-mute">{BN.incremental}</p>
      <p className="text-[11.5px] leading-relaxed text-faint">{BN.limits}</p>
      <StaggerItem className="border-t border-line pt-3">
        {!asking ? (
          <Button size="sm" variant="danger" onClick={() => setAsking(true)} data-testid="bn-disconnect">
            {BN.disconnect}
          </Button>
        ) : (
          <div className="grid gap-2" role="group" aria-label={BN.disconnect}>
            <p className="text-[12.5px] text-mute">{BN.disconnectAsk}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" loading={busy === "disconnect"} onClick={() => void disconnectAccount(conn.id).then((ok) => ok && setAsking(false))} data-testid="bn-disconnect-yes">
                {BN.disconnectYes}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                {BN.disconnectNo}
              </Button>
            </div>
          </div>
        )}
      </StaggerItem>
      <span className="sr-only">{id}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

interface Creds {
  apiKey: string;
  secret: string;
}

function Setup({ id, market, onClose }: { id: ServiceId; market: Market; onClose: () => void }) {
  const reduced = useReducedFx();
  const egress = useExchange((s) => s.status?.binance?.egressIp ?? null);
  const [w, dispatch] = useReducer(wizardReducer, 3, wizardStart);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState<JournalAccount>("scalp");
  const [symbols, setSymbols] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [result, setResult] = useState<{ connection: ExchangeConnection; available: number } | null>(null);
  const [range, setRange] = useState<"30" | "90">("90");
  const creds = useRef<Creds | null>(null);
  const okRef = useRef<HTMLSpanElement>(null);

  const close = (): void => {
    creds.current = null; // a typed secret never outlives the dialog
    setApiKey("");
    setSecret("");
    onClose();
  };

  async function send(acceptWarnings: boolean): Promise<void> {
    const c = creds.current;
    if (!c) return;
    try {
      const out = await connectExchange({
        exchange: "binance",
        market,
        apiKey: c.apiKey,
        secret: c.secret,
        label: label.trim() || undefined,
        journalAccount: account,
        readOnlyConfirmed: true,
        symbols: market === "spot" ? symbols.split(/[\s,;]+/).filter(Boolean) : undefined,
        acceptWarnings: acceptWarnings || undefined,
      });
      creds.current = null;
      setResult({ connection: out.connection, available: out.account.available });
      dispatch({ type: "ok" });
      void loadExchangeStatus();
      requestAnimationFrame(() => okRef.current && celebrateFrom(okRef.current, { kind: "streak", tone: "win" }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "rights_confirm") {
        const found = issuesOf(e.details);
        setIssues(found);
        dispatch({ type: "ask", warnings: found.filter((i) => i.level === "warn").map((i) => i.text) });
        return;
      }
      if (e instanceof ApiError && e.code === "rights_refused") setIssues(issuesOf(e.details));
      else setIssues([]);
      // the key stays in memory only so that a typo can be fixed; nothing was stored by the server
      dispatch({ type: "fail", message: e instanceof ApiError ? e.message : "Das hat nicht geklappt. Bitte erneut versuchen." });
      if (e instanceof ApiError && e.code === "rights_refused") creds.current = null;
    }
  }

  function submit(): void {
    if (apiKey.trim().length < 8 || secret.trim().length < 8) {
      setFormError(BN.required);
      setShake(Date.now());
      return;
    }
    if (!readOnly) {
      setFormError(BN.confirmRequired);
      setShake(Date.now());
      return;
    }
    setFormError(null);
    creds.current = { apiKey: apiKey.trim(), secret: secret.trim() };
    // out of the form's state AND its DOM before the step changes: committed once more without them (flushSync), so the
    // exiting form's frozen copy holds no key either
    flushSync(() => {
      setSecret("");
      setApiKey("");
    });
    dispatch({ type: "submit" });
    void send(false);
  }

  const lead = market === "spot" ? BN.leadSpot : BN.leadFutures;
  const refused = w.phase === "failed" && issues.some((i) => i.level === "block");

  return (
    <div className="grid gap-5" data-testid="bn-setup" data-market={market} data-service={id}>
      <StaggerItem>
        <Steps step={w.step} labels={BN.steps} />
      </StaggerItem>

      <AnimatePresence mode="popLayout" initial={false}>
        {w.step === 0 && (
          <motion.div key="how" className="grid gap-3" initial={reduced ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }} exit={{ opacity: 0, x: -14, transition: tween.exit }} transition={{ x: spring.enter, opacity: tween.fade }}>
            <p className="text-[13px] leading-relaxed text-mute">{lead}</p>
            <h3 className="text-[14px] font-semibold">{BN.howTitle}</h3>
            <ol className="grid gap-2">
              {BN.how(market).map((s, i) => (
                <li key={s.t} className="cx-panel grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3">
                  <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg border border-line-2 font-mono text-[12px]">
                    {i + 1}
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-[13px] font-medium text-fg">{s.t}</span>
                    <span className="text-[12.5px] leading-snug text-mute">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="rounded-xl border border-warn/25 bg-warn/[0.05] px-3 py-2 text-[12px] leading-relaxed text-mute" data-testid="bn-ip-note">
              {egress ? BN.ipEgress(egress) : BN.ipNone}
            </p>
            <a href={BINANCE_API_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[12.5px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg">
              {BN.open}
            </a>
            <PartnerBox partner="binance" />
          </motion.div>
        )}

        {w.step === 1 && (
          <motion.form
            key="form"
            className="grid gap-4"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            initial={reduced ? false : { opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, x: -14, transition: tween.exit }}
            transition={{ x: spring.enter, opacity: tween.fade }}
          >
            <Field label={BN.keyLabel} htmlFor="bn-key" invalidKey={formError && apiKey.trim().length < 8 ? shake : null}>
              <Input id="bn-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" className="font-mono" invalid={!!formError && apiKey.trim().length < 8} />
            </Field>
            <Field label={BN.secretLabel} htmlFor="bn-secret" invalidKey={formError && secret.trim().length < 8 ? shake : null}>
              <Input id="bn-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="new-password" className="font-mono" invalid={!!formError && secret.trim().length < 8} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={BN.label} htmlFor="bn-label">
                <Input id="bn-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={BN.labelPh} />
              </Field>
              <div className="grid content-start gap-1.5">
                <span id="bn-account" className="label">
                  {BN.account}
                </span>
                <Segmented className="justify-self-start" aria-labelledby="bn-account" value={account} onChange={setAccount} options={ACCOUNTS} />
              </div>
            </div>
            {market === "spot" && (
              <Field label={BN.extraSymbols} htmlFor="bn-symbols" help={BN.extraSymbolsHelp}>
                <Input id="bn-symbols" value={symbols} onChange={(e) => setSymbols(e.target.value.toUpperCase())} spellCheck={false} placeholder="SOLUSDT, DOGEUSDT" className="font-mono" />
              </Field>
            )}
            <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-[13px]", readOnly ? "border-win/35 bg-win/[0.05]" : "border-line bg-ink-950/40")}>
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#3fb27f]" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} data-testid="bn-readonly" />
              <span className="text-fg">{BN.confirm}</span>
            </label>
            <p className="text-[11.5px] leading-relaxed text-faint">{BN.privacy}</p>
            {formError && <ErrorBox testId="bn-form-error">{formError}</ErrorBox>}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </motion.form>
        )}

        {w.step === 2 && (
          <motion.div key="check" className="grid gap-4" initial={reduced ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }} exit={{ opacity: 0, transition: tween.exit }} transition={{ scale: spring.enter, opacity: tween.fade }}>
            {w.phase === "checking" && (
              <div className="cx-panel grid place-items-center gap-3 px-4 py-8 text-center" aria-busy="true" data-testid="bn-checking">
                <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-line-2 border-t-fg motion-reduce:animate-none" />
                <span className="text-[13px] text-mute">{BN.checking}</span>
              </div>
            )}

            {w.phase === "confirm" && (
              <div className="grid gap-3" data-testid="bn-confirm">
                <h3 className="text-[14px] font-semibold">{BN.warnTitle}</h3>
                <ul className="grid gap-2">
                  {issues
                    .filter((i) => i.level !== "info")
                    .map((i) => (
                      <li key={i.code} className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-fg">
                        {i.text}
                      </li>
                    ))}
                </ul>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-[13px]">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#3fb27f]" checked={w.accepted} onChange={() => dispatch({ type: "accept" })} data-testid="bn-accept" />
                  <span>{BN.warnAccept}</span>
                </label>
              </div>
            )}

            {w.phase === "failed" && (
              <div className="grid gap-3" data-testid={refused ? "bn-refused" : "bn-failed"}>
                {refused ? (
                  <>
                    <h3 className="text-[14px] font-semibold text-loss">{BN.refusedTitle}</h3>
                    <p className="text-[12.5px] text-mute">{BN.refusedLead}</p>
                    <ul className="grid gap-2">
                      {issues
                        .filter((i) => i.level === "block")
                        .map((i) => (
                          <li key={i.code} className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] leading-relaxed text-fg">
                            {i.text}
                          </li>
                        ))}
                    </ul>
                    <p className="text-[12.5px] text-mute">{BN.refusedNext}</p>
                  </>
                ) : (
                  <ErrorBox>{w.error}</ErrorBox>
                )}
              </div>
            )}

            {w.phase === "done" && result && (
              <div className="grid gap-4" data-testid="bn-done">
                <div className="cx-panel grid place-items-center gap-2 px-4 py-6 text-center">
                  <span ref={okRef} className="grid size-12 place-items-center rounded-full border border-win/40 bg-win/10 text-win">
                    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <motion.path d="M5 12.5 10 17 19 7" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tween.check} />
                    </svg>
                  </span>
                  <span className="text-[17px] font-semibold">{BN.ok}</span>
                  <span className="flex items-baseline gap-2 text-mute">
                    <RollingDigits value={Math.round(result.available)} className="dot-num text-[26px] leading-none text-fg" aria-label={`${Math.round(result.available)} USDT`} />
                    <span className="text-[12.5px]">USDT verfügbar</span>
                  </span>
                </div>
                <ul className="grid gap-0.5 text-[12px] text-mute" aria-label={BN.rightsTitle}>
                  <li className="flex gap-1.5">
                    <Tick />
                    {BN.rightRead}
                  </li>
                  <li className="flex gap-1.5">
                    <Tick />
                    {BN.rightNoTrade}
                  </li>
                  {result.connection.permissions.includes("futures_enabled") && (
                    <li className="flex gap-1.5">
                      <Tick ok={false} />
                      {BN.rightFutures}
                    </li>
                  )}
                </ul>
                <div className="grid gap-2">
                  <span className="label">{BN.importTitle}</span>
                  <p className="text-[12.5px] text-mute">{BN.importLead}</p>
                  <Segmented className="justify-self-start" aria-label={BN.importTitle} value={range} onChange={setRange} options={BN.importRanges} />
                </div>
                <ImportProgress connectionId={result.connection.id} />
                <p className="text-[11.5px] leading-relaxed text-faint">{BN.limits}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="bn-footer">
        {w.step === 0 && (
          <>
            <span className="flex-1" />
            <Button variant="ghost" onClick={close}>
              Abbrechen
            </Button>
            <Button variant="primary" fx={false} onClick={() => dispatch({ type: "next" })} data-testid="bn-next">
              {BN.next}
            </Button>
          </>
        )}
        {w.step === 1 && (
          <>
            <Button onClick={() => dispatch({ type: "back" })}>{BN.back}</Button>
            <span className="flex-1" />
            <Button variant="primary" fx={false} onClick={submit} data-testid="bn-submit">
              Key prüfen
            </Button>
          </>
        )}
        {w.step === 2 && w.phase === "confirm" && (
          <>
            <Button onClick={() => dispatch({ type: "back" })}>{BN.back}</Button>
            <span className="flex-1" />
            <Button
              variant="primary"
              fx={false}
              disabled={!canResubmit(w)}
              onClick={() => {
                dispatch({ type: "submit" });
                void send(true);
              }}
              data-testid="bn-confirm-go"
            >
              {BN.warnGo}
            </Button>
          </>
        )}
        {w.step === 2 && w.phase === "failed" && (
          <>
            <Button
              onClick={() => {
                // a typo can be fixed: the key and secret come back from memory (a refused key was dropped, nothing stored)
                if (creds.current) {
                  setApiKey(creds.current.apiKey);
                  setSecret(creds.current.secret);
                  creds.current = null;
                }
                dispatch({ type: "back" });
              }}
            >
              {BN.back}
            </Button>
            <span className="flex-1" />
          </>
        )}
        {w.step === 2 && w.phase === "done" && result && (
          <>
            <Button onClick={close}>{BN.importLater}</Button>
            <span className="flex-1" />
            <Button
              onClick={() => {
                close();
                void runDryRun(result.connection.id);
              }}
            >
              {BN.importDry}
            </Button>
            <Button variant="primary" fx={false} onClick={() => void startFirstImport(result.connection.id, Number(range))} data-testid="bn-import">
              {BN.importStart}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Binance dialog body: the connected view when this market is connected when the dialog opens, otherwise the guided
 * setup – which stays on screen after the connection exists (the success view, the first import). The host remounts it
 * per opening (`key`).
 */
export function BinanceWizard({ id, onClose }: { id: ServiceId; onClose: () => void }) {
  const market = binanceMarketOf(id) ?? "futures";
  const status = useExchange((s) => s.status);
  const conn = connectionOf(status, id);
  const [setupFirst] = useState(!conn);
  if (conn && !setupFirst) return <Manage conn={conn} id={id} onClose={onClose} />;
  return <Setup id={id} market={market} onClose={onClose} />;
}
