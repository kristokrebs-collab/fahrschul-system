/** Messages between `labRunner.ts` and `lab.worker.ts` (P07). */
import type { ExtraJobInput, ExtraResult } from "../lab/extras/job";
import type { LabJobInput, LabPhase, LabResult } from "./job";

export type LabRequest = { kind: "run"; id: number; input: LabJobInput } | { kind: "extra"; id: number; input: ExtraJobInput };

export type LabResponse =
  | { id: number; kind: "progress"; progress: number; phase: LabPhase }
  | { id: number; kind: "done"; result: LabResult }
  | { id: number; kind: "extra-done"; result: ExtraResult }
  | { id: number; kind: "error"; message: string };
