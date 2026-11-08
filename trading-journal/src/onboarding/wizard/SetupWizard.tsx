/**
 * The setup wizard (Paket B): four short steps in one glass sheet – Konto · Demo oder eigene Daten · Verbindung (optional) ·
 * erster Trade / erste Analyse. Progress is saved per step (`wizardStore`), "Später fortsetzen" closes it without losing the
 * place, "Überspringen" ends it for good, optional steps have their own "Später". Nothing here is a tour of the app: every
 * step is one decision or one action, and nothing is claimed that did not happen (no "verbunden" without a connection, no
 * demo data in the journal – the demo is the app's own marked sample session).
 *
 * Own chunk (lazy, mounted by `WizardHost` only when it opens). Reduced motion: steps swap without movement.
 */
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cloudEnabled } from "@/cloud";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi, type Page } from "@/store/uiStore";
import { chooseWizardData, finishWizard, goToWizardStep, pauseWizard, skipWizard, useWizard, WIZARD_COUNT, WIZARD_STEPS, type WizardData } from "./wizardStore";

export const WIZARD = {
  title: "Einrichtung",
  later: "Später fortsetzen",
  skip: "Überspringen",
  back: "Zurück",
  next: "Weiter",
  finish: "Fertig",
  rail: "Fortschritt der Einrichtung",
  konto: {
    title: "Dein Konto",
    signedIn: "Dein Konto ist angelegt. Dein Journal läuft ab jetzt auf allen Geräten, auf denen du dich anmeldest.",
    confirmed: "E-Mail bestätigt",
    unconfirmed: "E-Mail noch nicht bestätigt – schau in dein Postfach.",
    signedOut: "Mit einem Konto läuft dein Journal auf allen Geräten synchron. Ohne Konto bleibt alles in diesem Browser – das geht genauso.",
    create: "Konto erstellen oder anmelden",
    off: "In dieser Ausgabe gibt es kein Konto. Dein Journal bleibt auf diesem Gerät und ist vollständig nutzbar – sichere es regelmäßig unter Einstellungen → Daten.",
  },
  daten: {
    title: "Womit startest du?",
    lead: "Du kannst jederzeit wechseln. Beides kostet nichts.",
    demo: { title: "Demo ausprobieren", text: "Eine abgegrenzte Sitzung mit deutlich markierten Beispieldaten. Dein Journal bleibt unberührt." },
    own: { title: "Eigene Daten", text: "Du trägst Trades selbst ein oder importierst sie – per CSV oder, später, von deiner Börse." },
    group: "Startart",
    missing: "Wähle eine Startart – oder tippe auf „Überspringen“.",
  },
  verbindung: {
    title: "Verbindung optional – zunächst Demo ausprobieren",
    lead: "Börse oder TradingView lassen sich jederzeit später verbinden, nur lesend. Nichts hier ist nötig, damit das Journal funktioniert.",
    open: "Verbindungen ansehen",
    later: "Später verbinden",
    off: "Verbindungen brauchen das Cloud-Konto – in dieser Ausgabe gibt es keins. Per CSV-Import kommen deine Trades trotzdem ins Journal.",
  },
  start: {
    title: "Dein erster Schritt",
    lead: "Ein Trade reicht, damit Übersicht, Analyse und Berichte etwas zeigen.",
    trade: "Ersten Trade eintragen",
    demo: "Demo öffnen",
    analysis: "Analyse ansehen",
    hasTrades: "Dein Journal hat schon Trades – öffne die Analyse oder trag den nächsten ein.",
    demoNote: "Die Demo zeigt Beispieldaten, keine echten Ergebnisse.",
  },
} as const;

function StepHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="text-[19px] font-semibold leading-tight tracking-tight text-fg" data-testid="wizard-step-title">
        {title}
      </h3>
      {lead && <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-mute">{lead}</p>}
    </div>
  );
}

