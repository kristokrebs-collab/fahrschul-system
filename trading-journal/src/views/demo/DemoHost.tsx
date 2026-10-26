/**
 * The interactive demo (F58): a sheet that walks through the app's core steps with clearly marked example data – Import, Regelentwurf,
 * Test, Demokonto, Alarm. One lazy chunk (`DeferredHosts` mounts it the first time `openDemo` ran), so nothing of it weighs on the
 * first load. Isolation: its own in-memory session (`session.ts`), emptied at every open and close; no journal, no settings, no
 * cloud, no storage – the only way out of the demo into the app is a button the trader presses (open the real CSV import, the lab,
 * the plan, the key levels) after the demo closed. The calculations are the app's own functions on invented, computed candles.
 */
import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { StaggerItem, Sheet } from "@/motion/Sheet";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { AlarmStep } from "./AlarmStep";
import { closeDemo, useDemo } from "./demoStore";
import { DemoCard } from "./DemoCard";
import { ImportStep } from "./ImportStep";
import { PaperStep } from "./PaperStep";
import { RulesStep } from "./RulesStep";
import { patch, resetSession, STEP_IDS, useSession, type StepId } from "./session";
import { DEMO, DONE } from "./strings";
import { TestStep } from "./TestStep";

const STEP_VIEW: Record<StepId, () => ReactNode> = {
  import: () => <ImportStep />,
  regeln: () => <RulesStep />,
  test: () => <TestStep />,
  konto: () => <PaperStep />,
  alarm: () => <AlarmStep />,
};

async function openFunction(id: string): Promise<void> {
  closeDemo();
  const { openFeature } = await import("@/app/featureOpen");
  openFeature(id);
}

function Done() {
  return (
    <DemoCard step="ende" title={DONE.title} lead={DONE.lead}>
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="demo-done-links">
        {DONE.links.map((l) => (
          <li key={l.id}>
            <Button size="sm" className="w-full justify-start whitespace-normal text-left" onClick={() => void openFunction(l.id)} data-testid={`demo-go-${l.id}`}>
              {l.label}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] font-medium text-fg">{DEMO.nothingSaved}</p>
    </DemoCard>
  );
}

function Stepper() {
  const step = useSession((s) => s.step);
  const at = STEP_IDS.indexOf(step);
  return (
    <nav aria-label={DEMO.stepsLabel} data-testid="demo-steps">
      <ol className="grid grid-cols-5 gap-1.5">
        {STEP_IDS.map((id, i) => (
          <li key={id} className="min-w-0">
            <button
              type="button"
              onClick={() => patch({ step: id })}
              aria-current={id === step ? "step" : undefined}
              data-testid={`demo-step-${id}`}
              className={cn(
                "grid min-h-12 w-full min-w-0 place-items-center content-center gap-0.5 rounded-xl border px-1 py-1.5 text-center outline-none transition-colors duration-200 pointer-coarse:min-h-11",
                id === step ? "border-white/60 bg-white/[0.08] text-fg" : i < at ? "border-line-2 text-fg hover:bg-white/[0.05]" : "border-line text-mute hover:bg-white/[0.04] hover:text-fg",
              )}
            >
              <span className="num font-mono text-[12px] font-semibold leading-none">{i + 1}</span>
              <span className="max-w-full truncate text-[10.5px] leading-tight">{DEMO.steps[id]}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Body() {
  const step = useSession((s) => s.step);
  const reduced = useReducedFx();
  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    top.current?.scrollIntoView?.({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [step, reduced]);
  // the session belongs to this opening: whatever happened in it is gone when the body goes away
  useEffect(() => () => resetSession(), []);
  return (
    <div className="grid min-w-0 gap-4" data-testid="demo-host" data-step={step}>
      <StaggerItem>
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute" data-testid="demo-lead">
          {DEMO.lead}
        </p>
      </StaggerItem>
      <StaggerItem>
        <div ref={top} className="scroll-mt-2">
          <Stepper />
        </div>
      </StaggerItem>
      <StaggerItem>
        <motion.div key={step} className="grid min-w-0 gap-4" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} transition={{ opacity: tween.fade, y: spring.enter }}>
          {STEP_VIEW[step]()}
          {step === "alarm" && <Done />}
        </motion.div>
      </StaggerItem>
    </div>
  );
}

function Footer() {
  const step = useSession((s) => s.step);
  const at = STEP_IDS.indexOf(step);
  const last = at === STEP_IDS.length - 1;
  return (
    <div className="flex items-center justify-between gap-3">
      <Button onClick={() => patch({ step: STEP_IDS[Math.max(0, at - 1)]! })} disabled={at === 0} data-testid="demo-back">
        {DEMO.back}
      </Button>
      <span className="num font-mono text-[12px] text-mute" data-testid="demo-progress">
        {DEMO.stepOf(at + 1, STEP_IDS.length)}
      </span>
      {last ? (
        <Button variant="primary" onClick={closeDemo} data-testid="demo-finish">
          {DEMO.finish}
        </Button>
      ) : (
        <Button variant="primary" onClick={() => patch({ step: STEP_IDS[at + 1]! })} data-testid="demo-next">
          {DEMO.next}
        </Button>
      )}
    </div>
  );
}

export default function DemoHost() {
  const open = useDemo((s) => s.open);
  const seq = useDemo((s) => s.seq);
  useEffect(() => {
    if (open) resetSession();
  }, [open, seq]);
  return (
    <Sheet open={open} onClose={closeDemo} title={DEMO.title} size="lg" dismissGuard={false} footer={open ? <Footer /> : undefined}>
      {open ? <Body key={seq} /> : null}
    </Sheet>
  );
}

