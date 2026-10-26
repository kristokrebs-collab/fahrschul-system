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
import type { AktienSlotProps } from "./types";

const AnalystPanel = lazy(() => import("@/views/analyst/AnalystPanel"));
const DcfPanel = lazy(() => import("@/views/analyst/DcfPanel"));
const ThesisPanel = lazy(() => import("@/views/analyst/ThesisPanel"));
const CongressCard = lazy(() => import("@/views/aktien/kongress/CongressCard"));

/** a stock ticker the SEC knows (letters, dot, hyphen) – a crypto pair like BTCUSDT is not one, the field stays empty then */
const STOCK_TICKER = /^[A-Z][A-Z.-]{0,5}$/;

function Loading({ id }: { id: string }) {
  return (
    <div className="rounded-xl border border-line-2 bg-ink-950/40 p-4 text-[12px] text-faint" data-testid={id} role="status">
      Wird geladen …
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

  return (
    <div className="grid min-w-0 gap-6" data-testid="aktien-analyse" data-state="ready">
      <Suspense fallback={<Loading id="aktien-analyse-zahlen-loading" />}>
        <AnalystPanel ticker={ticker} onUseInDcf={useInDcf} onStartThesis={startThesis} />
      </Suspense>
      <div ref={dcfRef} className="scroll-mt-24" data-testid="aktien-analyse-dcf">
        <Suspense fallback={<Loading id="aktien-analyse-dcf-loading" />}>
          <DcfPanel ticker={seed?.ticker ?? ticker} seed={seed?.seed ?? null} />
        </Suspense>
      </div>
      <div ref={thesisRef} className="scroll-mt-24" data-testid="aktien-analyse-these">
        <Suspense fallback={<Loading id="aktien-analyse-these-loading" />}>
          <ThesisPanel ticker={thesisTicker || ticker} />
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
