import type { HyblockReading, Settings, StoreApi, StoreMode, Trade } from "@/domain/types";

export type { StoreApi, StoreMode };

/** What an adapter knows about the journal at a point in time. */
export interface StorageSnapshot {
  trades: Trade[];
  settings: Settings;
  hyblock: HyblockReading[];
}

export type SnapshotPatch = Partial<StorageSnapshot>;

export type AdapterEvent =
  | { type: "patch"; patch: SnapshotPatch }
  | { type: "error"; error: unknown }
  | { type: "quarantine"; count: number };

export interface StorageAdapter {
  /** `local` or `cloud`. */
  readonly mode: Extract<StoreMode, "local" | "cloud">;
  /** Synchronous view of the currently known data (local: reads localStorage; cloud: last snapshots). */
  load(): StorageSnapshot;
  /** Write API identical to the original bundle. */
  api: StoreApi;
  /** Emits patches after writes (local) or after remote snapshots (cloud), plus errors. */
  subscribe(listener: (event: AdapterEvent) => void): () => void;
  /** Bulk write used by backup import/restore. */
  replaceAll(snapshot: StorageSnapshot): Promise<void>;
  dispose(): void;
}
