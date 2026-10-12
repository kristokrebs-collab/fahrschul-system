/** Messages between `labRunner.ts` and `lab.worker.ts` (P07). */
import type { LabJobInput, LabPhase, LabResult } from "./job";

export type LabRequest = { kind: "run"; id: number; input: LabJobInput };

export type LabResponse =
  | { id: number; kind: "progress"; progress: number; phase: LabPhase }
  | { id: number; kind: "done"; result: LabResult }
  | { id: number; kind: "error"; message: string };
