/**
 * The public contract of the three analyst panels (F68 / F69). Types only; importing this file costs nothing at run time.
 *
 *   const AnalystPanel = lazy(() => import("@/views/analyst/AnalystPanel"));
 *   const DcfPanel = lazy(() => import("@/views/analyst/DcfPanel"));
 *   const ThesisPanel = lazy(() => import("@/views/analyst/ThesisPanel"));
 *
 * The page `#aktien` (built elsewhere) hosts them in an `AnalystSlot`: it lazy-loads the panels, passes the ticker the person is
 * looking at and wires the hand-overs ("In den DCF-Rechner übernehmen", "These anlegen"). The panels work alone too: each one
 * can load the SEC numbers itself, and the DCF works without any SEC data (typed numbers).
 *
 * Nothing here places an order or changes anything outside its own settings key (`settings.theses`); every write is the result of
 * a click or an edit of the person on that very thing.
 */
import type { AnalystResult } from "@/domain/analyst";
import type { DcfSeed } from "@/domain/dcf";
import type { SecFilingsPayload } from "@/market/sec";
import type { SecStamped } from "@/market/sec";

/** What a successful load of the analyst hands to the host. */
export interface AnalystLoaded {
  ticker: string;
  result: AnalystResult;
  /** the filings list of the same company; `null` when it could not be read (the numbers are still shown) */
  filings: SecStamped<SecFilingsPayload> | null;
}

interface Common {
  className?: string;
  /** the panel without its own `Card` frame (when the host already has one) */
  bare?: boolean;
  /**
   * the host page carries the one `AnalysisNote` ("Keine professionelle Finanzberatung.", once per page): the panel then keeps only
   * its own lead sentence (what its numbers are made of) as a plain line and leaves the standing sentence to the page
   */
  hosted?: boolean;
  /** tests: a `fetch` for the SEC functions instead of the real one */
  fetchImpl?: typeof fetch;
}

export interface AnalystPanelProps extends Common {
  /** start value of the ticker field (the company the page is about); the person can type another */
  ticker?: string;
  /** load at once when a ticker is given (default: wait for the button) */
  autoLoad?: boolean;
  onLoaded?: (loaded: AnalystLoaded) => void;
  /** "In den DCF-Rechner übernehmen" – the button exists only when the host gives this; the host decides what happens */
  onUseInDcf?: (seed: DcfSeed, ticker: string) => void;
  /** "These zu dieser Firma anlegen" – the button exists only when the host gives this */
  onStartThesis?: (ticker: string) => void;
  /** "Plan erstellen →" – the button exists only when the host gives this (the host opens the Handelsplan for the ticker; nothing is saved) */
  onCreatePlan?: (ticker: string) => void;
}

export interface DcfPanelProps extends Common {
  /** the company to load SEC starting values for */
  ticker?: string;
  /** starting values the host already has (e.g. from `onUseInDcf`); filled into the form when it changes */
  seed?: DcfSeed | null;
  /** an `Date.now()`-like clock (tests) */
  now?: () => number;
}

export interface ThesisPanelProps extends Common {
  /** a ticker for a new thesis ("These anlegen" of the analyst); selects an existing thesis of that company when there is one */
  ticker?: string;
  /** an `Date.now()`-like clock (tests) */
  now?: () => number;
  /** check the criteria of monitored theses when the panel opens (default true) */
  monitor?: boolean;
}
