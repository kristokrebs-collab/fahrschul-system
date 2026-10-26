/**
 * The bodies of the two slots (`Slots.tsx`). `AnalystSlotImpl` hosts the three analyst panels (Quartalszahlen · DCF · Kaufthese,
 * F68 / F69, `src/views/analyst`), each lazy and each with its own frame. The host only does two hand-overs the panels ask for:
 * "In den DCF-Rechner übernehmen" (the starting numbers go to the DCF panel) and "These anlegen" (the ticker goes to the thesis
 * panel) – and scrolls there. `CongressSlotImpl` hosts the Congress tracker (`./kongress`), lazy as well: the stock trades of
 * members of the House as the Clerk's public reports state them.
 */
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { DcfSeed } from "@/domain/dcf";
import { useReducedFx } from "@/motion/useReducedFx";
import { PendingBlock } from "@/ui/PendingCard";
import { planHash, planPageExists } from "./ResultsCard";
import type { AktienSlotProps } from "./types";

const AnalystPanel = lazy(() => import("@/views/analyst/AnalystPanel"));
const DcfPanel = lazy(() => import("@/views/analyst/DcfPanel"));
const ThesisPanel = lazy(() => import("@/views/analyst/ThesisPanel"));
const CongressCard = lazy(() => import("@/views/aktien/kongress/CongressCard"));

/** a stock ticker the SEC knows (letters, dot, hyphen) – a crypto pair like BTCUSDT is not one, the field stays empty then */
const STOCK_TICKER = /^[A-Z][A-Z.-]{0,5}$/;

/** The place of a panel that loads as its own chunk, in the height of the finished panel (measured): nothing below it moves. */
const PANEL_SIZE: Record<string, number | { base: number; lg: number }> = {
  "aktien-analyse-zahlen-loading": { base: 516, lg: 448 },
  "aktien-analyse-dcf-loading": { base: 1744, lg: 1153 },
  "aktien-analyse-these-loading": { base: 785, lg: 530 },
  "aktien-kongress-card-loading": { base: 1672, lg: 889 },
};

function Loading({ id }: { id: string }) {
  return (
    <div data-testid={id} role="status" aria-label="Wird geladen …">
      <PendingBlock height={PANEL_SIZE[id] ?? 120} />
    </div>
  );
}

export function AnalystSlotImpl({ symbol }: AktienSlotProps) {
  const reduced = useReducedFx();
  const ticker = symbol && STOCK_TICKER.test(symbol) ? symbol : "";
  const [seed, setSeed] = useState<{ seed: DcfSeed; ticker: string } | null>(null);
  const [thesisTicker, setThesisTicker] = useState("");
  const dcfRef = useRef<HTMLDivElement>(null);
  const thesisRef = useRef<HTMLDivElement>(null);

  const reveal = useCallback(
    (el: HTMLElement | null) => {
      // after the panel re-rendered with the new values; one frame is enough, the panels are already mounted
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" }));
    },
    [reduced],
  );
  const useInDcf = useCallback(
    (s: DcfSeed, t: string) => {
      setSeed({ seed: s, ticker: t });
      reveal(dcfRef.current);
    },
    [reveal],
  );
  const startThesis = useCallback(
    (t: string) => {
      setThesisTicker(t);
      reveal(thesisRef.current);
    },
    [reveal],
  );

  // the Handelsplan reads the ticker from the link (market and direction only – nothing is saved or sent); the page may not exist in a build without it
  const planOk = planPageExists();
  const createPlan = useCallback((t: string) => {
    window.location.hash = planHash(t, "long");
  }, []);

  return (
    <div className="grid min-w-0 gap-6" data-testid="aktien-analyse" data-state="ready">
      <Suspense fallback={<Loading id="aktien-analyse-zahlen-loading" />}>
        <AnalystPanel hosted ticker={ticker} onUseInDcf={useInDcf} onStartThesis={startThesis} {...(planOk ? { onCreatePlan: createPlan } : {})} />
      </Suspense>
      <div ref={dcfRef} className="scroll-mt-24" data-testid="aktien-analyse-dcf">
        <Suspense fallback={<Loading id="aktien-analyse-dcf-loading" />}>
          <DcfPanel hosted ticker={seed?.ticker ?? ticker} seed={seed?.seed ?? null} />
        </Suspense>
      </div>
      <div ref={thesisRef} className="scroll-mt-24" data-testid="aktien-analyse-these">
        <Suspense fallback={<Loading id="aktien-analyse-these-loading" />}>
          <ThesisPanel hosted ticker={thesisTicker || ticker} />
        </Suspense>
      </div>
    </div>
  );
}

export function CongressSlotImpl(props: AktienSlotProps) {
  return (
    <Suspense fallback={<Loading id="aktien-kongress-card-loading" />}>
      <CongressCard {...props} />
    </Suspense>
  );
}
