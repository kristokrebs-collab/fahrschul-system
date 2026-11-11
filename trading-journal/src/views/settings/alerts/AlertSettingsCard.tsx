/**
 * Einstellungen › Alarme (C2): the four alarms – Grün-Vorwarnung, Grün-Bestätigung, Rot-Vorwarnung, Rot-Bestätigung – per channel (Browser, E-Mail,
 * Telefon), with the sources they watch, thresholds, quiet hours, a test button per channel and the Zustellprotokoll. Its own lazy chunk (the
 * settings page folds it); everything the server decides (plan limits, what is set up, the phone) arrives with `/api/v1/alerts/prefs`.
 *
 * Honest by construction: nothing is on until the person switches it on; a channel the plan does not have says what to do next; a channel the server
 * is not set up for says "Einrichtung nötig"; the phone only ever calls a number the person confirmed; an alert points to a rule they set, it is no advice.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { ALERT_CHANNEL_LABEL, ALERT_CHANNELS, channelOn, channelsOn, COOLDOWN_MIN, MARKETS_MAX, PARAM_RANGE, SYMBOL_RE, type AlertChannel, type AlertPrefs } from "@/domain/alerts/config";
import { ALERT_EVENT_HELP, ALERT_EVENT_LABEL, ALERT_EVENTS, type AlertEvent, type AlertSourceKind, type SourceParams } from "@/domain/alerts/types";
import { INDUSTRY_NAMES } from "@/domain/industryTrend/config";
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Skeleton } from "@/primitives/Skeleton";
import { hasClaudeRuntime } from "@/store/capability";
import { navigate } from "@/store/router";
import { pushToast } from "@/store/uiStore";
import { SwitchRow } from "@/views/schluesselmarken/SwitchRow";
import { AlertConnectSlot } from "./AlertConnectSlot";
import { fetchPrefs, phoneTest, savePrefs, sendEmailTest } from "./api";
import { setBrowserAlertsOn } from "./browserFlag";
import { notifyBrowser } from "./AlertFeedHost";
import { channelGate, channelLimitHit, channelLimitText, GATE_TEXT, prefsEqual, withEvent, type ChannelGate, type PrefsView } from "./model";
import { PhoneSetup } from "./PhoneSetup";
import { Protocol } from "./Protocol";

export const ALERTS_STRINGS = {
  title: "Alarme",
  note: "Vier Ereignisse, drei Kanäle. Nichts ist an, bis du es einschaltest. Ein Alarm weist auf eine Regel hin, die du selbst eingestellt hast – keine Beratung, keine Order.",
  needAccount: "Die vier Alarme laufen auf dem Server und brauchen ein Konto in der Cloud-Version.",
  signIn: "Anmelden",
  save: "Speichern",
  saved: "Alarme gespeichert",
  unsaved: "Ungespeicherte Änderungen",
  discard: "Verwerfen",
} as const;

const SOURCES: readonly { kind: AlertSourceKind; label: string; help: string }[] = [
  { kind: "industry", label: "Branchen-Trend", help: "Die Regel des Branchen-Trends für Branchen, die du wählst. Die Datenquelle (Ken French) hinkt ein bis zwei Monate hinterher: der Alarm gilt dem Stand dieses Tages, nicht dem Live-Kurs." },
  { kind: "whale", label: "Top-Trader-Umschlag", help: "Der Long-Anteil der Binance-Top-Trader (nach Positionen) über oder unter 50 %. Das sind Binance-Gruppen, keine Wale und keine Vorhersage. Alle 5 Minuten." },
  { kind: "keylevel", label: "Schlüsselmarken", help: "Deine eigenen Schlüsselmarken mit eingeschaltetem Alarm (Markt-Seite). Die Sammelmail der Markt-Seite läuft getrennt weiter – nimm nur einen der beiden Wege, sonst kommt es doppelt." },
];

const COOLDOWNS: readonly { v: number; label: string }[] = [
  { v: 30, label: "30 Minuten" },
  { v: 60, label: "1 Stunde" },
  { v: 180, label: "3 Stunden" },
  { v: 360, label: "6 Stunden" },
  { v: 720, label: "12 Stunden" },
  { v: 1440, label: "24 Stunden" },
];

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; view: PrefsView };

const errText = (e: unknown): string => (e instanceof ApiError ? e.message : "Der Server hat nicht geantwortet.");

/** A number field that keeps what is typed and commits a valid number (comma or point) on every change. */
function NumField({ id, label, help, value, onCommit, step, min, max, suffix }: { id: string; label: string; help?: string; value: number; onCommit: (v: number) => void; step: number; min: number; max: number; suffix: string }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  return (
    <Field label={label} htmlFor={id} help={help ?? `${String(min).replace(".", ",")} bis ${String(max).replace(".", ",")}, in Schritten von ${String(step).replace(".", ",")}`} suffix={suffix}>
      <Input
        id={id}
        numeric
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => setText(String(value).replace(".", ","))}
      />
    </Field>
  );
}

