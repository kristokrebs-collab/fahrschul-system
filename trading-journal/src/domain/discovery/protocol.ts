/** Messages between `runner.ts` and `discovery.worker.ts`. */
import type { DiscoveryInput, DiscoveryResult } from "./types";

export interface DiscoveryRequest {
  id: number;
  input: DiscoveryInput;
}

export type DiscoveryResponse = { id: number; kind: "progress"; progress: number } | { id: number; kind: "done"; result: DiscoveryResult } | { id: number; kind: "error"; message: string };