function StepKonto({ onClose }: { onClose: () => void }) {
  const user = useCloudSession((s) => s.user);
  const confirmed = useCloudSession((s) => s.emailConfirmed);
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const cloud = cloudEnabled();
  return (
    <div className="grid gap-4">
      <StepHead title={WIZARD.konto.title} lead={!cloud ? WIZARD.konto.off : signedIn ? WIZARD.konto.signedIn : WIZARD.konto.signedOut} />
      {cloud && signedIn && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-white/[0.02] px-4 py-3 text-[13.5px]" data-testid="wizard-account">
          <span className="min-w-0 truncate font-medium text-fg">{user?.email ?? "–"}</span>
          <span className={cn("text-[12px]", confirmed ? "text-win" : "text-mute")}>{confirmed ? WIZARD.konto.confirmed : WIZARD.konto.unconfirmed}</span>
        </div>
      )}
      {cloud && !signedIn && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              openAuthSheet("signup", "card");
            }}
            data-testid="wizard-signup"
          >
            {WIZARD.konto.create}
          </Button>
        </div>
      )}
    </div>
  );
}

function Choice({ value, current, title, text, onPick, testId }: { value: Exclude<WizardData, null>; current: WizardData; title: string; text: string; onPick: (v: Exclude<WizardData, null>) => void; testId: string }) {
  const on = current === value;
  return (
    <label
      className={cn(
        "grid cursor-pointer gap-1 rounded-2xl border px-4 py-3 transition-colors focus-within:shadow-(--ring-glow-btn)",
        on ? "border-fg/50 bg-white/[0.06]" : "border-line bg-white/[0.02] hover:bg-white/[0.04]",
      )}
      data-testid={testId}
      data-on={on || undefined}
    >
      <span className="flex items-center gap-2.5">
        <input type="radio" name="wizard-data" value={value} checked={on} onChange={() => onPick(value)} className="size-4 accent-current" />
        <span className="text-[14px] font-semibold text-fg">{title}</span>
      </span>
      <span className="pl-[26px] text-[12.5px] leading-snug text-mute">{text}</span>
    </label>
  );
}

function StepDaten({ data, invalid }: { data: WizardData; invalid: boolean }) {
  return (
    <div className="grid gap-4">
      <StepHead title={WIZARD.daten.title} lead={WIZARD.daten.lead} />
      <div role="radiogroup" aria-label={WIZARD.daten.group} className="grid gap-2.5">
        <Choice value="demo" current={data} title={WIZARD.daten.demo.title} text={WIZARD.daten.demo.text} onPick={chooseWizardData} testId="wizard-choice-demo" />
        <Choice value="own" current={data} title={WIZARD.daten.own.title} text={WIZARD.daten.own.text} onPick={chooseWizardData} testId="wizard-choice-own" />
      </div>
      {invalid && (
        <p role="alert" className="text-[12.5px] text-loss">
          {WIZARD.daten.missing}
        </p>
      )}
    </div>
  );
}

function StepVerbindung({ onOpen }: { onOpen: () => void }) {
  const cloud = cloudEnabled();
  return (
    <div className="grid gap-4">
      <StepHead title={WIZARD.verbindung.title} lead={cloud ? WIZARD.verbindung.lead : WIZARD.verbindung.off} />
      {cloud && (
        <div>
          <Button variant="secondary" onClick={onOpen} data-testid="wizard-connections">
            {WIZARD.verbindung.open}
          </Button>
        </div>
      )}
    </div>
  );
}

function StepStart({ data, trades, onTrade, onDemo, onAnalysis }: { data: WizardData; trades: number; onTrade: () => void; onDemo: () => void; onAnalysis: () => void }) {
  const demo = data === "demo";
  return (
    <div className="grid gap-4">
      <StepHead title={WIZARD.start.title} lead={trades > 0 ? WIZARD.start.hasTrades : WIZARD.start.lead} />
      <div className="flex flex-wrap items-center gap-2.5">
        {demo ? (
          <Button variant="primary" onClick={onDemo} data-testid="wizard-open-demo">
            {WIZARD.start.demo}
          </Button>
        ) : (
          <Button variant="primary" onClick={onTrade} data-testid="wizard-first-trade">
            {WIZARD.start.trade}
          </Button>
        )}
        {demo ? (
          <Button onClick={onTrade}>{WIZARD.start.trade}</Button>
        ) : (
          <Button onClick={onAnalysis} data-testid="wizard-analysis">
            {WIZARD.start.analysis}
          </Button>
        )}
      </div>
      {demo && <p className="text-[12px] text-faint">{WIZARD.start.demoNote}</p>}
    </div>
  );
}

