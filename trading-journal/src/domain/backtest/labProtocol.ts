/** Messages between `labRunner.ts` and `lab.worker.ts` (P07). */
import type { ExtraJobInput, ExtraResult } from "../lab/extras/job";
import type { SearchJobInput, SearchPhase, SearchResult } from "../lab/search/types";
import type { LabJobInput, LabPhase, LabResult } from "./job";

export type LabRequest = { kind: "run"; id: number; input: LabJobInput } | { kind: "extra"; id: number; input: ExtraJobInput } | { kind: "search"; id: number; input: SearchJobInput };

export type LabResponse =
  | { id: number; kind: "progress"; progress: number; phase: LabPhase }
  | { id: number; kind: "done"; result: LabResult }
  | { id: number; kind: "extra-done"; result: ExtraResult }
  /** Strategiesuche: Fortschritt mit der echten Zahl („412 von 1.000 geprüft“) */
  | { id: number; kind: "search-progress"; progress: number; phase: SearchPhase; done: number; total: number }
  | { id: number; kind: "search-done"; result: SearchResult }
  | { id: number; kind: "error"; message: string };