function ParamFields({ kind, params, onChange }: { kind: "industry" | "whale"; params: SourceParams; onChange: (p: SourceParams) => void }) {
  const r = PARAM_RANGE[kind];
  const unit = kind === "industry" ? "%" : "Pkt";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <NumField id={`p-${kind}-warn`} label="Vorwarnung ab Abstand" value={params.warn} onCommit={(v) => onChange({ ...params, warn: v })} {...r.warn} suffix={unit} help={kind === "industry" ? "Abstand zur Grenze, ab dem die Vorwarnung kommt" : "Abstand zur bestätigenden Linie"} />
      {kind === "whale" && <NumField id={`p-${kind}-confirm`} label="Bestätigung ab Abstand zu 50 %" value={params.confirm} onCommit={(v) => onChange({ ...params, confirm: v })} {...r.confirm} suffix={unit} help="Wie weit über oder unter 50 % der Long-Anteil liegen muss" />}
      <NumField id={`p-${kind}-hyst`} label="Hysterese" value={params.hyst} onCommit={(v) => onChange({ ...params, hyst: v })} {...r.hyst} suffix={unit} help="Eine Vorwarnung endet erst darüber – kein Flackern an der Linie" />
    </div>
  );
}

function IndustryPicker({ picked, onChange }: { picked: string[]; onChange: (m: string[]) => void }) {
  const max = MARKETS_MAX.industry;
  return (
    <details className="rounded-xl border border-line bg-ink-950/40" data-testid="industry-picker">
      <summary className="touch-hit flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px] text-fg">
        <span>Branchen wählen</span>
        <span className="text-[12px] text-mute">
          {picked.length} von {max}
        </span>
      </summary>
      <ul className="grid gap-x-3 px-2 pb-2 sm:grid-cols-2">
        {Object.entries(INDUSTRY_NAMES).map(([code, name]) => {
          const on = picked.includes(code);
          const full = !on && picked.length >= max;
          return (
            <li key={code}>
              <label className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-[13px] text-fg hover:bg-white/[0.04]", full && "cursor-not-allowed opacity-50")}>
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-signal)]" checked={on} disabled={full} onChange={() => onChange(on ? picked.filter((c) => c !== code) : [...picked, code])} />
                {name}
              </label>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function SymbolPicker({ picked, onChange }: { picked: string[]; onChange: (m: string[]) => void }) {
  const [text, setText] = useState("");
  const max = MARKETS_MAX.whale;
  const sym = text.trim().toUpperCase();
  const valid = SYMBOL_RE.test(sym) && !picked.includes(sym) && picked.length < max;
  const add = (): void => {
    if (!valid) return;
    onChange([...picked, sym]);
    setText("");
  };
  return (
    <div className="grid gap-2" data-testid="symbol-picker">
      <ul className="flex flex-wrap gap-2">
        {picked.map((s) => (
          <li key={s}>
            <button type="button" className="touch-hit inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white/[0.05] px-2.5 text-[12px] text-fg hover:bg-white/[0.09]" aria-label={`${s} entfernen`} onClick={() => onChange(picked.filter((x) => x !== s))}>
              {s}
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <Field label="Symbol hinzufügen" htmlFor="symbol-add" help={`Binance-Futures-Symbol, zum Beispiel ETHUSDT (höchstens ${max})`} className="min-w-0 flex-1">
          <Input
            id="symbol-add"
            value={text}
            autoCapitalize="characters"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Button size="sm" variant="secondary" disabled={!valid} onClick={add}>
          Hinzufügen
        </Button>
      </div>
    </div>
  );
}

function GateNote({ gate }: { gate: ChannelGate }) {
  if (gate.state === "ok") return null;
  return (
    <p className={cn("text-[12px]", gate.state === "locked" ? "text-fg" : "text-warn")} data-gate={gate.state}>
      {gate.message}
      {gate.state === "locked" && (
        <>
          {" "}
          <button type="button" className="touch-hit underline underline-offset-2 hover:text-signal" onClick={() => navigate(gate.next.page)}>
            {gate.next.label}
          </button>
        </>
      )}
    </p>
  );
}

function AlertsBody({ view, onViewChange, reload }: { view: PrefsView; onViewChange: (v: PrefsView) => void; reload: () => void }) {
  const [draft, setDraft] = useState<AlertPrefs>(view.prefs);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState<AlertChannel | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [protocolKey, setProtocolKey] = useState(0);
  const [phoneOpen, setPhoneOpen] = useState(view.phone.status === "pending");
  const [codeSent, setCodeSent] = useState(false);

  const dirty = !prefsEqual(draft, view.prefs);
  const gates = useMemo(() => Object.fromEntries(ALERT_CHANNELS.map((c) => [c, channelGate(c, view)])) as Record<AlertChannel, ChannelGate>, [view]);
  const used = channelsOn(draft).length;

  const toggle = (c: AlertChannel, e: AlertEvent, on: boolean): void => {
    setLimitMsg(null);
    if (on && channelLimitHit(draft, c, view.limits.alertChannels)) {
      setLimitMsg(channelLimitText(view.limits.alertChannels));
      return;
    }
    setDraft((d) => withEvent(d, c, e, on));
  };

  const setSource = (k: AlertSourceKind, patch: Partial<AlertPrefs["sources"][AlertSourceKind]>): void => setDraft((d) => ({ ...d, sources: { ...d.sources, [k]: { ...d.sources[k], ...patch } } }));

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const next = await savePrefs(draft);
      setBrowserAlertsOn(channelOn(next.prefs, "browser"));
      onViewChange(next);
      setDraft(next.prefs);
      pushToast({ kind: "success", title: ALERTS_STRINGS.saved });
    } catch (e) {
      setSaveError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  async function test(c: AlertChannel): Promise<void> {
    setTesting(c);
    setTestResult(null);
    try {
      if (c === "browser") {
        if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission().catch(() => "default");
        notifyBrowser({ event: "green_warn", market: "Test", detail: "Das ist ein Testalarm" });
        setTestResult(typeof Notification !== "undefined" && Notification.permission === "denied" ? `Als Hinweis in der App gezeigt. ${GATE_TEXT.browserDenied}` : "Der Testalarm wurde gezeigt.");
      } else if (c === "email") {
        await sendEmailTest();
        setTestResult("Die Testmail ist unterwegs. Sieh in deinem Postfach nach.");
      } else {
        const r = await phoneTest();
        setTestResult(r.status === "skipped" || r.status === "failed" ? `Kein Anruf: ${r.reasonText ?? "nicht möglich"}.` : "Der Testanruf ist unterwegs. Der Status steht gleich im Zustellprotokoll.");
      }
      setProtocolKey((n) => n + 1);
    } catch (e) {
      setTestResult(errText(e));
    } finally {
      setTesting(null);
    }
  }

  const phone = view.phone;
  const slotState = gates.phone.state === "ok" ? "connected" : gates.phone.state === "connect" ? (phone.status === "pending" || codeSent ? "pending" : "missing") : "unavailable";
  const emailSlotState = gates.email.state === "ok" ? "connected" : gates.email.state === "connect" ? "missing" : "unavailable";

  return (
    <div className="grid gap-6" data-testid="alerts-body">
      <section aria-labelledby="alert-sources-h" className="grid gap-3">
        <h3 id="alert-sources-h" className="label !text-fg">
          Was beobachtet wird
        </h3>
        {SOURCES.map((s) => (
          <div key={s.kind} className="grid gap-3" data-source={s.kind}>
            <SwitchRow id={`src-${s.kind}`} label={s.label} help={s.help} checked={draft.sources[s.kind].on} onChange={(v) => setSource(s.kind, { on: v })} />
            {draft.sources[s.kind].on && s.kind === "industry" && (
              <div className="grid gap-3 pl-1">
                <IndustryPicker picked={draft.sources.industry.markets} onChange={(m) => setSource("industry", { markets: m })} />
                {draft.sources.industry.markets.length === 0 && <p className="text-[12px] text-warn">Wähle mindestens eine Branche, sonst gibt es nichts zu beobachten.</p>}
                <ParamFields kind="industry" params={draft.sources.industry.params} onChange={(p) => setSource("industry", { params: p })} />
              </div>
            )}
            {draft.sources[s.kind].on && s.kind === "whale" && (
              <div className="grid gap-3 pl-1">
                <SymbolPicker picked={draft.sources.whale.markets} onChange={(m) => setSource("whale", { markets: m })} />
                <ParamFields kind="whale" params={draft.sources.whale.params} onChange={(p) => setSource("whale", { params: p })} />
              </div>
            )}
          </div>
        ))}
      </section>

      <section aria-labelledby="alert-matrix-h" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="alert-matrix-h" className="label !text-fg">
            Wohin welcher Alarm geht
          </h3>
          <span className="text-[12px] text-mute" data-testid="channel-count">
            {used} von {view.limits.alertChannels} Kanälen in deinem Tarif
          </span>
        </div>
        <div role="group" aria-labelledby="alert-matrix-h" className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center gap-x-1 gap-y-1 rounded-xl border border-line bg-ink-950/40 p-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,5rem)]" data-testid="alert-matrix">
          <span />
          {ALERT_CHANNELS.map((c) => (
            <span key={c} className="text-center text-[11px] text-mute">
              {ALERT_CHANNEL_LABEL[c]}
            </span>
          ))}
          {ALERT_EVENTS.map((e) => (
            <div key={e} className="contents">
              <span className="grid min-h-11 min-w-0 content-center gap-0.5 py-1 pr-2">
                <span className="text-[13px] text-fg">{ALERT_EVENT_LABEL.de[e]}</span>
                <span className="hidden text-[11px] text-faint sm:block">{ALERT_EVENT_HELP[e]}</span>
              </span>
              {ALERT_CHANNELS.map((c) => {
                const locked = gates[c].state === "locked" || gates[c].state === "setup";
                return (
                  <span key={c} className="flex h-11 items-center justify-center">
                    <Switch
                      size="sm"
                      checked={draft.channels[c][e]}
                      disabled={locked}
                      onCheckedChange={(v) => toggle(c, e, v)}
                      aria-label={`${ALERT_EVENT_LABEL.de[e]} per ${ALERT_CHANNEL_LABEL[c]}`}
                      data-testid={`ev-${c}-${e}`}
                      className="touch-hit"
                    />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        {limitMsg && (
          <p className="text-[12px] text-warn" role="status" data-testid="limit-note">
            {limitMsg}{" "}
            <button type="button" className="touch-hit underline underline-offset-2 hover:text-signal" onClick={() => navigate("preise")}>
              Tarife ansehen
            </button>
          </p>
        )}
        <div className="grid gap-1" data-testid="gate-notes">
          {ALERT_CHANNELS.map((c) => (gates[c].state === "ok" ? null : <GateNote key={c} gate={gates[c]} />))}
        </div>
      </section>

      <section aria-labelledby="alert-connect-h" className="grid gap-3">
        <h3 id="alert-connect-h" className="label !text-fg">
          Verbindungen
        </h3>
        <AlertConnectSlot
          channel="email"
          state={emailSlotState}
          title="E-Mail"
          detail={gates.email.state === "ok" ? "Die bestätigte Adresse deines Kontos." : gates.email.state === "locked" ? "" : (gates.email as { message: string }).message}
        />
        <AlertConnectSlot
          channel="phone"
          state={slotState}
          title="Telefon"
          detail={gates.phone.state === "ok" ? `Bestätigte Nummer ${phone.masked ?? ""}`.trim() : (gates.phone as { message: string }).message}
          actionLabel={gates.phone.state === "connect" && !phoneOpen ? (phone.status === "pending" ? "Code eingeben" : "Nummer bestätigen") : undefined}
          onAction={() => setPhoneOpen(true)}
        >
          {gates.phone.state === "ok" || (gates.phone.state === "connect" && (phoneOpen || phone.status === "pending")) ? <PhoneSetup status={phone.status} masked={phone.masked} onChanged={reload} onStarted={() => setCodeSent(true)} /> : null}
        </AlertConnectSlot>
      </section>

      <section aria-labelledby="alert-quiet-h" className="grid gap-3">
        <h3 id="alert-quiet-h" className="label !text-fg">
          Ruhezeit und Wiederholung
        </h3>
        <SwitchRow id="quiet-on" label="Ruhezeit" help="Nachts kein Anruf und keine Anzeige; E-Mails kommen erst, wenn die Ruhezeit endet. Gerechnet in deiner Zeitzone." checked={draft.quiet.on} onChange={(v) => setDraft((d) => ({ ...d, quiet: { ...d.quiet, on: v } }))} />
        {draft.quiet.on && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ruhezeit von" htmlFor="quiet-from" help={`Zeitzone: ${view.tz}`}>
              <Input id="quiet-from" type="time" value={draft.quiet.from} onChange={(e) => e.target.value && setDraft((d) => ({ ...d, quiet: { ...d.quiet, from: e.target.value } }))} />
            </Field>
            <Field label="Ruhezeit bis" htmlFor="quiet-to">
              <Input id="quiet-to" type="time" value={draft.quiet.to} onChange={(e) => e.target.value && setDraft((d) => ({ ...d, quiet: { ...d.quiet, to: e.target.value } }))} />
            </Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Wiederholungssperre" htmlFor="cooldown" help={`Dasselbe Ereignis desselben Marktes kommt nicht noch einmal innerhalb dieser Zeit (${COOLDOWN_MIN.min} Minuten bis 24 Stunden).`}>
            <select id="cooldown" className="touch-hit min-h-11 w-full rounded-xl border border-line bg-ink-950/60 px-3 text-[13px] text-fg" value={COOLDOWNS.some((c) => c.v === draft.cooldownMin) ? draft.cooldownMin : COOLDOWN_MIN.def} onChange={(e) => setDraft((d) => ({ ...d, cooldownMin: Number(e.target.value) }))}>
              {COOLDOWNS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sprache von Anruf und Mail" htmlFor="alert-lang">
            <select id="alert-lang" className="touch-hit min-h-11 w-full rounded-xl border border-line bg-ink-950/60 px-3 text-[13px] text-fg" value={draft.lang} onChange={(e) => setDraft((d) => ({ ...d, lang: e.target.value === "en" ? "en" : "de" }))}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="grid gap-2" data-testid="alert-save-row">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-4">
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {ALERTS_STRINGS.save}
          </Button>
          {dirty && (
            <>
              <span className="text-[12px] text-mute">{ALERTS_STRINGS.unsaved}</span>
              <Button variant="ghost" size="sm" onClick={() => setDraft(view.prefs)}>
                {ALERTS_STRINGS.discard}
              </Button>
            </>
          )}
        </div>
        {saveError && (
          <p className="text-[12px] text-loss" role="alert" data-testid="alert-save-error">
            {saveError}{" "}
            {/Tarif|Kanal|Premium/.test(saveError) && (
              <button type="button" className="touch-hit underline underline-offset-2" onClick={() => navigate("preise")}>
                Tarife ansehen
              </button>
            )}
          </p>
        )}
      </div>

      <section aria-labelledby="alert-test-h" className="grid gap-3">
        <h3 id="alert-test-h" className="label !text-fg">
          Testen
        </h3>
        <div className="flex flex-wrap gap-x-2 gap-y-4">
          {ALERT_CHANNELS.map((c) => {
            const g = gates[c];
            const ok = g.state === "ok";
            return (
              <Button key={c} size="sm" variant="secondary" disabled={!ok} loading={testing === c} onClick={() => void test(c)} title={g.state === "ok" ? undefined : g.message} data-testid={`test-${c}`}>
                {c === "browser" ? "Browser testen" : c === "email" ? "Testmail senden" : "Testanruf"}
              </Button>
            );
          })}
        </div>
        <p className="text-[11px] text-faint">Ein Test geht nur an dich, zählt aber bei Anrufen gegen dein Monatskontingent. Er wird im Zustellprotokoll aufgeführt.</p>
        {testResult && (
          <p className="text-[12px] text-fg" role="status" data-testid="test-result">
            {testResult}
          </p>
        )}
      </section>

      {view.lastRun && (
        <p className="text-[11px] text-faint" data-testid="alert-lastrun">
          Der Server hat zuletzt um {new Date(view.lastRun.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr nachgesehen{view.lastRun.ok ? "" : ` (Problem: ${view.lastRun.code ?? "unbekannt"})`}.
        </p>
      )}

      <Protocol active refreshKey={protocolKey} />
    </div>
  );
}

export default function AlertSettingsCard() {
  const cloud = cloudEnabled() && !hasClaudeRuntime();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const ready = cloud && signedIn && !needsMfa;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    fetchPrefs(ctrl.signal).then(
      (view) => !ctrl.signal.aborted && setLoad({ kind: "ok", view }),
      (e: unknown) => !ctrl.signal.aborted && setLoad({ kind: "error", message: errText(e) }),
    );
    return () => ctrl.abort();
  }, [ready, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const state = !cloud ? "no-cloud" : !signedIn ? "signed-out" : needsMfa ? "mfa" : load.kind;

  return (
    <Card title={ALERTS_STRINGS.title} note={ALERTS_STRINGS.note} data-testid="alerts-settings" data-state={state}>
      {state === "no-cloud" && <p className="text-[13px] text-mute">{ALERTS_STRINGS.needAccount}</p>}
      {state === "signed-out" && (
        <div className="grid gap-3">
          <p className="text-[13px] text-mute">{ALERTS_STRINGS.needAccount}</p>
          <div>
            <Button variant="secondary" onClick={() => openAuthSheet("signin", "card")}>
              {ALERTS_STRINGS.signIn}
            </Button>
          </div>
        </div>
      )}
      {state === "mfa" && <p className="text-[13px] text-mute">Bestätige zuerst mit deinem Authenticator-Code, dann erscheinen die Alarme.</p>}
      {state === "loading" && (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-40" />
          <span className="sr-only">Lade …</span>
        </div>
      )}
      {state === "error" && load.kind === "error" && (
        <div className="grid gap-3">
          <p className="text-[13px] text-warn" role="alert">
            {load.message}
          </p>
          <div>
            <Button size="sm" variant="secondary" onClick={() => (setLoad({ kind: "loading" }), reload())}>
              Noch einmal versuchen
            </Button>
          </div>
        </div>
      )}
      {state === "ok" && load.kind === "ok" && <AlertsBody key={`${load.view.phone.status}-${load.view.plan}`} view={load.view} onViewChange={(view) => setLoad({ kind: "ok", view })} reload={reload} />}
    </Card>
  );
}