export function SetupWizard() {
  const open = useWizard((s) => s.open);
  const step = useWizard((s) => s.step);
  const data = useWizard((s) => s.data);
  const trades = useJournal((s) => s.trades.length);
  const reduced = useReducedFx();
  const [dir, setDir] = useState<1 | -1>(1);
  const [invalid, setInvalid] = useState(false);
  const id = WIZARD_STEPS[step] ?? WIZARD_STEPS[0];
  const last = step === WIZARD_COUNT - 1;

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setInvalid(false);
    goToWizardStep(n);
  };
  const next = () => {
    // the decision of step 2 is the one thing the wizard asks for; everything else can be passed
    if (id === "daten" && !data) return setInvalid(true);
    go(Math.min(WIZARD_COUNT - 1, step + 1));
  };
  // an action that leaves the wizard (another page, the editor, the demo): the place is kept, it does not reopen by itself
  const leaveTo = (run: () => void) => {
    pauseWizard();
    run();
  };
  const toPage = (p: Page) => leaveTo(() => navigate(p));
  // the last step's action IS the end of the wizard: it counts as done (the person took the first step)
  const endWith = (run: () => void) => {
    finishWizard();
    run();
  };

  return (
    <Sheet
      open={open}
      onClose={pauseWizard}
      title={WIZARD.title}
      size="md"
      dismissGuard={false}
      headerExtra={<DotMatrixText text={`${step + 1}:${WIZARD_COUNT}`} size={3} gap={1.5} tone="mute" label={`Schritt ${step + 1} von ${WIZARD_COUNT}`} />}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2.5">
          <span className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={pauseWizard} data-testid="wizard-later">
              {WIZARD.later}
            </Button>
            <Button variant="ghost" size="sm" onClick={skipWizard} data-testid="wizard-skip">
              {WIZARD.skip}
            </Button>
          </span>
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <Button variant="secondary" onClick={() => go(step - 1)} data-testid="wizard-back">
                {WIZARD.back}
              </Button>
            )}
            {id === "verbindung" && (
              <Button variant="secondary" onClick={() => go(step + 1)} data-testid="wizard-optional-later">
                {WIZARD.verbindung.later}
              </Button>
            )}
            {last ? (
              <Button variant="primary" onClick={finishWizard} data-testid="wizard-finish">
                {WIZARD.finish}
              </Button>
            ) : (
              <Button variant="primary" onClick={next} data-testid="wizard-next">
                {WIZARD.next}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid min-w-0 gap-6" data-testid="setup-wizard" data-step={id} data-data={data ?? undefined}>
        <ol aria-label={WIZARD.rail} className="grid grid-cols-4 gap-1.5" data-testid="wizard-rail">
          {WIZARD_STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} data-state={i < step ? "done" : i === step ? "now" : "next"} className="grid gap-1">
              <span aria-hidden="true" className={cn("h-1 rounded-full", i <= step ? "bg-fg" : "bg-white/[0.08]")} />
              <span className={cn("text-[11px]", i === step ? "text-fg" : "text-faint")}>{["Konto", "Daten", "Verbindung", "Start"][i]}</span>
            </li>
          ))}
        </ol>
        <div className="relative min-h-[220px] min-w-0">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 20 * dir }}
              animate={{ opacity: 1, x: 0, transition: { opacity: tween.fade, x: spring.enter } }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -14 * dir, transition: tween.exit }}
            >
              {id === "konto" && <StepKonto onClose={pauseWizard} />}
              {id === "daten" && <StepDaten data={data} invalid={invalid} />}
              {id === "verbindung" && <StepVerbindung onOpen={() => toPage("konto")} />}
              {id === "start" && (
                <StepStart
                  data={data}
                  trades={trades}
                  onTrade={() => endWith(() => useUi.getState().openEditor())}
                  onDemo={() => endWith(() => void import("@/views/demo/demoStore").then((m) => m.openDemo()))}
                  onAnalysis={() => endWith(() => navigate("analyse"))}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Sheet>
  );
}

export default SetupWizard;
